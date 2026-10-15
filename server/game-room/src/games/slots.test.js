// Pure-logic tests for the 243-ways evaluator, wild substitution, and scatter
// counting. No DB: we exercise `evaluate()` and `spinReels()` directly on
// hand-crafted grids. Run: node --test src/games/slots.test.js
//
// slots.js imports supabase.js (which reads env at load), so set dummy env
// BEFORE importing the module. ESM hoists static imports, so use a dynamic
// import after the env is in place.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test';
process.env.SUPABASE_JWT_SECRET ??= 'test';

const { evaluate, resolveCollectors, spinReels, _internal } = await import('./slots.js');

// Helper: build a column-major window (reels[reelIndex] = [3 symbols]) from a
// short spec. Each reel is a 3-symbol array.
function win(...reels) {
  return reels.map((r) => {
    assert.equal(r.length, 3, 'each reel needs exactly 3 visible symbols');
    return r;
  });
}

const PT = _internal.SLOTS.paytable;
const SP = _internal.SLOTS.scatterPays;
const FS = _internal.SLOTS.freeSpinAwards;

// Filler reel with no paying symbols and no scatter/wild (use 'lj'? no — that
// pays; use a guaranteed non-matching column for a given symbol). We use
// distinct lows so they don't accidentally extend a run we are testing.
const X = ['p1', 'p2', 'p3']; // a reel that contains premiums but breaks low runs

test('p1 three-of-a-kind on reels 1-2-3, one each => 1 way', () => {
  const reels = win(
    ['p1', 'la', 'lk'],
    ['lq', 'p1', 'lj'],
    ['lk', 'lj', 'p1'],
    ['la', 'lk', 'lq'], // no p1, no wild => run stops at 3
    ['lj', 'la', 'lk']
  );
  const r = evaluate(reels, 10);
  const w = r.wins.find((x) => x.symbol === 'p1');
  assert.ok(w, 'expected a p1 win');
  assert.equal(w.count, 3);
  assert.equal(w.ways, 1);
  assert.equal(w.payout, PT.p1[3] * 10 * 1);
  assert.equal(r.totalPayout, w.payout);
});

test('wild substitutes for p1 and multiplies the ways count', () => {
  // reel0: one p1. reel1: a WILD (counts as p1). reel2: two p1.
  // ways = 1 (reel0) * 1 (reel1 wild) * 2 (reel2) = 2. matchCount = 3.
  const reels = win(
    ['p1', 'la', 'lk'],
    ['wild', 'lq', 'lj'],
    ['p1', 'p1', 'lk'],
    ['la', 'lk', 'lq'], // breaks the run
    ['lj', 'la', 'lk']
  );
  const r = evaluate(reels, 10);
  const w = r.wins.find((x) => x.symbol === 'p1');
  assert.ok(w);
  assert.equal(w.count, 3);
  assert.equal(w.ways, 2, 'wild on reel1 + double p1 on reel2 => 2 ways');
  assert.equal(w.payout, PT.p1[3] * 10 * 2);
});

test('a full 5-reel run with multiple symbols per reel multiplies ways', () => {
  // p2 on every reel: counts 2,1,1,1,2 => ways = 2*1*1*1*2 = 4, matchCount 5.
  const reels = win(
    ['p2', 'p2', 'lk'],
    ['p2', 'la', 'lj'],
    ['lk', 'p2', 'lq'],
    ['la', 'p2', 'lk'],
    ['p2', 'p2', 'lj']
  );
  const r = evaluate(reels, 10);
  const w = r.wins.find((x) => x.symbol === 'p2');
  assert.ok(w);
  assert.equal(w.count, 5);
  assert.equal(w.ways, 4);
  assert.equal(w.payout, PT.p2[5] * 10 * 4);
});

test('run must start at reel 1 (leftmost) — a gap on reel 1 means no win', () => {
  // p3 on reels 2-3-4 only (reel 1 has none) => no p3 win.
  const reels = win(
    ['la', 'lk', 'lq'], // no p3, no wild
    ['p3', 'la', 'lk'],
    ['p3', 'lq', 'lj'],
    ['p3', 'la', 'lk'],
    ['lq', 'lj', 'la']
  );
  const r = evaluate(reels, 10);
  assert.equal(r.wins.find((x) => x.symbol === 'p3'), undefined);
});

test('premium symbols still need 3 consecutive reels', () => {
  const reels = win(
    ['p4', 'la', 'lk'],
    ['p4', 'lq', 'lj'],
    ['la', 'lk', 'lq'], // breaks at reel 3
    ['lj', 'la', 'lk'],
    ['lq', 'lj', 'la']
  );
  const r = evaluate(reels, 10);
  assert.equal(r.wins.find((x) => x.symbol === 'p4'), undefined);
});

test('a low Snow Pair pays from the first two reels', () => {
  const reels = win(
    ['la', 'p1', 'p2'],
    ['p3', 'la', 'p4'],
    ['p1', 'p2', 'p3'],
    ['p2', 'p3', 'p4'],
    ['p1', 'p3', 'p4']
  );
  const r = evaluate(reels, 10);
  const pair = r.wins.find((x) => x.symbol === 'la');
  assert.ok(pair, 'expected a low-symbol Snow Pair');
  assert.equal(pair.count, 2);
  assert.equal(pair.ways, 1);
  assert.equal(pair.payout, PT.la[2] * 10);
});

test('multiple paying symbols each pay independently and sum', () => {
  // p1 run of 3 (1 way) AND la run of 3 (1 way). Both should appear.
  const reels = win(
    ['p1', 'la', 'lk'],
    ['p1', 'la', 'lj'],
    ['p1', 'la', 'lq'],
    ['lk', 'lj', 'lq'], // breaks both p1 and la at reel 4
    ['lj', 'lq', 'lk']
  );
  const r = evaluate(reels, 10);
  const p1 = r.wins.find((x) => x.symbol === 'p1');
  const la = r.wins.find((x) => x.symbol === 'la');
  assert.ok(p1 && la, 'both p1 and la should win');
  assert.equal(p1.payout, PT.p1[3] * 10 * 1);
  assert.equal(la.payout, PT.la[3] * 10 * 1);
  assert.equal(r.totalPayout, p1.payout + la.payout);
});

test('scatter x3 anywhere pays and is reported, regardless of position', () => {
  const reels = win(
    ['scatter', 'la', 'lk'],
    ['lq', 'lj', 'la'],
    ['lk', 'scatter', 'lq'],
    ['la', 'lk', 'lj'],
    ['lq', 'la', 'scatter']
  );
  const r = evaluate(reels, 10);
  assert.equal(r.scatterCount, 3);
  assert.equal(r.scatterPay, SP[3] * 10);
  assert.ok(FS[3] > 0, 'scatter x3 should award free spins via config');
});

test('wild does NOT substitute for scatter', () => {
  // Two scatters + three wilds. Scatter count must stay 2 (no pay, no trigger).
  const reels = win(
    ['scatter', 'la', 'lk'],
    ['wild', 'lq', 'lj'],
    ['wild', 'la', 'lk'],
    ['wild', 'lq', 'lj'],
    ['scatter', 'la', 'lk']
  );
  const r = evaluate(reels, 10);
  assert.equal(r.scatterCount, 2, 'wild must not be counted as a scatter');
  assert.equal(r.scatterPay, 0);
  assert.equal(SP[2], undefined, '2 scatters should not be in the pay table');
});

test('no winning combination => empty wins, zero payout', () => {
  // Carefully alternate so no symbol forms a 3+ left-aligned run and <3 scatter.
  const reels = win(
    ['p1', 'la', 'lk'],
    ['lq', 'lj', 'p2'],
    ['p3', 'la', 'lk'],
    ['lq', 'lj', 'p4'],
    ['p1', 'la', 'lk']
  );
  const r = evaluate(reels, 10);
  assert.equal(r.totalPayout, 0);
  assert.equal(r.wins.length, 0);
  assert.ok(r.scatterCount < 3);
});

test('spinReels is deterministic and produces a 5×3 window in both layouts', () => {
  const a = spinReels('abc'.repeat(20), 'client', 0);
  const b = spinReels('abc'.repeat(20), 'client', 0);
  assert.deepEqual(a.reels, b.reels, 'same seed => same reels');
  assert.equal(a.reels.length, 5, '5 reels');
  for (const col of a.reels) assert.equal(col.length, 3, '3 visible per reel');
  assert.equal(a.grid.length, 3, '3 rows');
  for (const row of a.grid) assert.equal(row.length, 5, '5 reels per row');
  // grid is the transpose of reels.
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 5; i++) assert.equal(a.grid[row][i], a.reels[i][row]);
});

test('scatter x5 triggers the max free-spin award', () => {
  const reels = win(
    ['scatter', 'la', 'lk'],
    ['scatter', 'lq', 'lj'],
    ['scatter', 'la', 'lk'],
    ['scatter', 'lq', 'lj'],
    ['scatter', 'la', 'lk']
  );
  const r = evaluate(reels, 10);
  assert.equal(r.scatterCount, 5);
  assert.equal(r.scatterPay, SP[5] * 10);
  assert.equal(FS[5], 20);
});

test('Snowfall Trio checks are deterministic and free spins never advance meters', () => {
  const before = { red: 2, blue: 4, yellow: 8 };
  const reels = [['relic_red','relic_blue','relic_yellow']];
  const a = resolveCollectors('server-seed', 'client-seed', 0, before, 25, reels, true);
  const b = resolveCollectors('server-seed', 'client-seed', 0, before, 25, reels, true);
  assert.deepEqual(a, b);

  const free = resolveCollectors('server-seed', 'client-seed', 0, before, 25, reels, false);
  assert.deepEqual(free.next, before);
  assert.equal(free.totalPayout, 0);
  assert.ok(Object.values(free.events).every((event) => !event.hit && !event.triggered));
});

test('a threshold hit resets real progress and pays an allowed server tier', () => {
  const before = { red: 14, blue: 0, yellow: 0 };
  const result = resolveCollectors('red-hit', 'client', 0, before, 10, [['relic_red','la','lk']], true);
  assert.equal(result.next.red, 0);
  assert.equal(result.events.red.triggered, true);
  assert.ok(_internal.SLOTS.collectors.red.multipliers.includes(result.events.red.multiplier));
  assert.equal(result.events.red.payout, result.events.red.multiplier * 10);
});

test('collector expected return is derived from visible relic windows, not a removed random hit setting', () => {
  let featureRtp = 0;
  for (const config of Object.values(_internal.SLOTS.collectors)) {
    const totalWeight = config.weights.reduce((sum, weight) => sum + weight, 0);
    const expectedMultiplier = config.multipliers.reduce(
      (sum, multiplier, index) => sum + multiplier * config.weights[index] / totalWeight,
      0,
    );
    const missProbability = _internal.SLOTS.reels.reduce((miss, strip) => {
      const hits = strip.filter((_, stop) => Array.from({ length: _internal.SLOTS.rows }, (_, row) => strip[(stop+row)%strip.length]).includes(config.symbol)).length;
      return miss * (1 - hits / strip.length);
    }, 1);
    featureRtp += (1-missProbability) * expectedMultiplier / config.threshold;
  }
  assert.ok(Number.isFinite(featureRtp) && featureRtp > 0 && featureRtp < 1, `feature RTP was ${featureRtp}`);
});

void X; // (kept intentionally unused; documents a non-matching filler reel)
