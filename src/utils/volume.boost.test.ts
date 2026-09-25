import { beforeEach, describe, expect, it } from 'vitest';
import { loadPlayerVolume, MAX_VOLUME, savePlayerVolume, stepVolume, volumeBar } from './volume';

beforeEach(() => { localStorage.clear(); });

describe('volume past 100%', () => {
  it('steps up to 150% and no further, and back down', () => {
    let v = 1;
    for (let i = 0; i < 10; i++) v = stepVolume(v, 0.1);
    expect(v).toBe(MAX_VOLUME);
    expect(stepVolume(1.5, -0.1)).toBe(1.4);
    expect(stepVolume(0.05, -0.1)).toBe(0);
  });

  it('remembers a boosted level', () => {
    savePlayerVolume(1.3);
    expect(loadPlayerVolume()).toBe(1.3);
    savePlayerVolume(9);
    expect(loadPlayerVolume()).toBe(1.5);
  });

  it('draws the bar over 0-150%, marked as a boost past 100%', () => {
    expect(volumeBar(1)).toEqual({ pct: 100, fill: (1 / 1.5) * 100, boost: false });
    expect(volumeBar(1.5)).toEqual({ pct: 150, fill: 100, boost: true });
    expect(volumeBar(0.9).boost).toBe(false);
  });
});
