// Phase 2 (rebuilt) — Slots: a 5-reel × 3-row, 243-WAYS video slot with the
// original Snowfall Trio collector feature. The server decides every symbol;
// the client only
// animates to the returned grid. Provably fair: each reel's stop position is
// drawn from the seed stream and the 3 visible symbols are read off the strip
// (with wrap-around). The revealed serverSeed lets the player verify the math.
//
// ---------------------------------------------------------------------------
// 243-WAYS RULE (read this before touching evaluate()):
//   The visible window is 3 symbols per reel => a 5×3 grid (3^5 = 243 ways).
//   There are NO fixed paylines. For each PAYING symbol (the four premiums
//   p1..p4 and the four lows la/lk/lq/lj):
//     • Look at consecutive reels STARTING AT REEL 1 (leftmost, index 0).
//     • A win needs the symbol on 3, 4, or 5 consecutive reels from the left.
//     • WILD substitutes for the symbol, so on each reel we count
//       (occurrences of the symbol) + (occurrences of WILD) in that reel's
//       3-cell window.
//     • The number of WAYS = the PRODUCT of those per-reel counts across the
//       consecutive reels that matched.
//     • Payout for the symbol = paytable[symbol][matchCount] × totalBet × ways.
//     • Each paying symbol pays its single longest left-aligned run once; wins
//       are summed across all paying symbols.
//   WILD substitutes for every paying symbol but NEVER for SCATTER.
//
//   SCATTER pays anywhere: count every scatter across the whole 5×3 grid.
//   3/4/5 scatters => a scatter pay (× totalBet) AND triggers FREE SPINS
//   (3 → 8, 4 → 12, 5 → 20). Free spins are re-triggerable from inside a free
//   spin. During free spins every win is multiplied by freeSpinMultiplier and
//   no new stake is taken (the trigger bet is reused for the payout math).
// ---------------------------------------------------------------------------
import { supabase } from '../supabase.js';
import { getOrCreateBalance } from '../chips.js';
import { commit, intInRange, weightedIndex } from '../provablyFair.js';
import * as config from '../config.js';

// Placeholder glyphs keyed by symbol. The front end swaps in real images by
// key later; this map is the single source of truth the server ships to it.
export const symbols = {
  p1: '💎',
  p2: '👑',
  p3: '🐺',
  p4: '🔥',
  la: '🅰️',
  lk: '🇰',
  lq: '🇶',
  lj: '🇯',
  wild: '⭐',
  scatter: '🎁',
  relic_red: '❄',
  relic_blue: '❄',
  relic_yellow: '♛',
};

// The parent integrates the new `export const slots = {...}` into config.js (see
// the CONFIG BLOCK in the handoff). Fall back to a complete, RTP-tuned default
// so this module + the pure-logic tests still load before that edit lands.
const DEFAULT_SLOTS = {
  rows: 3,
  reelCount: 5,
  bets: [10, 25, 50, 100, 250, 500, 1000],
  // Five reel strips. Premiums are rarer than lows; WILD only on reels 2,3,4
  // (index 1,2,3); SCATTER sparse on every reel. Base target is ~84% RTP.
  reels: buildDefaultReels(),
  // matchCount → multiplier (× total bet, then × ways) per paying symbol.
  paytable: {
    p1: { 3: 1.837, 4: 5.972, 5: 23.889 },
    p2: { 3: 1.193, 4: 3.401, 5: 15.636 },
    p3: { 3: 0.733, 4: 2.112, 5: 10.106 },
    p4: { 3: 0.459, 4: 1.378, 5: 7.350 },
    la: { 2: 0.05, 3: 0.1104, 4: 0.3674, 5: 1.837 },
    lk: { 2: 0.04, 3: 0.0919, 4: 0.2941, 5: 1.467 },
    lq: { 2: 0.035, 3: 0.0733, 4: 0.2300, 5: 1.104 },
    lj: { 2: 0.03, 3: 0.0459, 4: 0.1842, 5: 0.919 },
  },
  // scatterCount → pay (× total bet), paid anywhere on the grid.
  scatterPays: { 3: 3.674, 4: 18.374, 5: 91.871 },
  // scatterCount → free spins awarded (re-triggerable).
  freeSpinAwards: { 3: 8, 4: 12, 5: 20 },
  freeSpinMultiplier: 2,
  collectors: {
    red: { symbol: 'relic_red', threshold: 15, multipliers: [2, 4, 8, 14], weights: [40, 30, 20, 10] },
    blue: { symbol: 'relic_blue', threshold: 24, multipliers: [4, 8, 14, 32], weights: [40, 30, 20, 10] },
    yellow: { symbol: 'relic_yellow', threshold: 34, multipliers: [8, 16, 30, 60], weights: [40, 30, 20, 10] },
  },
  symbols,
};

// Default reel strips, expressed as frequency maps for readability and then
// expanded to flat strips. Symbol frequency IS the odds model.
function buildDefaultReels() {
  const base = { p1: 3, p2: 4, p3: 5, p4: 6, la: 8, lk: 9, lq: 10, lj: 11, scatter: 1 };
  const freqs = [
    { ...base, relic_red: 1 }, // reel 0 — no wild
    { ...base, wild: 3, relic_red: 1, relic_blue: 1 }, // reel 1
    { ...base, wild: 3, relic_red: 1, relic_blue: 1, relic_yellow: 1 }, // reel 2
    { ...base, wild: 3, relic_red: 1, relic_blue: 1, relic_yellow: 1 }, // reel 3
    { ...base, relic_red: 1 }, // reel 4 — no wild
  ];
  return freqs.map((f) => {
    const strip = [];
    for (const [sym, n] of Object.entries(f)) for (let i = 0; i < n; i++) strip.push(sym);
    return strip;
  });
}

const slots = config.slots ?? DEFAULT_SLOTS;

// Tolerate a partial/old config.slots: fill any missing field from the default
// so a half-written config (or the pre-rebuild 3-reel block) can't crash a spin.
// `reels` is the source of truth for the grid shape — if config.slots lacks the
// new 5-strip `reels` array, use the default ones (and derive reelCount/paytable
// etc. from the same default) so we never mix a 5-strip grid with 3-reel pays.
const hasNewShape = Array.isArray(slots.reels) && slots.reels.length >= 5 && slots.paytable;
const SRC = hasNewShape ? slots : DEFAULT_SLOTS;
const SLOTS = {
  rows: SRC.rows ?? DEFAULT_SLOTS.rows,
  reels: SRC.reels,
  reelCount: SRC.reels.length,
  bets: SRC.bets ?? DEFAULT_SLOTS.bets,
  paytable: SRC.paytable ?? DEFAULT_SLOTS.paytable,
  scatterPays: SRC.scatterPays ?? DEFAULT_SLOTS.scatterPays,
  freeSpinAwards: SRC.freeSpinAwards ?? DEFAULT_SLOTS.freeSpinAwards,
  freeSpinMultiplier: SRC.freeSpinMultiplier ?? DEFAULT_SLOTS.freeSpinMultiplier,
  collectors: SRC.collectors ?? DEFAULT_SLOTS.collectors,
  symbols: SRC.symbols ?? symbols,
};

// The eight paying symbols, longest-first irrelevant (each pays independently).
const PAYING = ['p1', 'p2', 'p3', 'p4', 'la', 'lk', 'lq', 'lj'];
const COLLECTOR_COLORS = ['red', 'blue', 'yellow'];

// Per-user free-spins state (module-level Map, like blackjack's `rounds`).
// Present only while a user has free spins banked. Single PM2 fork => safe.
//   { freeSpinsRemaining, multiplier, betAtTrigger }
const freeSpinState = new Map();
// A single process owns live play (one PM2 fork). This prevents two sockets for
// the same account racing the persisted per-bet meter row. Postgres still
// verifies the expected previous state inside the settlement transaction.
const slotSpinLocks = new Set();

const emptyCollectorProgress = () => ({ red: 0, blue: 0, yellow: 0 });

function normalizeCollectorProgress(row) {
  return Object.fromEntries(COLLECTOR_COLORS.map((color) => {
    const threshold = SLOTS.collectors[color].threshold;
    const raw = Number(row?.[`${color}_progress`] ?? row?.[color] ?? 0);
    return [color, Number.isInteger(raw) && raw >= 0 && raw < threshold ? raw : 0];
  }));
}

function publicCollectors(progress, events = null) {
  return Object.fromEntries(COLLECTOR_COLORS.map((color) => {
    const config = SLOTS.collectors[color];
    const event = events?.[color];
    return [color, {
      progress: progress[color],
      threshold: config.threshold,
      hit: !!event?.hit,
      triggered: !!event?.triggered,
      multiplier: event?.multiplier ?? 0,
      payout: event?.payout ?? 0,
      sources: Array.isArray(event?.sources) ? event.sources : [],
    }];
  }));
}

async function loadCollectorProgress(userId, bet) {
  const { data, error } = await supabase
    .from('slot_collectors')
    .select('red_progress, blue_progress, yellow_progress')
    .eq('user_id', userId)
    .eq('bet', bet)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeCollectorProgress(data) : emptyCollectorProgress();
}

/**
 * Resolve the three Snowfall Kingdom relics from symbols that visibly landed.
 * A relic anywhere in the 5×3 window charges its matching feature, independent
 * of a paying way. Multiple matching relics create multiple visual flights but
 * progress is deliberately capped at +1 per colour per spin.
 */
export function resolveCollectors(serverSeed, clientSeed, nonce, previous, bet, reels, canAdvance = true) {
  const next = { ...normalizeCollectorProgress(previous) };
  const events = {};
  let totalPayout = 0;

  for (const color of COLLECTOR_COLORS) {
    const cfg = SLOTS.collectors[color];
    const sources = [];
    if (Array.isArray(reels)) {
      for (let reel = 0; reel < reels.length; reel += 1) {
        for (let row = 0; row < (reels[reel]?.length ?? 0); row += 1) {
          if (reels[reel][row] === cfg.symbol) sources.push({ reel, row });
        }
      }
    }
    const hit = canAdvance && sources.length > 0;
    let triggered = false;
    let multiplier = 0;
    let payout = 0;

    if (hit) {
      next[color] += 1;
      if (next[color] >= cfg.threshold) {
        next[color] -= cfg.threshold;
        triggered = true;
        const tier = weightedIndex(
          cfg.weights, serverSeed, clientSeed, `${nonce}:collector:${color}:tier`,
        );
        multiplier = cfg.multipliers[tier];
        payout = bet * multiplier;
        totalPayout += payout;
      }
    }
    events[color] = { hit, triggered, multiplier, payout, sources };
  }

  return { previous: normalizeCollectorProgress(previous), next, events, totalPayout };
}

async function settleSpinTransaction({
  userId, roundBet, progressBet, result, fair, net, reason, previous, next, updateCollectors,
}) {
  const { data, error } = await supabase.rpc('settle_slots_spin', {
    p_user: userId,
    p_round_bet: roundBet,
    p_progress_bet: progressBet,
    p_result: result,
    p_server_seed_hash: fair.serverSeedHash,
    p_server_seed: fair.serverSeed,
    p_client_seed: fair.clientSeed,
    p_nonce: fair.nonce,
    p_net: net,
    p_reason: reason,
    p_update_collectors: updateCollectors,
    p_expected_red: previous.red,
    p_expected_blue: previous.blue,
    p_expected_yellow: previous.yellow,
    p_next_red: next.red,
    p_next_blue: next.blue,
    p_next_yellow: next.yellow,
  });
  if (error) throw error;
  return {
    roundId: Number(data?.roundId),
    balance: Number(data?.balance),
  };
}

// --- Pure helpers (exported for tests) -------------------------------------

// Spin the reels from the seed stream. Returns:
//   reels  : reels[reelIndex] = [3 visible symbols top→bottom]  (column-major)
//   grid   : grid[row] = [5 symbols left→right]                  (row-major)
//   stops  : the chosen stop index per reel (for the audit record)
export function spinReels(serverSeed, clientSeed, nonce) {
  const reels = [];
  const stops = [];
  const rows = SLOTS.rows;
  for (let i = 0; i < SLOTS.reelCount; i++) {
    const strip = SLOTS.reels[i];
    const stop = intInRange(0, strip.length - 1, serverSeed, clientSeed, `${nonce}:reel:${i}`);
    stops.push(stop);
    const col = [];
    for (let row = 0; row < rows; row++) col.push(strip[(stop + row) % strip.length]);
    reels.push(col);
  }
  // Build the row-major grid for the front end (grid[row][reel]).
  const grid = [];
  for (let row = 0; row < rows; row++) {
    const r = [];
    for (let i = 0; i < SLOTS.reelCount; i++) r.push(reels[i][row]);
    grid.push(r);
  }
  return { reels, grid, stops };
}

// 243-ways evaluation on a column-major window: reels[reelIndex] = [symbols].
// `totalBet` is the staked amount the payout multiplies against. Returns
// { wins, totalPayout, scatterCount, scatterPay }. See the header for the rule.
export function evaluate(reels, totalBet) {
  const wins = [];
  let totalPayout = 0;

  for (const sym of PAYING) {
    let matchCount = 0;
    let ways = 1;
    // Walk consecutive reels from the leftmost; WILD counts as the symbol.
    for (let i = 0; i < reels.length; i++) {
      let count = 0;
      for (const s of reels[i]) if (s === sym || s === 'wild') count++;
      if (count === 0) break; // run ends at the first reel without the symbol
      ways *= count;
      matchCount += 1;
    }
    const mult = SLOTS.paytable[sym]?.[matchCount];
    if (matchCount >= 2 && mult) {
      const payout = mult * totalBet * ways;
      wins.push({ symbol: sym, count: matchCount, ways, payout });
      totalPayout += payout;
    }
  }

  // Scatter pays anywhere — count across the whole grid (WILD is NOT a scatter).
  let scatterCount = 0;
  for (const col of reels) for (const s of col) if (s === 'scatter') scatterCount++;
  let scatterPay = 0;
  const sPay = SLOTS.scatterPays[scatterCount];
  if (sPay) {
    scatterPay = sPay * totalBet;
    totalPayout += scatterPay;
  }

  return { wins, totalPayout, scatterCount, scatterPay };
}

// --- Public API ------------------------------------------------------------

// One spin. Drives a PAID spin or, if the user has free spins banked, a FREE
// spin (no stake taken, wins × freeSpinMultiplier). Same signature the server's
// `slots_spin` handler already calls — keep it.
async function spinSlotsUnlocked(userId, betIn, clientSeedIn) {
  const fs = freeSpinState.get(userId);
  const isFreeSpin = !!(fs && fs.freeSpinsRemaining > 0);

  // Stake the payout math runs against.
  let bet;
  let balanceBeforeBet;

  if (isFreeSpin) {
    // Free spin: reuse the trigger bet; do NOT validate the incoming bet and do
    // NOT deduct anything.
    bet = fs.betAtTrigger;
    balanceBeforeBet = await getOrCreateBalance(userId);
  } else {
    bet = Number(betIn);
    if (!SLOTS.bets.includes(bet)) return { ok: false, error: 'invalid_bet' };
    balanceBeforeBet = await getOrCreateBalance(userId);
    if (bet > balanceBeforeBet) {
      return { ok: false, error: 'insufficient_balance', balance: balanceBeforeBet };
    }
  }

  const clientSeed =
    typeof clientSeedIn === 'string' && clientSeedIn ? clientSeedIn.slice(0, 64) : 'slots';
  const { serverSeed, serverSeedHash } = commit();
  const nonce = 0;

  // Provably-fair reels + 243-ways evaluation against the staked bet.
  const { reels, grid, stops } = spinReels(serverSeed, clientSeed, nonce);
  const evalResult = evaluate(reels, bet);

  // Free-spin wins are multiplied. Visible relics charge on every spin: when a
  // symbol lands, the player always sees the matching feature react.
  const multiplier = isFreeSpin ? SLOTS.freeSpinMultiplier : 1;
  const basePayout = Math.round(evalResult.totalPayout * multiplier);
  const collectorBefore = await loadCollectorProgress(userId, bet);
  const collectorResult = resolveCollectors(
    serverSeed, clientSeed, nonce, collectorBefore, bet, reels, true,
  );
  const collectorPayout = collectorResult.totalPayout;
  const totalPayout = basePayout + collectorPayout;
  const collectors = publicCollectors(collectorResult.next, collectorResult.events);

  // Did this spin (re-)trigger free spins?
  const triggeredFreeSpins = SLOTS.freeSpinAwards[evalResult.scatterCount] || 0;

  // Net settlement.
  //   Paid spin: single applyChange of (totalPayout - bet).
  //   Free spin: single applyChange of (totalPayout) — no stake taken.
  let net;
  let reason;
  if (isFreeSpin) {
    net = totalPayout;
    reason = 'slots_freespin_win';
  } else {
    net = totalPayout - bet;
    reason = totalPayout > 0 ? 'slots_win' : 'slots_bet';
  }

  // Record the round (audit + provably-fair reveal). result holds everything.
  const result = {
    grid,
    reels,
    stops,
    wins: evalResult.wins,
    scatterCount: evalResult.scatterCount,
    scatterPay: evalResult.scatterPay,
    basePayout,
    collectorPayout,
    collectors,
    totalPayout,
    net,
    bet,
    freeSpin: isFreeSpin,
    multiplier,
    triggeredFreeSpins,
  };
  // Meter update, round record, balance change and ledger entry commit in one
  // Postgres transaction. The expected-state check rejects any stale writer.
  const settled = await settleSpinTransaction({
    userId,
    roundBet: isFreeSpin ? 0 : bet,
    progressBet: bet,
    result,
    fair: { serverSeedHash, serverSeed, clientSeed, nonce },
    net,
    reason,
    previous: collectorResult.previous,
    next: collectorResult.next,
    updateCollectors: true,
  });
  const { balance, roundId } = settled;

  // Update free-spins state AFTER settling this spin.
  if (isFreeSpin) {
    fs.freeSpinsRemaining -= 1; // consume this free spin
    if (triggeredFreeSpins > 0) fs.freeSpinsRemaining += triggeredFreeSpins; // re-trigger
    if (fs.freeSpinsRemaining <= 0) freeSpinState.delete(userId);
  } else if (triggeredFreeSpins > 0) {
    // A paid spin opened a free-spins session; bank them at this bet.
    freeSpinState.set(userId, {
      freeSpinsRemaining: triggeredFreeSpins,
      multiplier: SLOTS.freeSpinMultiplier,
      betAtTrigger: bet,
    });
  }

  const after = freeSpinState.get(userId);
  const freeSpinsRemaining = after ? after.freeSpinsRemaining : 0;

  return {
    ok: true,
    grid,
    reels,
    wins: evalResult.wins,
    scatterCount: evalResult.scatterCount,
    scatterPay: evalResult.scatterPay,
    basePayout,
    collectorPayout,
    collectors,
    totalPayout,
    net,
    bet,
    balance,
    freeSpin: isFreeSpin,
    freeSpinsRemaining,
    multiplier,
    triggeredFreeSpins,
    symbols: SLOTS.symbols,
    roundId,
    fair: { serverSeedHash, serverSeed, clientSeed, nonce },
  };
}

export async function spinSlots(userId, betIn, clientSeedIn) {
  if (slotSpinLocks.has(userId)) return { ok: false, error: 'spin_in_progress' };
  slotSpinLocks.add(userId);
  try {
    return await spinSlotsUnlocked(userId, betIn, clientSeedIn);
  } finally {
    slotSpinLocks.delete(userId);
  }
}

/** Read the real persisted n/N meters for the selected bet. */
export async function getSlotState(userId, betIn) {
  const bet = Number(betIn);
  if (!SLOTS.bets.includes(bet)) return { ok: false, error: 'invalid_bet' };
  const progress = await loadCollectorProgress(userId, bet);
  const fs = freeSpinState.get(userId);
  return {
    ok: true,
    bet,
    collectors: publicCollectors(progress),
    freeSpinsRemaining: fs?.betAtTrigger === bet ? fs.freeSpinsRemaining : 0,
    multiplier: fs?.multiplier ?? SLOTS.freeSpinMultiplier,
  };
}

// Read-only free-spins state for a user (server.js may surface this on connect
// so the app resumes a free-spins session after a reload). No side effects.
export function getFreeSpinState(userId) {
  const fs = freeSpinState.get(userId);
  return {
    freeSpinsRemaining: fs ? fs.freeSpinsRemaining : 0,
    multiplier: fs ? fs.multiplier : SLOTS.freeSpinMultiplier,
    betAtTrigger: fs ? fs.betAtTrigger : null,
  };
}

// Exposed for tests/diagnostics only.
export const _internal = {
  freeSpinState, slotSpinLocks, SLOTS, PAYING, COLLECTOR_COLORS,
  normalizeCollectorProgress, publicCollectors,
};
