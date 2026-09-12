// Plex provider link: a box signed into Live TV gets the provider's Plex
// token from plex-provider-token instead of the PIN round trip, a dead
// provider token is replaced on its own, and a member's own PIN-linked Plex
// is never touched.
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

// Not native: every store falls back to localStorage.
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: () => Promise.reject(new Error('web')), set: () => Promise.reject(new Error('web')), remove: () => Promise.reject(new Error('web')) } }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => false }));
vi.mock('@/lib/plexDemo', () => ({ demoConn: { base: '', token: '', name: '' } }));
vi.mock('@/utils/idle', () => ({ runWhenIdle: () => () => { /* never runs in tests */ } }));

const loadCreds = vi.fn();
vi.mock('@/lib/xtream', () => ({ loadCreds: () => loadCreds() }));

const getPlexServers = vi.fn();
const storage = () => ({
  token: localStorage.getItem('snow-plex-token-v1'),
  server: localStorage.getItem('snow-plex-server-v1'),
  flag: localStorage.getItem('snow-plex-provider-v1'),
});
vi.mock('@/lib/plex', () => ({
  requestPlexPin: vi.fn(),
  checkPlexPin: vi.fn(),
  loadPlexToken: async () => localStorage.getItem('snow-plex-token-v1'),
  savePlexToken: async (t: string) => { localStorage.setItem('snow-plex-token-v1', t); },
  clearPlexToken: async () => { localStorage.removeItem('snow-plex-token-v1'); localStorage.removeItem('snow-plex-server-v1'); },
  getPlexServers: (t: string) => getPlexServers(t),
  pickPlexConnectionDetailed: async () => ({ base: 'https://p2.plex.direct:32400', route: 'direct' }),
  loadPlexServer: async () => { const raw = localStorage.getItem('snow-plex-server-v1'); return raw ? JSON.parse(raw) : null; },
  savePlexServer: async (s: unknown) => { localStorage.setItem('snow-plex-server-v1', JSON.stringify(s)); },
  // The saved server IS the server that answers /identity in these tests.
  getPlexIdentity: async () => { const raw = localStorage.getItem('snow-plex-server-v1'); return raw ? (JSON.parse(raw).clientIdentifier as string) : 'machine-p2'; },
  bumpPlexImageEpoch: () => { /* noop */ },
  clearPlexCaches: () => { /* noop */ },
  plexRouteOf: () => 'direct',
  isPlexPlaybackActive: () => false,
}));

import { usePlexAuth } from '@/hooks/usePlexAuth';

const LINE = { host: 'http://dstreams.xyz:8080', username: 'jself', password: 'pw', output: 'm3u8' as const, serverLabel: 'Dreamstreams' };
const SERVER = { name: 'Snow Media P2', clientIdentifier: 'machine-p2', accessToken: 'srv-tok', owned: false, connections: [] };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
  loadCreds.mockReset();
  getPlexServers.mockReset();
  getPlexServers.mockResolvedValue([SERVER]);
});
afterEach(() => cleanup());

describe('usePlexAuth provider link', () => {
  it('signs into Plex from the Live TV line when no Plex token is stored', async () => {
    loadCreds.mockResolvedValue(LINE);
    invoke.mockResolvedValue({ data: { ok: true, token: 'provider-tok' }, error: null });

    const { result } = renderHook(() => usePlexAuth());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('plex-provider-token', {
      body: { host: 'dstreams.xyz:8080', username: 'jself', password: 'pw' },
    });
    expect(getPlexServers).toHaveBeenCalledWith('provider-tok');
    expect(result.current.conn?.name).toBe('Snow Media P2');
    expect(result.current.conn?.token).toBe('srv-tok');
    expect(storage()).toMatchObject({ token: 'provider-tok', flag: '1' });
    expect(result.current.providerAvailable).toBe(true);
  });

  it('stays on the PIN screen and never calls the function without a Live TV line', async () => {
    loadCreds.mockResolvedValue(null);
    const { result } = renderHook(() => usePlexAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.providerAvailable).toBe(false);
  });

  it('explains an inactive line and falls back to signed-out', async () => {
    loadCreds.mockResolvedValue(LINE);
    invoke.mockResolvedValue({ data: { ok: false, reason: 'line_inactive', status: 'expired' }, error: null });
    const { result } = renderHook(() => usePlexAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(result.current.providerNote).toMatch(/expired/);
    expect(storage().token).toBeNull();
  });

  it('is invisible when the feature is off (reason: disabled)', async () => {
    loadCreds.mockResolvedValue(LINE);
    invoke.mockResolvedValue({ data: { ok: false, reason: 'disabled' }, error: null });
    const { result } = renderHook(() => usePlexAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(result.current.providerNote).toBeNull();
  });

  it('replaces a provider token that plex.tv rejects with a fresh one, without a code', async () => {
    localStorage.setItem('snow-plex-token-v1', 'dead-tok');
    localStorage.setItem('snow-plex-provider-v1', '1');
    loadCreds.mockResolvedValue(LINE);
    getPlexServers.mockImplementation(async (t: string) => {
      if (t === 'dead-tok') throw new Error('Plex HTTP 401');
      return [SERVER];
    });
    invoke.mockResolvedValue({ data: { ok: true, token: 'fresh-tok' }, error: null });

    const { result } = renderHook(() => usePlexAuth());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(storage().token).toBe('fresh-tok');
    expect(result.current.conn?.token).toBe('srv-tok');
  });

  it('also repairs a dead token whose saved server is the provider\'s, even without the flag', async () => {
    localStorage.setItem('snow-plex-token-v1', 'dead-tok');
    localStorage.setItem('snow-plex-server-v1', JSON.stringify({ base: 'https://p2.plex.direct:32400', token: 'dead-srv', name: 'Snow Media P2', clientIdentifier: 'machine-p2' }));
    loadCreds.mockResolvedValue(LINE);
    invoke.mockResolvedValue({ data: { ok: true, token: 'fresh-tok' }, error: null });

    const { result } = renderHook(() => usePlexAuth());
    // Cached path: /identity answers, so the box lands on 'ready' with the
    // dead token. The 401 only shows at the first library request.
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.conn?.token).toBe('dead-srv');
    expect(invoke).not.toHaveBeenCalled();

    act(() => { result.current.reportAuthFailure(); });
    await waitFor(() => expect(result.current.conn?.token).toBe('srv-tok'));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(storage()).toMatchObject({ token: 'fresh-tok', flag: '1' });
  });

  it('leaves a member\'s own PIN-linked Plex alone on a 401', async () => {
    localStorage.setItem('snow-plex-token-v1', 'own-tok');
    localStorage.setItem('snow-plex-server-v1', JSON.stringify({ base: 'https://home.example:32400', token: 'own-srv', name: "Bob's NAS", clientIdentifier: 'machine-bob' }));
    loadCreds.mockResolvedValue(LINE);
    invoke.mockResolvedValue({ data: { ok: true, token: 'fresh-tok' }, error: null });

    const { result } = renderHook(() => usePlexAuth());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => { result.current.reportAuthFailure(); });
    await new Promise((r) => setTimeout(r, 30));
    expect(invoke).not.toHaveBeenCalled();
    expect(storage().token).toBe('own-tok');
  });

  it('signs Plex out when the Live TV line is removed, only if the link was the provider\'s', async () => {
    loadCreds.mockResolvedValue(LINE);
    invoke.mockResolvedValue({ data: { ok: true, token: 'provider-tok' }, error: null });
    const { result } = renderHook(() => usePlexAuth());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    loadCreds.mockResolvedValue(null);
    act(() => { window.dispatchEvent(new CustomEvent('playerAccountRefresh')); });
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(storage()).toMatchObject({ token: null, flag: null });
    expect(result.current.providerAvailable).toBe(false);
  });

  it('keeps a PIN-linked Plex when the Live TV line is removed', async () => {
    localStorage.setItem('snow-plex-token-v1', 'own-tok');
    loadCreds.mockResolvedValue(LINE);
    const { result } = renderHook(() => usePlexAuth());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    loadCreds.mockResolvedValue(null);
    act(() => { window.dispatchEvent(new CustomEvent('playerAccountRefresh')); });
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.status).toBe('ready');
    expect(storage().token).toBe('own-tok');
  });

  it('links on the spot when the member signs into Live TV while Plex is signed out', async () => {
    loadCreds.mockResolvedValue(null);
    const { result } = renderHook(() => usePlexAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));

    loadCreds.mockResolvedValue(LINE);
    invoke.mockResolvedValue({ data: { ok: true, token: 'provider-tok' }, error: null });
    act(() => { window.dispatchEvent(new CustomEvent('playerAccountRefresh')); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not sign straight back in after the member presses Sign out', async () => {
    loadCreds.mockResolvedValue(LINE);
    invoke.mockResolvedValue({ data: { ok: true, token: 'provider-tok' }, error: null });
    const { result } = renderHook(() => usePlexAuth());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => { await result.current.signOut(); });
    expect(result.current.status).toBe('signed-out');
    act(() => { window.dispatchEvent(new CustomEvent('playerAccountRefresh')); });
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.status).toBe('signed-out');
    expect(invoke).toHaveBeenCalledTimes(1);

    // The button on the sign-in screen is the way back in.
    await act(async () => { await result.current.linkWithProvider(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
