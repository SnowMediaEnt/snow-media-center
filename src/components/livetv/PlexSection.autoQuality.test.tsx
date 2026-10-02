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
import { _setPlexSpeed } from '@/lib/plexVersions';

// Slow under a loaded full run (renders the whole screen); the default 5 s flakes.
vi.setConfig({ testTimeout: 20_000 });

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
    /** Whether each of them was to be read over several connections (rangeFetch). */
    rangeFetch: [] as boolean[],
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
    useNativePlayer: ({ url, rangeFetch }: { url: string | null; rangeFetch?: boolean }) => {
      const [, force] = React.useState(0);
      React.useEffect(() => { h.kick = () => force((n) => n + 1); return () => { h.kick = null; }; }, []);
      if (url && h.urls[h.urls.length - 1] !== url) { h.urls.push(url); h.rangeFetch.push(!!rangeFetch); }
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
const pings = () => h.fetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/video/:/transcode/universal/ping?'));
const decisionsAll = () => h.fetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/video/:/transcode/universal/decision?'));
/** Where in the run of requests the first one matching `part` went out. */
const requestIndex = (part: string) => h.fetch.mock.calls.findIndex((c) => String(c[0]).includes(part));
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
  h.rangeFetch = [];
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
    // Stopped at once, BEFORE the new session is asked for (its decision):
    // a server that allows one conversion at a time has the slot free.
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toContain(`session=${sessionOf(first)}`);
    expect(stops()[0].startsWith('https://plex.test/video/:/transcode/universal/stop?')).toBe(true);
    expect(requestIndex(`stop?session=${sessionOf(first)}`)).toBeLessThan(requestIndex(`decision?`) < 0 ? Infinity : h.fetch.mock.calls.findIndex((c) => String(c[0]).includes('decision?') && String(c[0]).includes(`session=${sessionOf(second)}`)));
    await wait(1700);
    // And not again by the delayed stop.
    expect(stops()).toHaveLength(1);
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

  it('with the server seen sending the file twice over, stalls alone keep the file, and the card says so', async () => {
    await resumedDune();
    // Its start filled flat out at 30 Mb/s (a 10 Mb/s file).
    await report(30000);
    await wait(31_000);
    stallBoth();
    await wait(3_000);
    await waitFor(() => expect(screen.getByText('Auto quality: keeps the original — the Plex server has sent it fast enough')).toBeTruthy());
    act(() => { diagSetBuffering(false); });
    setBuffering(false);
    await stall(); await stall(); await stall();
    await wait(1_000);
    expect(h.urls.filter(isTranscode)).toHaveLength(0);
    expect(toastTitles().filter((t) => t.startsWith('Lowered'))).toHaveLength(0);
  });

  it('a quick internet check far above what the file needs is no such proof: stalls still lower it', async () => {
    h.fetch.mockImplementation(async (u: unknown) => (String(u).includes('speed.cloudflare.com')
      ? new Response(new Uint8Array(1 << 20), { status: 200 })
      : new Response('', { status: 200 })));
    await resumedDune();
    await wait(31_000);
    stallBoth();
    await wait(3_000);
    expect(screen.queryByText(/keeps the original/)).toBeNull();
    act(() => { diagSetBuffering(false); });
    setBuffering(false);
    await stall(); await stall(); await stall();
    await waitFor(() => expect(isTranscode(lastUrl())).toBe(true));
  });
});

describe('a customer\'s box: the quick check fast, the Plex server slow (automatic quality follows the server)', () => {
  const report = async (kbps: number, after = 3_000) => { await wait(after); act(() => { recordPlayerRate(kbps); }); };
  const stallBoth = () => { setBuffering(true); act(() => { diagSetBuffering(true); }); };
  const playOn = () => { act(() => { diagSetBuffering(false); }); setBuffering(false); };
  /** A 12 Mb/s film (the customer's), well past its start; the quick internet check reads fast. */
  async function playing12() {
    h.part.mockImplementation(async () => ({ partKey: '/library/parts/7/file.mkv', bitrateKbps: 12000, versions: [] }));
    h.fetch.mockImplementation(async (u: unknown) => (String(u).includes('speed.cloudflare.com')
      ? new Response(new Uint8Array(1 << 20), { status: 200 })
      : new Response('', { status: 200 })));
    await openDune();
    await play('Dune');
    await started();
    act(() => { beginStream(lastUrl(), 'vod'); markPlaybackStart(); });
    await wait(31_000);
  }
  /** Two short stalls (7 s), one rate report inside each, `between` while it plays on. */
  async function twoStalls(inside: [number, number], between: [number, number]) {
    stallBoth();
    await report(inside[0]);
    await wait(4_000);
    playOn();
    await report(between[0]);
    await report(between[1]);
    stallBoth();
    await report(inside[1]);
    await wait(4_000);
  }

  it('delivered 1.4-5.7 Mb/s of a 12 Mb/s file: steps down to what the server carries, and never says the internet is fast enough', async () => {
    await playing12();
    await twoStalls([1400, 3000], [5700, 2000]);
    await waitFor(() => expect(isTranscode(lastUrl())).toBe(true));
    // The best it got was 5.7 Mb/s: 720p · 4 Mbps fits it with headroom.
    expect(cap(lastUrl())).toBe('4000');
    expect(toastTitles()).toContain('Lowered to 720p · 4 Mbps for your speed');
    expect(screen.queryByText(/fast enough/)).toBeNull();
  });

  it('delivered healthy: no change', async () => {
    await playing12();
    await twoStalls([30000, 42000], [12000, 12000]);
    await stall(); await stall(); await stall();
    await wait(4_000);
    expect(h.urls.filter(isTranscode)).toHaveLength(0);
    expect(toastTitles().filter((t) => t.startsWith('Lowered'))).toHaveLength(0);
  });
});

describe('a 4K film (bugs/plex-4k.md): the start is not a reason to leave it, nor is a line the player has seen carry it', () => {
  const report = async (kbps: number, after = 3_000) => { await wait(after); act(() => { recordPlayerRate(kbps); }); };
  // A 4K (60 Mb/s) and a 1080p (10 Mb/s) file of the same film; it starts on the 4K one.
  const FILES = [
    { id: 'd1:0', ratingKey: 'd1', mediaIndex: 0, partKey: '/library/parts/40/file.mkv', label: '4K', videoResolution: '4k', height: 2160, bitrateKbps: 60000 },
    { id: 'd1:1', ratingKey: 'd1', mediaIndex: 1, partKey: '/library/parts/41/file.mkv', label: '1080p', videoResolution: '1080', height: 1080, bitrateKbps: 10000 },
  ];
  const on1080 = () => h.urls.some((u) => u.includes('/library/parts/41/'));
  /** Started from 0:00; while its start was held the player filled flat out at `fillKbps`. */
  async function playing4k(fillKbps: number) {
    h.part.mockImplementation(async () => ({ partKey: FILES[0].partKey, bitrateKbps: 60000, versions: FILES }));
    await openDune();
    await play('Dune');
    act(() => { beginStream(lastUrl(), 'vod'); });
    for (let i = 0; i < 4; i += 1) await report(fillKbps);
    await started();
    act(() => { markPlaybackStart(); });
    // Then topping up at the file's own rate.
    for (let i = 0; i < 11; i += 1) await report(60000);
  }

  it('the player was sent 200 Mb/s: three stalls after the first half minute keep the 4K file, and the card says so', async () => {
    await playing4k(200000);
    expect(h.urls[0]).toContain('/library/parts/40/');
    setBuffering(true);
    act(() => { diagSetBuffering(true); });
    await wait(3_000);
    await waitFor(() => expect(screen.getByText(/keeps the original/)).toBeTruthy());
    act(() => { diagSetBuffering(false); });
    setBuffering(false);
    await stall(); await stall(); await stall();
    await wait(10_000);
    expect(on1080()).toBe(false);
    expect(h.urls.filter(isTranscode)).toHaveLength(0);
    expect(toastTitles().filter((t) => t.startsWith('Lowered'))).toHaveLength(0);
  });

  it('a slow spell of the server in a stall is no proof either, once the line is proven', async () => {
    await playing4k(200000);
    setBuffering(true);
    await report(30000, 1_000);
    await report(30000);
    await report(30000);
    await wait(3_000);
    expect(on1080()).toBe(false);
    expect(toastTitles().filter((t) => t.startsWith('Lowered'))).toHaveLength(0);
  });

  it('a line that never carried twice the file: stalls still lower it to the 1080p file, as in 1.7.9', async () => {
    await playing4k(70000);
    await stall(); await stall(); await stall();
    await waitFor(() => expect(on1080()).toBe(true));
    expect(toastTitles()).toContain('Lowered to 1080p for your speed');
  });

  it("the title page's short read is no proof on its own: one window of the stall must be backed by a second", async () => {
    // The title page's check read 30 Mb/s (a short read, still ramping up).
    (await import('@/lib/plexVersions'))._setPlexSpeed(h.conn.base, 30000);
    await playing4k(70000);
    setBuffering(true);
    await report(40000, 1_000);
    // 1.7.9 dropped here: that window and the read, both under the file's 60 Mb/s.
    await wait(5_500);
    expect(on1080()).toBe(false);
    // The second window: the server refills flat out.
    await report(150000, 0);
    await wait(6_000);
    expect(on1080()).toBe(false);
    expect(toastTitles().filter((t) => t.startsWith('Lowered'))).toHaveLength(0);
  });
});

describe('a conversion the Plex server answers with an HTTP error status', () => {
  // The native player tried that session twice, then says so with the status.
  const convertFail = (status: number | null = 503) => act(() => {
    h.native = { ...h.native, error: { code: 'PLEX_TRANSCODE_HTTP', message: `The Plex server refused this file (HTTP ${status}).`, ...(status ? { httpStatus: status } : {}) } as NativeState['error'] };
    h.kick?.();
  });
  // A new stream clears the error (useNativePlayer).
  const cleared = () => act(() => { h.native = { ...h.native, error: null }; h.kick?.(); });
  const decisions = () => h.fetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/video/:/transcode/universal/decision?'));
  async function converting720() {
    await openDune();
    await play('Dune');
    await started();
    act(() => { h.pickQuality?.('720-4', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
    await started();
  }

  it('a fresh session (new id, decision first), then another quality, then a plain message with the status; never the same session again', async () => {
    await converting720();
    const first = lastUrl();
    convertFail();
    // 1. A fresh session of the same quality: a new id, asked for with a decision call first.
    await waitFor(() => expect(lastUrl()).not.toBe(first));
    const fresh = lastUrl();
    expect(isTranscode(fresh)).toBe(true);
    expect(cap(fresh)).toBe('4000');
    expect(sessionOf(fresh)).not.toBe(sessionOf(first));
    // The first was named like Plex's players; the fresh one is the plain
    // start of builds 38-56, the other thing to try.
    expect(first).toContain('X-Plex-Platform=Android');
    expect(fresh).not.toContain('X-Plex-Platform=Android');
    expect(decisions()).toHaveLength(2);
    expect(decisions()[1]).toContain(`session=${sessionOf(fresh)}`);
    expect(toastTitles()).toContain("The Plex server couldn't prepare this");
    expect(screen.queryByText('Playback Error')).toBeNull();
    cleared();
    await started();
    // 2. That one too: another quality (nothing measured: one step lighter).
    convertFail();
    await waitFor(() => expect(cap(lastUrl())).toBe('3000'));
    const other = lastUrl();
    expect(sessionOf(other)).not.toBe(sessionOf(fresh));
    expect(other).toContain('X-Plex-Platform=Android');
    expect(decisions()).toHaveLength(3);
    expect(h.toast.mock.calls.map((c) => String((c[0] as { description?: string }).description ?? ''))).toContain('Playing 720p · 3 Mbps instead. Change it any time under Quality.');
    cleared();
    await started();
    // 3. And that one: the message, with the status. No more sessions.
    convertFail();
    await waitFor(() => expect(screen.getByText("The Plex server couldn't prepare this video (it may be busy). Try again in a minute or pick another quality.")).toBeTruthy());
    expect(screen.getByText('HTTP 503')).toBeTruthy();
    await wait(5_000);
    expect(lastUrl()).toBe(other);
    // Every session was its own.
    const sessions = h.urls.filter(isTranscode).map(sessionOf);
    expect(new Set(sessions).size).toBe(sessions.length);
    // Retry: a fresh session again, never the one that failed.
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(lastUrl()).not.toBe(other));
    expect(sessionOf(lastUrl())).not.toBe(sessionOf(other));
    expect(cap(lastUrl())).toBe('3000');
  });

  it('a fresh session the server turns down at its decision goes straight to another quality', async () => {
    await converting720();
    // The fresh session's decision is turned down; the next one is not.
    let refusals = 1;
    h.fetch.mockImplementation(async (u: unknown) => (String(u).includes('/transcode/universal/decision?') && refusals-- > 0
      ? new Response('', { status: 503 })
      : new Response('', { status: 200 })));
    const first = lastUrl();
    convertFail();
    await waitFor(() => expect(cap(lastUrl())).toBe('3000'));
    expect(h.urls.filter(isTranscode).filter((u) => cap(u) === '4000')).toEqual([first]);
    expect(decisions()).toHaveLength(3);
  });

  it('with the rate measured from the server carrying the file, the other quality is the file as it is', async () => {
    await openDune();
    await play('Dune');
    await started();
    act(() => { beginStream(lastUrl(), 'vod'); recordPlayerRate(40000); });
    act(() => { h.pickQuality?.('720-4', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
    await started();
    act(() => { beginStream(lastUrl(), 'vod'); recordPlayerRate(40000); });
    const first = lastUrl();
    convertFail();
    await waitFor(() => expect(lastUrl()).not.toBe(first));
    expect(cap(lastUrl())).toBe('4000');
    cleared();
    convertFail();
    await waitFor(() => expect(isTranscode(lastUrl())).toBe(false));
    expect(lastUrl()).toContain('/library/parts/7/file.mkv');
  });
});

describe('a quality the viewer picks (customers on 1.8.0: "changing of quality — not playing")', () => {
  const decisionsFor = (url: string) => decisionsAll().filter((d) => d.includes(`session=${sessionOf(url)}`));

  it('starts the way Plex\'s own players start one: the old session stopped first, a decision for the new session, then its playlist — all one session, named', async () => {
    await openDune();
    await play('Dune');
    await started();
    act(() => { h.pickQuality?.('720-4', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
    const url = lastUrl();
    expect(isTranscode(url)).toBe(true);
    expect(url).toContain('X-Plex-Platform=Android');
    expect(url).toContain('location=wan');
    expect(decisionsFor(url)).toHaveLength(1);
    const q = new URLSearchParams(decisionsFor(url)[0].slice(decisionsFor(url)[0].indexOf('?') + 1));
    expect(q.get('maxVideoBitrate')).toBe('4000');
    expect(q.get('X-Plex-Platform')).toBe('Android');
    // The file had no session to stop.
    expect(stops()).toEqual([]);
    expect(toastTitles()).not.toContain("The Plex server couldn't prepare this");
    await started();
    // A second pick: the first session stopped before the second is asked for.
    act(() => { h.pickQuality?.('720-3', 700); });
    await waitFor(() => expect(cap(lastUrl())).toBe('3000'));
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toContain(`session=${sessionOf(url)}`);
    expect(requestIndex(`stop?session=${sessionOf(url)}`)).toBeLessThan(requestIndex(`decision?`) >= 0 ? h.fetch.mock.calls.findIndex((c) => String(c[0]).includes(`session=${sessionOf(lastUrl())}`)) : Infinity);
    expect(screen.queryByText('Still preparing…')).toBeNull();
  });

  it('turned down at its decision: the next lighter conversion, said so; every one turned down: the file as it is, said so — never a spinner', async () => {
    await openDune();
    await play('Dune');
    await started();
    const file = lastUrl();
    h.fetch.mockImplementation(async (u: unknown) => (String(u).includes('/transcode/universal/decision?')
      ? new Response('', { status: 503 })
      : new Response('', { status: 200 })));
    act(() => { h.pickQuality?.('1080-8', 600); });
    // 1080p · 8 refused → 720p · 4 refused → 720p · 3 refused → the file.
    await waitFor(() => expect(decisionsAll()).toHaveLength(3));
    await waitFor(() => expect(toastTitles()).toContain("The Plex server wouldn't convert this"));
    const caps = decisionsAll().map((d) => /[?&]maxVideoBitrate=(\d+)/.exec(d)?.[1]);
    expect(caps).toEqual(['8000', '4000', '3000']);
    // Not one of them was handed to the player; the file plays on.
    expect(h.urls.filter(isTranscode)).toEqual([]);
    expect(lastUrl()).toBe(file);
    const descs = h.toast.mock.calls.map((c) => String((c[0] as { description?: string }).description ?? ''));
    expect(descs).toContain('Playing 720p · 4 Mbps instead. Change it any time under Quality.');
    expect(descs).toContain('Playing 720p · 3 Mbps instead. Change it any time under Quality.');
    expect(screen.queryByText('Still preparing…')).toBeNull();
    expect(screen.queryByText('Playback Error')).toBeNull();
    // Nothing converted is tried again on this title by automatic quality.
    await started();
    await stall(); await stall(); await stall();
    await wait(4_000);
    expect(h.urls.filter(isTranscode)).toEqual([]);
  });

  it('a title with no file to play as it is: a pick the server turns down goes back to converting at original quality', async () => {
    h.part.mockImplementation(async () => ({ versions: [] }));
    await openDune();
    await play('Dune');
    await started();
    const original = lastUrl();
    expect(isTranscode(original)).toBe(true);
    h.fetch.mockImplementation(async (u: unknown) => (String(u).includes('/transcode/universal/decision?')
      ? new Response('', { status: 500 })
      : new Response('', { status: 200 })));
    act(() => { h.pickQuality?.('720-4', 600); });
    await waitFor(() => expect(decisionsAll().length).toBeGreaterThan(0));
    await waitFor(() => expect(lastUrl()).not.toBe(original));
    expect(isTranscode(lastUrl())).toBe(true);
    expect(cap(lastUrl())).toBeNull();
    expect(screen.queryByText('Still preparing…')).toBeNull();
  });

  it('a paused conversion is kept alive on the server; a file played as it is is not', async () => {
    await openDune();
    await play('Dune');
    await started();
    act(() => { h.native = { ...h.native, paused: true }; h.kick?.(); });
    await wait(45_000);
    expect(pings()).toEqual([]);
    act(() => { h.native = { ...h.native, paused: false }; h.kick?.(); });
    act(() => { h.pickQuality?.('720-4', 600); });
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
    await started();
    await wait(45_000);
    expect(pings()).toEqual([]);
    act(() => { h.native = { ...h.native, paused: true }; h.kick?.(); });
    await wait(45_000);
    expect(pings()).toHaveLength(2);
    expect(pings()[0]).toContain(`session=${sessionOf(lastUrl())}`);
    act(() => { h.native = { ...h.native, paused: false }; h.kick?.(); });
    await wait(45_000);
    expect(pings()).toHaveLength(2);
  });

  it('a conversion the server accepts but never feeds: the same quality asked for the plain way once, then the file', async () => {
    h.pos.playing = false; h.pos.position = 0; h.pos.duration = 0;
    await openDune();
    await play('Dune');
    act(() => { h.pickQuality?.('720-4', 0); });
    await waitFor(() => expect(cap(lastUrl())).toBe('4000'));
    const named = lastUrl();
    expect(named).toContain('X-Plex-Platform=Android');
    await wait(31_000);
    await waitFor(() => expect(lastUrl()).not.toBe(named));
    const plain = lastUrl();
    expect(cap(plain)).toBe('4000');
    expect(plain).not.toContain('X-Plex-Platform=Android');
    expect(stops()[0]).toContain(`session=${sessionOf(named)}`);
    await wait(31_000);
    await waitFor(() => expect(isTranscode(lastUrl())).toBe(false));
    expect(toastTitles()).toContain("The Plex server couldn't convert this in time");
  });
});

describe('a remote server: what it delivers to this box decides the start, and the file is read over several connections', () => {
  it('measured short of the file: starts at what it carries, as automatic quality\'s own conversion', async () => {
    h.part.mockImplementation(async () => ({ partKey: '/library/parts/7/file.mkv', bitrateKbps: 12000, versions: [{ id: 'd1:0', ratingKey: 'd1', mediaIndex: 0, partKey: '/library/parts/7/file.mkv', label: '1080p', bitrateKbps: 12000 }] }));
    _setPlexSpeed(h.conn.base, 5000);
    await openDune();
    await play('Dune');
    expect(isTranscode(lastUrl())).toBe(true);
    expect(cap(lastUrl())).toBe('3000');
    expect(toastTitles()).toContain('Starting at 720p · 3 Mbps');
    expect(h.toast.mock.calls.map((c) => String((c[0] as { description?: string }).description ?? ''))).toContain('The Plex server is delivering about 5.0 Mb/s to this TV. It goes back up by itself when the speed allows. Change it any time under Quality.');
    expect(decisionsAll()).toHaveLength(1);
    expect(h.rangeFetch[h.rangeFetch.length - 1]).toBe(false);
  });

  it('measured short, the server refusing to convert: the file as it is, read over several connections', async () => {
    h.part.mockImplementation(async () => ({ partKey: '/library/parts/7/file.mkv', bitrateKbps: 12000, versions: [{ id: 'd1:0', ratingKey: 'd1', mediaIndex: 0, partKey: '/library/parts/7/file.mkv', label: '1080p', bitrateKbps: 12000 }] }));
    _setPlexSpeed(h.conn.base, 5000);
    h.fetch.mockImplementation(async (u: unknown) => (String(u).includes('/transcode/universal/decision?')
      ? new Response('', { status: 503 })
      : new Response('', { status: 200 })));
    await openDune();
    await play('Dune');
    expect(isTranscode(lastUrl())).toBe(false);
    expect(lastUrl()).toContain('/library/parts/7/file.mkv');
    expect(h.rangeFetch[h.rangeFetch.length - 1]).toBe(true);
    expect(toastTitles()).toContain("The Plex server wouldn't convert this");
  });

  it('measured fast enough: the file as it is, over several connections; on this network over one', async () => {
    h.part.mockImplementation(async (_b: string, _t: string, key: string) => ({ partKey: `/library/parts/${key}/file.mkv`, bitrateKbps: 12000, versions: [] }));
    _setPlexSpeed(h.conn.base, 40000);
    await openDune();
    await play('Dune');
    expect(isTranscode(lastUrl())).toBe(false);
    expect(h.rangeFetch[h.rangeFetch.length - 1]).toBe(true);
    expect(toastTitles()).toEqual([]);
    act(() => { h.closePlayer?.(); });
    await wait(20);
    h.closePlayer = null;
    h.conn.route = 'lan';
    await play('Other');
    expect(isTranscode(lastUrl())).toBe(false);
    expect(h.rangeFetch[h.rangeFetch.length - 1]).toBe(false);
  });

  it('nothing measured yet: a short read of the file over three connections before the first play, once per server', async () => {
    h.part.mockImplementation(async () => ({ partKey: '/library/parts/7/file.mkv', bitrateKbps: 12000, versions: [{ id: 'd1:0', ratingKey: 'd1', mediaIndex: 0, partKey: '/library/parts/7/file.mkv', label: '1080p', bitrateKbps: 12000 }] }));
    await openDune();
    await play('Dune');
    expect(isTranscode(lastUrl())).toBe(false);
    const ranges = h.fetch.mock.calls.map((c) => String(((c[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined)?.Range ?? '')).filter(Boolean);
    expect(ranges).toEqual(['bytes=0-4194303', 'bytes=4194304-8388607', 'bytes=8388608-12582911']);
    act(() => { h.closePlayer?.(); });
    await wait(20);
    h.closePlayer = null;
    await play('Other');
    // Could not tell (nothing came back): not read again on every play.
    expect(h.fetch.mock.calls.map((c) => String(((c[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined)?.Range ?? '')).filter(Boolean)).toHaveLength(3);
  });
});
