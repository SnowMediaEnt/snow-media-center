// Phase 3 — Blackjack. Multi-turn and stateful: the server holds a finite shoe
// + both hands per user and only the server deals cards / decides outcomes.
// The client sends intents (deal/hit/stand/double); the server replies with the
// new visible state and the shoe commitment. The seed stays secret until that
// finite shoe retires, then is back-filled into its audit rows for verification.
//
// Single PM2 fork process => one in-memory round per user. Every public intent
// is serialized through a per-user queue because Socket.IO handlers are async:
// ordered delivery alone does not stop two overlapping handlers from mutating
// or settling the same hand. Each round also carries an auto-resolve timer so
// a hand can never hang on disconnect/timeout.
//
// One split into two hands; no re-splits or double-after-split. Split aces
// receive one card each. Side bets are evaluated once from the original deal.
import { supabase } from '../supabase.js';
import { applyChange, getOrCreateBalance } from '../chips.js';
import { commit, shuffle } from '../provablyFair.js';
import * as config from '../config.js';
import { validateSideBets, evaluateSideBets } from './blackjackExtras.js';

// The parent integrates `export const blackjack = {...}` into config.js (see the
// CONFIG BLOCK in the handoff). Fall back to sane defaults so this module still
// loads in tests / before that edit lands.
const FALLBACK_VARIANTS = {
  classic: {
    label: 'Classic 21', deckCount: 6, penetration: 0.75,
    dealerHitsSoft17: false, faceDownDouble: false,
  },
  single_deck: {
    label: 'Single Deck', deckCount: 1, penetration: 0.65,
    dealerHitsSoft17: false, faceDownDouble: false,
  },
  double_reveal: {
    label: 'Double Reveal', deckCount: 6, penetration: 0.75,
    dealerHitsSoft17: false, faceDownDouble: true,
  },
};
const blackjack = config.blackjack ?? {
  bets: [10, 25, 50, 100, 250, 500, 1000], roundTimeoutMs: 90_000,
  defaultVariant: 'classic', variants: FALLBACK_VARIANTS,
};
const variants = blackjack.variants ?? FALLBACK_VARIANTS;
const defaultVariant = variants[blackjack.defaultVariant] ? blackjack.defaultVariant : 'classic';

const ROUND_TIMEOUT_MS = blackjack.roundTimeoutMs ?? 90_000;

// Per-user round state. Keyed by userId. Present only while a hand is live.
const rounds = new Map();
// A separate shoe is retained for each user/table variant. Cards never return
// to the shoe until its published cut card is reached between hands.
const shoes = new Map();
// Promise gates used as a cleanup-safe FIFO mutex per user. Gates never reject,
// so one failed command cannot poison the queue for the next command.
const userQueues = new Map();

async function withUserLock(userId, task) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const previous = userQueues.get(userId);
  userQueues.set(userId, gate);

  if (previous) await previous;

  try {
    return await task();
  } finally {
    release();
    // A later waiter may already have installed its own gate. Only the tail of
    // the queue is allowed to remove the key.
    if (userQueues.get(userId) === gate) userQueues.delete(userId);
  }
}

// --- Card helpers ----------------------------------------------------------

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['S', 'H', 'D', 'C']; // spades, hearts, diamonds, clubs

// Fresh ordered N-deck shoe. Each card is { rank, suit }.
function buildDeck(deckCount = 1) {
  const deck = [];
  for (let deckIndex = 0; deckIndex < deckCount; deckIndex += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) deck.push({ rank, suit });
    }
  }
  return deck;
}

export function normalizeVariant(variantIn) {
  return typeof variantIn === 'string' && variants[variantIn] ? variantIn : defaultVariant;
}

function publicRules(variant) {
  const rules = variants[variant];
  return {
    variant,
    label: rules.label,
    deckCount: rules.deckCount,
    penetration: rules.penetration,
    dealerHitsSoft17: !!rules.dealerHitsSoft17,
    dealerStandsSoft17: !rules.dealerHitsSoft17,
    blackjackPayout: '3:2',
    doubleRule: 'any_two',
    faceDownDouble: !!rules.faceDownDouble,
  };
}

function shoeKey(userId, variant) {
  return `${userId}:${variant}`;
}

function createShoe(userId, variant, clientSeed) {
  const rules = variants[variant];
  const { serverSeed, serverSeedHash } = commit();
  const cards = shuffle(buildDeck(rules.deckCount), serverSeed, clientSeed, `shoe:${variant}`);
  const shoe = {
    id: serverSeedHash.slice(0, 20),
    userId,
    variant,
    cards,
    cursor: 0,
    cutAt: Math.max(1, Math.floor(cards.length * rules.penetration)),
    serverSeed,
    serverSeedHash,
    clientSeed,
    roundIds: [],
  };
  shoes.set(shoeKey(userId, variant), shoe);
  return shoe;
}

function shoeNeedsShuffle(shoe) {
  // Reserve enough cards for an unusually long player/dealer runout. The shoe
  // is only replaced before a hand, never while chips are committed.
  return !shoe || shoe.cursor >= shoe.cutAt || shoe.cards.length - shoe.cursor < 40;
}

async function getShoe(userId, variant, clientSeed, reveal = revealRetiredShoe) {
  const key = shoeKey(userId, variant);
  const current = shoes.get(key);
  if (!shoeNeedsShuffle(current)) return current;

  // Do not replace the retired shoe until all of its round rows carry the
  // reveal. If the audit update fails, `current` remains in the map so the next
  // serialized deal retries the same reveal instead of losing that seed.
  if (current) await reveal(current);
  return createShoe(userId, variant, clientSeed);
}

function drawCard(shoe) {
  const card = shoe.cards[shoe.cursor];
  if (!card) throw new Error('shoe_exhausted');
  shoe.cursor += 1;
  return card;
}

async function revealRetiredShoe(shoe) {
  if (!shoe?.roundIds?.length) return;
  // Reveal only after the shoe is retired; revealing it sooner would expose
  // undealt cards. This happens before the next stake is deducted, so an audit
  // write failure can safely stop a new deal without risking player chips.
  const { error } = await supabase
    .from('game_rounds')
    .update({ server_seed: shoe.serverSeed })
    .in('id', shoe.roundIds);
  if (error) throw error;
}

// Base value of a card; ace is 11 here and downgraded to 1 in handTotal().
function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

// Best total for a hand: count aces as 11, then drop to 1 while busting.
// Returns { total, soft } — soft means an ace is still counted as 11.
export function handTotal(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += cardValue(card.rank);
    if (card.rank === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10; // demote one ace from 11 to 1
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

export function isBust(hand) {
  return handTotal(hand).total > 21;
}

// Natural blackjack = exactly two cards totalling 21.
export function isBlackjack(hand) {
  return hand.length === 2 && handTotal(hand).total === 21;
}

// Dealer strategy is table-defined. All currently published Snow tables stand
// on soft 17, but the pure helper accepts H17 for future rule variants.
export function dealerShouldHit(hand, hitsSoft17 = false) {
  const { total, soft } = handTotal(hand);
  return total < 17 || (hitsSoft17 && total === 17 && soft);
}

// A normal busted hand ends immediately. Double Reveal is intentionally
// different: its extra player card remains visually sealed while the dealer
// completes the hand, then the client reveals that card. Settlement still
// treats a busted player as a loss.
export function shouldDealerComplete(playerHand, faceDownDouble = false) {
  return faceDownDouble || !isBust(playerHand);
}

// Settlement math. Returns { outcome, payout } where payout is the TOTAL chips
// returned to the player (bet is already deducted). net = payout - bet.
//   blackjack -> 2.5x (3:2),  win -> 2x,  push -> 1x,  loss/bust -> 0
export function settleOutcome(playerHand, dealerHand, bet, splitHand = false) {
  const player = handTotal(playerHand).total;
  const dealer = handTotal(dealerHand).total;
  const playerBJ = !splitHand && isBlackjack(playerHand);
  const dealerBJ = isBlackjack(dealerHand);

  if (player > 21) return { outcome: 'bust', payout: 0 };
  if (playerBJ && dealerBJ) return { outcome: 'push', payout: bet };
  if (playerBJ) return { outcome: 'blackjack', payout: Math.floor(bet * 2.5) };
  if (dealerBJ) return { outcome: 'lose', payout: 0 };
  if (dealer > 21) return { outcome: 'dealer_bust', payout: bet * 2 };
  if (player > dealer) return { outcome: 'win', payout: bet * 2 };
  if (player < dealer) return { outcome: 'lose', payout: 0 };
  return { outcome: 'push', payout: bet };
}

// --- Round lifecycle -------------------------------------------------------

function clearRound(userId) {
  const r = rounds.get(userId);
  if (r?.timer) clearTimeout(r.timer);
  rounds.delete(userId);
}

function armTimeout(userId) {
  const r = rounds.get(userId);
  if (!r) return;
  if (r.timer) clearTimeout(r.timer);
  // Auto-stand if the player walks away mid-hand so a round can't hang forever.
  r.timer = setTimeout(() => {
    resolveOpenHand(userId).catch(() => {});
  }, ROUND_TIMEOUT_MS);
  if (typeof r.timer.unref === 'function') r.timer.unref();
}

// In-progress turn state (dealer's hole card stays hidden).
function playerTurnState(userId) {
  const r = rounds.get(userId);
  const { total: playerTotal } = handTotal(r.playerHand);
  const dealerUp = [r.dealerHand[0]];
  return {
    ok: true,
    status: 'player_turn',
    playerHand: r.playerHand,
    playerTotal,
    dealerUp,
    dealerUpTotal: handTotal(dealerUp).total,
    canHit: true,
    canStand: true,
    // Double only on the first two cards (and only if affordable, checked at call).
    canDouble: !r.hands && r.playerHand.length === 2 && r.balance >= r.bet,
    canSplit: !r.hands && r.playerHand.length === 2 && r.playerHand[0].rank === r.playerHand[1].rank && r.balance >= r.bet,
    hands: r.hands?.map(h => ({ cards: h.cards, bet: h.bet })),
    activeHand: r.activeHand ?? 0,
    sideResults: r.sideResults,
    bet: r.bet,
    balance: r.balance,
    variant: r.variant,
    rules: r.rules,
    shoe: {
      id: r.shoe.id,
      cardsRemaining: r.shoe.cards.length - r.shoe.cursor,
      shuffleAt: r.shoe.cards.length - r.shoe.cutAt,
      shufflePending: r.shoe.cursor >= r.shoe.cutAt,
      serverSeedHash: r.shoe.serverSeedHash,
    },
    serverSeedHash: r.shoe.serverSeedHash,
  };
}

// Play out the dealer, settle money + record the round, and return the reveal.
async function settle(userId) {
  const r = rounds.get(userId);
  if (!r) return { ok: false, error: 'no_active_round' };

  // Double Reveal must finish the dealer before revealing the sealed player
  // card, even when that card makes the player bust. Other busts end at once.
  if (r.hands ? r.hands.some(h => !isBust(h.cards)) : shouldDealerComplete(r.playerHand, r.doubleCardFaceDown)) {
    while (dealerShouldHit(r.dealerHand, r.rules.dealerHitsSoft17)) {
      r.dealerHand.push(drawCard(r.shoe));
    }
  }

  if (r.hands) r.hands[r.activeHand].bet = r.bet;
  const handResults = r.hands?.map(h => ({ ...h, ...settleOutcome(h.cards, r.dealerHand, h.bet, true) }));
  const base = settleOutcome(r.playerHand, r.dealerHand, r.bet);
  const totalBet = (r.hands ? r.hands.reduce((sum, h) => sum + h.bet, 0) : r.bet) + r.sideStake;
  const payout = (handResults ? handResults.reduce((sum, h) => sum + h.payout, 0) : base.payout)
    + r.sideResults.reduce((sum, side) => sum + side.payout, 0);
  const net = payout - totalBet;
  const outcome = handResults ? (net > 0 ? 'win' : net === 0 ? 'push' : 'lose') : base.outcome;
  const playerTotal = handTotal(r.playerHand).total;
  const dealerTotal = handTotal(r.dealerHand).total;

  // Record the round (audit + provably-fair reveal data).
  const { data: round, error: roundErr } = await supabase
    .from('game_rounds')
    .insert({
      user_id: userId,
      game: 'blackjack',
      bet: totalBet,
      result: {
        bet: r.bet,
        totalBet, hands: handResults, sideResults: r.sideResults,
        playerHand: r.playerHand,
        dealerHand: r.dealerHand,
        playerTotal,
        dealerTotal,
        outcome,
        payout,
        net,
        doubled: r.doubled,
        doubleCardFaceDown: r.doubleCardFaceDown,
        variant: r.variant,
        rules: r.rules,
        shoeId: r.shoe.id,
        cardsRemaining: r.shoe.cards.length - r.shoe.cursor,
        shufflePending: r.shoe.cursor >= r.shoe.cutAt,
      },
      // The shoe seed remains secret while cards are still undealt. It is
      // back-filled for every round when this shoe retires.
      server_seed_hash: r.shoe.serverSeedHash,
      server_seed: null,
      client_seed: r.shoe.clientSeed,
      nonce: r.handNumber,
    })
    .select('id')
    .single();
  if (roundErr) throw roundErr;
  r.shoe.roundIds.push(round.id);

  // Credit the total return (payout >= 0, so balance can never go negative).
  let balance = await getOrCreateBalance(userId);
  if (payout > 0) {
    balance = await applyChange(userId, payout, 'blackjack_settle', round.id);
  }

  clearRound(userId);

  return {
    ok: true,
    status: outcome,
    hands: handResults,
    activeHand: r.activeHand ?? 0,
    sideResults: r.sideResults,
    totalBet,
    playerHand: r.playerHand,
    dealerHand: r.dealerHand,
    playerTotal,
    dealerTotal,
    payout,
    net,
    bet: r.bet,
    balance,
    roundId: round.id,
    variant: r.variant,
    rules: r.rules,
    doubled: r.doubled,
    doubleCardFaceDown: r.doubleCardFaceDown,
    doubleCardIndex: r.doubleCardFaceDown ? r.playerHand.length - 1 : null,
    preDoublePlayerTotal: r.preDoublePlayerTotal,
    shoe: {
      id: r.shoe.id,
      cardsRemaining: r.shoe.cards.length - r.shoe.cursor,
      shuffleAt: r.shoe.cards.length - r.shoe.cutAt,
      shufflePending: r.shoe.cursor >= r.shoe.cutAt,
      serverSeedHash: r.shoe.serverSeedHash,
    },
    fair: {
      serverSeedHash: r.shoe.serverSeedHash,
      // Deliberately withheld until the finite shoe retires. The TV UI no
      // longer displays seed internals, while game_rounds retains the audit.
      serverSeed: null,
      clientSeed: r.shoe.clientSeed,
      nonce: r.handNumber,
    },
  };
}

// --- Public API ------------------------------------------------------------

// Start a hand: validate + deduct the bet, shuffle once, deal 2/2. If either
// side has a natural the hand settles immediately; otherwise it's the player's turn.
async function dealBlackjackUnlocked(userId, betIn, clientSeedIn, variantIn, sideBetsIn) {
  const bet = Number(betIn);
  if (!blackjack.bets.includes(bet)) return { ok: false, error: 'invalid_bet' };
  if (rounds.has(userId)) return { ok: false, error: 'round_in_progress' };
  const sideBets = validateSideBets(sideBetsIn);
  if (!sideBets) return { ok: false, error: 'invalid_side_bet' };
  const sideStake = Object.values(sideBets).reduce((sum, amount) => sum + amount, 0);

  const balance = await getOrCreateBalance(userId);
  if (bet + sideStake > balance) return { ok: false, error: 'insufficient_balance', balance };

  const clientSeed =
    typeof clientSeedIn === 'string' && clientSeedIn ? clientSeedIn.slice(0, 64) : 'blackjack';
  const variant = normalizeVariant(variantIn);
  const rules = publicRules(variant);
  // A retired shoe is revealed before its replacement is installed. A failed
  // audit write aborts this deal before chips move and remains retryable.
  const shoe = await getShoe(userId, variant, clientSeed);

  // Deal alternately from the retained shoe; no card is returned or reshuffled.
  const playerHand = [drawCard(shoe)];
  const dealerHand = [drawCard(shoe)];
  playerHand.push(drawCard(shoe));
  dealerHand.push(drawCard(shoe));

  // Deduct the stake up front (atomic; balance >= bet was checked above).
  const afterBet = await applyChange(userId, -(bet + sideStake), 'blackjack_bet');

  const r = {
    sideStake,
    sideResults: evaluateSideBets(playerHand, dealerHand, sideBets),
    shoe,
    playerHand,
    dealerHand,
    bet,
    doubled: false,
    doubleCardFaceDown: false,
    preDoublePlayerTotal: null,
    variant,
    rules,
    handNumber: shoe.roundIds.length,
    balance: afterBet, // balance after the bet, before any settlement credit
    status: 'player_turn',
    timer: null,
  };
  rounds.set(userId, r);

  // Natural blackjack on either side ends the hand right away.
  if (isBlackjack(playerHand) || isBlackjack(dealerHand)) {
    return settle(userId);
  }

  armTimeout(userId);
  return playerTurnState(userId);
}

// Take a card. Bust settles immediately (a loss); otherwise it stays the player's turn.
async function hitUnlocked(userId) {
  const r = rounds.get(userId);
  if (!r) return { ok: false, error: 'no_active_round' };

  r.playerHand.push(drawCard(r.shoe));
  if (isBust(r.playerHand) || (r.hands && handTotal(r.playerHand).total === 21)) return finishHand(userId);

  armTimeout(userId);
  return playerTurnState(userId);
}

// End the player's turn; dealer plays out and the hand settles.
async function standUnlocked(userId) {
  const r = rounds.get(userId);
  if (!r) return { ok: false, error: 'no_active_round' };
  return finishHand(userId);
}

function finishHand(userId) {
  const r = rounds.get(userId);
  if (r.hands) {
    r.hands[r.activeHand].bet = r.bet;
    if (r.activeHand + 1 < r.hands.length) {
      r.activeHand += 1;
      r.playerHand = r.hands[r.activeHand].cards;
      r.bet = r.hands[r.activeHand].bet;
      r.doubled = false;
      r.doubleCardFaceDown = false;
      armTimeout(userId);
      return playerTurnState(userId);
    }
  }
  return settle(userId);
}

async function splitUnlocked(userId) {
  const r = rounds.get(userId);
  if (!r) return { ok: false, error: 'no_active_round' };
  if (r.hands || r.playerHand.length !== 2 || r.playerHand[0].rank !== r.playerHand[1].rank) return { ok: false, error: 'cannot_split' };
  r.balance = await getOrCreateBalance(userId);
  if (r.balance < r.bet) return { ok: false, error: 'insufficient_balance', balance: r.balance };
  r.balance = await applyChange(userId, -r.bet, 'blackjack_bet');
  const aces = r.playerHand[0].rank === 'A';
  r.hands = r.playerHand.map(card => ({ cards: [card, drawCard(r.shoe)], bet: r.bet }));
  r.activeHand = 0;
  r.playerHand = r.hands[0].cards;
  if (aces) return settle(userId);
  armTimeout(userId);
  return playerTurnState(userId);
}

// Double: stake another `bet`, take exactly one card, then auto-stand.
async function doubleUnlocked(userId) {
  const r = rounds.get(userId);
  if (!r) return { ok: false, error: 'no_active_round' };
  if (r.playerHand.length !== 2) return { ok: false, error: 'cannot_double' };
  if (r.hands) return { ok: false, error: 'cannot_double' };
  if (r.doubled) return { ok: false, error: 'cannot_double' };

  // Must be able to cover the extra stake.
  r.balance = await getOrCreateBalance(userId);
  if (r.bet > r.balance) return { ok: false, error: 'insufficient_balance', balance: r.balance };

  // Stake the extra bet, then bet doubles for settlement math.
  r.balance = await applyChange(userId, -r.bet, 'blackjack_bet');
  r.preDoublePlayerTotal = handTotal(r.playerHand).total;
  r.bet *= 2;
  r.doubled = true;
  r.doubleCardFaceDown = !r.hands && !!r.rules.faceDownDouble;

  // Exactly one card, then settle regardless of the result.
  r.playerHand.push(drawCard(r.shoe));
  return finishHand(userId);
}

// Auto-stand for disconnect/timeout. No-op (ok:false) if there's no live hand.
async function resolveOpenHandUnlocked(userId) {
  if (!rounds.has(userId)) return { ok: false, error: 'no_active_round' };
  return settle(userId);
}

// Public entrypoints all share the same per-user queue. This covers commands
// from multiple sockets as well as the timeout/disconnect auto-resolver.
export function dealBlackjack(userId, betIn, clientSeedIn, variantIn, sideBetsIn) {
  return withUserLock(userId, () =>
    dealBlackjackUnlocked(userId, betIn, clientSeedIn, variantIn, sideBetsIn)
  );
}

export function hit(userId) {
  return withUserLock(userId, () => hitUnlocked(userId));
}

export function stand(userId) {
  return withUserLock(userId, () => standUnlocked(userId));
}

export function double(userId) {
  return withUserLock(userId, () => doubleUnlocked(userId));
}
export function split(userId) {
  return withUserLock(userId, () => splitUnlocked(userId));
}

export function resolveOpenHand(userId) {
  return withUserLock(userId, () => resolveOpenHandUnlocked(userId));
}

// Exposed for tests/diagnostics only.
export const _internal = {
  rounds,
  shoes,
  buildDeck,
  cardValue,
  publicRules,
  createShoe,
  getShoe,
  shoeNeedsShuffle,
  userQueues,
  withUserLock,
};
