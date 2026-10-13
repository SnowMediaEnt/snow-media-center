import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test';
process.env.SUPABASE_JWT_SECRET ??= 'test';
const { createVerifiedArcade, triviaReturn } = await import('./verifiedArcade.js');
const { settleArcade } = await import('./arcade.js');
const ID = '12345678-1234-4234-8234-123456789012';

function harness() {
  const rows = new Map();
  let balance = 1000;
  let payouts = 0;
  let draws = 0;
  let now = Date.now();
  const db = {
    from(table) {
      const filters = [];
      const query = {
        select() { return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        order() { return this; },
        async limit() { return { data: [], error: null }; },
        async maybeSingle() {
          assert.equal(table, 'arcade_sessions');
          return { data: structuredClone([...rows.values()].find((r) => filters.every(([key, value]) => r[key] === value)) ?? null), error: null };
        },
      };
      return query;
    },
    async rpc(name, p) {
      if (name === 'start_verified_arcade') {
        const existing = rows.get(p.p_id) ?? [...rows.values()].find((s) => s.user_id === p.p_user && s.game === p.p_game && s.status === 'active');
        if (existing) return { data: { session: structuredClone(existing), balance, resumed: true } };
        assert.ok(balance >= p.p_bet);
        balance -= p.p_bet;
        const session = { id: p.p_id, user_id: p.p_user, game: p.p_game, bet: p.p_bet, state: p.p_state,
          version: 0, status: 'active', expires_at: new Date(now + 86400000).toISOString() };
        rows.set(session.id, structuredClone(session));
        return { data: { session, balance, resumed: false } };
      }
      assert.equal(name, 'advance_verified_arcade');
      const row = rows.get(p.p_id);
      if (row.version !== p.p_version || row.status !== 'active') {
        return { data: { session: structuredClone(row), balance, alreadySettled: row.status === 'settled', resynced: true } };
      }
      row.state = p.p_state;
      row.version += 1;
      if (p.p_result) {
        row.status = 'settled';
        row.result = { ...p.p_result, net: p.p_result.payout - row.bet, verified: true };
        balance += p.p_result.payout;
        payouts += 1;
      }
      return { data: { session: structuredClone(row), balance } };
    },
  };
  const service = createVerifiedArcade({ db, getBalance: async () => balance,
    draw: (max) => (draws++ % max), now: () => now });
  return { service, rows, get balance() { return balance; }, get payouts() { return payouts; },
    expire() { now += 86400001; } };
}

test('legacy client-reported outcomes cannot credit coins', async () => {
  for (const game of ['dice','trivia']) {
    assert.deepEqual(await settleArcade('user', { game, bet: 100, dice: [6,6,6,6,6], correct: 10, total: 10, score: 999999 }),
      { ok: false, error: 'game_update_required' });
  }
});

test('dice starts once, resumes across devices, preserves holds, and stops after three rolls', async () => {
  const h = harness();
  const first = await h.service.start('user', { game: 'dice', bet: 100, requestId: ID });
  assert.equal(first.rollsUsed, 1);
  assert.equal(h.balance, 900);
  const resumed = await h.service.start('user', { game: 'dice', bet: 25, requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  assert.equal(resumed.sessionId, ID);
  assert.equal(resumed.bet, 100);
  assert.equal(h.balance, 900);
  const second = await h.service.action('user', { game: 'dice', sessionId: ID, version: 0, action: 'roll', holds: [true,false,true,false,false] });
  assert.equal(second.dice[0], first.dice[0]);
  assert.equal(second.dice[2], first.dice[2]);
  assert.equal(second.rollsUsed, 2);
  const replay = await h.service.action('user', { game: 'dice', sessionId: ID, version: 0, action: 'roll', holds: Array(5).fill(false) });
  assert.deepEqual(replay.dice, second.dice);
  assert.equal(replay.rollsUsed, 2);
  await h.service.action('user', { game: 'dice', sessionId: ID, version: 1, action: 'roll', holds: Array(5).fill(false) });
  assert.equal((await h.service.action('user', { game: 'dice', sessionId: ID, version: 2, action: 'roll', holds: Array(5).fill(false) })).error, 'invalid_roll');
});

test('bank retries and simultaneous requests pay exactly once', async () => {
  const h = harness();
  await h.service.start('user', { game: 'dice', bet: 100, requestId: ID });
  const payload = { game: 'dice', sessionId: ID, version: 0, action: 'bank' };
  const results = await Promise.all([h.service.action('user', payload), h.service.action('user', payload)]);
  assert.equal(h.payouts, 1);
  assert.equal(results[0].payout, results[1].payout);
  assert.equal(h.balance, 900 + results[0].payout);
  const restarted = await h.service.start('user', { game: 'dice', bet: 100, requestId: ID });
  assert.equal(restarted.status, 'settled');
  assert.equal(h.payouts, 1);
});

test('forged results, foreign sessions, invalid holds, and expired actions are rejected', async () => {
  const h = harness();
  assert.equal((await h.service.start('user', { game: 'dice', bet: 100, requestId: ID, dice: [6,6,6,6,6] })).ok, false);
  await h.service.start('user', { game: 'dice', bet: 100, requestId: ID });
  const action = { game: 'dice', sessionId: ID, version: 0, action: 'bank' };
  assert.equal((await h.service.action('user', { ...action, score: 99999 })).ok, false);
  assert.equal((await h.service.action('other-user', action)).error, 'round_not_found');
  assert.equal((await h.service.action('user', { ...action, action: 'roll', holds: [true,true,true,true,true] })).error, 'invalid_roll');
  h.expire();
  assert.equal((await h.service.action('user', action)).error, 'round_expired');
  assert.equal(h.payouts, 0);
});

test('trivia exposes one question without its answer key, grades answers, and prevents answer changes', async () => {
  const h = harness();
  const first = await h.service.start('user', { game: 'trivia', requestId: ID, mode: 'snow', difficulty: 'expert', bet: 50 });
  assert.equal(first.total, 10);
  assert.equal(h.balance, 950);
  assert.equal('correct' in first.question, false);
  assert.equal('fact' in first.question, false);
  assert.equal('questions' in first, false);
  const q = h.rows.get(ID).state.questions[0];
  const wrong = (q.correct + 1) % 4;
  const action = { game: 'trivia', sessionId: ID, version: 0, action: 'answer', questionId: q.id, answerIndex: wrong };
  const answer = await h.service.action('user', action);
  assert.equal(answer.score, 0);
  assert.equal(answer.question.correct, q.correct);
  const changed = await h.service.action('user', { ...action, answerIndex: q.correct });
  assert.equal(changed.selectedAnswer, wrong);
  assert.equal(changed.score, 0);
  const next = await h.service.action('user', { game: 'trivia', sessionId: ID, version: 1, action: 'next' });
  assert.equal(next.questionIndex, 1);
  assert.equal('correct' in next.question, false);
  assert.equal((await h.service.action('user', { ...action, version: 2 })).error, 'invalid_answer');
});

test('trivia computes the full challenge score, wager, payout, and leaderboard result on the server', async () => {
  const h = harness();
  assert.equal((await h.service.start('user', { game: 'trivia', requestId: ID, mode: 'snow', difficulty: 'expert', bet: 10 })).error, 'invalid_challenge');
  let response = await h.service.start('user', { game: 'trivia', requestId: ID, mode: 'snow', difficulty: 'expert', bet: 50 });
  for (let index = 0; index < 10; index += 1) {
    const q = h.rows.get(ID).state.questions[index];
    response = await h.service.action('user', { game: 'trivia', sessionId: ID, version: response.version, action: 'answer', questionId: q.id, answerIndex: q.correct });
    if (index < 9) response = await h.service.action('user', { game: 'trivia', sessionId: ID, version: response.version, action: 'next' });
  }
  assert.equal(response.status, 'settled');
  assert.equal(response.correctCount, 10);
  assert.equal(response.score, 3125);
  assert.equal(response.payout, 250);
  assert.equal(response.net, 200);
  assert.equal(h.balance, 1200);
  assert.equal(h.payouts, 1);
  assert.deepEqual([triviaReturn(0,10,'easy'),triviaReturn(6,10,'standard'),triviaReturn(10,10,'expert')], [0,1.25,5]);
});
