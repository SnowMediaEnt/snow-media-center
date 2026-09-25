/**
 * "Stats for nerds", like the Plex app's: Help → Playback stats shows what
 * the player is doing (read from SnowPlayer.getStats once a second) next to
 * what the app knows (direct play or converting, the server, the route).
 * It reads the player only while open, takes no D-pad focus, and Back
 * closes it before anything else. The plugin is a stand-in.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerStats } from '@/capacitor/SnowPlayer';

const h = vi.hoisted(() => ({ getStats: vi.fn() }));

vi.mock('@/capacitor/SnowPlayer', () => ({
  SCREEN_FORMATS: [{ id: 'fit', label: 'Fit', hint: '' }],
  SCREEN_FORMAT_KEY: 'k',
  SnowPlayer: {
    getStats: h.getStats,
    setResizeMode: async () => ({ mode: 'fit' }),
    getResizeMode: async () => ({ mode: 'fit' }),
  },
}));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }), set: async () => {} } }));
vi.mock('@/lib/opensubtitles', () => ({ searchOpenSubtitles: async () => ({ ok: false }), downloadOpenSubtitle: async () => ({ ok: false }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: () => {} }));

import PlayerStatsPanel from './PlayerStatsPanel';
import PlexPlayerOverlay from './PlexPlayerOverlay';

// The owner's film in the Plex app, as SMC's player would report it.
const STATS: PlayerStats = {
  state: 'ready', playing: true, positionSec: 3723, durationSec: 7800, bufferedAheadSec: 18.4,
  nowKbps: 84000, avgKbps: 84000, minKbps: 15800, maxKbps: 305800,
  videoDecoder: 'c2.amlogic.hevc.decoder', videoFormat: 'HEVC 1920x804 23.98fps 21.6 Mb/s', renderedFrames: 89210, droppedFrames: 0,
  audioDecoder: 'Passthrough', audioFormat: 'EAC3 8ch 48.0kHz',
  restarts: 1, lastRestartReason: 'server stopped responding', lastError: 'ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT', loadProfile: 'steady · 50 s / 128 MB',
  javaHeapMb: 61.4, nativeHeapMb: 142,
};

const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const key = (init: KeyboardEventInit & { keyCode?: number }) => act(() => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.keyCode != null) Object.defineProperty(e, 'keyCode', { get: () => init.keyCode });
  window.dispatchEvent(e);
});
const ok = () => key({ key: 'Enter', keyCode: 13 });
const back = () => key({ key: 'Escape', keyCode: 27 });
const right = () => key({ key: 'ArrowRight' });
const down = () => key({ key: 'ArrowDown' });
const panel = () => document.querySelector('[data-player-stats]');
const barShown = () => screen.queryByLabelText('Play/Pause') !== null;

beforeEach(() => {
  vi.useFakeTimers();
  h.getStats.mockReset();
  h.getStats.mockImplementation(async () => ({ ...STATS }));
});
afterEach(() => { vi.useRealTimers(); });

describe('the stats panel', () => {
  it('shows what the player reports next to what the app knows', async () => {
    render(<PlayerStatsPanel session="Direct play of the original file" serverName="Snow Media P2" routeLabel="Direct to server · plex.direct · https" needKbps={21600} />);
    await wait(0);
    const text = panel()?.textContent ?? '';
    for (const part of [
      'Direct play of the original file', 'Server Snow Media P2', 'Route Direct to server · plex.direct · https',
      'Playing', 'Buffer 18.4 s ahead', 'At 1:02:03 / 2:10:00',
      'Now 84.0 Mb/s', 'Average 84.0 Mb/s', '(min 15.8, max 305.8)', 'Needs 21.6 Mb/s',
      'c2.amlogic.hevc.decoder', 'HEVC 1920x804 23.98fps 21.6 Mb/s', 'Frames 89,210 · 0 dropped',
      'Passthrough', 'EAC3 8ch 48.0kHz',
      'Restarts 1 (last: server stopped responding)', 'Last error ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT', 'Load steady · 50 s / 128 MB',
      'Java 61 MB', 'Native 142 MB',
    ]) expect(text).toContain(part);
    expect(h.getStats).toHaveBeenCalledWith(undefined);
  });

  it('nothing known yet reads as dashes; converting says to what', async () => {
    h.getStats.mockImplementation(async () => ({
      ...STATS, state: 'buffering', playing: false, nowKbps: 0, avgKbps: null, minKbps: null, maxKbps: null,
      videoDecoder: null, videoFormat: null, renderedFrames: null, droppedFrames: null, audioDecoder: null, audioFormat: null,
      restarts: 0, lastRestartReason: null, lastError: null, loadProfile: null, javaHeapMb: null, nativeHeapMb: null,
    }));
    render(<PlayerStatsPanel session="Converting to 720p · 4 Mbps" />);
    await wait(0);
    const text = panel()?.textContent ?? '';
    expect(text).toContain('Converting to 720p · 4 Mbps');
    expect(text).toContain('Buffering');
    expect(text).toContain('Now 0.0 Mb/s');
    expect(text).toContain('(min —, max —)');
    expect(text).toContain('Restarts 0');
    expect(text).toContain('Last error none');
    expect(text).toContain('Java —');
    expect(text).not.toContain('null');
  });

  it('an app too old to answer says so instead of breaking', async () => {
    h.getStats.mockImplementation(async () => { throw new Error('not implemented'); });
    render(<PlayerStatsPanel session="Direct play of the original file" serverName="Snow Media P2" />);
    await wait(0);
    expect(screen.getByText(/can't read the player's stats yet/)).toBeTruthy();
    expect(panel()?.textContent).toContain('Snow Media P2');
  });

  it('reads once a second while shown, one read at a time, and stops when gone', async () => {
    let answer: (s: PlayerStats) => void = () => {};
    h.getStats.mockImplementation(() => new Promise<PlayerStats>((r) => { answer = r; }));
    const { unmount } = render(<PlayerStatsPanel session="x" />);
    await wait(0);
    expect(h.getStats).toHaveBeenCalledTimes(1);
    // The bridge is slow: no second call piles up behind the first.
    await wait(3_000);
    expect(h.getStats).toHaveBeenCalledTimes(1);
    await act(async () => { answer({ ...STATS }); });
    await wait(1_000);
    expect(h.getStats).toHaveBeenCalledTimes(2);
    unmount();
    await wait(5_000);
    expect(h.getStats).toHaveBeenCalledTimes(2);
  });

  it('never takes focus', async () => {
    render(<PlayerStatsPanel session="x" />);
    await wait(0);
    const el = panel() as HTMLElement;
    expect(el.className).toContain('pointer-events-none');
    expect(el.querySelector('[data-focused], [tabindex], button')).toBeNull();
  });
});

describe('Help → Playback stats in the Plex player', () => {
  const onBackWhileHidden = vi.fn();
  function Player() {
    return (
      <PlexPlayerOverlay
        active title="The Film" controller={null} tracksTick={0}
        getPosition={async () => ({ position: 60, duration: 5400, playing: true })} seekTo={async () => {}}
        onBackWhileHidden={onBackWhileHidden} qualityKey="original" onChangeQuality={() => {}}
        volume={1} onChangeVolume={() => {}}
        routeLabel="Direct to server · plex.direct · https" statsSession="Direct play of the original file" serverName="Snow Media P2" needKbps={21600}
      />
    );
  }
  /** Bar up, focus on Help (from ▶❚❚, seven to the right), menu open, on
   *  "Playback stats" (the third item). */
  async function toStatsItem() {
    ok();
    for (let i = 0; i < 7; i += 1) right();
    await helpMenuAtStats();
  }
  /** Focus already on Help: open its menu and go down to "Playback stats". */
  async function helpMenuAtStats() {
    ok();
    await wait(0);
    expect(screen.getByText('Fix buffering — step-by-step guide')).toBeTruthy();
    down(); down();
    await wait(0);
  }
  const statsItem = () => screen.getByText('Fix buffering — step-by-step guide').parentElement?.parentElement?.querySelectorAll('[data-focused]')[2] as HTMLElement;

  beforeEach(() => { onBackWhileHidden.mockReset(); });

  it('reads nothing until opened; OK opens it, OK on it again closes it', async () => {
    render(<Player />);
    await wait(5_000);
    expect(h.getStats).not.toHaveBeenCalled();
    expect(panel()).toBeNull();

    await toStatsItem();
    expect(panel()).toBeNull();
    ok();
    await wait(0);
    expect(panel()).not.toBeNull();
    expect(panel()?.textContent).toContain('Snow Media P2');
    expect(panel()?.textContent).toContain('Needs 21.6 Mb/s');
    await wait(3_000);
    const calls = h.getStats.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(3);

    // The menu shows it is on; OK there turns it off.
    await helpMenuAtStats();
    expect(statsItem().getAttribute('data-focused')).toBe('true');
    expect(statsItem().textContent).toBe('Playback stats●');
    ok();
    await wait(0);
    expect(panel()).toBeNull();
    const after = h.getStats.mock.calls.length;
    await wait(5_000);
    expect(h.getStats.mock.calls.length).toBe(after);
  });

  it('stays up when the bar hides, and Back closes it before leaving the film', async () => {
    render(<Player />);
    await toStatsItem();
    ok();
    await wait(6_000);
    expect(barShown()).toBe(false);
    expect(panel()).not.toBeNull();

    back();
    await wait(0);
    expect(panel()).toBeNull();
    expect(onBackWhileHidden).not.toHaveBeenCalled();
    const n = h.getStats.mock.calls.length;
    await wait(3_000);
    expect(h.getStats.mock.calls.length).toBe(n);

    // Closed: Back leaves the film as before.
    back();
    expect(onBackWhileHidden).toHaveBeenCalledTimes(1);
  });

  it('with the bar up, Back closes the stats first, then hides the bar', async () => {
    render(<Player />);
    await toStatsItem();
    ok();
    await wait(0);
    expect(barShown()).toBe(true);
    back();
    await wait(0);
    expect(panel()).toBeNull();
    expect(barShown()).toBe(true);
    back();
    await wait(0);
    expect(barShown()).toBe(false);
    expect(onBackWhileHidden).not.toHaveBeenCalled();
  });

  it('open, the control bar keeps the D-pad: ◀ ▶ still move along it', async () => {
    render(<Player />);
    await toStatsItem();
    ok();
    await wait(0);
    // Focus is still on Help; one to the left is Volume.
    key({ key: 'ArrowLeft' });
    await wait(0);
    expect(screen.getByLabelText('Volume').getAttribute('data-focused')).toBe('true');
    expect(panel()?.querySelector('[data-focused]')).toBeNull();
  });
});
