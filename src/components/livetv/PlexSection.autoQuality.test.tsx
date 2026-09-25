// Automatic quality through PlexSection, as the player drives it: the
// viewer's Quality pick is a ceiling for that title only (not an off switch
// for the session), the Plex Relay starts at the quality it can carry and a
// slow conversion there is never sent back to Original (one the server
// refuses is, once; an outage is not a refusal), a title with no file to
// play as it is is known to be converting, every converting session
// playback leaves is stopped on the server, and the original is only left
// early on proof that the server can't send it fast enough — never because
// it paused. The buffering card says what automatic quality will do, and
// when. Only the network and the native player are stand-ins.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlexItem, PlexLibrary } from '@/lib/plex';
import { beginStream, endStream, recordPlayerRate, setBuffering as diagSetBuffering } from '@/lib/bufferDiagnostics';
import { emptyPlayerStats } from '@/capacitor/SnowPlayer';
import { AutoQuality } from '@/lib/plexAutoQuality';
import { markPlaybackStart } from '@/lib/playerSeek';

type NativeState = {
  error: { code?: string; message: string } | null; buffering: boolean; paused: boolean; audioWarning: null; controller: null;
  getPosition: () => Promise<{ position: number; duration: number; playing: boolean }>;
  seekTo: () => Promise<void>; retry: () => void;
};

const h = vi.hoisted(() => {
  const later = <T,>(ms: number, v: T): Promise<T> => new Promise((r) => { setTimeout(() => r(v), ms); });
  const noop = () => { /* test */ };
  const conn: { base: string; token: string; name: string; clientIdentifier: string; route?: 'lan' | 'direct' | 'relay' } = {
    base: 'https://plex.test', token: 'tok', name: 'Snow Media P2', clientIdentifier: 'srv',
  };
  const auth = {
    status: 'ready', conn, pinCode: null, error: null, justLinked: false, accountToken: null, providerNote: null, providerAvailable: false,
    clearJustLinked: noop, startLink: noop, cancelLink: noop, signOut: noop, retryConnect: noop, linkWithProvider: noop, reportAuthFailure: noop,
  };
  const pos = { position: 600, duration: 7200, playing: true };
  return {
    later, auth, conn, pos,
    /** Every stream address the native player was handed, in order. */
    urls: [] as string[],
    native: null as unknown as NativeState,
    kick: null as null | (() => void),
    part: vi.fn(),
    toast: vi.fn(),
    fetch: vi.fn(),
    /** The native player's getStats (its last error). */
    stats: vi.fn(),
    closePlayer: null as null | (() => void),
    pickQuality: null as null | ((key: string, resumeSec: number) => void),
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
vi.mock('@/hooks/use-toast', () => ({ toast: h.toast, useToast: () => ({ toast: h.toast, toasts: [], dismiss: () => undefined }) }));
vi.mock('@/hooks/usePlexAuth', () => ({ usePlexAuth: () => h.auth }));
vi.mock('@/capacitor/SnowPlayer', async (orig) => {
  const m = await orig<typeof import('@/capacitor/SnowPlayer')>();
  // The plugin as it is, but for its stats.
  const SnowPlayer = new Proxy(m.SnowPlayer, { get: (t, p) => (p === 'getStats' ? h.stats : Reflect.get(t, p)) });
  return { ...m, hasNativePlayer: () => true, SnowPlayer };
});
// The native player: records the address it is handed; a test flips
// `buffering` and kicks a re-render to stall it.
vi.mock('@/hooks/useNativePlayer', async () => {
  const React = await import('react');
  return {
    useNativePlayer: ({ url }: { url: string | null }) => {
      const [, force] = React.useState(0);
      React.useEffect(() => { h.kick = () => force((n) => n + 1); return () => { h.kick = null; }; }, []);
      if (url && h.urls[h.urls.length - 1] !== url) h.urls.push(url);
      return h.native;
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
  getPlexPart: h.part,
  getPlexPlayInfo: async () => null,
  getNextPlexEpisode: async () => null,
  reportPlexTimeline: async () => undefined,
  getPlexAccount: async () => null,
  loadHiddenPlexLibs: async () => [],
  loadPlexQuality: async () => 'original',
  savePlexQuality: async () => undefined,
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
// The title page: Play, and Play on another title.
vi.mock('./PlexDetail', () => ({
  default: ({ item, onPlay }: { item: PlexItem; onPlay: (it: PlexItem) => void }) => (
    <div>
      <button onClick={() => onPlay(item)}>PLAY:{item.title}</button>
      <button onClick={() => onPlay({ ...item, ratingKey: 'o1', title: 'Other' })}>PLAY:Other</button>
    </div>
  ),
}));
// The player's controls: Back, and the Quality menu.
vi.mock('./PlexPlayerOverlay', () => ({
  default: ({ onBackWhileHidden, onChangeQuality }: { onBackWhileHidden: () => void; onChangeQuality: (k: string, s: number) => void }) => {
    h.closePlayer = onBackWhileHidden;
    h.pickQuality = onChangeQuality;
    return null;
  },
}));

class NoResize { observe() { /* test */ } unobserve() { /* test */ } disconnect() { /* test */ } }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= NoResize;

// Fake timers that also move with real time (the title page's loads use
// real promises): a wait of seconds takes none.
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const lastUrl = () => h.urls[h.urls.length - 1] ?? '';
const isTranscode = (u: string) => u.includes('/video/:/transcode/universal/start');
const cap = (u: string) => /[?&]maxVideoBitrate=(\d+)/.exec(u)?.[1] ?? null;
const sessionOf = (u: string) => /[?&]session=([^&]+)/.exec(u)?.[1] ?? '';
const stops = () => h.fetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/video/:/transcode/universal/stop'));
// Reads of the file itself (measurePlexSpeed: a ranged GET of up to 16 MB).
const speedReads = () => h.fetch.mock.calls.filter((c) => /bytes=0-/.test(String((c[1] as RequestInit | undefined)?.headers
  ? ((c[1] as RequestInit).headers as Record<string, string>).Range ?? '' : '')));
const toastTitles = () => h.toast.mock.calls.map((c) => String((c[0] as { title?: string })?.title ?? ''));

function setBuffering(on: boolean) {
  act(() => { h.native = { ...h.native, buffering: on }; h.kick?.(); });
}
/** A stall of playback already under way (not a seek, not the first load). */
async function stall() {
  setBuffering(true);
  await wait(30);
  setBuffering(false);
  await wait(30);
}

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  h.conn.route = 'direct';
  h.pos.position = 600; h.pos.duration = 7200; h.pos.playing = true;
  h.urls = [];
  h.native = {
    error: null, buffering: false, paused: false, audioWarning: null, controller: null,
    getPosition: async () => ({ ...h.pos }), seekTo: async () => undefined, retry: () => undefined,
  };
  h.closePlayer = null;
  h.pickQuality = null;
  h.toast.mockReset();
  h.part.mockReset();
  // A 10 Mb/s film, one file.
  h.part.mockImplementation(async () => ({ partKey: '/library/parts/7/file.mkv', bitrateKbps: 10000, versions: [] }));
  h.fetch.mockReset();
  h.fetch.mockImplementation(async () => new Response('', { status: 200 }));
  h.stats.mockReset();
  h.stats.mockImplementation(async () => emptyPlayerStats());
  vi.stubGlobal('fetch', h.fetch);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  (await import('@/lib/kidsFilter')).setKidsLevel(null);
  (await import('@/lib/plex')).clearPlexCaches();
  (await import('./plexKeyOwner')).setPlexKeyOwner('browse');
  (await import('@/lib/plexProgress')).__resetPlexProgressForTests('device');
  (await import('@/lib/plexVersions'))._resetPlexSpeedCache();
  markPlaybackStart(0);
});
afterEach(() => {
  act(() => { endStream(); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openDune() {
  sessionStorage.setItem('smc-plex-deeplink', JSON.stringify({ ratingKey: 'd1', title: 'Dune', kind: 'movie', machineIdentifier: 'srv', at: Date.now() }));
  const { default: PlexSection } = await import('./PlexSection');
  return render(<PlexSection isActive onExitLeft={() => undefined} onExitUp={() => undefined} />);
}
async function play(title: string) {
  fireEvent.click(await screen.findByText(`PLAY:${title}`, undefined, { timeout: 3000 }));
  await waitFor(() => expect(h.closePlayer).not.toBeNull());
  await waitFor(() => expect(h.urls.length).toBeGreaterThan(0));
}
/** Past the start: the player reports it is playing (polled every 1.5 s). */
const started = () => wait(1700);

describe('automatic quality through PlexSection', () => {
  it('lowers below a quality the viewer picked, when it keeps stalling', async () => {
    await openDune();
    await play('Dune');
    await started();
    act(() => { h.pickQuality?.('1080-8', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('8000'));
    await started();
    await stall(); await stall(); await stall();
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
    expect(toastTitles()).toContain('Lowered to 720p · 4 Mbps for your speed');
  });

  it("a pick on one title does not switch automatic quality off for the next", async () => {
    await openDune();
    await play('Dune');
    await started();
    act(() => { h.pickQuality?.('720-3', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('3000'));
    act(() => { h.closePlayer?.(); });
    await wait(20);
    h.closePlayer = null;
    h.urls = [];
    await play('Other');
    // The next title starts at Original, as it is.
    expect(isTranscode(lastUrl())).toBe(false);
    await started();
    await stall(); await stall(); await stall();
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
  });

  it('stops the converting session playback leaves, and the last one on Back', async () => {
    await openDune();
    await play('Dune');
    await started();
    act(() => { h.pickQuality?.('1080-8', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('8000'));
    const first = lastUrl();
    act(() => { h.pickQuality?.('720-4', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
    const second = lastUrl();
    expect(stops()).toEqual([]);
    await wait(1700);
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toContain(`session=${sessionOf(first)}`);
    expect(stops()[0].startsWith('https://plex.test/video/:/transcode/universal/stop?')).toBe(true);
    act(() => { h.closePlayer?.(); });
    await wait(1700);
    expect(stops()).toHaveLength(2);
    expect(stops()[1]).toContain(`session=${sessionOf(second)}`);
  });

  it('a file played as it is has no session to stop', async () => {
    await openDune();
    await play('Dune');
    await started();
    act(() => { h.closePlayer?.(); });
    await wait(1700);
    expect(stops()).toEqual([]);
  });
});

describe('the Plex Relay', () => {
  it('starts at 480p · 2 Mbps instead of the original', async () => {
    h.conn.route = 'relay';
    await openDune();
    await play('Dune');
    expect(h.urls).toHaveLength(1);
    expect(isTranscode(lastUrl())).toBe(true);
    expect(cap(lastUrl())).toBe('2000');
    expect(toastTitles()).toContain('Playing at 480p · 2 Mbps');
  });

  it('a slow conversion there waits longer and is never sent back to Original', async () => {
    h.conn.route = 'relay';
    // The server never gets the conversion going.
    h.pos.playing = false; h.pos.position = 0; h.pos.duration = 0;
    await openDune();
    await play('Dune');
    const relayUrl = lastUrl();
    await wait(31_000);
    // Past the usual 30 s: still waiting, still the same conversion.
    expect(screen.queryByText('Still preparing…')).toBeNull();
    expect(lastUrl()).toBe(relayUrl);
    await wait(31_000);
    // Nothing lighter to try: the Retry panel, not Original.
    expect(screen.getByText('Still preparing…')).toBeTruthy();
    await wait(2_000);
    expect(h.urls.every(isTranscode)).toBe(true);
    expect(lastUrl()).toBe(relayUrl);
    expect(toastTitles()).not.toContain("The Plex server couldn't convert this in time");
  });
});

describe('a title with no file to play as it is', () => {
  it('is known to be converting: the title says so, and the start gets the converting grace', async () => {
    h.part.mockImplementation(async () => ({ versions: [] }));
    h.pos.playing = false; h.pos.position = 0; h.pos.duration = 0;
    await openDune();
    await play('Dune');
    expect(isTranscode(lastUrl())).toBe(true);
    expect(await screen.findByText(/Dune · transcoding/)).toBeTruthy();
    // A file played as it is gets 8 s; a conversion 30.
    await wait(9_000);
    expect(screen.queryByText('Still preparing…')).toBeNull();
  });
});

describe('leaving the original early: only on proof', () => {
  // The film is 10 Mb/s. The player's own rate reports, every 3 s.
  async function playingDune() {
    await openDune();
    await play('Dune');
    await started();
    act(() => { beginStream(lastUrl(), 'vod'); });
  }
  const report = async (kbps: number, after = 3_000) => { await wait(after); act(() => { recordPlayerRate(kbps); }); };

  it('topping up at 0.75x the file, then a stall where the server pauses: no drop', async () => {
    await playingDune();
    for (let i = 0; i < 10; i += 1) await report(7500);
    setBuffering(true);
    // The window straddling the stall's start, then nothing (reported once).
    await report(5000, 1_000);
    await report(0);
    await wait(15_000);
    expect(h.urls).toHaveLength(1);
    expect(isTranscode(lastUrl())).toBe(false);
    expect(toastTitles().filter((t) => t.indexOf('Lowered') === 0)).toEqual([]);
  });

  it('a line too slow for the file (every window of the stall short): dropped a few seconds in', async () => {
    await playingDune();
    for (let i = 0; i < 10; i += 1) await report(4000);
    setBuffering(true);
    await report(4000, 1_000);
    await report(4000);
    await wait(2_500);
    await waitFor(() => expect(cap(lastUrl())).toBe('3000'));
    expect(toastTitles()).toContain('Lowered to 720p · 3 Mbps for your speed');
  });

  it('a stall the server refills flat out is not a slow line', async () => {
    await playingDune();
    for (let i = 0; i < 10; i += 1) await report(7500);
    setBuffering(true);
    await report(9000, 1_000);
    await report(60000);
    await wait(12_000);
    expect(h.urls).toHaveLength(1);
  });
});

describe('the buffering card: what automatic quality will do, and when', () => {
  async function playingDune() {
    await openDune();
    await play('Dune');
    await started();
    act(() => { beginStream(lastUrl(), 'vod'); });
  }
  const report = async (kbps: number, after = 3_000) => { await wait(after); act(() => { recordPlayerRate(kbps); }); };
  /** A stall as the player and the diagnostics both see it. */
  const stallBoth = () => { setBuffering(true); act(() => { diagSetBuffering(true); }); };

  it('proof in, the early drop still to come: "in a few seconds", to where the drop then goes', async () => {
    await playingDune();
    // Topping up at 4 Mb/s; inside the stall the server manages 6 at most.
    for (let i = 0; i < 10; i += 1) await report(4000);
    stallBoth();
    await report(6000, 1_000);
    await report(6000);
    await wait(1_000);
    // Sized by the stall's own rate (6), not the steady 4 before it (which
    // would say 720p · 3 Mbps).
    expect(screen.getByText(/Lowering to 720p · 4 Mbps in a few seconds\.$/)).toBeTruthy();
    expect(screen.queryByText(/keeps stalling/)).toBeNull();
    // Six seconds into the stall it does.
    await wait(1_500);
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
    expect(toastTitles()).toContain('Lowered to 720p · 4 Mbps for your speed');
  });

  it('a conversion is not dropped early: "if it keeps stalling"', async () => {
    await openDune();
    await play('Dune');
    await started();
    act(() => { h.pickQuality?.('1080-8', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('8000'));
    await started();
    act(() => { beginStream(lastUrl(), 'vod'); });
    for (let i = 0; i < 10; i += 1) await report(4000);
    stallBoth();
    await report(4000, 1_000);
    await report(4000);
    await wait(1_000);
    expect(screen.getByText(/Lowering to 720p · 3 Mbps automatically if it keeps stalling\.$/)).toBeTruthy();
    expect(screen.queryByText(/few seconds/)).toBeNull();
  });

  it('at the floor below the pick: its lowest step, not "off"', async () => {
    // A 20 Mb/s film: 1080p · 12, 1080p · 8, 720p · 4 and 720p · 3 below it.
    h.part.mockImplementation(async () => ({ partKey: '/library/parts/7/file.mkv', bitrateKbps: 20000, versions: [] }));
    await openDune();
    await play('Dune');
    await started();
    act(() => { h.pickQuality?.('1080-8', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('8000'));
    await started();
    await stall(); await stall(); await stall();
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
    await started();
    await stall(); await stall(); await stall();
    await waitFor(() => expect(cap(lastUrl())).toBe('3000'));
    await started();
    setBuffering(true);
    await wait(2_500);
    expect(screen.getByText('Auto quality: at its lowest step (goes back up to 1080p · 8 Mbps when the speed allows)')).toBeTruthy();
    expect(screen.queryByText(/Auto quality off/)).toBeNull();
  });

  it('at the pick, on the floor: off for this title', async () => {
    await openDune();
    await play('Dune');
    await started();
    act(() => { h.pickQuality?.('720-3', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('3000'));
    await started();
    setBuffering(true);
    await wait(2_500);
    expect(screen.getByText('Auto quality off for this title (you picked 720p · 3 Mbps)')).toBeTruthy();
  });
});

describe('the Plex Relay: a conversion the server refuses', () => {
  // The player gives up (the plugin says RECONNECT_EXHAUSTED for any
  // ERROR_CODE_IO_*); its last error says what the server did.
  const fail = (lastError: string) => act(() => {
    h.stats.mockImplementation(async () => ({ ...emptyPlayerStats(), lastError }));
    h.native = { ...h.native, error: { code: 'RECONNECT_EXHAUSTED', message: 'The server stopped responding. Try again.' } };
    h.kick?.();
  });
  // The server answered, with an error status.
  const refuse = () => fail('ERROR_CODE_IO_BAD_HTTP_STATUS');

  it('falls back to the file as it is, once, and never steps back into a conversion', async () => {
    h.conn.route = 'relay';
    // The server never gets it going: an error before any picture.
    h.pos.playing = false; h.pos.position = 0; h.pos.duration = 0;
    await openDune();
    await play('Dune');
    expect(cap(lastUrl())).toBe('2000');
    refuse();
    await waitFor(() => expect(isTranscode(lastUrl())).toBe(false));
    expect(h.stats).toHaveBeenCalled();
    expect(lastUrl()).toContain('/library/parts/7/file.mkv');
    expect(toastTitles()).toContain("The Plex server wouldn't convert this");
    // The new stream clears the error; now it plays.
    act(() => { h.native = { ...h.native, error: null }; h.kick?.(); });
    h.pos.playing = true; h.pos.position = 30; h.pos.duration = 7200;
    await started();
    await stall(); await stall(); await stall();
    await wait(1_000);
    expect(h.urls.filter(isTranscode)).toHaveLength(1);
    expect(toastTitles().filter((t) => t === "The Plex server wouldn't convert this")).toHaveLength(1);
  });

  it('an outage (the connection failed, no answer) is not a refusal: left to the network retry', async () => {
    h.conn.route = 'relay';
    h.pos.playing = false; h.pos.position = 0; h.pos.duration = 0;
    const retry = vi.fn();
    h.native = { ...h.native, retry };
    const refused = vi.spyOn(AutoQuality.prototype, 'conversionsRefused');
    try {
      await openDune();
      await play('Dune');
      const relayUrl = lastUrl();
      expect(cap(relayUrl)).toBe('2000');
      fail('ERROR_CODE_IO_NETWORK_CONNECTION_FAILED');
      await wait(2_000);
      expect(h.stats).toHaveBeenCalled();
      expect(lastUrl()).toBe(relayUrl);
      expect(h.urls.every(isTranscode)).toBe(true);
      expect(toastTitles()).not.toContain("The Plex server wouldn't convert this");
      expect(refused).not.toHaveBeenCalled();
      // The network-retry path has it: the same conversion, tried again.
      await wait(3_000);
      expect(retry).toHaveBeenCalled();
      expect(lastUrl()).toBe(relayUrl);
    } finally {
      refused.mockRestore();
    }
  });

  it('an app that can\'t say (no getStats) is not a refusal either', async () => {
    h.conn.route = 'relay';
    h.pos.playing = false; h.pos.position = 0; h.pos.duration = 0;
    await openDune();
    await play('Dune');
    const relayUrl = lastUrl();
    act(() => {
      h.stats.mockImplementation(async () => { throw new Error('not implemented'); });
      h.native = { ...h.native, error: { code: 'RECONNECT_EXHAUSTED', message: 'x' } };
      h.kick?.();
    });
    await wait(2_000);
    expect(lastUrl()).toBe(relayUrl);
    expect(toastTitles()).not.toContain("The Plex server wouldn't convert this");
  });

  it('an error once it has played is the reconnect path\'s, not a refusal', async () => {
    h.conn.route = 'relay';
    await openDune();
    await play('Dune');
    await started();
    const relayUrl = lastUrl();
    refuse();
    await wait(2_000);
    expect(lastUrl()).toBe(relayUrl);
    expect(toastTitles()).not.toContain("The Plex server wouldn't convert this");
  });

  it('a conversion refused on a direct route is left to the error panel, as before', async () => {
    await openDune();
    await play('Dune');
    await started();
    act(() => { h.pickQuality?.('720-4', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
    h.pos.playing = false;
    refuse();
    await wait(2_000);
    expect(cap(lastUrl())).toBe('4000');
  });
});

describe('raising the quality back up: no reads of the file over the relay', () => {
  beforeEach(() => {
    // The file's part key is known (so a read of it could be made).
    h.part.mockImplementation(async () => ({
      partKey: '/library/parts/7/file.mkv', bitrateKbps: 10000,
      versions: [{ id: 'd1:0', ratingKey: 'd1', mediaIndex: 0, partKey: '/library/parts/7/file.mkv', label: '1080p', bitrateKbps: 10000 }],
    }));
  });

  it('on a direct route, a converted stream due a raise reads a few seconds of the file', async () => {
    await openDune();
    await play('Dune');
    await started();
    await stall(); await stall(); await stall();
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
    await started();
    await wait(2.5 * 60_000);
    expect(speedReads().length).toBeGreaterThan(0);
  });

  it('on the Plex Relay it never does', async () => {
    h.conn.route = 'relay';
    await openDune();
    await play('Dune');
    await started();
    await wait(5 * 60_000);
    expect(cap(lastUrl())).toBe('2000');
    expect(speedReads()).toEqual([]);
  });
});

describe('a resume (build 39 on the owner\'s TV): the start is not a reason to leave the file', () => {
  const report = async (kbps: number, after = 3_000) => { await wait(after); act(() => { recordPlayerRate(kbps); }); };
  const stallBoth = () => { setBuffering(true); act(() => { diagSetBuffering(true); }); };
  /** Resumed at 20:00: the native player marks when it began to play. */
  async function resumedDune() {
    await openDune();
    await play('Dune');
    await started();
    act(() => { beginStream(lastUrl(), 'vod'); markPlaybackStart(); });
  }

  it('stalls in the first half minute after it begins to play never lower it', async () => {
    await resumedDune();
    await stall(); await stall(); await stall();
    await wait(1_000);
    expect(h.urls.filter(isTranscode)).toHaveLength(0);
    expect(toastTitles().filter((t) => t.startsWith('Lowered'))).toHaveLength(0);
  });

  it("nor does the server's slow first seconds there, proof or not", async () => {
    await openDune();
    await play('Dune');
    await started();
    act(() => { beginStream(lastUrl(), 'vod'); });
    for (let i = 0; i < 10; i += 1) await report(4000);
    // The viewer skips ahead; it plays on from there, and stalls at once.
    act(() => { markPlaybackStart(); });
    stallBoth();
    await report(6000, 1_000);
    await report(6000);
    await wait(6_000);
    expect(toastTitles().filter((t) => t.startsWith('Lowered'))).toHaveLength(0);
    await wait(1_000);
    expect(h.urls.filter(isTranscode)).toHaveLength(0);
    expect(screen.queryByText(/in a few seconds/)).toBeNull();
  });

  it('after that, repeated stalls still lower it as before', async () => {
    await resumedDune();
    await wait(31_000);
    await stall(); await stall(); await stall();
    await waitFor(() => expect(isTranscode(lastUrl())).toBe(true));
  });

  it('with the internet check far above what the file needs, stalls alone keep the file, and the card says so', async () => {
    // The internet check (a download from Cloudflare) reads fast.
    h.fetch.mockImplementation(async (u: unknown) => (String(u).includes('speed.cloudflare.com')
      ? new Response(new Uint8Array(1 << 20), { status: 200 })
      : new Response('', { status: 200 })));
    await resumedDune();
    await wait(31_000);
    stallBoth();
    await wait(3_000);
    await waitFor(() => expect(screen.getByText(/keeps the original/)).toBeTruthy());
    act(() => { diagSetBuffering(false); });
    setBuffering(false);
    await stall(); await stall(); await stall();
    await wait(1_000);
    expect(h.urls.filter(isTranscode)).toHaveLength(0);
    expect(toastTitles().filter((t) => t.startsWith('Lowered'))).toHaveLength(0);
  });
});
