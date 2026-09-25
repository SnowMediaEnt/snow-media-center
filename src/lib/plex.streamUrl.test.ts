// The direct-play URL names the app to the server the way Plex's own players
// do: the player sends none of the headers the API calls carry, so the client
// id, product, version, platform and device ride on the URL next to the token.
// The transcode URL keeps the client id alone, as it always has: the server
// picks its conversion profile by platform and product.
import { afterEach, describe, expect, it, vi } from 'vitest';

// Not native: plexReq goes through fetch, which the header test captures.
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false }, CapacitorHttp: {} }));

import {
  getPlexClientId, getPlexServers, plexDirectUrl, plexTranscodeUrl,
  PLEX_DEVICE, PLEX_PRODUCT, PLEX_VERSION,
} from './plex';
import { transcodeStopUrl } from './plexAutoQuality';

const BASE = 'https://203-0-113-5.abc123.plex.direct:32400';
const PART = '/library/parts/7/1700000000/file.mkv';

const query = (url: string) => new URLSearchParams(url.slice(url.indexOf('?') + 1));

afterEach(() => { vi.unstubAllGlobals(); });

describe('plexDirectUrl', () => {
  it('keeps the token first and names the app after it', () => {
    const cid = getPlexClientId();
    expect(plexDirectUrl(BASE, PART, 'tok+1')).toBe(
      `${BASE}${PART}?X-Plex-Token=tok%2B1`
      + `&X-Plex-Client-Identifier=${encodeURIComponent(cid)}`
      + '&X-Plex-Product=Snow%20Media%20Center&X-Plex-Version=1.0'
      + '&X-Plex-Platform=Android&X-Plex-Device=Android%20TV'
      + '&X-Plex-Device-Name=Snow%20Media%20Center',
    );
  });

  it('sends the same client id, product and device as the API calls', async () => {
    let sent: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_url: string, init?: { headers?: Record<string, string> }) => {
      sent = init?.headers ?? {};
      return { ok: true, status: 200, text: async () => '[]' };
    });
    await getPlexServers('stream-url-test', { fresh: true });
    const q = query(plexDirectUrl(BASE, PART, 'tok'));
    for (const k of ['X-Plex-Client-Identifier', 'X-Plex-Product', 'X-Plex-Version', 'X-Plex-Platform', 'X-Plex-Device', 'X-Plex-Device-Name']) {
      expect(q.get(k)).toBe(sent[k]);
    }
    expect(q.get('X-Plex-Product')).toBe(PLEX_PRODUCT);
    expect(q.get('X-Plex-Version')).toBe(PLEX_VERSION);
    expect(q.get('X-Plex-Device')).toBe(PLEX_DEVICE);
    expect(q.get('X-Plex-Platform')).toBe('Android');
    expect(q.get('X-Plex-Token')).toBe('tok');
  });
});

describe('plexTranscodeUrl', () => {
  it('names the client by its id alone, with the token after it', () => {
    const url = plexTranscodeUrl(BASE, '101', 'tok+1', { maxVideoBitrateKbps: 4000, mediaIndex: 1 });
    const q = query(url);
    expect(q.getAll('X-Plex-Client-Identifier')).toEqual([getPlexClientId()]);
    expect(q.getAll('X-Plex-Token')).toEqual(['tok+1']);
    // Nothing the server could pick a different conversion profile by.
    for (const k of ['X-Plex-Product', 'X-Plex-Version', 'X-Plex-Platform', 'X-Plex-Device', 'X-Plex-Device-Name']) {
      expect(q.has(k)).toBe(false);
    }
    expect(url.slice(url.indexOf('&mediaIndex='))).toBe(
      `&mediaIndex=1&partIndex=0&X-Plex-Client-Identifier=${encodeURIComponent(getPlexClientId())}`
      + '&X-Plex-Token=tok%2B1&maxVideoBitrate=4000',
    );
  });

  it('still gives the address that ends its converting session', () => {
    const url = plexTranscodeUrl(BASE, '101', 'tok+1');
    const session = query(url).get('session');
    expect(session).toBeTruthy();
    expect(transcodeStopUrl(url)).toBe(
      `${BASE}/video/:/transcode/universal/stop?session=${session}`
      + `&X-Plex-Client-Identifier=${encodeURIComponent(getPlexClientId())}&X-Plex-Token=tok%2B1`,
    );
  });
});
