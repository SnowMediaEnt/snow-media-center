import { describe, expect, it } from 'vitest';
import { actionChallenge } from './actionChallenges';

describe('educational action challenges', () => {
  it('always offers one unambiguous answer for every tier and gate count', () => {
    for (const tier of ['little', 'kids', 'teens'] as const) for (const count of [3, 6]) for (let level = 1; level <= 20; level++) for (let round = 0; round < 8; round++) {
      const q = actionChallenge(tier, level, round, count);
      expect(q.answers).toHaveLength(count);
      expect(new Set(q.answers).size).toBe(count);
      expect(q.correct).toBeGreaterThanOrEqual(0);
      expect(q.correct).toBeLessThan(count);
      if (tier === 'little') {
        if (q.prompt.includes('How many')) expect(Number(q.answers[q.correct])).toBe(q.symbol!.split(' ').length);
        else expect(q.answers[q.correct]).toBe(q.symbol);
      } else {
        const [, a, operator, b] = q.prompt.match(/(\d+) ([+−×]) (\d+)/)!;
        const expected = operator === '+' ? Number(a) + Number(b) : operator === '−' ? Number(a) - Number(b) : Number(a) * Number(b);
        expect(Number(q.answers[q.correct])).toBe(expected);
      }
    }
  });
});
