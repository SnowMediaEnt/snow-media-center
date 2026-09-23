import { describe, expect, it } from 'vitest';
import { SNOWBALL_COLORS, sledChallenge, snowballChallenge } from './actionChallenges';

describe('distinct educational action games', () => {
  it('keeps snowball targets about colors, shapes and later color mixing', () => {
    for (const tier of ['little', 'kids', 'teens'] as const) for (let level = 1; level <= 20; level++) for (let round = 0; round < 8; round++) {
      const challenge = snowballChallenge(tier, level, round);
      expect(challenge.answers).toHaveLength(6);
      expect(new Set(challenge.answers).size).toBe(6);
      expect(challenge.answers[challenge.correct]).toBeTruthy();
      expect(challenge.prompt).not.toMatch(/\d/);
      if (challenge.kind === 'color') expect(SNOWBALL_COLORS[challenge.answers[challenge.correct]]).toBeTruthy();
      else expect(challenge.answers[challenge.correct]).toBe(challenge.symbol);
    }
    expect(snowballChallenge('little', 1, 0).clueColor).toBe('Red');
    expect(snowballChallenge('kids', 3, 2).prompt).toContain('Mix');
  });

  it('makes sled gates about picture words, missing letters and vocabulary', () => {
    for (const tier of ['little', 'kids', 'teens'] as const) for (let level = 1; level <= 20; level++) for (let round = 0; round < 8; round++) {
      const challenge = sledChallenge(tier, level, round);
      expect(challenge.answers).toHaveLength(3);
      expect(new Set(challenge.answers).size).toBe(3);
      expect(challenge.answers[challenge.correct]).toBeTruthy();
      expect(challenge.prompt).not.toMatch(/\d/);
    }
    expect(sledChallenge('little', 1, 0).prompt).toContain('picture');
    expect(sledChallenge('kids', 1, 1).prompt).toContain('Finish');
    expect(sledChallenge('teens', 1, 0).prompt).toContain('means');
  });
});
