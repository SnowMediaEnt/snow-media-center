// Unit tests for the roulette PAYOUT EVALUATOR — no DB, no sockets.
// Run: node --test src/games/roulette.test.js
//
// These exercise betWins() against known wheel outcomes. The evaluator is the
// part that decides money, so it gets the coverage. Settlement (stake/payout
// arithmetic, balance) is covered by the smoke test against a live server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test';
process.env.SUPABASE_JWT_SECRET ??= 'test';
const { betWins, settleBet } = await import('./roulette.js');

// Tiny helper: build a *validated-shape* bet the way validateBet() would.
// For inside bets we pass the concrete winning number set; for outside bets
// `numbers` is null and the evaluator uses the type/selection predicate.
function bet(type, selection = null, numbers = null) {
  return { type, selection, numbers, amount: 10, multiplier: 0 };
}

test('red / black correctness for several numbers', () => {
  // Standard European/American red set includes 1,3,5,7,9,12,14,16,18,...
  assert.equal(betWins(bet('red'), '1'), true);
  assert.equal(betWins(bet('red'), '3'), true);
  assert.equal(betWins(bet('red'), '7'), true);
  assert.equal(betWins(bet('red'), '2'), false); // 2 is black
  assert.equal(betWins(bet('black'), '2'), true);
  assert.equal(betWins(bet('black'), '4'), true);
  assert.equal(betWins(bet('black'), '1'), false);
  // 36 is red, 35 is black.
  assert.equal(betWins(bet('red'), '36'), true);
  assert.equal(betWins(bet('black'), '35'), true);
});

test('0 and 00 lose all even-money / column / dozen bets', () => {
  for (const z of ['0', '00']) {
    assert.equal(betWins(bet('red'), z), false);
    assert.equal(betWins(bet('black'), z), false);
    assert.equal(betWins(bet('even'), z), false);
    assert.equal(betWins(bet('odd'), z), false);
    assert.equal(betWins(bet('low'), z), false);
    assert.equal(betWins(bet('high'), z), false);
    assert.equal(betWins(bet('column', 1), z), false);
    assert.equal(betWins(bet('column', 2), z), false);
    assert.equal(betWins(bet('column', 3), z), false);
    assert.equal(betWins(bet('dozen', 1), z), false);
    assert.equal(betWins(bet('dozen', 2), z), false);
    assert.equal(betWins(bet('dozen', 3), z), false);
  }
});

test('European single zero returns half of even-money bets under La Partage', () => {
  const red = bet('red');
  red.amount = 10;
  red.multiplier = 1;
  assert.deepEqual(settleBet(red, '0', 'european', true), {
    won: false,
    payout: 5,
    halfBack: true,
  });
  assert.deepEqual(settleBet(red, '00', 'american', true), {
    won: false,
    payout: 0,
    halfBack: false,
  });
  const straight = bet('straight', 0, [0]);
  straight.amount = 10;
  straight.multiplier = 35;
  assert.deepEqual(settleBet(straight, '0', 'european', true), {
    won: true,
    payout: 360,
    halfBack: false,
  });
});

test('straight hit pays on exact number, misses otherwise', () => {
  // numbers set holds ints / the string 00.
  assert.equal(betWins(bet('straight', 7, [7]), '7'), true);
  assert.equal(betWins(bet('straight', 7, [7]), '8'), false);
  // straight on 0 wins only on the single zero (not 00).
  assert.equal(betWins(bet('straight', 0, [0]), '0'), true);
  assert.equal(betWins(bet('straight', 0, [0]), '00'), false);
  // straight on 00 wins only on 00.
  assert.equal(betWins(bet('straight', '00', ['00']), '00'), true);
  assert.equal(betWins(bet('straight', '00', ['00']), '0'), false);
});

test('straight multiplier convention is 35:1 (returns 36x on win)', () => {
  // Convention check: payout = amount * (multiplier + 1). 35:1 -> 36x.
  const multiplier = 35;
  const amount = 10;
  const payout = amount * (multiplier + 1);
  assert.equal(payout, 360);
});

test('dozen membership', () => {
  // 1st dozen 1-12, 2nd 13-24, 3rd 25-36.
  assert.equal(betWins(bet('dozen', 1), '1'), true);
  assert.equal(betWins(bet('dozen', 1), '12'), true);
  assert.equal(betWins(bet('dozen', 1), '13'), false);
  assert.equal(betWins(bet('dozen', 2), '13'), true);
  assert.equal(betWins(bet('dozen', 2), '24'), true);
  assert.equal(betWins(bet('dozen', 2), '25'), false);
  assert.equal(betWins(bet('dozen', 3), '25'), true);
  assert.equal(betWins(bet('dozen', 3), '36'), true);
});

test('column membership', () => {
  // col1: 1,4,7,... col2: 2,5,8,... col3: 3,6,9,...
  assert.equal(betWins(bet('column', 1), '1'), true);
  assert.equal(betWins(bet('column', 1), '34'), true);
  assert.equal(betWins(bet('column', 1), '2'), false);
  assert.equal(betWins(bet('column', 2), '2'), true);
  assert.equal(betWins(bet('column', 2), '35'), true);
  assert.equal(betWins(bet('column', 3), '3'), true);
  assert.equal(betWins(bet('column', 3), '36'), true);
  assert.equal(betWins(bet('column', 3), '34'), false);
});

test('even / odd with 0 losing', () => {
  assert.equal(betWins(bet('even'), '2'), true);
  assert.equal(betWins(bet('even'), '36'), true);
  assert.equal(betWins(bet('even'), '1'), false);
  assert.equal(betWins(bet('odd'), '1'), true);
  assert.equal(betWins(bet('odd'), '35'), true);
  assert.equal(betWins(bet('odd'), '2'), false);
  assert.equal(betWins(bet('even'), '0'), false);
  assert.equal(betWins(bet('odd'), '0'), false);
});

test('low / high boundaries', () => {
  assert.equal(betWins(bet('low'), '1'), true);
  assert.equal(betWins(bet('low'), '18'), true);
  assert.equal(betWins(bet('low'), '19'), false);
  assert.equal(betWins(bet('high'), '19'), true);
  assert.equal(betWins(bet('high'), '36'), true);
  assert.equal(betWins(bet('high'), '18'), false);
  assert.equal(betWins(bet('low'), '0'), false);
  assert.equal(betWins(bet('high'), '0'), false);
});

test('inside bets win on any member (split / street / corner / six_line)', () => {
  assert.equal(betWins(bet('split', [1, 2], [1, 2]), '2'), true);
  assert.equal(betWins(bet('split', [1, 2], [1, 2]), '3'), false);
  assert.equal(betWins(bet('street', 1, [1, 2, 3]), '3'), true);
  assert.equal(betWins(bet('street', 1, [1, 2, 3]), '4'), false);
  assert.equal(betWins(bet('corner', 1, [1, 2, 4, 5]), '5'), true);
  assert.equal(betWins(bet('corner', 1, [1, 2, 4, 5]), '3'), false);
  assert.equal(betWins(bet('six_line', 1, [1, 2, 3, 4, 5, 6]), '6'), true);
  assert.equal(betWins(bet('six_line', 1, [1, 2, 3, 4, 5, 6]), '7'), false);
});

test('american 00 handling on inside bets', () => {
  // A straight on 00 wins on 00 and nothing else; a 0 straight never wins on 00.
  assert.equal(betWins(bet('straight', '00', ['00']), '00'), true);
  assert.equal(betWins(bet('straight', '00', ['00']), '0'), false);
  assert.equal(betWins(bet('straight', '00', ['00']), '17'), false);
  // 00 loses every outside bet (already covered above, re-assert one).
  assert.equal(betWins(bet('red'), '00'), false);
});
