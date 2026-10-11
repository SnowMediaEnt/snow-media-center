// A title's trailer, through PlexSection: it plays in SMC's own player (the
// native one on a box), OK pauses and plays it, Back closes it in one step,
// back to the title page. It is not watching the title: no resume point, no
// watched check, no Continue Watching, no watch history, no Up Next, no
// plex_play. Only the network and the native player are stand-ins; the
// progress reporter and Up Next are the real ones, as in
// PlexSection.progress.test.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlexItem, PlexLibrary, PlexPlayInfo, PlexTrailer } from '@/lib/plex';

const TRAILER_PART = '/library/parts/901/1700000000/trailer.mp4';

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
    pos: { position: 0, duration: 0, playing: false },
    /** The address the native player was handed last. */
    url: null as string | null,
    togglePlay: vi.fn(),
    playInfo: vi.fn(),
    next: vi.fn(),
    recordPlexWatch: vi.fn(),
    trackEvent: vi.fn(),
    closePlayer: null as null | (() => void),
    trailer: null as null | PlexTrailer,
    /** The native player's error, and a way to have PlexSection read it again. */
    error: null as null | { code: string; message: string },
    rerender: null as null | (() => void),
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
  trackEvent: h.trackEvent, startTimer: vi.fn(), stopTimer: vi.fn(),
}));
vi.mock('@/lib/watchHistory', async (orig) => ({
  ...(await orig<typeof import('@/lib/watchHistory')>()),
  recordPlexWatch: h.recordPlexWatch,
}));
vi.mock('@/hooks/usePlexAuth', () => ({ usePlexAuth: () => h.auth }));
vi.mock('@/capacitor/SnowPlayer', async (orig) => ({
  ...(await orig<typeof import('@/capacitor/SnowPlayer')>()),
  hasNativePlayer: () => true,
}));
vi.mock('@/hooks/useNativePlayer', () => {
  const controller = {
    play: () => undefined, pause: () => undefined, togglePlay: () => h.togglePlay(), seek: () => undefined,
    isPaused: () => false, isSeekable: () => true, getSubtitleTracks: () => [], setSubtitleTrack: () => undefined,
    getAudioTracks: () => [], setAudioTrack: () => undefined,
  };
  const state = {
    error: null as null | { code: string; message: string }, buffering: false, paused: false, audioWarning: null, controller,
    getPosition: async () => ({ ...h.pos }), seekTo: async () => undefined, retry: () => undefined,
  };
  // One object per error, as the real hook's memo: PlexSection's effects run
  // on a change of it.
  let shown = state;
  return {
    useNativePlayer: (opts: { url: string | null }) => {
      const [, force] = React.useState(0);
      React.useEffect(() => { h.rerender = () => force((n) => n + 1); }, []);
      if (opts.url) h.url = opts.url;
      if (shown.error !== h.error) shown = { ...state, error: h.error };
      return shown;
    },
  };
});
const LIBS: PlexLibrary[] = [{ key: '1', title: 'Movies', type: 'movie' }];
vi.mock('@/lib/plex', async (orig) => ({
  ...(await orig<typeof import('@/lib/plex')>()),
  getPlexLibraries: () => h.later(5, LIBS),
  searchPlex: () => h.later(5, []),
  getPlexItemByKey: async () => null,
  getPlexHub: () => h.later(5, []),
  getPlexRecentlyAdded: () => h.later(5, []),
  getPlexSectionRow: () => h.later(5, []),
  getPlexPart: async () => ({ partKey: '/library/parts/7/file.mkv', versions: [] }),
  // The server's say on a conversion: no answer (the start goes ahead).
  plexTranscodeDecision: async () => null,
  getPlexPlayInfo: h.playInfo,
  getNextPlexEpisode: h.next,
  reportPlexTimeline: async () => undefined,
  getPlexAccount: async () => null,
  loadHiddenPlexLibs: async () => [],
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
// The title page: its Play and Trailer buttons.
vi.mock('./PlexDetail', () => ({
  default: ({ item, onPlay, onPlayTrailer }: {
    item: PlexItem; onPlay: (it: PlexItem) => void; onPlayTrailer?: (tr: PlexTrailer, title: string) => void;
  }) => (
    <div>
      <button onClick={() => onPlay(item)}>PLAY:{item.title}</button>
      <button onClick={() => { if (h.trailer) onPlayTrailer?.(h.trailer, item.title); }}>TRAILER:{item.title}</button>
    </div>
  ),
}));
// A film's player: its own Back.
vi.mock('./PlexPlayerOverlay', () => ({
  default: ({ onBackWhileHidden }: { onBackWhileHidden: () => void }) => { h.closePlayer = onBackWhileHidden; return null; },
}));

class NoResize { observe() { /* test */ } unobserve() { /* test */ } disconnect() { /* test */ } }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= NoResize;

const film: PlexPlayInfo = { ratingKey: 'd1', kind: 'movie', title: 'Dune', librarySectionID: '1', duration: 9300, markers: [] };
const clip: PlexPlayInfo = { ratingKey: '901', kind: 'movie', title: 'Official Trailer', librarySectionID: '1', duration: 150, markers: [] };
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const press = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
const controls = () => document.querySelector('[data-plex-trailer-controls]');

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  h.pos = { position: 0, duration: 0, playing: false };
  h.url = null;
  h.error = null;
  h.closePlayer = null;
  h.togglePlay.mockReset();
  h.recordPlexWatch.mockReset();
  h.trackEvent.mockReset();
  // The server would describe the trailer's clip too, if it were asked.
  h.playInfo.mockReset(); h.playInfo.mockImplementation(async (_b: string, _t: string, key: string) => (key === 'd1' ? film : key === '901' ? clip : null));
  h.next.mockReset(); h.next.mockImplementation(async () => null);
  const { mediaVersions, clearPlexCaches } = await import('@/lib/plex');
  const version = mediaVersions({ Media: [{ videoResolution: '1080', bitrate: 5000, Part: [{ key: TRAILER_PART }] }] }, '901')[0];
  h.trailer = { ratingKey: '901', title: 'Official Trailer', partKey: TRAILER_PART, online: false, duration: 150_000, version };
  (await import('@/lib/kidsFilter')).setKidsLevel(null);
  clearPlexCaches();
  (await import('./plexKeyOwner')).setPlexKeyOwner('browse');
  (await import('@/lib/plexProgress')).__resetPlexProgressForTests('device');
});

async function openDune() {
  sessionStorage.setItem('smc-plex-deeplink', JSON.stringify({ ratingKey: 'd1', title: 'Dune', kind: 'movie', machineIdentifier: 'srv', at: Date.now() }));
  const { default: PlexSection } = await import('./PlexSection');
  render(<PlexSection isActive onExitLeft={() => undefined} onExitUp={() => undefined} />);
  await screen.findByText('TRAILER:Dune', undefined, { timeout: 3000 });
}

describe('PlexSection — a trailer in SMC\'s own player', () => {
  it('plays the trailer\'s file, pauses on OK, closes on one Back, and saves nothing', { timeout: 30000 }, async () => {
    await openDune();
    // Part-way through it: a place a film would be saved at.
    h.pos = { position: 70, duration: 150, playing: true };
    fireEvent.click(screen.getByText('TRAILER:Dune'));
    await waitFor(() => expect(controls()).not.toBeNull());
    // The trailer's own file, played as it is, in the native player.
    expect(h.url).toContain(`https://plex.test${TRAILER_PART}?X-Plex-Token=tok`);
    expect(screen.getByText('Dune · Trailer')).toBeTruthy();
    // Anything that saves would have by now.
    await wait(200);

    // OK pauses (and plays); a held OK is not a press.
    press('Enter');
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true })); });
    expect(h.togglePlay).toHaveBeenCalledTimes(1);

    // One Back: the player closes, the title page is still there, and the
    // remote is the page's again.
    press('Escape');
    await waitFor(() => expect(controls()).toBeNull());
    expect(screen.getByText('TRAILER:Dune')).toBeTruthy();
    const { isPlexKeyOwner } = await import('./plexKeyOwner');
    expect(isPlexKeyOwner('detail')).toBe(true);
    await wait(20);

    const { continueWatching, getProgress, plexItemWatched, progressCount, resumeSeconds } = await import('@/lib/plexProgress');
    expect(resumeSeconds('901')).toBeUndefined();
    expect(resumeSeconds('d1')).toBeUndefined();
    expect(getProgress('901')).toBeNull();
    expect(getProgress('d1')).toBeNull();
    expect(progressCount()).toBe(0);
    expect(continueWatching()).toEqual([]);
    expect(plexItemWatched({ ratingKey: 'd1', type: 'movie' })).toBe(false);
    // No watch history, no Up Next, no plex_play (the content bar's Popular).
    expect(h.recordPlexWatch).not.toHaveBeenCalled();
    expect(h.playInfo).not.toHaveBeenCalled();
    expect(h.next).not.toHaveBeenCalled();
    expect(h.trackEvent.mock.calls.map((c) => c[0])).not.toContain('plex_play');
    expect(h.trackEvent.mock.calls.map((c) => c[0])).toContain('plex_trailer');
  });

  it('the film after its trailer is saved as before', { timeout: 30000 }, async () => {
    await openDune();
    fireEvent.click(screen.getByText('TRAILER:Dune'));
    await waitFor(() => expect(controls()).not.toBeNull());
    press('Escape');
    await waitFor(() => expect(controls()).toBeNull());

    h.pos = { position: 1500, duration: 9300, playing: true };
    fireEvent.click(screen.getByText('PLAY:Dune'));
    await waitFor(() => expect(h.closePlayer).not.toBeNull());
    await wait(50);
    // The film's player, not the trailer's keys.
    expect(controls()).toBeNull();
    const { continueWatching, resumeSeconds } = await import('@/lib/plexProgress');
    expect(resumeSeconds('d1')).toBe(1500);
    expect(h.recordPlexWatch).toHaveBeenCalledTimes(1);
    act(() => { h.closePlayer?.(); });
    await wait(20);
    expect(continueWatching().map((i) => i.ratingKey)).toEqual(['d1']);
  });

  it("Plex's online trailer that won't play as a file: once, the server's conversion of the clip", { timeout: 30000 }, async () => {
    const online = '/services/iva/assets/593133/video.mp4?fmt=4&bitrate=5000';
    const { mediaVersions } = await import('@/lib/plex');
    const version = mediaVersions({ Media: [{ videoResolution: '1080', Part: [{ key: online }] }] }, '902')[0];
    h.trailer = { ratingKey: '902', title: 'Trailer', partKey: online, online: true, version };
    await openDune();
    fireEvent.click(screen.getByText('TRAILER:Dune'));
    await waitFor(() => expect(controls()).not.toBeNull());
    // First as a file, through the server (the token joins the file's own query).
    expect(h.url).toContain(`https://plex.test${online}&X-Plex-Token=tok`);
    // The server won't hand it over.
    h.error = { code: 'ERROR_CODE_IO_BAD_HTTP_STATUS', message: 'HTTP 403' };
    act(() => { h.rerender?.(); });
    await waitFor(() => expect(h.url).toContain('/video/:/transcode/universal/start.m3u8'), { timeout: 5000 });
    expect(h.url).toContain(`path=${encodeURIComponent('/library/metadata/902')}`);
    // Still nothing saved.
    const { progressCount } = await import('@/lib/plexProgress');
    expect(progressCount()).toBe(0);
  });
});
