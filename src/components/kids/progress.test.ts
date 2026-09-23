import { beforeEach, describe, expect, it } from 'vitest';
import { cleanRecord, completeRound, mergeRecord, readProgress, writeProgress } from './progress';

describe('profile-scoped kids records', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the best score while accumulating plays, stars, and levels', () => {
    const first = completeRound(undefined, { score: 450, stars: 3, level: 2 }, 100);
    const second = completeRound(first, { score: 300, stars: 2, level: 3 }, 200);
    expect(second).toEqual({ plays: 2, bestScore: 450, stars: 5, level: 3, updatedAt: 200 });
  });

  it('separates records for different child profiles', () => {
    const one = 'smc-kids-progress-v1:device:childone';
    const two = 'smc-kids-progress-v1:device:childtwo';
    writeProgress(one, { 'snow-world': completeRound(undefined, { score: 100, stars: 1 }, 10) });
    expect(readProgress(one)['snow-world']?.stars).toBe(1);
    expect(readProgress(two)).toEqual({});
  });

  it('uses the stronger offline or cloud record and bounds corrupt values', () => {
    const merged = mergeRecord(
      cleanRecord({ plays: 3, stars: 7, bestScore: 100, level: 2, updatedAt: 100 }),
      cleanRecord({ plays: 2, stars: 4, bestScore: 300, level: 4, updatedAt: 200 }),
    );
    expect(merged).toEqual({ plays: 3, stars: 7, bestScore: 300, level: 4, updatedAt: 200 });
    expect(cleanRecord({ plays: -7, stars: Number.NaN, level: 0 }).level).toBe(1);
  });
});
