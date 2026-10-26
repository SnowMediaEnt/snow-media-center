import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_247_CUSHION, CUSHION_LEVELS, DEFAULT_CUSHION, LIVE_BUFFER_KEY, LIVE_BUFFER_STEPS_KEY, STEP_GAP_MS,
  __resetLiveBufferForTests, channelBufferKey, cushionFor, isBigCushion, isTwentyFourSeven, loadLiveBuffer,
  noteStall, saveLiveBuffer, stepOf,
} from './liveBuffer';

const T0 = new Date(2026, 9, 26, 12, 0, 0).getTime();
const key = channelBufferKey('host|user|101');

beforeEach(() => {
  localStorage.clear();
  __resetLiveBufferForTests();
});

describe('isTwentyFourSeven', () => {
  it('finds 24/7, 24-7 and 247 in a name or category, any case', () => {
    expect(isTwentyFourSeven('Ancient Aliens 24/7')).toBe(true);
    expect(isTwentyFourSeven(null, 'US| 24-7 CHANNELS')).toBe(true);
    expect(isTwentyFourSeven('247 Simpsons')).toBe(true);
    expect(isTwentyFourSeven('SHOWS 24 / 7')).toBe(true);
  });
  it('leaves normal channels and longer numbers alone', () => {
    expect(isTwentyFourSeven('News 1', 'US News')).toBe(false);
    expect(isTwentyFourSeven('Channel 1247')).toBe(false);
    expect(isTwentyFourSeven(undefined, null)).toBe(false);
  });
});

describe('the setting', () => {
  it('is Auto by default and keeps a choice', () => {
    expect(loadLiveBuffer()).toBe('auto');
    saveLiveBuffer('large');
    expect(loadLiveBuffer()).toBe('large');
    localStorage.setItem(LIVE_BUFFER_KEY, 'huge');
    expect(loadLiveBuffer()).toBe('auto');
  });
  it('fixed sizes are the briefed cushions and never step', () => {
    expect(cushionFor('small', { key })).toEqual({ startMs: 2500, rebufferMs: 5000 });
    expect(cushionFor('medium', { key })).toEqual({ startMs: 6000, rebufferMs: 8000 });
    expect(cushionFor('large', { key })).toEqual({ startMs: 10000, rebufferMs: 12000 });
    expect(cushionFor('xlarge', { key })).toEqual({ startMs: 15000, rebufferMs: 18000 });
    expect(noteStall('large', { key }, CUSHION_LEVELS[2], T0)).toBeNull();
  });
});

describe('Auto', () => {
  it('keeps normal channels quick and gives 24/7 channels Large', () => {
    expect(cushionFor('auto', { key, name: 'News' }, T0)).toEqual(DEFAULT_CUSHION);
    expect(cushionFor('auto', { key, name: 'Ancient Aliens 24/7' }, T0)).toEqual({ startMs: 10000, rebufferMs: 12000 });
    expect(AUTO_247_CUSHION).toEqual(CUSHION_LEVELS[2]);
    expect(isBigCushion(DEFAULT_CUSHION)).toBe(false);
    expect(isBigCushion(AUTO_247_CUSHION)).toBe(true);
  });

  it('steps a normal channel 2.5 → 6 → 10 → 15 s, at most every 30 s', () => {
    let c = cushionFor('auto', { key }, T0);
    let at = T0;
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      // Too soon after the last step: nothing.
      if (i > 0) expect(noteStall('auto', { key }, c, at + 1000)).toBeNull();
      at += STEP_GAP_MS;
      const next = noteStall('auto', { key }, c, at);
      expect(next).not.toBeNull();
      c = next!;
      seen.push(c.startMs);
    }
    expect(seen).toEqual([6000, 10000, 15000]);
    // The biggest: no more.
    expect(noteStall('auto', { key }, c, at + STEP_GAP_MS)).toBeNull();
  });

  it('steps a 24/7 channel 10 → 15 s', () => {
    const ch = { key, name: '24/7 Cartoons' };
    const next = noteStall('auto', ch, cushionFor('auto', ch, T0), T0);
    expect(next).toEqual(CUSHION_LEVELS[3]);
  });

  it('remembers a step for the channel for the day, then forgets it', () => {
    noteStall('auto', { key }, DEFAULT_CUSHION, T0);
    expect(JSON.parse(localStorage.getItem(LIVE_BUFFER_STEPS_KEY)!).ch[key]).toBe(1);
    __resetLiveBufferForTests(); // a new session, same day
    expect(cushionFor('auto', { key }, T0 + 60_000)).toEqual(CUSHION_LEVELS[1]);
    // Another channel is untouched.
    expect(cushionFor('auto', { key: channelBufferKey('host|user|202') }, T0)).toEqual(DEFAULT_CUSHION);
    // The next day: back to quick.
    expect(stepOf(key, T0 + 24 * 3600_000)).toBe(0);
  });

  it('keeps the steps in memory when storage is off', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('off'); };
    try {
      expect(noteStall('auto', { key }, DEFAULT_CUSHION, T0)).toEqual(CUSHION_LEVELS[1]);
      expect(cushionFor('auto', { key }, T0 + 1000)).toEqual(CUSHION_LEVELS[1]);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it('never keeps the line login in the key', () => {
    expect(channelBufferKey('host|user|101')).not.toContain('user');
  });
});
