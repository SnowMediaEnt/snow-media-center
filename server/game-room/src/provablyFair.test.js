import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commit,
  verifyReveal,
  sha256Hex,
  floatFromSeed,
  intInRange,
  weightedIndex,
  shuffle,
} from './provablyFair.js';

test('commit/reveal: hash matches the seed, tamper is detected', () => {
  const { serverSeed, serverSeedHash } = commit();
  assert.equal(serverSeedHash.length, 64);
  assert.equal(sha256Hex(serverSeed), serverSeedHash);
  assert.equal(verifyReveal(serverSeed, serverSeedHash), true);
  assert.equal(verifyReveal(serverSeed + '00', serverSeedHash), false);
});

test('commit: two commits produce different seeds', () => {
  const a = commit();
  const b = commit();
  assert.notEqual(a.serverSeed, b.serverSeed);
});

test('floatFromSeed: deterministic and within [0, 1)', () => {
  const s = 'server', c = 'client';
  for (let n = 0; n < 1000; n++) {
    const x = floatFromSeed(s, c, n);
    assert.ok(x >= 0 && x < 1, `float out of range at nonce ${n}: ${x}`);
    assert.equal(x, floatFromSeed(s, c, n)); // stable
  }
});

test('intInRange: deterministic, respects bounds, covers the full range', () => {
  const s = 'server', c = 'client';
  const seen = new Set();
  for (let n = 0; n < 5000; n++) {
    const v = intInRange(1, 6, s, c, n);
    assert.ok(v >= 1 && v <= 6, `out of range: ${v}`);
    assert.equal(v, intInRange(1, 6, s, c, n)); // stable
    seen.add(v);
  }
  assert.equal(seen.size, 6, 'should hit every face of a d6');
});

test('intInRange: roughly uniform (loose chi-square sanity)', () => {
  const s = 'seed-x', c = 'client-y';
  const N = 60000, sides = 6;
  const counts = new Array(sides).fill(0);
  for (let n = 0; n < N; n++) counts[intInRange(0, sides - 1, s, c, n)]++;
  const expected = N / sides;
  let chi = 0;
  for (const obs of counts) chi += (obs - expected) ** 2 / expected;
  // 5 dof, 0.1% critical value ~20.5; uniform RNG sits well under it.
  assert.ok(chi < 20.5, `distribution not uniform enough, chi2=${chi}`);
});

test('intInRange: rejects bad ranges', () => {
  assert.throws(() => intInRange(5, 1, 's', 'c', 0));
  assert.throws(() => intInRange(1.5, 3, 's', 'c', 0));
});

test('weightedIndex: deterministic and honours weights distribution', () => {
  const s = 'wseed', c = 'wclient';
  const weights = [1, 1, 8]; // index 2 should win ~80%
  const counts = [0, 0, 0];
  const N = 40000;
  for (let n = 0; n < N; n++) {
    const i = weightedIndex(weights, s, c, n);
    assert.equal(i, weightedIndex(weights, s, c, n)); // stable
    counts[i]++;
  }
  const p2 = counts[2] / N;
  assert.ok(p2 > 0.76 && p2 < 0.84, `index 2 share off: ${p2}`);
});

test('weightedIndex: rejects empty or zero weights', () => {
  assert.throws(() => weightedIndex([], 's', 'c', 0));
  assert.throws(() => weightedIndex([0, 0], 's', 'c', 0));
});

test('shuffle: is a permutation, deterministic, and actually reorders', () => {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const a = shuffle(deck, 'srv', 'cli', 1);
  const b = shuffle(deck, 'srv', 'cli', 1);
  assert.deepEqual(a, b, 'same seed -> same shuffle');
  assert.equal(a.length, 52);
  assert.deepEqual([...a].sort((x, y) => x - y), deck, 'must be a permutation');
  assert.notDeepEqual(a, deck, 'should not be identity');
  const c = shuffle(deck, 'srv', 'cli', 2);
  assert.notDeepEqual(a, c, 'different nonce -> different order');
});
