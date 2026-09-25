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
    next: vi.fn(),
    hub: vi.fn(),
    /** Whether the box is on the viewer's own Plex account, when it finds out. */
    own: vi.fn(),
    closePlayer: null as null | (() => void),
    /** The episode the title page's episode list plays (PLAYEP). */
    ep: null as null | { ep: { ratingKey: string; title: string; index?: number; duration?: number }; ctx: { title: string; grandparentTitle?: string; season?: number; episode?: number } },
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
  getPlexHub: h.hub,
  getPlexRecentlyAdded: () => h.later(5, []),
  getPlexSectionRow: () => h.later(5, []),
  getPlexPart: async () => ({ partKey: '/library/parts/7/file.mkv', versions: [] }),
  getPlexPlayInfo: h.playInfo,
  getNextPlexEpisode: h.next,
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
  isOwnPlexAccount: h.own,
}));
vi.mock('./PlexImage', () => ({ default: () => null }));
// The title page: its Play button, an episode from its list, and Back.
vi.mock('./PlexDetail', () => ({
  default: ({ item, onPlay, onPlayEpisode, onBack }: {
    item: PlexItem; onPlay: (it: PlexItem) => void; onBack: () => void;
    onPlayEpisode: (ep: NonNullable<typeof h.ep>['ep'], ctx: NonNullable<typeof h.ep>['ctx']) => void;
  }) => (
    <div>
      <button onClick={() => onPlay(item)}>PLAY:{item.title}</button>
      <button onClick={() => { if (h.ep) onPlayEpisode(h.ep.ep, h.ep.ctx); }}>PLAYEP</button>
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
  h.ep = null;
  h.playInfo.mockReset();
  h.next.mockReset(); h.next.mockImplementation(async () => null);
  h.hub.mockReset(); h.hub.mockImplementation(() => h.later(5, []));
  h.own.mockReset(); h.own.mockImplementation(async () => false);
  (await import('@/lib/kidsFilter')).setKidsLevel(null);
  (await import('@/lib/plex')).clearPlexCaches();
  (await import('./plexKeyOwner')).setPlexKeyOwner('browse');
  (await import('@/lib/plexProgress')).__resetPlexProgressForTests('device');
});

/** Opens a title's page from the content bar's link. */
async function openTitle(ratingKey: string, title: string, kind: string) {
  sessionStorage.setItem('smc-plex-deeplink', JSON.stringify({ ratingKey, title, kind, machineIdentifier: 'srv', at: Date.now() }));
  const { default: PlexSection } = await import('./PlexSection');
  render(<PlexSection isActive onExitLeft={() => undefined} onExitUp={() => undefined} />);
}
async function playTitle(ratingKey: string, title: string, kind: string) {
  await openTitle(ratingKey, title, kind);
  fireEvent.click(await screen.findByText(`PLAY:${title}`, undefined, { timeout: 3000 }));
  await waitFor(() => expect(h.closePlayer).not.toBeNull());
}
const playDune = () => playTitle('d1', 'Dune', 'movie');

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

  // On the box in question the server never answered "what is playing" at
  // all, and nothing was ever saved. Play already knows the title.
  it('saves from what Play knew when the server never says what is playing', async () => {
    h.playInfo.mockImplementation(async () => null);
    h.pos = { position: 1500, duration: 9300, playing: true };
    await playDune();
    await wait(50);
    const { continueWatching, getProgress, resumeSeconds } = await import('@/lib/plexProgress');
    expect(resumeSeconds('d1')).toBe(1500);
    expect(getProgress('d1')).toMatchObject({ kind: 'movie', title: 'Dune', dur: 9300 });
    act(() => { h.closePlayer?.(); });
    await wait(20);
    expect(continueWatching().map((i) => i.ratingKey)).toEqual(['d1']);
    fireEvent.click(screen.getByText('BACK'));
    const row = await screen.findByText('Continue Watching', undefined, { timeout: 3000 });
    expect(row.closest('[data-plex-row="continue"]')?.textContent).toContain('Dune');
  });

  it('keeps the library a title was saved under when Play knew less', async () => {
    const { continueWatching, getProgress, saveProgress } = await import('@/lib/plexProgress');
    // Saved last night, when the server did answer.
    saveProgress({ ratingKey: 'd1', kind: 'movie', title: 'Dune', at: 600, dur: 9300, librarySectionID: '1' });
    await wait(10);
    h.playInfo.mockImplementation(async () => null);
    h.pos = { position: 1500, duration: 9300, playing: true };
    // The content bar's link knows no library.
    await playDune();
    await wait(50);
    expect(getProgress('d1')).toMatchObject({ at: 1500, librarySectionID: '1' });
    expect(continueWatching(30, '1').map((i) => i.ratingKey)).toEqual(['d1']);
  });

  it('saves an episode as an episode (the player itself calls everything a movie)', async () => {
    h.playInfo.mockImplementation(async () => null);
    h.pos = { position: 800, duration: 2940, playing: true };
    await playTitle('e3', 'The Long Night', 'episode');
    await wait(50);
    const { getProgress } = await import('@/lib/plexProgress');
    expect(getProgress('e3')).toMatchObject({ kind: 'episode', at: 800 });
  });

  it('saves an episode from the show\'s list under its show, with the server silent', async () => {
    h.playInfo.mockImplementation(async () => null);
    h.ep = {
      ep: { ratingKey: 'e3', title: 'The Long Night', index: 3, duration: 2_940_000 },
      ctx: { title: 'The Long Night', grandparentTitle: 'Frontier', season: 2, episode: 3 },
    };
    h.pos = { position: 800, duration: 0, playing: true };
    await openTitle('s1', 'Frontier', 'show');
    fireEvent.click(await screen.findByText('PLAYEP', undefined, { timeout: 3000 }));
    await waitFor(() => expect(h.closePlayer).not.toBeNull());
    await wait(50);
    const { getProgress } = await import('@/lib/plexProgress');
    // The running time from the list: the player did not know it yet.
    expect(getProgress('e3')).toMatchObject({
      kind: 'episode', title: 'The Long Night', at: 800, dur: 2940, showKey: 's1', showTitle: 'Frontier', season: 2, index: 3,
    });
  });

  it('saves the next episode Up Next started, under the same show, with the server silent about it', async () => {
    const e3: PlexPlayInfo = {
      ratingKey: 'e3', kind: 'episode', title: 'The Long Night', librarySectionID: '2', index: 3, seasonIndex: 2,
      seasonKey: 'se2', showKey: 's1', showTitle: 'Frontier', duration: 2940, markers: [],
    };
    h.playInfo.mockImplementation(async (_b: string, _t: string, key: string) => (key === 'e3' ? e3 : null));
    h.next.mockImplementation(async () => ({ ratingKey: 'e4', title: 'Dawn', index: 4, duration: 3_000_000, seasonIndex: 2 }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // In the credits: Up Next counts down and starts the next one.
      h.pos = { position: 2930, duration: 2940, playing: true };
      await playTitle('e3', 'The Long Night', 'episode');
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      // The next episode is first read a few seconds after it starts.
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      const { getProgress } = await import('@/lib/plexProgress');
      expect(getProgress('e4')).toMatchObject({
        kind: 'episode', title: 'Dawn', dur: 3000, librarySectionID: '2', showKey: 's1', showTitle: 'Frontier', season: 2, index: 4,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PlexSection — Home\'s Continue Watching on the viewer\'s own Plex account', () => {
  const home = async () => {
    const { default: PlexSection } = await import('./PlexSection');
    render(<PlexSection isActive onExitLeft={() => undefined} onExitUp={() => undefined} />);
  };
  const onDeck = (path: string) => path.startsWith('/library/onDeck');

  it('a Kids profile keeps its own titles, and the server\'s are still checked', async () => {
    (await import('@/lib/kidsFilter')).setKidsLevel('kids');
    h.own.mockImplementation(async () => true);
    h.hub.mockImplementation((_b: string, _t: string, path: string) => h.later(5, onDeck(path) ? [
      { ratingKey: 'a1', title: 'Arrival', type: 'movie', contentRating: 'PG', lastViewedAt: 1 },
      { ratingKey: 'x1', title: 'Heat', type: 'movie', lastViewedAt: 2 },
    ] as PlexItem[] : []));
    const { saveProgress } = await import('@/lib/plexProgress');
    // Watched on this profile: its own list carries no certificate.
    saveProgress({ ratingKey: 'k1', kind: 'movie', title: 'Paddington', at: 1500, dur: 5700, librarySectionID: '1' });
    await wait(10);
    await home();
    const row = await screen.findByText('Continue Watching', undefined, { timeout: 3000 });
    const cont = () => row.closest('[data-plex-row="continue"]')?.textContent ?? '';
    await waitFor(() => expect(cont()).toContain('Arrival'));
    expect(cont()).toContain('Paddington');
    // The server's own unrated title is not for a Kids profile.
    expect(cont()).not.toContain('Heat');
  });

  it('shows the server\'s Continue Watching once the box finds out it is the viewer\'s own account', async () => {
    let own: (v: boolean) => void = () => undefined;
    h.own.mockImplementation(() => new Promise<boolean>((r) => { own = r; }));
    let onDeckCalls = 0;
    h.hub.mockImplementation((_b: string, _t: string, path: string) => {
      if (!onDeck(path)) return h.later(5, []);
      onDeckCalls += 1;
      // The settle screen's ask fails (the Wi-Fi blinked), so Home asks itself.
      if (onDeckCalls === 1) return h.later(5, null).then(() => { throw new Error('offline'); });
      return h.later(5, [{ ratingKey: 'a1', title: 'Arrival', type: 'movie', lastViewedAt: 1 }] as PlexItem[]);
    });
    await home();
    await screen.findByText('Recently Added', undefined, { timeout: 3000 });
    // Home's first load, before the account is known.
    await wait(50);
    await act(async () => { own(true); });
    const row = await screen.findByText('Continue Watching', undefined, { timeout: 3000 });
    expect(row.closest('[data-plex-row="continue"]')?.textContent).toContain('Arrival');
  });
});

describe('PlexSection — the Continue Watching check in Plex Settings', () => {
  it('says what the player last reported, why nothing was saved, and how it closed', async () => {
    const { noteProgressDiag } = await import('@/lib/plexProgress');
    const now = Date.now();
    noteProgressDiag({
      beatAt: now - 2 * 60_000, beatPos: 1510, beatDur: 6720, beatSkip: 'no-position',
      closedAt: now - 3 * 60_000, closedKnown: true, closedActive: false,
      storageErrorAt: now - 5 * 60_000, cloudErrorAt: now - 4 * 60_000, cloudError: 'permission denied',
    });
    const { default: PlexSection } = await import('./PlexSection');
    render(<PlexSection isActive onExitLeft={() => undefined} onExitUp={() => undefined} />);
    fireEvent.click(await screen.findByText('Settings', undefined, { timeout: 3000 }));
    const check = (await screen.findByText('Continue Watching check')).parentElement?.textContent ?? '';
    expect(check).toContain('Player last reported 25:10 of 1:52:00, 2 min ago but saved nothing: no position');
    expect(check).toContain('Last closed 3 min ago — title known: yes, playing: no');
    expect(check).toContain("Couldn't save on this box 5 min ago");
    expect(check).toContain("Couldn't copy to your account 4 min ago: permission denied");
  });
});
