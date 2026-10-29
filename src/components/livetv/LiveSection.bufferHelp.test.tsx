/**
 * "Still buffering?" in Live TV: a full-screen channel buffering for 20 s
 * (or stalling three times in two minutes) gets the pop-up over the picture;
 * quick start-up buffering and the error card never do. While it is up the
 * remote is its own (no zap, no bar); the picture playing again leaves it
 * up; Back closes only it — still full screen, the bar down, the same
 * channel — and the next Back leaves the picture as before. Open the
 * Buffering Guide goes to Support's guide; Report this channel opens the
 * report flow with "Channel buffering" picked. No panel is contacted.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';
import { MEDIA_KEY_EVENT } from '@/lib/mediaKeys';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

configure({ asyncUtilTimeout: 4000 });

const h = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  retry: vi.fn(),
  setBuffering: null as null | ((b: boolean) => void),
  setError: null as null | ((e: { code?: string; message: string; httpStatus?: number } | null) => void),
  url: null as string | null,
}));

const CH: XtreamLiveStream[] = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [],
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => CH.map((c) => ({ ...c })),
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 2, byCat: {} }),
  loadPlayerAccount: async () => ({ host: 'http://h.test', username: 'someuser', password: 'secretpw', maxConnections: 2 }),
}));
vi.mock('@/lib/favoritesSync', async (orig) => ({
  ...(await orig<typeof import('@/lib/favoritesSync')>()),
  scheduleFavoritesPushForLine: vi.fn(),
  reconcileFavoritesForLine: vi.fn(async () => null),
  flushFavoritesPush: vi.fn(),
}));
vi.mock('@/lib/channelStatus', async (orig) => ({
  ...(await orig<typeof import('@/lib/channelStatus')>()),
  useDownChannels: () => new Set<string>(),
  signalChannel: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({}),
  },
}));
vi.mock('@/lib/liveLayout', async (orig) => ({
  ...(await orig<typeof import('@/lib/liveLayout')>()),
  useLiveLayout: () => 'classic',
  hasLiveLayoutChoice: () => true,
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: h.trackEvent, startTimer: vi.fn(), stopTimer: vi.fn(), getDeviceId: () => 'd' }));
vi.mock('@/lib/watchHistory', () => ({ recordChannelWatch: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/capacitor/SnowPlayer', () => ({
  hasNativePlayer: () => true,
  SnowPlayer: { timeshiftStatus: async () => ({ state: 'off' }), timeshiftWipe: async () => {}, getEngines: async () => ({}), getStats: async () => ({}) },
}));
vi.mock('@/capacitor/SnowRecorder', () => ({
  RECORDINGS_CHANGED_EVENT: 'smc-recordings:changed',
  notifyRecordingsChanged: () => {},
  hasRecorder: () => false,
  SnowRecorder: { listSchedules: async () => ({ schedules: [] }), active: async () => ({ jobs: [] }), list: async () => ({ recordings: [], volumes: [] }) },
}));
// The native player: buffering and an error the test sets.
vi.mock('@/hooks/useNativePlayer', async () => {
  const React = await import('react');
  return {
    useNativePlayer: (o: { active: boolean; url: string | null }) => {
      const [buffering, setBuffering] = React.useState(false);
      const [error, setError] = React.useState<{ code?: string; message: string; httpStatus?: number } | null>(null);
      h.setBuffering = setBuffering;
      h.setError = setError;
      h.url = o.active ? o.url : null;
      return { buffering, error, retry: h.retry, audioWarning: null, controller: null, paused: false, engineNotice: null };
    },
  };
});
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('./BufferingDiagnostics', () => ({ default: () => null }));
vi.mock('./VideoPlayer', () => ({ default: () => <div data-testid="video" /> }));
vi.mock('./ReportChannelDialog', () => ({
  default: ({ channelName, initialChoice }: { channelName: string; initialChoice?: string }) => (
    <div data-testid="report">{`${channelName} · ${initialChoice ?? ''}`}</div>
  ),
}));
// jsdom has no layout: the list shows every row.
vi.mock('@tanstack/react-virtual', async () => {
  const { useMemo } = await import('react');
  return {
    useVirtualizer: ({ count, estimateSize, getItemKey }: { count: number; estimateSize: (i: number) => number; getItemKey?: (i: number) => number | string }) => {
      const items = useMemo(
        () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey ? getItemKey(index) : index, start: index * estimateSize(index), size: estimateSize(index) })),
        [count, estimateSize, getItemKey],
      );
      return { getVirtualItems: () => items, getTotalSize: () => count * estimateSize(0), measure: () => {}, scrollToOffset: () => {}, scrollToIndex: () => {} };
    },
  };
});

import LiveSection from './LiveSection';
import { BUFFER_HELP_STORE_KEY } from './useBufferingHelp';

const creds: XtreamCreds = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'ts', serverLabel: 'Dreamstreams' };
const press = (k: string) => {
  act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : undefined }); });
  act(() => { fireEvent.keyUp(window, { key: k }); });
};
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
/** Fake time from here on (the channel is already up with real timers). */
const fakeTime = () => vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const text = () => document.body.textContent ?? '';
const help = () => document.querySelector('[data-buffer-help]')?.getAttribute('data-buffer-help') ?? null;
const bar = () => document.querySelector('[data-howto="bar.root"]');
const fullScreen = () => document.documentElement.classList.contains('snowplayer-fullscreen');
const on = (id: number) => !!h.url && h.url.includes(`/${id}.`);
const buffering = (b: boolean) => act(() => { h.setBuffering?.(b); });
const helpEvents = () => h.trackEvent.mock.calls.filter((c) => c[0] === 'buffering_help').map((c) => c[2]);

async function watchNewsOne(onNavigate = vi.fn()) {
  render(<LiveSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} onNavigate={onNavigate} />);
  await waitFor(() => expect(text()).toContain('News'));
  await sleep(30);
  press('ArrowRight');
  await waitFor(() => expect(text()).toContain('News One'));
  await sleep(30);
  press('Enter');
  await waitFor(() => expect(document.querySelector('button[aria-label="Report channel"]')).not.toBeNull());
  await waitFor(() => expect(on(101)).toBe(true));
  return onNavigate;
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  h.trackEvent.mockClear(); h.retry.mockClear();
  h.url = null;
});
afterEach(() => {
  vi.useRealTimers();
  __setPhoneModeForTests({ touch: false, phone: false });
  document.documentElement.className = '';
});

describe('"Still buffering?" over a full-screen channel', () => {
  it('20 s of buffering asks; the remote is its own; playing again it stays; Back closes only it', async () => {
    await watchNewsOne();
    fakeTime();
    wait(12_000); // well past the start-up
    buffering(true);
    wait(19_000);
    expect(help()).toBeNull();
    wait(1000);
    expect(help()).toBe('restart');
    expect(text()).toContain('Have you restarted your TV box and your internet router?');
    // The bar went down with it.
    expect(bar()).toBeNull();
    expect(helpEvents()).toEqual([{ step: 'restart', action: 'shown', trigger: 'long', server: 'Dreamstreams' }]);
    // No channel, host or address in it.
    expect(JSON.stringify(helpEvents())).not.toMatch(/News|h\.test|someuser|secretpw/);

    wait(700); // a press already on its way as it came up does nothing
    // ▼ would change channel behind it, CH+ too: neither does.
    press('ArrowDown');
    await act(async () => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: 'chup' })); await Promise.resolve(); });
    expect(on(101)).toBe(true);
    // It starts on "Show me how"; ▼ moved it to "Yes, I did" instead.
    expect(document.querySelector('[data-focused="true"]')?.getAttribute('data-buffer-help-choice')).toBe('yes');
    expect(bar()).toBeNull();

    // The channel starts playing: no surprise, it stays.
    buffering(false);
    wait(30_000);
    expect(help()).toBe('restart');

    press('Escape');
    expect(help()).toBeNull();
    expect(fullScreen()).toBe(true);
    expect(bar()).toBeNull();
    expect(on(101)).toBe(true);
    expect(helpEvents().at(-1)).toMatchObject({ step: 'restart', action: 'close' });
    // The snooze starts.
    expect(JSON.parse(localStorage.getItem(BUFFER_HELP_STORE_KEY)!).closedAt).toBeGreaterThan(0);

    // The next Back leaves the picture, as it always did.
    press('Escape');
    await act(async () => { await Promise.resolve(); });
    expect(fullScreen()).toBe(false);
  });

  it('quick start-up buffering asks nothing', async () => {
    await watchNewsOne();
    fakeTime();
    buffering(true);
    wait(5000);
    buffering(false);
    wait(60_000);
    expect(help()).toBeNull();
    expect(helpEvents()).toEqual([]);
  });

  it('three stalls within two minutes ask', async () => {
    await watchNewsOne();
    fakeTime();
    wait(12_000);
    for (let i = 0; i < 2; i++) { buffering(true); wait(3000); buffering(false); wait(20_000); }
    expect(help()).toBeNull();
    buffering(true);
    wait(2000);
    expect(help()).toBe('restart');
    expect(helpEvents()[0]).toMatchObject({ action: 'shown', trigger: 'stalls' });
  });

  // A dead channel (the server answers 404 / 5xx): the player gives it up
  // in seconds with its own card — never this pop-up.
  const OFF_AIR = { code: 'RECONNECT_EXHAUSTED', message: "This channel isn't on the air right now.", httpStatus: 404 };

  it('never with the error card up (a dead channel\'s "isn\'t on the air" too)', async () => {
    await watchNewsOne();
    fakeTime();
    buffering(true);
    wait(4000);
    act(() => { h.setError?.(OFF_AIR); });
    wait(40_000);
    expect(help()).toBeNull();
    expect(text()).toContain("This channel isn't on the air right now.");
    expect(helpEvents()).toEqual([]);
  });

  it('the error card coming up takes the remote from it', async () => {
    await watchNewsOne();
    fakeTime();
    wait(12_000);
    buffering(true);
    wait(20_000);
    expect(help()).toBe('restart');
    act(() => { h.setError?.(OFF_AIR); });
    expect(help()).toBeNull();
    expect(text()).toContain("This channel isn't on the air right now.");
    expect(helpEvents().map((e) => e.action)).toEqual(['shown']);
    // An OK pressed as the cards swap lands on nothing…
    press('Enter');
    expect(h.retry).not.toHaveBeenCalled();
    // …then OK is the card's Retry again.
    wait(600);
    press('Enter');
    expect(h.retry).toHaveBeenCalledTimes(1);
    // Not the viewer's close: no rest, and not one of the day's.
    expect(JSON.parse(localStorage.getItem(BUFFER_HELP_STORE_KEY)!)).toMatchObject({ shown: 0, closedAt: 0 });
  });

  it('another channel put on under it (a kickoff reminder, a voice "put on…") closes it, with no rest', async () => {
    await watchNewsOne();
    fakeTime();
    wait(12_000);
    buffering(true);
    wait(20_000);
    expect(help()).toBe('restart');
    sessionStorage.setItem('smc-live-deeplink', JSON.stringify({ host: 'http://h.test', username: 'someuser', streamId: 102, name: 'News Two', categoryId: '1' }));
    await act(async () => { window.dispatchEvent(new Event('smc:live-deeplink')); await Promise.resolve(); });
    expect(on(102)).toBe(true);
    expect(help()).toBeNull();
    expect(fullScreen()).toBe(true);
    expect(JSON.parse(localStorage.getItem(BUFFER_HELP_STORE_KEY)!)).toMatchObject({ shown: 0, closedAt: 0 });
  });

  it('frozen with the list over the picture open, then another channel picked there: no pop-up on its start-up', async () => {
    await watchNewsOne();
    fakeTime();
    wait(12_000);
    press('ContextMenu'); // Menu: the list over the picture
    await waitFor(() => expect(document.querySelector('[data-overlay-channel]')).not.toBeNull());
    buffering(true);
    // 25 s frozen while the viewer looks through the list (it stays open).
    for (let i = 0; i < 5; i++) { wait(5000); press(i % 2 ? 'ArrowUp' : 'ArrowDown'); }
    expect(help()).toBeNull();
    // OK on News Two: the list closes and it plays, still buffering (its start-up).
    expect(document.querySelector('[data-channel-overlay]')).not.toBeNull();
    const at = () => document.querySelector('[data-overlay-channel][data-focused="true"]')?.textContent ?? '';
    for (let i = 0; i < 4 && !at().includes('News Two'); i++) press('ArrowDown');
    expect(at()).toContain('News Two');
    press('Enter');
    await waitFor(() => expect(on(102)).toBe(true));
    wait(5000);
    expect(help()).toBeNull();
    expect(helpEvents()).toEqual([]);
  });

  it('Yes, I did → Try a VPN → Open the Buffering Guide goes to Support\'s guide', async () => {
    const onNavigate = await watchNewsOne();
    const opened = vi.fn();
    window.addEventListener('support:open-buffering-guide', opened);
    try {
      fakeTime();
      wait(12_000);
      buffering(true);
      wait(20_000);
      wait(700);
      press('ArrowLeft');
      press('Enter'); // Yes, I did
      expect(help()).toBe('vpn');
      expect(text()).toContain('Try a VPN');
      wait(700);
      press('Enter'); // Open the Buffering Guide
      expect(help()).toBeNull();
      expect(onNavigate).toHaveBeenCalledWith('support');
      wait(100);
      expect(opened).toHaveBeenCalledTimes(1);
      const stored = JSON.parse(localStorage.getItem(BUFFER_HELP_STORE_KEY)!);
      expect(stored).toMatchObject({ restart: true, vpn: true, shown: 1 });
      expect(helpEvents().map((e) => `${e.step}:${e.action}`)).toEqual(['restart:shown', 'restart:yes', 'vpn:open_guide']);
    } finally {
      window.removeEventListener('support:open-buffering-guide', opened);
    }
  });

  it('restart and VPN done today: straight to the guide, and Report this channel opens the report flow', async () => {
    const d = new Date();
    localStorage.setItem(BUFFER_HELP_STORE_KEY, JSON.stringify({ day: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, shown: 1, restart: true, vpn: true, closedAt: 0 }));
    await watchNewsOne();
    fakeTime();
    wait(12_000);
    buffering(true);
    wait(20_000);
    expect(help()).toBe('guide');
    expect(text()).toContain('Still buffering? Open the Buffering Guide');
    wait(700);
    // Open the guide, Check this stream (1 minute), Report this channel.
    press('ArrowRight');
    press('ArrowRight');
    press('Enter');
    expect(help()).toBeNull();
    await act(async () => { await vi.dynamicImportSettled(); });
    await waitFor(() => expect(document.querySelector('[data-testid="report"]')?.textContent).toBe('News One · Channel buffering'));
    expect(fullScreen()).toBe(true);
  });

  it('"Check this stream (1 minute)": the channel keeps playing under a slim strip; Back cancels only the check', async () => {
    const d = new Date();
    localStorage.setItem(BUFFER_HELP_STORE_KEY, JSON.stringify({ day: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, shown: 1, restart: true, vpn: true, closedAt: 0 }));
    await watchNewsOne();
    fakeTime();
    wait(12_000);
    buffering(true);
    wait(20_000);
    expect(help()).toBe('guide');
    wait(700);
    press('ArrowRight');
    press('Enter');
    expect(help()).toBeNull();
    await waitFor(() => expect(document.querySelector('[data-player-check="running"]')).not.toBeNull());
    expect(helpEvents()).toContainEqual(expect.objectContaining({ step: 'guide', action: 'check' }));
    press('Escape');
    expect(document.querySelector('[data-player-check]')).toBeNull();
    // The picture, and the channel, as they were.
    expect(fullScreen()).toBe(true);
    expect(on(101)).toBe(true);
  });
});

describe('the preview box', () => {
  it('on a TV, a channel previewing while browsing never asks', async () => {
    render(<LiveSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
    await waitFor(() => expect(text()).toContain('News'));
    await sleep(30);
    press('ArrowRight');
    await waitFor(() => expect(text()).toContain('News One'));
    await waitFor(() => expect(on(101)).toBe(true));
    expect(fullScreen()).toBe(false);
    fakeTime();
    wait(12_000);
    buffering(true);
    wait(40_000);
    expect(help()).toBeNull();
  });

  it('upright on a phone, where the box is the player, it asks there', async () => {
    act(() => __setPhoneModeForTests({ touch: true, phone: true, portrait: true }));
    render(<LiveSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
    const row = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('[data-focused]')).find((el) => (el.textContent ?? '').includes(name));
    await waitFor(() => expect(row('News One')).toBeTruthy());
    act(() => { fireEvent.click(row('News One')!); });
    await waitFor(() => expect(on(101)).toBe(true));
    expect(fullScreen()).toBe(false);
    fakeTime();
    wait(12_000);
    buffering(true);
    wait(20_000);
    expect(help()).toBe('restart');
    // A tap beside the card closes it; the box keeps the channel.
    act(() => { fireEvent.click(document.querySelector('[data-buffer-help]')!); });
    expect(help()).toBeNull();
    expect(on(101)).toBe(true);
    expect(document.querySelector('[data-phone-now]')?.textContent).toContain('News One');
  });

  it('turning the phone sideways while it is up still goes full screen (it goes by itself)', async () => {
    act(() => __setPhoneModeForTests({ touch: true, phone: true, portrait: true }));
    render(<LiveSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
    const row = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('[data-focused]')).find((el) => (el.textContent ?? '').includes(name));
    await waitFor(() => expect(row('News One')).toBeTruthy());
    act(() => { fireEvent.click(row('News One')!); });
    await waitFor(() => expect(on(101)).toBe(true));
    fakeTime();
    wait(12_000);
    buffering(true);
    wait(20_000);
    expect(help()).toBe('restart');
    act(() => __setPhoneModeForTests({ touch: true, phone: true, portrait: false }));
    await act(async () => { await Promise.resolve(); });
    expect(fullScreen()).toBe(true);
    expect(help()).toBeNull();
    expect(on(101)).toBe(true);
  });
});
