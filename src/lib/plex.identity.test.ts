// Who SMC says it is to a Plex server, and how one play of a title is told
// from another. The server owner (and SMC support) reads these in the server
// dashboard and its log: the real app version and the box's model, not "1.0"
// and "Android TV" on every box, and one session id per playback on the file
// URL.
import { afterEach, describe, expect, it, vi } from 'vitest';

const BOX_UA = 'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7633.3445N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/66.0.3359.158 Mobile Safari/537.36';
const BASE = 'https://203-0-113-5.abc123.plex.direct:32400';
const PART = '/library/parts/42/1700000000/file.mkv';
const query = (url: string) => new URLSearchParams(url.slice(url.indexOf('?') + 1));

/** A fresh copy of plex.ts (the identity is fixed at its first use). */
async function freshPlex(opts: { ua?: string; native?: boolean; installed?: { version: string; versionCode: number } | null } = {}) {
  vi.resetModules();
  if (opts.ua) vi.stubGlobal('navigator', { ...navigator, userAgent: opts.ua });
  const sent: Array<Record<string, string>> = [];
  vi.doMock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => !!opts.native },
    CapacitorHttp: {
      request: async (r: { headers: Record<string, string> }) => { sent.push(r.headers); return { status: 200, data: '[]' }; },
    },
  }));
  vi.doMock('@/hooks/useVersion', () => ({
    loadVersion: async () => opts.installed ?? { version: '1.0.0', versionCode: 0 },
  }));
  const plex = await import('./plex');
  return { plex, sent };
}

afterEach(() => {
  vi.doUnmock('@capacitor/core');
  vi.doUnmock('@/hooks/useVersion');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('plexClientIdentity', () => {
  it('names the box by its model, from the WebView agent (it carries Build.MODEL)', async () => {
    const { plex } = await freshPlex({ ua: BOX_UA });
    expect(plex.plexClientIdentity()).toMatchObject({ product: 'Snow Media Center', platform: 'Android', device: 'AFTMM', deviceName: 'Snow Media Center' });
    const q = query(plex.plexDirectUrl(BASE, PART, 'tok'));
    expect(q.get('X-Plex-Device')).toBe('AFTMM');
    expect(q.get('X-Plex-Product')).toBe('Snow Media Center');
    expect(q.get('X-Plex-Platform')).toBe('Android');
  });

  it('falls back to "Android TV" when the agent names no model', async () => {
    const { plex } = await freshPlex({ ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36' });
    expect(plex.plexClientIdentity().device).toBe(plex.PLEX_DEVICE);
  });

  it('on the box, sends the installed versionName on every request, read once before the first', async () => {
    const { plex, sent } = await freshPlex({ ua: BOX_UA, native: true, installed: { version: '1.8.1', versionCode: 59 } });
    await plex.getPlexServers('identity-native', { fresh: true });
    await plex.getPlexServers('identity-native-2', { fresh: true });
    expect(sent).toHaveLength(2);
    for (const h of sent) {
      expect(h['X-Plex-Version']).toBe('1.8.1');
      expect(h['X-Plex-Device']).toBe('AFTMM');
    }
    // The file URL names the client the same way.
    expect(query(plex.plexDirectUrl(BASE, PART, 'tok')).get('X-Plex-Version')).toBe('1.8.1');
  });

  it('never changes within a run: a conversion\'s decision and start name the client the same way', async () => {
    const { plex } = await freshPlex({ ua: BOX_UA });
    const first = plex.plexClientIdentity();
    expect(plex.plexClientIdentity()).toBe(first);
  });
});

describe('newPlexPlaybackSession', () => {
  it('gives each playback its own id, and tells listeners which one it replaced', async () => {
    const { plex } = await freshPlex();
    const heard: Array<[string | null, string]> = [];
    const off = plex.onPlexPlaybackSession((prev, next) => { heard.push([prev, next]); });
    expect(plex.currentPlexPlaybackSession()).toBeNull();
    const a = plex.newPlexPlaybackSession();
    const b = plex.newPlexPlaybackSession();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^smcp-/);
    expect(plex.currentPlexPlaybackSession()).toBe(b);
    expect(heard).toEqual([[null, a], [a, b]]);
    off();
    plex.newPlexPlaybackSession();
    expect(heard).toHaveLength(2);
  });

  it('goes on the file URL after who is asking, the token still first', async () => {
    const { plex } = await freshPlex();
    const id = plex.newPlexPlaybackSession();
    const url = plex.plexDirectUrl(BASE, PART, 'tok', { session: id });
    expect(url.indexOf(`${BASE}${PART}?X-Plex-Token=tok&`)).toBe(0);
    expect(query(url).get('X-Plex-Session-Identifier')).toBe(id);
    expect(url.endsWith(`&X-Plex-Session-Identifier=${id}`)).toBe(true);
    // Left out, the URL is as it was.
    expect(plex.plexDirectUrl(BASE, PART, 'tok')).not.toContain('Session-Identifier');
  });
});
