// Pure-logic unit tests for blackjack — no DB, no socket.
//   node --test src/games/blackjack.test.js
//
// Importing blackjack.js pulls the config/supabase chain, which only *reads*
// env at import (createClient is lazy and never connects here). Provide dummy
// values so requireEnv() doesn't throw; nothing in these tests touches the DB.
// We set env first, THEN dynamic-import — a static import is hoisted and would
// evaluate config.js before these assignments run.
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test';
process.env.SUPABASE_JWT_SECRET ??= 'test';

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  handTotal,
  isBust,
  isBlackjack,
  dealerShouldHit,
  shouldDealerComplete,
  settleOutcome,
  normalizeVariant,
  _internal,
} = await import('./blackjack.js');

const C = (rank, suit = 'S') => ({ rank, suit });

test('handTotal: hard total, no aces', () => {
  assert.deepEqual(handTotal([C('10'), C('7')]), { total: 17, soft: false });
  assert.deepEqual(handTotal([C('K'), C('Q')]), { total: 20, soft: false });
});

test('handTotal: soft ace counts as 11', () => {
  assert.deepEqual(handTotal([C('A'), C('6')]), { total: 17, soft: true });
  assert.deepEqual(handTotal([C('A'), C('9')]), { total: 20, soft: true });
});

test('handTotal: ace demotes to 1 to avoid bust (hard)', () => {
  // A + 6 + 9 = 16 (ace must be 1), not 26
  assert.deepEqual(handTotal([C('A'), C('6'), C('9')]), { total: 16, soft: false });
});

test('handTotal: two aces -> 12 (one as 11, one as 1)', () => {
  assert.deepEqual(handTotal([C('A'), C('A')]), { total: 12, soft: true });
});

test('handTotal: four aces stays soft at 14', () => {
  assert.deepEqual(handTotal([C('A'), C('A'), C('A'), C('A')]), { total: 14, soft: true });
});

test('isBust: detects > 21', () => {
  assert.equal(isBust([C('K'), C('Q'), C('5')]), true); // 25
  assert.equal(isBust([C('K'), C('Q')]), false); // 20
  assert.equal(isBust([C('A'), C('K'), C('Q')]), false); // 21 (ace as 1)
});

test('isBlackjack: only a two-card natural 21', () => {
  assert.equal(isBlackjack([C('A'), C('K')]), true);
  assert.equal(isBlackjack([C('A'), C('10')]), true);
  // 21 over three cards is NOT a blackjack
  assert.equal(isBlackjack([C('7'), C('7'), C('7')]), false);
  assert.equal(isBlackjack([C('K'), C('9')]), false); // 19
});

test('dealerShouldHit: stands on all 17 including soft 17', () => {
  assert.equal(dealerShouldHit([C('10'), C('6')]), true); // 16 -> hit
  assert.equal(dealerShouldHit([C('10'), C('7')]), false); // hard 17 -> stand
  assert.equal(dealerShouldHit([C('A'), C('6')]), false); // soft 17 -> stand (player-friendly)
  assert.equal(dealerShouldHit([C('A'), C('5')]), true); // soft 16 -> hit
});

test('dealerShouldHit supports an explicitly disclosed hit-soft-17 table', () => {
  assert.equal(dealerShouldHit([C('A'), C('6')], true), true);
  assert.equal(dealerShouldHit([C('10'), C('7')], true), false);
});

test('Double Reveal completes the dealer before a sealed bust is revealed', () => {
  const bustedPlayer = [C('10'), C('9'), C('5')];
  assert.equal(shouldDealerComplete(bustedPlayer, false), false);
  assert.equal(shouldDealerComplete(bustedPlayer, true), true);
  assert.equal(shouldDealerComplete([C('10'), C('8')], false), true);
});

test('per-user lock serializes overlapping intents in FIFO order and cleans up', async () => {
  const events = [];
  let releaseFirst;
  const holdFirst = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = _internal.withUserLock('queue-user', async () => {
    events.push('first:start');
    await holdFirst;
    events.push('first:end');
    return 'first-result';
  });
  const second = _internal.withUserLock('queue-user', async () => {
    events.push('second:start');
    events.push('second:end');
    return 'second-result';
  });

  await Promise.resolve();
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['first-result', 'second-result']);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
  assert.equal(_internal.userQueues.has('queue-user'), false);
});

test('per-user lock releases after failure and does not block another user', async () => {
  let otherUserRan = false;
  const failed = _internal.withUserLock('failing-user', async () => {
    throw new Error('expected-test-failure');
  });
  const recovered = _internal.withUserLock('failing-user', async () => 'recovered');
  const other = _internal.withUserLock('other-user', async () => {
    otherUserRan = true;
    return 'other';
  });

  await assert.rejects(failed, /expected-test-failure/);
  assert.equal(await recovered, 'recovered');
  assert.equal(await other, 'other');
  assert.equal(otherUserRan, true);
  assert.equal(_internal.userQueues.has('failing-user'), false);
  assert.equal(_internal.userQueues.has('other-user'), false);
});

test('published variants have finite shoes and player-friendly rules', () => {
  assert.equal(normalizeVariant('not-a-table'), 'classic');
  assert.equal(normalizeVariant('single_deck'), 'single_deck');

  const classic = _internal.publicRules('classic');
  const single = _internal.publicRules('single_deck');
  const reveal = _internal.publicRules('double_reveal');

  assert.equal(classic.deckCount, 6);
  assert.equal(classic.dealerStandsSoft17, true);
  assert.equal(classic.blackjackPayout, '3:2');
  assert.equal(single.deckCount, 1);
  assert.equal(reveal.faceDownDouble, true);
  assert.equal(_internal.buildDeck(classic.deckCount).length, 312);
  assert.equal(_internal.buildDeck(single.deckCount).length, 52);
});

test('finite shoe reaches a cut card instead of reshuffling every hand', () => {
  const shoe = _internal.createShoe('test-user', 'single_deck', 'unit-seed');
  assert.equal(shoe.cards.length, 52);
  assert.equal(shoe.cutAt, Math.floor(52 * 0.65));
  assert.equal(_internal.shoeNeedsShuffle(shoe), false);
  shoe.cursor = shoe.cutAt;
  assert.equal(_internal.shoeNeedsShuffle(shoe), true);
  _internal.shoes.clear();
});

test('failed retired-shoe reveal preserves the shoe for a successful retry', async () => {
  const userId = 'reveal-retry-user';
  const key = `${userId}:single_deck`;
  const retired = _internal.createShoe(userId, 'single_deck', 'old-seed');
  retired.cursor = retired.cutAt;
  retired.roundIds.push(101, 102);

  let attempts = 0;
  await assert.rejects(
    _internal.getShoe(userId, 'single_deck', 'new-seed', async (shoe) => {
      attempts += 1;
      assert.equal(shoe, retired);
      throw new Error('audit-write-failed');
    }),
    /audit-write-failed/
  );
  assert.equal(attempts, 1);
  assert.equal(_internal.shoes.get(key), retired);

  const replacement = await _internal.getShoe(
    userId,
    'single_deck',
    'new-seed',
    async (shoe) => {
      attempts += 1;
      assert.equal(shoe, retired);
    }
  );
  assert.equal(attempts, 2);
  assert.notEqual(replacement, retired);
  assert.equal(_internal.shoes.get(key), replacement);
  assert.equal(replacement.clientSeed, 'new-seed');
  _internal.shoes.delete(key);
});

test('settleOutcome: blackjack pays 3:2 (2.5x total return)', () => {
  const player = [C('A'), C('K')]; // blackjack
  const dealer = [C('10'), C('8')]; // 18
  assert.deepEqual(settleOutcome(player, dealer, 10), { outcome: 'blackjack', payout: 25 });
  // floor on odd bets: 25 -> 62
  assert.deepEqual(settleOutcome(player, dealer, 25), { outcome: 'blackjack', payout: 62 });
});

test('settleOutcome: ordinary win returns 2x', () => {
  const player = [C('10'), C('9')]; // 19
  const dealer = [C('10'), C('8')]; // 18
  assert.deepEqual(settleOutcome(player, dealer, 50), { outcome: 'win', payout: 100 });
});

test('settleOutcome: dealer bust returns 2x', () => {
  const player = [C('10'), C('7')]; // 17
  const dealer = [C('10'), C('6'), C('K')]; // 26 bust
  assert.deepEqual(settleOutcome(player, dealer, 50), { outcome: 'dealer_bust', payout: 100 });
});

test('settleOutcome: push returns the bet (1x)', () => {
  const player = [C('10'), C('8')]; // 18
  const dealer = [C('9'), C('9')]; // 18
  assert.deepEqual(settleOutcome(player, dealer, 100), { outcome: 'push', payout: 100 });
});

test('settleOutcome: both naturals push', () => {
  const player = [C('A'), C('K')];
  const dealer = [C('A'), C('Q')];
  assert.deepEqual(settleOutcome(player, dealer, 10), { outcome: 'push', payout: 10 });
});

test('settleOutcome: dealer blackjack beats a non-natural 21', () => {
  const player = [C('7'), C('7'), C('7')]; // 21, not natural
  const dealer = [C('A'), C('K')]; // natural
  assert.deepEqual(settleOutcome(player, dealer, 10), { outcome: 'lose', payout: 0 });
});

test('settleOutcome: player bust loses regardless of dealer', () => {
  const player = [C('K'), C('Q'), C('5')]; // 25
  const dealer = [C('10'), C('6'), C('K')]; // also bust
  assert.deepEqual(settleOutcome(player, dealer, 10), { outcome: 'bust', payout: 0 });
});

test('settleOutcome: lower total loses', () => {
  const player = [C('10'), C('6')]; // 16
  const dealer = [C('10'), C('9')]; // 19
  assert.deepEqual(settleOutcome(player, dealer, 25), { outcome: 'lose', payout: 0 });
});
