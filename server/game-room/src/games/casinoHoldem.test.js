// Pure-logic unit tests for Casino Hold'em — no DB, no socket.
//   node --test src/games/casinoHoldem.test.js
//
// config.js validates required env vars at import time; casinoHoldem.js imports
// it (for the runtime flow, not for scoring). './_testenv.js' stubs those vars
// and MUST be imported first — ESM evaluates imports in source order, so this
// runs before config.js's requireEnv() checks. None of these reach a real
// service; the tests only call the pure evaluator/settlement functions.
import './_testenv.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate5,
  bestOfSeven,
  compareScore,
  dealerQualifies,
  anteBonusMultiplier,
  settleHoldem,
  CATEGORY,
} from './casinoHoldem.js';

// "AS" -> { rank:'A', suit:'S' }, "10H" -> { rank:'10', suit:'H' }.
const c = (str) => ({ rank: str.slice(0, -1), suit: str.slice(-1) });
const hand = (...codes) => codes.map(c);

// --- evaluate5 (the 5-card core) -------------------------------------------

test('evaluate5: royal flush', () => {
  const e = evaluate5(hand('10S', 'JS', 'QS', 'KS', 'AS'));
  assert.equal(e.rank, 'royal_flush');
  assert.equal(e.category, CATEGORY.royal_flush);
});

test('evaluate5: straight flush (king-high)', () => {
  assert.equal(evaluate5(hand('9H', '10H', 'JH', 'QH', 'KH')).rank, 'straight_flush');
});

test('evaluate5: wheel straight flush A-2-3-4-5 is NOT royal', () => {
  const e = evaluate5(hand('AD', '2D', '3D', '4D', '5D'));
  assert.equal(e.rank, 'straight_flush');
  // High card of the wheel is the 5, so it loses to any higher straight flush.
  assert.equal(e.score[1], 5);
});

test('evaluate5: four of a kind', () => {
  assert.equal(evaluate5(hand('7S', '7H', '7D', '7C', 'KH')).rank, 'four_of_a_kind');
});

test('evaluate5: full house', () => {
  assert.equal(evaluate5(hand('QS', 'QH', 'QD', '4C', '4H')).rank, 'full_house');
});

test('evaluate5: flush', () => {
  assert.equal(evaluate5(hand('2S', '5S', '9S', 'JS', 'KS')).rank, 'flush');
});

test('evaluate5: straight (ace high) and (ace low)', () => {
  assert.equal(evaluate5(hand('10S', 'JH', 'QD', 'KC', 'AS')).rank, 'straight');
  assert.equal(evaluate5(hand('AS', '2H', '3D', '4C', '5S')).rank, 'straight');
});

test('evaluate5: three of a kind', () => {
  assert.equal(evaluate5(hand('8S', '8H', '8D', '2C', 'KH')).rank, 'three_of_a_kind');
});

test('evaluate5: two pair', () => {
  assert.equal(evaluate5(hand('9S', '9H', '4D', '4C', 'KH')).rank, 'two_pair');
});

test('evaluate5: one pair (any pair, not just jacks)', () => {
  assert.equal(evaluate5(hand('3S', '3H', '7D', '9C', 'KH')).rank, 'one_pair');
  assert.equal(evaluate5(hand('JS', 'JH', '3D', '7C', 'KH')).rank, 'one_pair');
});

test('evaluate5: high card', () => {
  assert.equal(evaluate5(hand('2S', '5H', '9D', 'JC', 'KH')).rank, 'high_card');
});

test('evaluate5: K-A-2-3-4 does not wrap into a straight', () => {
  assert.equal(evaluate5(hand('KS', 'AH', '2D', '3C', '4S')).rank, 'high_card');
});

test('evaluate5 rejects wrong card count', () => {
  assert.throws(() => evaluate5(hand('AS', 'KS')), /exactly 5/);
});

// --- compareScore (tiebreakers) --------------------------------------------

test('compareScore: higher category wins', () => {
  const flush = evaluate5(hand('2S', '5S', '9S', 'JS', 'KS'));
  const straight = evaluate5(hand('10S', 'JH', 'QD', 'KC', 'AS'));
  assert.ok(compareScore(flush.score, straight.score) > 0);
});

test('compareScore: same category broken by kickers', () => {
  // Pair of aces, king kicker vs pair of aces, queen kicker.
  const a = evaluate5(hand('AS', 'AH', 'KD', '5C', '2S'));
  const b = evaluate5(hand('AC', 'AD', 'QD', '5H', '2H'));
  assert.ok(compareScore(a.score, b.score) > 0);
});

test('compareScore: identical hands tie', () => {
  const a = evaluate5(hand('AS', 'AH', 'KD', '5C', '2S'));
  const b = evaluate5(hand('AC', 'AD', 'KH', '5H', '2H'));
  assert.equal(compareScore(a.score, b.score), 0);
});

// --- best-5-of-7 -----------------------------------------------------------

test('bestOfSeven: player makes a flush from hole + community', () => {
  // Hole: A♥ 4♥. Board: K♥ 9♥ 2♥ 7♠ 3♣ -> best is a heart flush A-K-9-4-2.
  const player = hand('AH', '4H'); // hole
  const community = hand('KH', '9H', '2H', '7S', '3C');
  const best = bestOfSeven([...player, ...community]);
  assert.equal(best.rank, 'flush');
});

test('bestOfSeven: trips on the board beats nothing in hand', () => {
  // Hole: A♦ 5♣. Board: 8♠ 8♥ 8♦ K♣ 2♠ -> trip eights, A-K kickers.
  const player = hand('AD', '5C');
  const community = hand('8S', '8H', '8D', 'KC', '2S');
  const best = bestOfSeven([...player, ...community]);
  assert.equal(best.rank, 'three_of_a_kind');
});

test('bestOfSeven: full house uses hole pair + board pair', () => {
  // Hole: Q♠ Q♥. Board: Q♦ 4♣ 4♥ 9♠ 2♦ -> queens full of fours.
  const player = hand('QS', 'QH');
  const community = hand('QD', '4C', '4H', '9S', '2D');
  const best = bestOfSeven([...player, ...community]);
  assert.equal(best.rank, 'full_house');
});

test('bestOfSeven: straight using one hole card', () => {
  // Hole: 6♠ K♦. Board: 5♥ 7♣ 8♦ 9♠ 2♣ -> 5-6-7-8-9 straight.
  const player = hand('6S', 'KD');
  const community = hand('5H', '7C', '8D', '9S', '2C');
  const best = bestOfSeven([...player, ...community]);
  assert.equal(best.rank, 'straight');
});

test('bestOfSeven rejects wrong count', () => {
  assert.throws(() => bestOfSeven(hand('AS', 'KS', 'QS')), /exactly 7/);
});

// --- dealer-qualify threshold ----------------------------------------------

test('dealerQualifies: pair of 4s qualifies', () => {
  const dealer = evaluate5(hand('4S', '4H', '9D', '7C', '2S'));
  assert.equal(dealerQualifies(dealer), true);
});

test('dealerQualifies: pair of 3s does NOT qualify', () => {
  const dealer = evaluate5(hand('3S', '3H', '9D', '7C', '2S'));
  assert.equal(dealerQualifies(dealer), false);
});

test('dealerQualifies: pair of 2s does NOT qualify', () => {
  const dealer = evaluate5(hand('2S', '2H', '9D', '7C', '5S'));
  assert.equal(dealerQualifies(dealer), false);
});

test('dealerQualifies: ace high (no pair) does NOT qualify', () => {
  const dealer = evaluate5(hand('AS', 'KH', '9D', '7C', '5S'));
  assert.equal(dealerQualifies(dealer), false);
});

test('dealerQualifies: any two pair / better always qualifies', () => {
  const twoPair = evaluate5(hand('3S', '3H', '2D', '2C', 'KS')); // 3s and 2s two pair
  assert.equal(dealerQualifies(twoPair), true);
});

// --- ante-bonus lookup -----------------------------------------------------

test('anteBonusMultiplier: straight-or-better paytable', () => {
  assert.equal(anteBonusMultiplier('royal_flush'), 100);
  assert.equal(anteBonusMultiplier('straight_flush'), 20);
  assert.equal(anteBonusMultiplier('four_of_a_kind'), 10);
  assert.equal(anteBonusMultiplier('full_house'), 3);
  assert.equal(anteBonusMultiplier('flush'), 2);
  assert.equal(anteBonusMultiplier('straight'), 1);
});

test('anteBonusMultiplier: below a straight pays 0', () => {
  assert.equal(anteBonusMultiplier('three_of_a_kind'), 0);
  assert.equal(anteBonusMultiplier('two_pair'), 0);
  assert.equal(anteBonusMultiplier('one_pair'), 0);
  assert.equal(anteBonusMultiplier('high_card'), 0);
});

// --- settlement math -------------------------------------------------------
// ante = 10 => call = 20, total wagered = 30.

test('settleHoldem: dealer does not qualify -> call push + ante 1:1 (+bonus)', () => {
  // Player has a plain pair (no ante bonus); dealer has high card (no qualify).
  const player = evaluate5(hand('KS', 'KH', '9D', '7C', '2S')); // pair of kings
  const dealer = evaluate5(hand('AD', 'QC', '9H', '6S', '3D')); // ace high
  const s = settleHoldem(player, dealer, 10);
  assert.equal(s.outcome, 'dealer_no_qualify');
  assert.equal(s.dealerQualified, false);
  // call push (20) + ante 1:1 (10 stake back + 10 win) + bonus(0) = 40.
  assert.equal(s.payout, 40);
  // net = payout - (ante + call) = 40 - 30 = +10 (the ante 1:1 win).
  assert.equal(s.payout - 30, 10);
});

test('settleHoldem: dealer no-qualify WITH ante bonus (player has a flush)', () => {
  const player = evaluate5(hand('AS', 'KS', '9S', '4S', '2S')); // flush -> bonus 2
  const dealer = evaluate5(hand('AD', 'QC', '9H', '6S', '3D')); // ace high, no qualify
  const s = settleHoldem(player, dealer, 10);
  assert.equal(s.outcome, 'dealer_no_qualify');
  // call push (20) + ante 1:1 (20) + bonus (10 * 2 = 20) = 60.
  assert.equal(s.payout, 60);
  assert.equal(s.anteBonus, 20);
});

test('settleHoldem: dealer qualifies and player WINS', () => {
  // Player two pair beats dealer one pair (qualifying — pair of 9s).
  const player = evaluate5(hand('KS', 'KH', '9D', '9C', '2S')); // two pair, no bonus
  const dealer = evaluate5(hand('9H', '9S', '7D', '5C', '3H')); // pair of 9s qualifies
  const s = settleHoldem(player, dealer, 10);
  assert.equal(s.outcome, 'win');
  assert.equal(s.dealerQualified, true);
  // ante 1:1 (20) + bonus (0) + call 1:1 (40) = 60.
  assert.equal(s.payout, 60);
  // net = 60 - 30 = +30.
  assert.equal(s.payout - 30, 30);
});

test('settleHoldem: dealer qualifies, player wins WITH ante bonus (straight)', () => {
  const player = evaluate5(hand('5H', '6C', '7D', '8S', '9H')); // straight -> bonus 1
  const dealer = evaluate5(hand('AS', 'AH', '7C', '4D', '2S')); // pair of aces, qualifies
  const s = settleHoldem(player, dealer, 10);
  assert.equal(s.outcome, 'win');
  // ante 1:1 (20) + bonus (10*1=10) + call 1:1 (40) = 70.
  assert.equal(s.payout, 70);
  assert.equal(s.anteBonus, 10);
});

test('settleHoldem: dealer qualifies and player LOSES -> payout 0', () => {
  const player = evaluate5(hand('7S', '7H', '9D', '5C', '2S')); // pair of 7s
  const dealer = evaluate5(hand('KS', 'KH', '9C', '5D', '3H')); // pair of kings, qualifies
  const s = settleHoldem(player, dealer, 10);
  assert.equal(s.outcome, 'lose');
  assert.equal(s.payout, 0);
  assert.equal(s.payout - 30, -30); // lost both stakes
});

test('settleHoldem: exact tie pushes both stakes (no ante bonus)', () => {
  // A true split: both sides play the same best 5 (identical pair of kings + the
  // same three kickers). The dealer's pair of kings also qualifies, so this
  // exercises the qualify+tie branch, not the no-qualify branch.
  const p2 = evaluate5(hand('KS', 'KH', 'QD', 'JC', '9S'));
  const d2 = evaluate5(hand('KC', 'KD', 'QH', 'JS', '9H'));
  const s = settleHoldem(p2, d2, 10);
  assert.equal(s.outcome, 'push');
  assert.equal(s.dealerQualified, true);
  assert.equal(s.payout, 30); // ante (10) + call (20) returned
  assert.equal(s.anteBonus, 0);
  assert.equal(s.payout - 30, 0);
});
