// The direct-play URL names the app to the server the way Plex's own players
// do: the player sends none of the headers the API calls carry, so the client
// id, product, version, platform and device ride on the URL next to the token.
// The transcode URL names the client the same way (bugs/plex-buffering-remote.md):
// the server picks its conversion profile by platform; the plain start of
// builds 38-56 (identify: false) is kept as the other thing to try.
import { afterEach, describe, expect, it, vi } from 'vitest';

// Not native: plexReq goes through fetch, which the header test captures.
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false }, CapacitorHttp: {} }));

import {
  getPlexClientId, getPlexServers, plexDirectUrl, plexTranscodeDecision, plexTranscodeDecisionUrl, plexTranscodeIdentified, plexTranscodeUrl,
  PLEX_DEVICE, PLEX_PRODUCT, PLEX_VERSION,
} from './plex';
import { transcodePingUrl, transcodeStopUrl } from './plexAutoQuality';

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
  it('names the client the way Plex\'s own players do, with the token after the id, and says where the box is', () => {
    const url = plexTranscodeUrl(BASE, '101', 'tok+1', { maxVideoBitrateKbps: 4000, mediaIndex: 1, location: 'wan' });
    const q = query(url);
    expect(q.getAll('X-Plex-Client-Identifier')).toEqual([getPlexClientId()]);
    expect(q.getAll('X-Plex-Token')).toEqual(['tok+1']);
    // What the server picks its conversion profile by: the platform, named
    // outright (Plex for Android sends the same), not left to the player's
    // User-Agent (build 39: SMC's own agent there, and no conversion started).
    expect(q.get('X-Plex-Platform')).toBe('Android');
    expect(q.get('X-Plex-Product')).toBe(PLEX_PRODUCT);
    expect(q.get('X-Plex-Version')).toBe(PLEX_VERSION);
    expect(q.get('X-Plex-Device')).toBe(PLEX_DEVICE);
    expect(q.get('X-Plex-Device-Name')).toBe(PLEX_PRODUCT);
    expect(q.get('location')).toBe('wan');
    expect(url.slice(url.indexOf('&mediaIndex='), url.indexOf('&location='))).toBe(
      `&mediaIndex=1&partIndex=0&X-Plex-Client-Identifier=${encodeURIComponent(getPlexClientId())}`
      + '&X-Plex-Token=tok%2B1&maxVideoBitrate=4000',
    );
    expect(plexTranscodeIdentified(url)).toBe(true);
  });

  it('the plain start of builds 38-56 (identify: false): the client id alone', () => {
    const url = plexTranscodeUrl(BASE, '101', 'tok+1', { maxVideoBitrateKbps: 4000, identify: false });
    const q = query(url);
    for (const k of ['X-Plex-Product', 'X-Plex-Version', 'X-Plex-Platform', 'X-Plex-Device', 'X-Plex-Device-Name', 'location']) {
      expect(q.has(k)).toBe(false);
    }
    expect(q.getAll('X-Plex-Client-Identifier')).toEqual([getPlexClientId()]);
    expect(plexTranscodeIdentified(url)).toBe(false);
    expect(plexTranscodeIdentified(plexDirectUrl(BASE, PART, 'tok'))).toBe(true);
    expect(plexTranscodeIdentified(null)).toBe(false);
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

describe('a conversion session asked for the other way round', () => {
  it('a named and a plain session differ only in the naming; the decision call has the same session and parameters', () => {
    const plain = plexTranscodeUrl(BASE, '42', 'tok', { maxVideoBitrateKbps: 4000, videoResolution: '1280x720', identify: false });
    expect(query(plain).get('X-Plex-Platform')).toBeNull();
    const fresh = plexTranscodeUrl(BASE, '42', 'tok', { maxVideoBitrateKbps: 4000, videoResolution: '1280x720' });
    const q = query(fresh);
    expect(q.get('X-Plex-Platform')).toBe('Android');
    expect(q.get('X-Plex-Product')).toBe(PLEX_PRODUCT);
    expect(q.get('X-Plex-Device')).toBe(PLEX_DEVICE);
    expect(q.getAll('X-Plex-Client-Identifier')).toEqual([getPlexClientId()]);
    expect(q.get('session')).not.toBe(query(plain).get('session'));
    const decision = plexTranscodeDecisionUrl(fresh) ?? '';
    expect(decision.startsWith(`${BASE}/video/:/transcode/universal/decision?`)).toBe(true);
    expect(query(decision).toString()).toBe(q.toString());
    expect(plexTranscodeDecisionUrl(plexDirectUrl(BASE, PART, 'tok'))).toBeNull();
    // The keep-alive while paused, for the same session.
    const ping = transcodePingUrl(fresh) ?? '';
    expect(ping).toBe(`${BASE}/video/:/transcode/universal/ping?session=${q.get('session')}`
      + `&X-Plex-Client-Identifier=${encodeURIComponent(getPlexClientId())}&X-Plex-Token=tok`);
    expect(transcodePingUrl(plexDirectUrl(BASE, PART, 'tok'))).toBeNull();
  });

  it('the decision: an error status or a "can\'t convert" code is a refusal; no answer is not', async () => {
    const fresh = plexTranscodeUrl(BASE, '42', 'tok', { identify: true });
    const answer = (r: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(r));
    answer(async () => new Response('', { status: 503 }));
    expect(await plexTranscodeDecision(fresh, 'tok')).toEqual({ refused: true, httpStatus: 503, code: null });
    answer(async () => new Response(JSON.stringify({ MediaContainer: { generalDecisionCode: 1001 } }), { status: 200 }));
    expect(await plexTranscodeDecision(fresh, 'tok')).toEqual({ refused: false, httpStatus: null, code: 1001 });
    answer(async () => new Response(JSON.stringify({ MediaContainer: { generalDecisionCode: 2000 } }), { status: 200 }));
    expect((await plexTranscodeDecision(fresh, 'tok'))?.refused).toBe(true);
    answer(async () => { throw new TypeError('Failed to fetch'); });
    expect(await plexTranscodeDecision(fresh, 'tok')).toBeNull();
  });
});
