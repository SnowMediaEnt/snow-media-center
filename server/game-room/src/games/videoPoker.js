// Phase 4 — Video Poker (Jacks or Better). Two-step, stateful, server-authoritative.
//
//   vp_deal  -> shuffle a 52-card deck once (provably fair), deal 5, deduct the
//               bet, return the hand + the commitment hash. The rest of the deck
//               is kept server-side as the draw pile.
//   vp_draw  -> replace the non-held cards from the draw pile (in order), score
//               the final 5-card hand against the 9/6 Jacks-or-Better paytable,
//               record the round, credit the payout, and reveal the server seed.
//
// All cards and the shuffle live on the server. The client never sees the deck
// order or the server seed until settlement, so it can't predict the draw.
//
// Round state is held in a module-level Map keyed by userId. This is safe ONLY
// because the server runs as a single PM2 fork (one process); in-memory is fine.
import { supabase } from '../supabase.js';
import { applyChange, getOrCreateBalance } from '../chips.js';
import { commit, shuffle } from '../provablyFair.js';
import * as config from '../config.js';

// Auto-settle a hanging round after this long (player walked away mid-hand).
const ROUND_TIMEOUT_MS = 90_000;

// Canonical 9/6 Jacks-or-Better paytable (multiplier × bet) and bets. The
// config export (config.videoPoker, added per the delivery instructions) is the
// runtime source so it can be retuned live; these locals mirror it and act as a
// fallback so the module imports cleanly even before config is wired (e.g. in
// the evaluator unit test, which needs no env/DB). Keep them identical.
export const PAYOUTS = {
  royal_flush: 800,
  straight_flush: 50,
  four_of_a_kind: 25,
  full_house: 9,
  flush: 6,
  straight: 4,
  three_of_a_kind: 3,
  two_pair: 2,
  jacks_or_better: 1,
  nothing: 0,
};
const DEFAULT_BETS = [10, 25, 50, 100, 250, 500, 1000];

// Runtime config view — prefer config.videoPoker once wired, else the locals.
const videoPoker = config.videoPoker ?? { bets: DEFAULT_BETS, payouts: PAYOUTS };

// --- Card model ------------------------------------------------------------
// A card is { rank, suit }. rank is one of RANKS; suit is one of SUITS.
// rankValue: 2..14 (Ace high = 14). Ace-low straights handled in the evaluator.
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['S', 'H', 'D', 'C']; // spades, hearts, diamonds, clubs
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2])); // 2..14

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck; // 52 cards, ordered; shuffled per round before dealing
}

// --- Hand evaluator (the crux) ---------------------------------------------
// Takes exactly 5 cards, returns { rank, multiplier }.
// rank is one of the paytable keys (or 'nothing'). multiplier comes from config.
//
// Detection order (highest first):
//   royal_flush, straight_flush, four_of_a_kind, full_house, flush, straight,
//   three_of_a_kind, two_pair, jacks_or_better, nothing.
export function evaluateHand(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) {
    throw new Error('evaluateHand: need exactly 5 cards');
  }

  const values = cards.map((c) => RANK_VALUE[c.rank]).sort((a, b) => a - b);
  const suits = cards.map((c) => c.suit);

  const isFlush = suits.every((s) => s === suits[0]);

  // Straight detection. Two cases:
  //   1. Ace-high / mid straights: five distinct consecutive values.
  //   2. Ace-low wheel A-2-3-4-5 (values 14,2,3,4,5 -> treat Ace as 1).
  const distinct = [...new Set(values)];
  let isStraight = false;
  let straightHigh = 0; // top card of the straight (for royal/straight-flush)
  if (distinct.length === 5) {
    if (values[4] - values[0] === 4) {
      isStraight = true;
      straightHigh = values[4];
    } else if (
      // Wheel: A,2,3,4,5 -> Ace plays low. Highest card of the straight is the 5.
      values[0] === 2 &&
      values[1] === 3 &&
      values[2] === 4 &&
      values[3] === 5 &&
      values[4] === 14
    ) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  // Rank multiplicities, e.g. {14:2, 5:1, 9:1, 2:1} -> counts [2,1,1,1].
  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const countVals = Object.values(counts).sort((a, b) => b - a); // desc

  // Score against the local canonical paytable so evaluation needs no config
  // (keeps the evaluator pure + unit-testable). Identical to config.videoPoker.
  const pay = (rank) => ({ rank, multiplier: PAYOUTS[rank] ?? 0 });

  if (isStraight && isFlush) {
    // Royal = straight flush with the top card being the Ace (10-J-Q-K-A).
    if (straightHigh === 14) return pay('royal_flush');
    return pay('straight_flush');
  }
  if (countVals[0] === 4) return pay('four_of_a_kind');
  if (countVals[0] === 3 && countVals[1] === 2) return pay('full_house');
  if (isFlush) return pay('flush');
  if (isStraight) return pay('straight');
  if (countVals[0] === 3) return pay('three_of_a_kind');
  if (countVals[0] === 2 && countVals[1] === 2) return pay('two_pair');
  if (countVals[0] === 2) {
    // One pair only pays if it's Jacks, Queens, Kings, or Aces.
    const pairValue = Number(
      Object.keys(counts).find((v) => counts[v] === 2)
    );
    if (pairValue >= RANK_VALUE['J']) return pay('jacks_or_better');
    return pay('nothing');
  }
  return pay('nothing');
}

// --- Round state -----------------------------------------------------------
const rounds = new Map(); // userId -> round state

function clearRoundTimer(state) {
  if (state?.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

// --- vp_deal ---------------------------------------------------------------
export async function dealVideoPoker(userId, betIn, clientSeedIn) {
  const bet = Number(betIn);
  if (!videoPoker.bets.includes(bet)) return { ok: false, error: 'invalid_bet' };

  // If a round is somehow already open, settle it as a no-hold draw first so we
  // never leak chips or double-deduct. (Defensive; the UI shouldn't allow this.)
  if (rounds.has(userId)) {
    try {
      await resolveOpen(userId);
    } catch {
      // best-effort; fall through and start fresh
      const stale = rounds.get(userId);
      clearRoundTimer(stale);
      rounds.delete(userId);
    }
  }

  const balance = await getOrCreateBalance(userId);
  if (bet > balance) return { ok: false, error: 'insufficient_balance', balance };

  const clientSeed =
    typeof clientSeedIn === 'string' && clientSeedIn
      ? clientSeedIn.slice(0, 64)
      : 'video_poker';
  const { serverSeed, serverSeedHash } = commit();
  const nonce = 0;

  // Shuffle once; deal the first 5; keep indices 5..51 as the draw pile.
  const deck = shuffle(buildDeck(), serverSeed, clientSeed, nonce);
  const hand = deck.slice(0, 5);
  const drawPile = deck.slice(5); // consumed in order on the draw

  // Stake the bet up front (atomic; rejects if it would go negative).
  const newBalance = await applyChange(userId, -bet, 'video_poker_bet');

  const state = {
    bet,
    dealt: hand,
    hand, // current hand (mutated on draw)
    drawPile,
    drawIndex: 0,
    serverSeed,
    serverSeedHash,
    clientSeed,
    nonce,
    status: 'dealt',
    timer: null,
  };
  // Auto-settle if the player vanishes mid-hand (counts as a no-hold draw).
  state.timer = setTimeout(() => {
    resolveOpen(userId).catch(() => {});
  }, ROUND_TIMEOUT_MS);
  rounds.set(userId, state);

  return {
    ok: true,
    hand,
    bet,
    balance: newBalance,
    serverSeedHash,
  };
}

// --- vp_draw ---------------------------------------------------------------
// holds: array of 5 booleans — true = keep that dealt card, false = replace it
// from the top of the draw pile (in card order).
export async function draw(userId, holdsIn) {
  const state = rounds.get(userId);
  if (!state || state.status !== 'dealt') {
    return { ok: false, error: 'no_active_round' };
  }
  clearRoundTimer(state);
  // Guard against concurrent draws (a second emit while the first is settling).
  state.status = 'settling';

  // Normalise holds to exactly 5 booleans.
  const holds = Array.from({ length: 5 }, (_, i) => Boolean(holdsIn?.[i]));

  // Build the final hand: held cards stay; the rest come from the draw pile.
  const finalHand = state.dealt.map((card, i) => {
    if (holds[i]) return card;
    return state.drawPile[state.drawIndex++];
  });
  state.hand = finalHand;

  // evaluateHand determines the RANK (config-independent). The runtime
  // multiplier comes from the live config paytable so it can be retuned without
  // a code change; falls back to the canonical local value.
  const { rank } = evaluateHand(finalHand);
  const multiplier = videoPoker.payouts?.[rank] ?? PAYOUTS[rank] ?? 0;
  const payout = state.bet * multiplier;
  const win = multiplier > 0;

  // Record the round (audit + provably-fair reveal). The bet was already taken
  // at deal time, so we only credit the payout here.
  const { data: round, error: roundErr } = await supabase
    .from('game_rounds')
    .insert({
      user_id: userId,
      game: 'video_poker',
      bet: state.bet,
      result: {
        dealt: state.dealt,
        holds,
        hand: finalHand,
        rank,
        multiplier,
        payout,
        net: payout - state.bet,
      },
      server_seed_hash: state.serverSeedHash,
      server_seed: state.serverSeed,
      client_seed: state.clientSeed,
      nonce: state.nonce,
    })
    .select('id')
    .single();
  if (roundErr) {
    // Re-open the round so a retry is possible rather than eating the bet.
    state.status = 'dealt';
    state.drawIndex = 0;
    state.hand = state.dealt;
    clearRoundTimer(state);
    state.timer = setTimeout(() => {
      resolveOpen(userId).catch(() => {});
    }, ROUND_TIMEOUT_MS);
    throw roundErr;
  }

  // Credit the payout (0 on a loss -> no-op change, still ledgered for audit).
  const balance = await applyChange(
    userId,
    payout,
    win ? 'video_poker_win' : 'video_poker_loss',
    round.id
  );

  // Round complete — drop the state.
  rounds.delete(userId);

  return {
    ok: true,
    dealt: state.dealt,
    holds,
    hand: finalHand,
    rank,
    multiplier,
    payout,
    net: payout - state.bet, // bet already staked; net counts that stake
    bet: state.bet,
    win,
    balance,
    roundId: round.id,
    payouts: videoPoker.payouts,
    fair: {
      serverSeedHash: state.serverSeedHash,
      serverSeed: state.serverSeed,
      clientSeed: state.clientSeed,
      nonce: state.nonce,
    },
  };
}

// --- resolveOpen -----------------------------------------------------------
// Settle whatever round is open as a draw that holds NOTHING (every card
// replaced from the draw pile). Called on disconnect or on the timeout so a
// round can't hang forever with the bet stuck staked. No-op if nothing is open.
export async function resolveOpen(userId) {
  const state = rounds.get(userId);
  if (!state || state.status !== 'dealt') return { ok: false, error: 'no_active_round' };
  return draw(userId, [false, false, false, false, false]);
}
