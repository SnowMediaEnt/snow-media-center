/**
 * Snow Originals resume points: only videos of 2 minutes or more resume, from
 * 15 s in to 10 s before the end; one list per profile, the newest 50 kept;
 * storage that throws means "start at 0", never an error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ profileId: 'p1' }));
vi.mock('@/lib/profiles', () => ({ activeProfile: () => ({ id: h.profileId }) }));

import { clearProgress, MAX_ENTRIES, resumeAt, saveProgress } from './originalsProgress';

const KEY = (p: string) => `smc-originals-progress-v1:${p}`;

beforeEach(() => { localStorage.clear(); h.profileId = 'p1'; });
afterEach(() => { vi.restoreAllMocks(); });

describe('originalsProgress', () => {
  it('resumes a video of 2 minutes or more from its saved place', () => {
    saveProgress('a', 60, 150);
    expect(resumeAt('a', 150)).toBe(60);
  });

  it('never resumes a short (under 120 s): it always starts at 0', () => {
    saveProgress('s', 60, 119);
    expect(resumeAt('s', 119)).toBe(0);
    expect(localStorage.getItem(KEY('p1'))).toBeNull(); // not even kept
    // A place saved while the length was unknown still does not resume a short.
    localStorage.setItem(KEY('p1'), JSON.stringify({ s: { pos: 60, dur: 300, at: 1 } }));
    expect(resumeAt('s', 90)).toBe(0);
    expect(resumeAt('s', 120)).toBe(60);
  });

  it('starts at 0 in the first 15 s and the last 10 s', () => {
    saveProgress('a', 14, 200);
    expect(resumeAt('a', 200)).toBe(0);
    saveProgress('a', 15, 200);
    expect(resumeAt('a', 200)).toBe(15);
    saveProgress('a', 189, 200);
    expect(resumeAt('a', 200)).toBe(189);
    localStorage.setItem(KEY('p1'), JSON.stringify({ a: { pos: 190, dur: 400, at: 1 } }));
    expect(resumeAt('a', 200)).toBe(190);
    localStorage.setItem(KEY('p1'), JSON.stringify({ a: { pos: 191, dur: 400, at: 1 } }));
    expect(resumeAt('a', 200)).toBe(0);
  });

  it('forgets a video watched to 95% or cleared at its end', () => {
    saveProgress('a', 100, 200);
    saveProgress('a', 190, 200);
    expect(resumeAt('a', 200)).toBe(0);
    saveProgress('b', 100, 200);
    clearProgress('b');
    expect(resumeAt('b', 200)).toBe(0);
  });

  it('keeps one list per profile', () => {
    saveProgress('a', 60, 200);
    h.profileId = 'kid';
    expect(resumeAt('a', 200)).toBe(0);
    saveProgress('a', 90, 200);
    expect(resumeAt('a', 200)).toBe(90);
    h.profileId = 'p1';
    expect(resumeAt('a', 200)).toBe(60);
    expect(Object.keys(JSON.parse(localStorage.getItem(KEY('kid')) || '{}'))).toEqual(['a']);
  });

  it('keeps only the newest 50', () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (let i = 0; i < MAX_ENTRIES + 5; i++) { now += 1; saveProgress(`v${i}`, 30, 200); }
    const map = JSON.parse(localStorage.getItem(KEY('p1')) || '{}');
    expect(Object.keys(map)).toHaveLength(MAX_ENTRIES);
    expect(map.v0).toBeUndefined();
    expect(map.v4).toBeUndefined();
    expect(map.v5).toBeDefined();
    expect(map[`v${MAX_ENTRIES + 4}`]).toBeDefined();
  });

  it('starts at 0 when storage throws or holds junk, and never throws itself', () => {
    localStorage.setItem(KEY('p1'), '{not json');
    expect(resumeAt('a', 200)).toBe(0);
    localStorage.setItem(KEY('p1'), '[1,2]');
    expect(resumeAt('a', 200)).toBe(0);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => saveProgress('a', 60, 200)).not.toThrow();
    expect(() => clearProgress('a')).not.toThrow();
    expect(resumeAt('a', 200)).toBe(0);
  });
});
