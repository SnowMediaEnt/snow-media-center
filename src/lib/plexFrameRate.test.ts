import { describe, expect, it } from 'vitest';
import { plexFrameRateLabel, plexMediaFrameRate } from './plexFrameRate';
import { mediaVersions } from './plex';

describe('a Plex file\'s frame rate, for frame-rate matching', () => {
  it('the video stream\'s own rate wins', () => {
    expect(plexMediaFrameRate({ videoFrameRate: '24p', Part: [{ Stream: [{ streamType: 2, frameRate: 0 }, { streamType: 1, frameRate: 23.976 }] }] })).toBe(23.976);
    expect(plexMediaFrameRate({ Part: [{ Stream: [{ streamType: '1', frameRate: '59.94' }] }] })).toBe(59.94);
  });

  it('else the label: 24p is 23.976, PAL 25, NTSC 29.97, a number as given', () => {
    expect(plexFrameRateLabel('24p')).toBe(23.976);
    expect(plexFrameRateLabel('PAL')).toBe(25);
    expect(plexFrameRateLabel('NTSC')).toBe(29.97);
    expect(plexFrameRateLabel('60p')).toBe(60);
    expect(plexFrameRateLabel('50')).toBe(50);
    expect(plexFrameRateLabel(25)).toBe(25);
    expect(plexMediaFrameRate({ videoFrameRate: 'PAL', Part: [{ Stream: [{ streamType: 1 }] }] })).toBe(25);
  });

  it('nothing usable: undefined (the player finds the rate itself)', () => {
    for (const v of [undefined, '', 'VFR', 'abc', 0, -1, 'NaN']) expect(plexFrameRateLabel(v)).toBeUndefined();
    expect(plexMediaFrameRate(undefined)).toBeUndefined();
    expect(plexMediaFrameRate({})).toBeUndefined();
  });

  it('each version carries its own', () => {
    const v = mediaVersions({ Media: [
      { videoResolution: '4k', videoFrameRate: '24p', Part: [{ key: '/p/1', Stream: [{ streamType: 1, frameRate: 23.976 }] }] },
      { videoResolution: '1080', videoFrameRate: 'PAL', Part: [{ key: '/p/2' }] },
      { videoResolution: '720', Part: [{ key: '/p/3' }] },
    ] }, '7');
    expect(v.map((x) => x.frameRate)).toEqual([23.976, 25, undefined]);
  });
});
