// Unit tests for the Video Poker hand evaluator. No DB, no network.
//
//   node --test src/games/videoPoker.test.js
//
// config.js validates required env vars at import time; videoPoker.js imports it
// (for the runtime flow, not for scoring). './_testenv.js' stubs those vars and
// MUST be imported first — ESM evaluates imports in source order, so this runs
// before config.js's requireEnv() checks. None of it touches a real service;
// the evaluator tests only ever call evaluateHand().
import './_testenv.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHand, PAYOUTS } from './videoPoker.js';

// Tiny helper: "AS" -> { rank:'A', suit:'S' }, "10H" -> { rank:'10', suit:'H' }.
const c = (str) => {
  const suit = str.slice(-1);
  const rank = str.slice(0, -1);
  return { rank, suit };
};
const hand = (...codes) => codes.map(c);

function expect(codes, rank) {
  const r = evaluateHand(hand(...codes));
  assert.equal(r.rank, rank, `expected ${rank}, got ${r.rank} for ${codes.join(' ')}`);
  assert.equal(r.multiplier, PAYOUTS[rank], `multiplier mismatch for ${rank}`);
}

test('royal flush', () => {
  expect(['10S', 'JS', 'QS', 'KS', 'AS'], 'royal_flush');
});

test('straight flush (king-high)', () => {
  expect(['9H', '10H', 'JH', 'QH', 'KH'], 'straight_flush');
});

test('straight flush (wheel A-2-3-4-5 same suit) is NOT royal', () => {
  // Ace-low straight flush -> straight_flush, not royal_flush.
  expect(['AD', '2D', '3D', '4D', '5D'], 'straight_flush');
});

test('four of a kind', () => {
  expect(['7S', '7H', '7D', '7C', 'KH'], 'four_of_a_kind');
});

test('full house', () => {
  expect(['QS', 'QH', 'QD', '4C', '4H'], 'full_house');
});

test('flush', () => {
  expect(['2S', '5S', '9S', 'JS', 'KS'], 'flush');
});

test('straight A-2-3-4-5 (ace low)', () => {
  expect(['AS', '2H', '3D', '4C', '5S'], 'straight');
});

test('straight 10-J-Q-K-A (ace high)', () => {
  expect(['10S', 'JH', 'QD', 'KC', 'AS'], 'straight');
});

test('straight (mid, mixed suits)', () => {
  expect(['5S', '6H', '7D', '8C', '9S'], 'straight');
});

test('three of a kind', () => {
  expect(['8S', '8H', '8D', '2C', 'KH'], 'three_of_a_kind');
});

test('two pair', () => {
  expect(['9S', '9H', '4D', '4C', 'KH'], 'two_pair');
});

test('jacks or better — pair of Jacks pays', () => {
  expect(['JS', 'JH', '3D', '7C', 'KH'], 'jacks_or_better');
});

test('jacks or better — pair of Aces pays', () => {
  expect(['AS', 'AH', '3D', '7C', '9H'], 'jacks_or_better');
});

test('jacks or better — pair of Queens pays', () => {
  expect(['QS', 'QH', '3D', '7C', '9H'], 'jacks_or_better');
});

test('jacks or better — pair of Kings pays', () => {
  expect(['KS', 'KH', '3D', '7C', '9H'], 'jacks_or_better');
});

test('low pair (Tens) does NOT pay -> nothing', () => {
  expect(['10S', '10H', '3D', '7C', 'KH'], 'nothing');
});

test('low pair (Twos) does NOT pay -> nothing', () => {
  expect(['2S', '2H', '5D', '7C', 'KH'], 'nothing');
});

test('high card nothing', () => {
  expect(['2S', '5H', '9D', 'JC', 'KH'], 'nothing');
});

test('almost-straight (gap) is nothing', () => {
  // 5-6-7-8-10 — not consecutive.
  expect(['5S', '6H', '7D', '8C', '10S'], 'nothing');
});

test('almost-flush (4 suited) is nothing', () => {
  expect(['2S', '5S', '9S', 'JS', 'KH'], 'nothing');
});

test('A-K-Q-J-10 wrap is not a straight when not consecutive past ace', () => {
  // K-A-2-3-4 must NOT be a straight (ace does not wrap high-to-low).
  expect(['KS', 'AH', '2D', '3C', '4S'], 'nothing');
});

test('evaluateHand rejects wrong card count', () => {
  assert.throws(() => evaluateHand(hand('AS', 'KS')), /exactly 5/);
});
