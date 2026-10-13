// Phase 6 — Casino Hold'em. Single-player poker vs the dealer with five shared
// community cards. Stateful, two-step, server-authoritative: the server holds
// the shuffled deck + every card per user and is the only authority on cards,
// outcomes, and balance. The client sends intents (deal/call/fold); the server
// replies with the visible state and, on settle, the provably-fair reveal so the
// shuffle can be verified after the fact.
//
// Lifecycle:
//   ch_deal { ante, clientSeed? } -> deduct the ANTE, shuffle the deck once, and
//       PREDETERMINE the player's 2 hole cards, the dealer's 2 hole cards, and
//       all 5 community cards from that single shuffle. Reveal to the client ONLY
//       the player's 2 hole cards + the FLOP (first 3 community). The player then
//       decides: CALL (bet 2× ante) or FOLD.
//   ch_call  -> stake the CALL = 2× ante, reveal the turn + river (community is
//       now 5) and the dealer's hole cards, then settle.
//   ch_fold  -> forfeit the ante (already deducted), end the round, no payout.
//
// Single PM2 fork process => one in-memory round per user is safe. Each round
// carries a ~90s auto-resolve timer; on disconnect/timeout an undecided hand is
// treated as a FOLD so the ante can't hang staked forever.
//
// PAYOUT CONVENTION (read this before touching the math):
//   The ante and the call are DEDUCTED up front via applyChange (negative
//   deltas). `payout` is the TOTAL number of chips RETURNED to the player at
//   settlement — never negative — credited in one applyChange(+payout). So:
//       net = payout - totalWagered,   totalWagered = ante + call
//   and because payout >= 0 and the stakes were already taken, the balance can
//   never go negative. A push returns the stake(s); a win returns stake + win.
import { supabase } from '../supabase.js';
import { applyChange, getOrCreateBalance } from '../chips.js';
import { commit, shuffle } from '../provablyFair.js';
import * as config from '../config.js';

// The parent integrates `export const casinoHoldem = {...}` into config.js (see
// the CONFIG BLOCK in the handoff). Fall back to sane defaults so this module
// still loads in tests / before that edit lands. Keep these identical to config.
const DEFAULT_ANTES = [10, 25, 50, 100, 250, 500, 1000];
const DEFAULT_ANTE_BONUS = {
  royal_flush: 100,
  straight_flush: 20,
  four_of_a_kind: 10,
  full_house: 3,
  flush: 2,
  straight: 1,
};
const casinoHoldem =
  config.casinoHoldem ?? {
    antes: DEFAULT_ANTES,
    anteBonus: DEFAULT_ANTE_BONUS,
    roundTimeoutMs: 90_000,
    raiseMultipliers: [2, 3, 4],
  };

const ROUND_TIMEOUT_MS = casinoHoldem.roundTimeoutMs ?? 90_000;
// Allowed call multiples (× ante). First entry is the standard call; the rest
// are raises. The player picks one when they call.
const RAISE_MULTS = casinoHoldem.raiseMultipliers ?? [2, 3, 4];
// Use the live config paytable when wired, else the canonical local one.
const ANTE_BONUS = casinoHoldem.anteBonus ?? DEFAULT_ANTE_BONUS;

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

// --- Hand category model ---------------------------------------------------
// Numeric category for comparison (higher = stronger). The string key is for
// the paytable + UI labels. This is the SAME rank vocabulary as videoPoker.js,
// extended downward to the categories Casino Hold'em needs (two_pair, one_pair,
// high_card) since the dealer-qualify threshold and showdown use full poker
// rankings, not Jacks-or-Better.
export const CATEGORY = {
  high_card: 1,
  one_pair: 2,
  two_pair: 3,
  three_of_a_kind: 4,
  straight: 5,
  flush: 6,
  full_house: 7,
  four_of_a_kind: 8,
  straight_flush: 9,
  royal_flush: 10,
};

// --- 5-card evaluator ------------------------------------------------------
// Takes exactly 5 cards, returns { category, rank, score } where:
//   category : numeric CATEGORY value (for fast comparison)
//   rank     : the string key (paytable/label)
//   score    : a comparable array [category, ...tiebreakers] — compare two
//              hands by comparing these arrays lexicographically (compareScore).
// Ace-low wheel (A-2-3-4-5) is handled; royal_flush is a straight_flush whose
// top card is the Ace (10-J-Q-K-A).
export function evaluate5(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) {
    throw new Error('evaluate5: need exactly 5 cards');
  }
  const values = cards.map((c) => RANK_VALUE[c.rank]).sort((a, b) => b - a); // desc
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  // Rank multiplicities -> groups sorted by (count desc, value desc). This is the
  // canonical tiebreaker ordering: e.g. a full house compares trips first, then
  // the pair; two pair compares the high pair, then the low pair, then kicker.
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]; // by count desc
    return b[0] - a[0]; // then by value desc
  });
  const countPattern = groups.map((g) => g[1]); // e.g. [3,2], [2,2,1], [1,1,1,1,1]
  const groupValues = groups.map((g) => g[0]); // values ordered by the same key

  // Straight detection (needs 5 distinct values). Ace plays low in the wheel.
  const distinct = [...new Set(values)]; // already desc
  let isStraight = false;
  let straightHigh = 0;
  if (distinct.length === 5) {
    if (distinct[0] - distinct[4] === 4) {
      isStraight = true;
      straightHigh = distinct[0];
    } else if (
      // Wheel A-2-3-4-5 -> values are 14,5,4,3,2; the straight's high card is 5.
      distinct[0] === 14 &&
      distinct[1] === 5 &&
      distinct[2] === 4 &&
      distinct[3] === 3 &&
      distinct[4] === 2
    ) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  const make = (rank, tiebreakers) => ({
    category: CATEGORY[rank],
    rank,
    score: [CATEGORY[rank], ...tiebreakers],
  });

  if (isStraight && isFlush) {
    if (straightHigh === 14) return make('royal_flush', [straightHigh]);
    return make('straight_flush', [straightHigh]);
  }
  if (countPattern[0] === 4) {
    // [quad value, kicker]
    return make('four_of_a_kind', groupValues);
  }
  if (countPattern[0] === 3 && countPattern[1] === 2) {
    // [trips value, pair value]
    return make('full_house', groupValues);
  }
  if (isFlush) {
    // All five values, high to low.
    return make('flush', values);
  }
  if (isStraight) {
    return make('straight', [straightHigh]);
  }
  if (countPattern[0] === 3) {
    // [trips value, kicker hi, kicker lo]
    return make('three_of_a_kind', groupValues);
  }
  if (countPattern[0] === 2 && countPattern[1] === 2) {
    // [high pair, low pair, kicker]
    return make('two_pair', groupValues);
  }
  if (countPattern[0] === 2) {
    // [pair value, kicker hi, mid, lo]
    return make('one_pair', groupValues);
  }
  // [all five values high to low]
  return make('high_card', values);
}

// Compare two `score` arrays lexicographically. > 0 if a beats b, < 0 if b beats
// a, 0 if exactly tied (a true split). Lengths match within a category; across
// categories the first element (the category) already decides it.
export function compareScore(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// --- best-5-of-7 -----------------------------------------------------------
// Evaluate every C(7,5)=21 five-card subset of (2 hole + 5 community) and keep
// the strongest. Returns the same shape as evaluate5 for the best hand.
const COMBOS_7_CHOOSE_5 = (() => {
  const combos = [];
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++)
      for (let c = b + 1; c < 7; c++)
        for (let d = c + 1; d < 7; d++)
          for (let e = d + 1; e < 7; e++) combos.push([a, b, c, d, e]);
  return combos; // 21 index quintuples
})();

export function bestOfSeven(sevenCards) {
  if (!Array.isArray(sevenCards) || sevenCards.length !== 7) {
    throw new Error('bestOfSeven: need exactly 7 cards');
  }
  let best = null;
  for (const idx of COMBOS_7_CHOOSE_5) {
    const five = [
      sevenCards[idx[0]],
      sevenCards[idx[1]],
      sevenCards[idx[2]],
      sevenCards[idx[3]],
      sevenCards[idx[4]],
    ];
    const ev = evaluate5(five);
    if (best === null || compareScore(ev.score, best.score) > 0) best = ev;
  }
  return best;
}

// Dealer qualifies with a pair of FOURS or better, i.e. the best hand is at
// least one_pair AND, if it IS exactly one pair, the pair value is >= 4.
// (Two pair or any higher category always qualifies.) Anything weaker — a pair
// of 3s, a pair of 2s, or high card — does NOT qualify.
export function dealerQualifies(dealerBest) {
  if (dealerBest.category > CATEGORY.one_pair) return true;
  if (dealerBest.category === CATEGORY.one_pair) {
    // score = [category, pairValue, kickers...] — second element is the pair value.
    return dealerBest.score[1] >= RANK_VALUE['4']; // 4
  }
  return false; // high_card
}

// Ante-bonus multiplier for the PLAYER's best hand (straight-or-better only).
// Lower hands return 0. Lives in config so it can be retuned live.
export function anteBonusMultiplier(playerRank) {
  return ANTE_BONUS[playerRank] ?? 0;
}

// --- Settlement math (pure) ------------------------------------------------
// Computes the outcome + the TOTAL payout (chips returned to the player) given
// the player's and dealer's best hands and the ante. The CALL is fixed at
// 2× ante. See the PAYOUT CONVENTION block at the top of the file.
//
// Cases:
//   Dealer does NOT qualify: the CALL pushes (returns 2× ante) and the ANTE pays
//     1:1 PLUS the ante bonus -> ante portion returns ante + ante (the 1:1 win)
//     + ante × bonus. So payout = 2*ante (call push) + ante*2 + ante*bonus.
//   Dealer qualifies and player WINS: ANTE pays 1:1 plus the ante bonus, CALL
//     pays 1:1 -> payout = (ante + ante) + ante*bonus + (call + call).
//   Dealer qualifies and player LOSES: lose both ante and call -> payout = 0.
//   TIE (exact split): push both -> payout = ante + call.
// Returns { outcome, payout, anteBonus, dealerQualified }.
export function settleHoldem(playerBest, dealerBest, ante, call = 2 * ante) {
  const qualified = dealerQualifies(dealerBest);
  const bonusMult = anteBonusMultiplier(playerBest.rank);
  const anteBonus = ante * bonusMult;

  if (!qualified) {
    // Call pushes; ante pays 1:1 + ante bonus (regardless of the comparison).
    const payout = call + ante * 2 + anteBonus;
    return { outcome: 'dealer_no_qualify', payout, anteBonus, dealerQualified: false };
  }

  const cmp = compareScore(playerBest.score, dealerBest.score);
  if (cmp > 0) {
    // Player wins: ante 1:1 + bonus, call 1:1.
    const payout = ante * 2 + anteBonus + call * 2;
    return { outcome: 'win', payout, anteBonus, dealerQualified: true };
  }
  if (cmp < 0) {
    // Player loses both stakes.
    return { outcome: 'lose', payout: 0, anteBonus: 0, dealerQualified: true };
  }
  // Exact tie -> push both stakes (no ante bonus on a push).
  return { outcome: 'push', payout: ante + call, anteBonus: 0, dealerQualified: true };
}

// --- Round state -----------------------------------------------------------
const rounds = new Map(); // userId -> round state

function clearRound(userId) {
  const r = rounds.get(userId);
  if (r?.timer) clearTimeout(r.timer);
  rounds.delete(userId);
}

function armTimeout(userId) {
  const r = rounds.get(userId);
  if (!r) return;
  if (r.timer) clearTimeout(r.timer);
  // Auto-FOLD an undecided hand if the player walks away so a round can't hang.
  r.timer = setTimeout(() => {
    fold(userId).catch(() => {});
  }, ROUND_TIMEOUT_MS);
  if (typeof r.timer.unref === 'function') r.timer.unref();
}

// --- ch_deal ---------------------------------------------------------------
// Validate + deduct the ante, shuffle once, predetermine ALL cards, reveal only
// the player's 2 hole cards + the flop. The player then calls or folds.
export async function dealCasinoHoldem(userId, anteIn, clientSeedIn) {
  const ante = Number(anteIn);
  if (!casinoHoldem.antes.includes(ante)) return { ok: false, error: 'invalid_bet' };
  if (rounds.has(userId)) return { ok: false, error: 'round_in_progress' };

  const balance = await getOrCreateBalance(userId);
  if (ante > balance) return { ok: false, error: 'insufficient_balance', balance };

  const clientSeed =
    typeof clientSeedIn === 'string' && clientSeedIn
      ? clientSeedIn.slice(0, 64)
      : 'casino_holdem';
  const { serverSeed, serverSeedHash } = commit();
  const nonce = 0;

  // Shuffle the full deck ONCE; everything is drawn off this ordered deck so the
  // whole round is fixed (and verifiable) at deal time. Layout (as at a table):
  //   player hole = deck[0], deck[2]; dealer hole = deck[1], deck[3];
  //   community   = deck[4..8] (flop 4,5,6 / turn 7 / river 8).
  const deck = shuffle(buildDeck(), serverSeed, clientSeed, nonce);
  const playerHole = [deck[0], deck[2]];
  const dealerHole = [deck[1], deck[3]];
  const community = [deck[4], deck[5], deck[6], deck[7], deck[8]];

  // Deduct the ante up front (atomic; balance >= ante checked above).
  const afterAnte = await applyChange(userId, -ante, 'casino_holdem_ante');

  const r = {
    deck,
    playerHole,
    dealerHole,
    community,
    ante,
    call: 0, // set when the player calls
    stage: 'decision',
    serverSeed,
    serverSeedHash,
    clientSeed,
    nonce,
    balance: afterAnte, // balance after the ante, before any settlement credit
    timer: null,
  };
  rounds.set(userId, r);
  armTimeout(userId);

  return {
    ok: true,
    status: 'decision',
    playerHole,
    flop: community.slice(0, 3), // reveal the flop only
    ante,
    callCost: 2 * ante,
    // The call (2×) plus any raises the player may pick, with their chip cost.
    raiseOptions: RAISE_MULTS.map((m) => ({ multiplier: m, cost: m * ante })),
    balance: afterAnte,
    serverSeedHash,
  };
}

// Settle a called hand: reveal turn + river + dealer hole, score best-5-of-7,
// credit the payout, record the round, and return the reveal.
async function settle(userId) {
  const r = rounds.get(userId);
  if (!r) return { ok: false, error: 'no_active_round' };

  const playerBest = bestOfSeven([...r.playerHole, ...r.community]);
  const dealerBest = bestOfSeven([...r.dealerHole, ...r.community]);
  const { outcome, payout, anteBonus, dealerQualified } = settleHoldem(
    playerBest,
    dealerBest,
    r.ante,
    r.call
  );
  const totalWagered = r.ante + r.call; // call = 2*ante
  const net = payout - totalWagered;

  // Record the round (audit + provably-fair reveal data).
  const { data: round, error: roundErr } = await supabase
    .from('game_rounds')
    .insert({
      user_id: userId,
      game: 'casino_holdem',
      bet: totalWagered,
      result: {
        playerHole: r.playerHole,
        dealerHole: r.dealerHole,
        community: r.community,
        playerRank: playerBest.rank,
        dealerRank: dealerBest.rank,
        dealerQualified,
        outcome,
        ante: r.ante,
        call: r.call,
        anteBonus,
        payout,
        net,
      },
      server_seed_hash: r.serverSeedHash,
      server_seed: r.serverSeed,
      client_seed: r.clientSeed,
      nonce: r.nonce,
    })
    .select('id')
    .single();
  if (roundErr) throw roundErr;

  // Credit the total return (payout >= 0, so balance can never go negative).
  let balance = await getOrCreateBalance(userId);
  if (payout > 0) {
    balance = await applyChange(userId, payout, 'casino_holdem_settle', round.id);
  }

  clearRound(userId);

  return {
    ok: true,
    status: outcome,
    playerHole: r.playerHole,
    dealerHole: r.dealerHole,
    community: r.community,
    playerRank: playerBest.rank,
    dealerRank: dealerBest.rank,
    dealerQualified,
    ante: r.ante,
    call: r.call,
    anteBonus,
    payout,
    net,
    balance,
    roundId: round.id,
    fair: {
      serverSeedHash: r.serverSeedHash,
      serverSeed: r.serverSeed,
      clientSeed: r.clientSeed,
      nonce: r.nonce,
    },
  };
}

// --- ch_call ---------------------------------------------------------------
// Stake the CALL (2× ante), reveal turn + river + dealer hole, then settle.
export async function call(userId, multiplierIn) {
  const r = rounds.get(userId);
  if (!r) return { ok: false, error: 'no_active_round' };
  if (r.stage !== 'decision') return { ok: false, error: 'round_in_progress' };

  // Call (2× ante) is standard; the player may RAISE to a bigger multiple.
  let mult = Number(multiplierIn);
  if (!RAISE_MULTS.includes(mult)) mult = RAISE_MULTS[0]; // default to standard call
  const callAmount = mult * r.ante;
  // Must be able to cover the call (the ante is already staked).
  r.balance = await getOrCreateBalance(userId);
  if (callAmount > r.balance) {
    return { ok: false, error: 'insufficient_balance', balance: r.balance };
  }

  // Lock the round so a second emit while settling can't double-stake.
  r.stage = 'settling';
  if (r.timer) clearTimeout(r.timer);

  try {
    // Stake the call (atomic; rejects if it would go negative).
    r.balance = await applyChange(userId, -callAmount, 'casino_holdem_call');
    r.call = callAmount;
  } catch (err) {
    // Re-open the decision so a retry is possible rather than wedging the round.
    r.stage = 'decision';
    armTimeout(userId);
    throw err;
  }

  return settle(userId);
}

// --- ch_fold ---------------------------------------------------------------
// Forfeit the ante (already deducted). End the round, no further payout. The
// dealer's cards + the full board are revealed for transparency.
export async function fold(userId) {
  const r = rounds.get(userId);
  if (!r) return { ok: false, error: 'no_active_round' };
  if (r.stage !== 'decision') return { ok: false, error: 'round_in_progress' };

  // Record the folded round (ante forfeited; no payout credited).
  const { data: round, error: roundErr } = await supabase
    .from('game_rounds')
    .insert({
      user_id: userId,
      game: 'casino_holdem',
      bet: r.ante, // total wagered = the forfeited ante
      result: {
        playerHole: r.playerHole,
        dealerHole: r.dealerHole,
        community: r.community,
        outcome: 'folded',
        ante: r.ante,
        call: 0,
        payout: 0,
        net: -r.ante,
      },
      server_seed_hash: r.serverSeedHash,
      server_seed: r.serverSeed,
      client_seed: r.clientSeed,
      nonce: r.nonce,
    })
    .select('id')
    .single();
  if (roundErr) throw roundErr;

  const balance = await getOrCreateBalance(userId); // ante already deducted; nothing to credit
  const fair = {
    serverSeedHash: r.serverSeedHash,
    serverSeed: r.serverSeed,
    clientSeed: r.clientSeed,
    nonce: r.nonce,
  };
  clearRound(userId);

  return {
    ok: true,
    status: 'folded',
    playerHole: r.playerHole,
    dealerHole: r.dealerHole,
    community: r.community,
    ante: r.ante,
    net: -r.ante,
    balance,
    roundId: round.id,
    fair,
  };
}

// --- resolveOpen -----------------------------------------------------------
// Disconnect/timeout safety net: an undecided hand is treated as a FOLD so the
// ante isn't left hanging staked. No-op if nothing is open or it's mid-settle.
export async function resolveOpen(userId) {
  const r = rounds.get(userId);
  if (!r || r.stage !== 'decision') return { ok: false, error: 'no_active_round' };
  return fold(userId);
}

// Exposed for tests/diagnostics only.
export const _internal = { rounds, buildDeck, RANK_VALUE };
