import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test';
process.env.SUPABASE_JWT_SECRET ??= 'test';
const { _internal } = await import('./arcade.js');

test('wide Plinko keeps every path in bounds and every drop lane near the target return', () => {
  for (let lane = 0; lane <= 10; lane += 1) {
    const counts = Array(11).fill(0);
    for (let word = 0; word < 1024; word += 1) {
      const decisions = Array.from({ length: 10 }, (_, row) => Boolean(word & (1 << row)));
      const path = _internal.reflectedPlinkoPath(decisions, lane);
      let halfLane = lane * 2;
      for (const right of path) {
        halfLane += right ? 1 : -1;
        assert.ok(halfLane >= 0 && halfLane <= 20);
      }
      assert.equal(halfLane % 2, 0);
      counts[halfLane / 2] += 1;
    }
    for (const risk of ['chill', 'classic', 'wild']) {
      const multipliers = _internal.widePlinkoMultipliers(risk, lane);
      const expected = counts.reduce((sum, count, slot) => sum + count * multipliers[slot] / 1024, 0);
      assert.ok(expected >= 1.04 && expected <= 1.06, `${risk} lane ${lane}: ${expected}`);
    }
  }
});
