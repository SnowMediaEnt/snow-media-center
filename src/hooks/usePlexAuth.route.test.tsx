// A saved Plex address that is not the best kind is looked at again at every
// Plex open, and replaced when a better one answers. A custom address (a
// reverse proxy, say) can answer /identity first on the day it is saved and
// still be slow for video, and one probe that missed its window must not pin
// the box to a worse path for good. A box stuck on the relay waited 45 s or
// more after each open, and up to ten minutes after a title ended, before
// looking for a direct path; now it looks once the first screen has settled,
// and a few seconds after each title.
import { renderHook, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: () => Promise.reject(new Error('web')), set: () => Promise.reject(new Error('web')), remove: () => Promise.reject(new Error('web')) } }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => false }));
vi.mock('@/lib/plexDemo', () => ({ demoConn: { base: '', token: '', name: '' } }));
// The idle upgrade runs on the next tick.
vi.mock('@/utils/idle', () => ({
  runWhenIdle: (fn: () => void) => { const t = setTimeout(fn, 0); return () => clearTimeout(t); },
  runAfter: (ms: number, fn: () => void) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
}));
vi.mock('@/lib/xtream', () => ({ loadCreds: async () => null, loadPlayerAccount: async () => null }));
vi.mock('@/lib/plexProvider', () => ({
  fetchProviderPlexToken: vi.fn(),
  providerLinkMessage: () => null,
  markPlexProviderLinked: async () => undefined,
  isPlexProviderLinked: async () => false,
  isProviderServer: () => false,
  providerLineInactive: async () => null,
}));
const img = vi.hoisted(() => ({ rekey: vi.fn(), clear: vi.fn() }));
vi.mock('@/components/livetv/PlexImage', () => ({ rekeyPlexImageCache: img.rekey, clearPlexImageCache: img.clear }));

const h = vi.hoisted(() => ({
  servers: vi.fn(),
  better: vi.fn(),
  pick: vi.fn(),
  rekey: vi.fn(),
  epoch: vi.fn(),
}));
// The ranking helpers (plexRouteImprovable, plexRouteOf) and the playback flag
// are the real ones; the network and storage are scripted.
vi.mock('@/lib/plex', async (orig) => ({
  ...(await orig<typeof import('@/lib/plex')>()),
  loadPlexToken: async () => localStorage.getItem('snow-plex-token-v1'),
  savePlexToken: async (t: string) => { localStorage.setItem('snow-plex-token-v1', t); },
  clearPlexToken: async () => { localStorage.removeItem('snow-plex-token-v1'); localStorage.removeItem('snow-plex-server-v1'); },
  loadPlexServer: async () => { const raw = localStorage.getItem('snow-plex-server-v1'); return raw ? JSON.parse(raw) : null; },
  savePlexServer: async (s: unknown) => { localStorage.setItem('snow-plex-server-v1', JSON.stringify(s)); },
  getPlexIdentity: async () => { const raw = localStorage.getItem('snow-plex-server-v1'); return raw ? (JSON.parse(raw).clientIdentifier as string) : null; },
  getPlexServers: h.servers,
  pickBetterPlexConnection: h.better,
  pickPlexConnectionDetailed: h.pick,
  rekeyPlexCaches: h.rekey,
  bumpPlexImageEpoch: h.epoch,
  clearPlexCaches: () => { /* noop */ },
}));

import { usePlexAuth } from '@/hooks/usePlexAuth';
import { setPlexPlaybackActive, type PlexServer } from '@/lib/plex';

const PD = 'https://203-0-113-5.abc123.plex.direct:32400';
const PD_HTTP = 'http://203.0.113.5:32400';
const CUSTOM = 'https://plex.example.com:443';
const RELAY = 'https://198-51-100-7.abc123.plex.direct:8443';

// Each test its own server: the hook remembers probe times per server across
// mounts, as it does across Plex opens on the box.
const server = (id: string): PlexServer => ({
  name: 'Snow Media P2', clientIdentifier: id, accessToken: 'srv-tok', owned: false,
  connections: [
    { uri: PD, address: '203.0.113.5', port: 32400, protocol: 'https', local: false, relay: false },
    { uri: CUSTOM, address: 'plex.example.com', port: 443, protocol: 'https', local: false, relay: false },
    { uri: RELAY, address: '198.51.100.7', port: 8443, protocol: 'https', local: false, relay: true },
  ],
});
const saved = () => JSON.parse(localStorage.getItem('snow-plex-server-v1') || 'null');
const cache = (id: string, base: string, route: string) => {
  localStorage.setItem('snow-plex-token-v1', 'acct-tok');
  localStorage.setItem('snow-plex-server-v1', JSON.stringify({ base, token: 'srv-tok', name: 'Snow Media P2', clientIdentifier: id, owned: false, route }));
  h.servers.mockResolvedValue([server(id)]);
};
/** Runs timers and the promises they start, inside act. */
const run = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  h.servers.mockReset();
  h.better.mockReset();
  h.pick.mockReset();
  h.rekey.mockReset();
  h.epoch.mockReset();
  img.rekey.mockReset();
  setPlexPlaybackActive(false);
});
afterEach(() => {
  cleanup();
  setPlexPlaybackActive(false);
  vi.useRealTimers();
});

describe('usePlexAuth: the saved address is re-tested at every Plex open', () => {
  it('moves a saved custom address to plex.direct when it answers', async () => {
    cache('srv-custom', CUSTOM, 'direct');
    h.better.mockResolvedValue({ base: PD, route: 'direct' });
    const { result } = renderHook(() => usePlexAuth());
    // Not while the Plex screen settles (9 s cap): 10 s in.
    await run(9_000);
    expect(h.better).not.toHaveBeenCalled();
    await run(1_500);
    expect(h.better).toHaveBeenCalledTimes(1);
    expect(h.better.mock.calls[0][1]).toEqual({ base: CUSTOM, route: 'direct' });
    expect(result.current.conn?.base).toBe(PD);
    expect(result.current.conn?.route).toBe('direct');
    expect(saved()).toMatchObject({ base: PD, route: 'direct', clientIdentifier: 'srv-custom' });
    // Same server, new address: the rails and posters carry over.
    expect(h.rekey).toHaveBeenCalledWith(CUSTOM, PD);
    expect(img.rekey).toHaveBeenCalledWith(CUSTOM, PD);
    expect(h.epoch).toHaveBeenCalled();
  });

  it('moves a saved http://ip address to https', async () => {
    cache('srv-http', PD_HTTP, 'direct');
    h.better.mockResolvedValue({ base: PD, route: 'direct' });
    const { result } = renderHook(() => usePlexAuth());
    await run(10_500);
    expect(h.better.mock.calls[0][1]).toEqual({ base: PD_HTTP, route: 'direct' });
    expect(result.current.conn?.base).toBe(PD);
  });

  it('keeps a custom address when nothing better answers, and tries again at the next open', async () => {
    cache('srv-retry', CUSTOM, 'direct');
    h.better.mockResolvedValue(null);
    const first = renderHook(() => usePlexAuth());
    await run(10_500);
    expect(first.result.current.conn?.base).toBe(CUSTOM);
    expect(h.rekey).not.toHaveBeenCalled();
    first.unmount();

    // The next Plex open, once the floor between probes has passed.
    await run(31_000);
    h.better.mockResolvedValue({ base: PD, route: 'direct' });
    const second = renderHook(() => usePlexAuth());
    await run(10_500);
    expect(h.better).toHaveBeenCalledTimes(2);
    expect(second.result.current.conn?.base).toBe(PD);
  });

  it('leaves a saved https plex.direct address alone', async () => {
    cache('srv-best', PD, 'direct');
    const { result } = renderHook(() => usePlexAuth());
    await run(10_500);
    expect(result.current.conn?.base).toBe(PD);
    expect(h.better).not.toHaveBeenCalled();
    expect(h.servers).not.toHaveBeenCalled();
  });

  it('never moves the address under a title that started while the probe ran', async () => {
    cache('srv-playing', CUSTOM, 'direct');
    h.better.mockImplementation(async () => {
      setPlexPlaybackActive(true);
      return { base: PD, route: 'direct' };
    });
    const { result } = renderHook(() => usePlexAuth());
    await run(10_500);
    expect(h.better).toHaveBeenCalledTimes(1);
    expect(result.current.conn?.base).toBe(CUSTOM);
    expect(saved().base).toBe(CUSTOM);
  });
});

describe('usePlexAuth: relay escape', () => {
  it('looks for a direct path ten seconds into a Plex open, past the settle screen, not 45 s', async () => {
    cache('srv-relay', RELAY, 'relay');
    h.better.mockResolvedValue({ base: PD, route: 'direct' });
    const { result } = renderHook(() => usePlexAuth());
    await run(50);
    expect(result.current.conn?.base).toBe(RELAY);
    // PlexSection's settle screen waits at most 9 s for the first screen's
    // requests: neither plex.tv nor the probe goes out before then.
    await run(9000);
    expect(h.servers).not.toHaveBeenCalled();
    expect(h.better).not.toHaveBeenCalled();
    await run(1500);
    expect(h.better).toHaveBeenCalled();
    expect(h.better.mock.calls[0][1]).toEqual({ base: RELAY, route: 'relay' });
    expect(result.current.conn).toMatchObject({ base: PD, route: 'direct' });
    expect(h.rekey).toHaveBeenCalledWith(RELAY, PD);
  });

  it('stands down while a title plays and runs about three seconds after it ends', async () => {
    cache('srv-relay-play', RELAY, 'relay');
    setPlexPlaybackActive(true);
    h.better.mockResolvedValue({ base: PD, route: 'direct' });
    const { result } = renderHook(() => usePlexAuth());
    await run(60_000);
    expect(h.better).not.toHaveBeenCalled();
    expect(result.current.conn?.base).toBe(RELAY);

    act(() => { setPlexPlaybackActive(false); });
    await run(2500);
    expect(h.better).not.toHaveBeenCalled();
    await run(1000);
    expect(h.better).toHaveBeenCalledTimes(1);
    expect(result.current.conn?.base).toBe(PD);
  });
});

describe('usePlexAuth: first connect', () => {
  it('probes with the full remote budget and keeps what the probe ranked best', async () => {
    localStorage.setItem('snow-plex-token-v1', 'acct-tok');
    h.servers.mockResolvedValue([server('srv-first')]);
    h.pick.mockResolvedValue({ base: PD, route: 'direct' });
    const { result } = renderHook(() => usePlexAuth());
    await run(50);
    expect(h.pick).toHaveBeenCalledTimes(1);
    // No noRelay: the relay stays in the race, but only wins when nothing direct answers.
    expect(h.pick.mock.calls[0][1]).toBeGreaterThanOrEqual(6000);
    expect(h.pick.mock.calls[0][2]).toBeUndefined();
    expect(result.current.conn).toMatchObject({ base: PD, route: 'direct', clientIdentifier: 'srv-first' });
  });
});
