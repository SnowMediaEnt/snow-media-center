import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaVersions, plexTranscodeUrl, type PlexVersion } from './plex';
import {
  _resetPlexSpeedCache, _setPlexSpeed, cachedPlexSpeed, defaultVersion, fallbackVersion, measurePlexSpeed,
  probeRate, sortVersions, speedVerdict, speedWarning, startVersion, transcodeSource, versionName,
} from './plexVersions';

// A film kept as a 4K and a 1080p file (two Media of one item), the way the
// Plex server sends it.
const film = {
  ratingKey: '101',
  Media: [
    { videoResolution: '1080', bitrate: 10000, height: 1080, videoCodec: 'h264', Part: [{ key: '/library/parts/1/file.mkv' }] },
    { videoResolution: '4k', bitrate: 48000, height: 2160, videoCodec: 'hevc', Part: [{ key: '/library/parts/2/file.mkv' }] },
  ],
};
const versions = mediaVersions(film, '101');
const [v1080, v4k] = versions;

describe('versions of a title', () => {
  it('reads every Media as a version, in Plex order', () => {
    expect(versions.map((v) => [v.id, v.label, v.bitrateKbps, v.mediaIndex, v.partKey])).toEqual([
      ['101:0', '1080p', 10000, 0, '/library/parts/1/file.mkv'],
      ['101:1', '4K', 48000, 1, '/library/parts/2/file.mkv'],
    ]);
  });

  it('lists 4K first and drops duplicates', () => {
    expect(sortVersions([v1080, v4k, { ...v4k }]).map((v) => v.label)).toEqual(['4K', '1080p']);
  });

  it('defaults to the version the clicked poster showed', () => {
    // A poster shows its item's first Media: 1080p here.
    expect(defaultVersion(versions, { ratingKey: '101', videoResolution: '1080' })?.id).toBe('101:0');
    // The same film's poster in a "4K Movies" library says 4K.
    const copy4k = mediaVersions({ Media: [{ videoResolution: '4k', bitrate: 50000, Part: [{ key: '/p/9' }] }] }, '202');
    expect(defaultVersion([...versions, ...copy4k], { ratingKey: '202', videoResolution: '4k' })?.id).toBe('202:0');
    expect(defaultVersion([], { ratingKey: '1' })).toBeNull();
  });

  it('names twins by their bitrate', () => {
    const twin: PlexVersion = { ...v1080, id: '101:2', mediaIndex: 2, bitrateKbps: 4000 };
    expect(versionName(v1080, [v1080, twin])).toBe('1080p · 10.0 Mb/s');
    expect(versionName(v4k, versions)).toBe('4K');
  });
});

describe('4K speed check', () => {
  it('says when the connection is clearly too slow for 4K', () => {
    const verdict = speedVerdict(v4k, 12000);
    expect(verdict?.tooSlow).toBe(true);
    expect(speedWarning(v4k, verdict!)).toBe('4K needs ~60 Mb/s, you have ~12');
    expect(speedVerdict(v4k, 90000)?.tooSlow).toBe(false);
    expect(speedVerdict(v4k, null)).toBeNull();
  });

  it('starts 1080p instead of a 4K default the line cannot carry', () => {
    expect(startVersion(versions, v4k, false, 12000)?.id).toBe(v1080.id);
    expect(startVersion(versions, v4k, false, 90000)?.id).toBe(v4k.id);
    // Unknown speed: what was chosen.
    expect(startVersion(versions, v4k, false, null)?.id).toBe(v4k.id);
  });

  it('plays 4K anyway when the viewer picked it', () => {
    expect(startVersion(versions, v4k, true, 12000)?.id).toBe(v4k.id);
  });

  it('never swaps a 1080p choice', () => {
    expect(startVersion(versions, v1080, false, 500)?.id).toBe(v1080.id);
  });

  it('falls back to the best lighter file that fits, else the lightest', () => {
    const v720: PlexVersion = { ...v1080, id: '101:2', mediaIndex: 2, label: '720p', height: 720, bitrateKbps: 4000, partKey: '/library/parts/3/file.mkv' };
    expect(fallbackVersion([v4k, v1080, v720], v4k, 20000).id).toBe(v1080.id);
    expect(fallbackVersion([v4k, v1080, v720], v4k, 6000).id).toBe(v720.id);
    expect(fallbackVersion([v4k, v1080, v720], v4k, 1000).id).toBe(v720.id);
    expect(fallbackVersion([v4k], v4k, 1000).id).toBe(v4k.id);
  });
});

describe('what a lower quality converts from', () => {
  it('uses the lightest file that still carries the cap', () => {
    expect(transcodeSource(versions, v4k, 8000)?.id).toBe(v1080.id);
    expect(transcodeSource(versions, v4k, 20000)?.id).toBe(v4k.id);
    expect(transcodeSource(versions, v1080, undefined)?.id).toBe(v1080.id);
    expect(transcodeSource([v4k], v4k, 8000)?.id).toBe(v4k.id);
  });

  it('asks the server for that Media', () => {
    expect(plexTranscodeUrl('http://s:32400', '101', 't', { mediaIndex: 1 })).toMatch(/&mediaIndex=1&partIndex=0/);
    expect(plexTranscodeUrl('http://s:32400', '101', 't')).toMatch(/&mediaIndex=0&partIndex=0/);
  });
});

describe('measuring the speed to the server', () => {
  afterEach(() => { _resetPlexSpeedCache(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('rates the bytes after the first 256 KB, else all of them on a slow line', () => {
    expect(probeRate(4_000_000, 3_000_000, 1000, 1500)).toBe(24000);
    // 150 KB in 3 s: slow, and that is what must not be missed.
    expect(probeRate(150_000, 0, 0, 3000)).toBe(400);
    expect(probeRate(0, 0, 0, 3000)).toBeNull();
  });

  it('keeps a measurement for a few minutes per server', () => {
    _setPlexSpeed('http://s:32400/', 30000, 1_000);
    expect(cachedPlexSpeed('http://s:32400', 1_000 + 60_000)).toBe(30000);
    expect(cachedPlexSpeed('http://s:32400', 1_000 + 6 * 60_000)).toBeNull();
  });

  it('reads part of the file once, and shares it', async () => {
    const chunk = new Uint8Array(512 * 1024);
    let reads = 0;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 206,
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            await new Promise((r) => setTimeout(r, 60));
            return reads > 6 ? { done: true, value: undefined } : { done: false, value: chunk };
          },
          cancel: async () => {},
        }),
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([
      measurePlexSpeed('http://s:32400', 'tok', '/library/parts/2/file.mkv'),
      measurePlexSpeed('http://s:32400', 'tok', '/library/parts/2/file.mkv'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(a);
    // From the cache now.
    expect(await measurePlexSpeed('http://s:32400', 'tok', '/library/parts/2/file.mkv')).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Range).toMatch(/^bytes=0-/);
  });

  it('cannot tell when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('blocked'); }));
    expect(await measurePlexSpeed('http://s:32400', 'tok', '/p')).toBeNull();
    expect(await measurePlexSpeed('http://s:32400', 'tok', undefined)).toBeNull();
  });
});
