import { beforeEach, describe, expect, it } from 'vitest';
import { MATCH_FRAME_RATE_FLAG, MATCH_FRAME_RATE_KEY, PLAYER_FLAG_DEFAULTS, PLAYER_FLAG_KEYS, PLAYER_SETTINGS_EVENT, loadMatchFrameRate, nativeLoadExtras, playerFlag, saveMatchFrameRate } from './playerFlags';
import { clearCachedFlag, writeCachedFlag } from './featureFlagCache';

beforeEach(() => {
  localStorage.clear();
});

describe('the native player\'s settings and remote switches', () => {
  it('"Match frame rate" is on by default and remembered on the box', () => {
    expect(loadMatchFrameRate()).toBe(true);
    let heard = 0;
    const on = () => { heard++; };
    window.addEventListener(PLAYER_SETTINGS_EVENT, on);
    saveMatchFrameRate(false);
    window.removeEventListener(PLAYER_SETTINGS_EVENT, on);
    expect(loadMatchFrameRate()).toBe(false);
    expect(localStorage.getItem(MATCH_FRAME_RATE_KEY)).toBe('0');
    expect(heard).toBe(1);
  });

  it('match_frame_rate: a missing row is on; the cached row wins', () => {
    expect(PLAYER_FLAG_DEFAULTS[MATCH_FRAME_RATE_FLAG]).toBe(true);
    expect(PLAYER_FLAG_KEYS).toContain('match_frame_rate');
    expect(playerFlag(MATCH_FRAME_RATE_FLAG)).toBe(true);
    writeCachedFlag(MATCH_FRAME_RATE_FLAG, false);
    expect(playerFlag(MATCH_FRAME_RATE_FLAG)).toBe(false);
    clearCachedFlag(MATCH_FRAME_RATE_FLAG);
    expect(playerFlag(MATCH_FRAME_RATE_FLAG)).toBe(true);
  });

  it('load() extras: a film asks for matching (with its rate), Live TV never', () => {
    expect(nativeLoadExtras(false, 23.976)).toMatchObject({ matchFrameRate: true, frameRate: 23.976 });
    expect(nativeLoadExtras(false)).not.toHaveProperty('frameRate');
    expect(nativeLoadExtras(false, NaN)).not.toHaveProperty('frameRate');
    expect(nativeLoadExtras(true, 25)).not.toHaveProperty('matchFrameRate');
    saveMatchFrameRate(false);
    expect(nativeLoadExtras(false, 24)).not.toHaveProperty('matchFrameRate');
    saveMatchFrameRate(true);
    writeCachedFlag(MATCH_FRAME_RATE_FLAG, false);
    expect(nativeLoadExtras(false, 24)).not.toHaveProperty('matchFrameRate');
  });
});
