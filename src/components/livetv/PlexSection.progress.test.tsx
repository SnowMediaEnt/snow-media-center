// Continue Watching, end to end through PlexSection: a title played in the
// native player is saved by the real EpisodeAutoplay + PlexProgressReporter
// pair as PlexSection wires them (active / ratingKey / info / getPosition),
// the final save runs when the player closes, and Home's Continue Watching
// shows it. Only the network and the native player are stand-ins.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlexItem, PlexLibrary, PlexPlayInfo } from '@/lib/plex';

const h = vi.hoisted(() => {
  const later = <T,>(ms: number, v: T): Promise<T> => new Promise((r) => { setTimeout(() => r(v), ms); });
  const noop = () => { /* test */ };
  const conn = { base: 'https://plex.test', token: 'tok', name: 'Snow Media P2', clientIdentifier: 'srv' };
  const auth = {
    status: 'ready', conn, pinCode: null, error: null, justLinked: false, accountToken: null, providerNote: null, providerAvailable: false,
    clearJustLinked: noop, startLink: noop, cancelLink: noop, signOut: noop, retryConnect: noop, linkWithProvider: noop, reportAuthFailure: noop,
  };
  return {
    later, auth,
    /** The native player's playhead (seconds, as SnowPlayerPlugin.getPosition answers). */
    pos: { position: 0, duration: 0, playing: false },
    playInfo: vi.fn(),
    closePlayer: null as null | (() => void),
  };
});

vi.mock('@/integrations/supabase/client', () => {
  const result = { data: null, error: null };
  const chain: unknown = new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => void) => res(result) : () => chain),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => result,
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { /* test */ } } } }),
      },
      functions: { invoke: async () => result },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => undefined,
    },
  };
});
vi.mock('@/lib/analytics', async (orig) => ({
  ...(await orig<typeof import('@/lib/analytics')>()),
  trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(),
}));
vi.mock('@/hooks/usePlexAuth', () => ({ usePlexAuth: () => h.auth }));
// The box has the native player (SnowPlayerPlugin).
vi.mock('@/capacitor/SnowPlayer', async (orig) => ({
  ...(await orig<typeof import('@/capacitor/SnowPlayer')>()),
  hasNativePlayer: () => true,
}));
vi.mock('@/hooks/useNativePlayer', () => {
  const state = {
    error: null, buffering: false, paused: false, audioWarning: null, controller: null,
    getPosition: async () => ({ ...h.pos }), seekTo: async () => undefined, retry: () => undefined,
  };
  return { useNativePlayer: () => state };
});
const LIBS: PlexLibrary[] = [{ key: '1', title: 'Movies', type: 'movie' }, { key: '2', title: 'TV Shows', type: 'show' }];
vi.mock('@/lib/plex', async (orig) => ({
  ...(await orig<typeof import('@/lib/plex')>()),
  getPlexLibraries: () => h.later(5, LIBS),
  searchPlex: () => h.later(5, []),
  getPlexItemByKey: async () => null,
  getPlexHub: () => h.later(5, []),
  getPlexRecentlyAdded: () => h.later(5, []),
  getPlexSectionRow: () => h.later(5, []),
  getPlexPart: async () => ({ partKey: '/library/parts/7/file.mkv', versions: [] }),
  getPlexPlayInfo: h.playInfo,
  getNextPlexEpisode: async () => null,
  reportPlexTimeline: async () => undefined,
  getPlexAccount: async () => null,
  loadHiddenPlexLibs: async () => [],
  loadPlexQuality: async () => 'original',
  preloadImages: async () => undefined,
}));
vi.mock('@/lib/plexFavorites', async (orig) => ({
  ...(await orig<typeof import('@/lib/plexFavorites')>()),
  myList: () => [], pullFavoritesFromCloud: async () => undefined,
}));
vi.mock('@/lib/plexProvider', async (orig) => ({
  ...(await orig<typeof import('@/lib/plexProvider')>()),
  isOwnPlexAccount: async () => false,
}));
vi.mock('./PlexImage', () => ({ default: () => null }));
// The title page: its Play button, and Back.
vi.mock('./PlexDetail', () => ({
  default: ({ item, onPlay, onBack }: { item: PlexItem; onPlay: (it: PlexItem) => void; onBack: () => void }) => (
    <div>
      <button onClick={() => onPlay(item)}>PLAY:{item.title}</button>
      <button onClick={() => onBack()}>BACK</button>
    </div>
  ),
}));
// The player's own Back (the overlay owns the remote while a film plays).
vi.mock('./PlexPlayerOverlay', () => ({
  default: ({ onBackWhileHidden }: { onBackWhileHidden: () => void }) => { h.closePlayer = onBackWhileHidden; return null; },
}));

class NoResize { observe() { /* test */ } unobserve() { /* test */ } disconnect() { /* test */ } }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= NoResize;

const film: PlexPlayInfo = { ratingKey: 'd1', kind: 'movie', title: 'Dune', librarySectionID: '1', duration: 9300, markers: [] };
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  h.pos = { position: 0, duration: 0, playing: false };
  h.closePlayer = null;
  h.playInfo.mockReset();
  (await import('@/lib/plex')).clearPlexCaches();
  (await import('./plexKeyOwner')).setPlexKeyOwner('browse');
  (await import('@/lib/plexProgress')).__resetPlexProgressForTests('device');
});

async function playDune() {
  sessionStorage.setItem('smc-plex-deeplink', JSON.stringify({ ratingKey: 'd1', title: 'Dune', kind: 'movie', librarySectionID: '1', machineIdentifier: 'srv', at: Date.now() }));
  const { default: PlexSection } = await import('./PlexSection');
  render(<PlexSection isActive onExitLeft={() => undefined} onExitUp={() => undefined} />);
  fireEvent.click(await screen.findByText('PLAY:Dune', undefined, { timeout: 3000 }));
  await waitFor(() => expect(h.closePlayer).not.toBeNull());
}

describe('PlexSection — Continue Watching after the native player', () => {
  it('saves where the film stopped, and Home shows it once the player closes', async () => {
    h.playInfo.mockImplementation(async () => film);
    // Resumed at 25:00.
    h.pos = { position: 1500, duration: 9300, playing: true };
    await playDune();
    // The reporter's first beat comes as soon as the title is known.
    await wait(50);
    const { continueWatching, resumeSeconds } = await import('@/lib/plexProgress');
    expect(resumeSeconds('d1')).toBe(1500);
    act(() => { h.closePlayer?.(); });
    await wait(20);
    expect(continueWatching(30, '1').map((i) => i.ratingKey)).toEqual(['d1']);
    fireEvent.click(screen.getByText('BACK'));
    const row = await screen.findByText('Continue Watching', undefined, { timeout: 3000 });
    expect(row.closest('[data-plex-row="continue"]')?.textContent).toContain('Dune');
  });

  it('still saves when the server was too busy to say what is playing the first two times', async () => {
    // Playback just started: the stream takes the whole link and the
    // metadata request times out, twice.
    let calls = 0;
    h.playInfo.mockImplementation(async () => { calls += 1; return calls <= 2 ? null : film; });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      h.pos = { position: 900, duration: 9300, playing: true };
      await playDune();
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      const { resumeSeconds } = await import('@/lib/plexProgress');
      expect(calls).toBeGreaterThanOrEqual(3);
      expect(resumeSeconds('d1')).toBe(900);
    } finally {
      vi.useRealTimers();
    }
  });
});
