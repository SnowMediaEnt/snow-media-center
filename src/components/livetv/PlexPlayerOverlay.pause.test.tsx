/**
 * "When you pause a movie can we get the little menu bar to pop up": a pause
 * made any way — the remote's Play/Pause key, OK on ▶❚❚ (Enter, keyCode 13),
 * the phone remote, or the system — brings the Plex control bar up and holds
 * it there; playing again lets it hide after the usual 5 s. A stall is not a
 * pause. Real useNativePlayer + native controller + overlay; only the plugin
 * is faked.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listeners, calls } = vi.hoisted(() => ({
  listeners: new Map<string, Array<(d: Record<string, unknown>) => void>>(),
  calls: [] as string[],
}));

vi.mock('@/capacitor/SnowPlayer', () => ({
  SCREEN_FORMATS: [{ id: 'fit', label: 'Fit', hint: '' }],
  SCREEN_FORMAT_KEY: 'k',
  SnowPlayer: {
    setRect: async () => {},
    load: async () => { calls.push('load'); },
    stop: async () => {},
    seekTo: async () => {},
    setVolume: async () => {},
    play: async () => { calls.push('play'); },
    pause: async () => { calls.push('pause'); },
    getPosition: async () => ({ position: 60, duration: 5400, playing: true }),
    getAudioTracks: async () => ({ tracks: [] }),
    getSubtitleTracks: async () => ({ tracks: [] }),
    setResizeMode: async () => ({ mode: 'fit' }),
    getResizeMode: async () => ({ mode: 'fit' }),
    addListener: async (ev: string, cb: (d: Record<string, unknown>) => void) => {
      listeners.set(ev, [...(listeners.get(ev) ?? []), cb]);
      return { remove: () => { listeners.set(ev, (listeners.get(ev) ?? []).filter((f) => f !== cb)); } };
    },
  },
}));
vi.mock('@/lib/bufferDiagnostics', () => ({
  beginStream: () => {}, endStream: () => {}, setBuffering: () => {}, recordPlayerRate: () => {},
  getPlayerSpeedKbps: () => 23400,
  formatMbps: (k: number | null) => (k == null ? '—' : `${(k / 1000).toFixed(1)} Mb/s`),
}));
vi.mock('@/utils/quietMode', () => ({ enterQuiet: () => {}, exitQuiet: () => {} }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: () => {} }) } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }), set: async () => {} } }));
vi.mock('@/lib/opensubtitles', () => ({ searchOpenSubtitles: async () => ({ ok: false }), downloadOpenSubtitle: async () => ({ ok: false }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: () => {} }));

import { useNativePlayer } from '@/hooks/useNativePlayer';
import { MEDIA_KEY_EVENT } from '@/lib/mediaKeys';
import PlexPlayerOverlay from './PlexPlayerOverlay';
import plugin from '../../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';

const onBackWhileHidden = vi.fn();

function Player() {
  const native = useNativePlayer({ active: true, url: 'http://srv/film.mkv', volume: 1, live: false });
  return (
    <PlexPlayerOverlay
      active title="The Film" controller={native.controller} tracksTick={0}
      getPosition={native.getPosition} seekTo={native.seekTo}
      onBackWhileHidden={onBackWhileHidden} qualityKey="original" onChangeQuality={() => {}}
      volume={1} onChangeVolume={() => {}} paused={native.paused}
    />
  );
}

const barShown = () => screen.queryByLabelText('Play/Pause') !== null;
const fire = (ev: string, data: Record<string, unknown>) => act(() => { (listeners.get(ev) ?? []).forEach((cb) => cb(data)); });
const key = (init: KeyboardEventInit & { keyCode?: number }) => act(() => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.keyCode != null) Object.defineProperty(e, 'keyCode', { get: () => init.keyCode });
  window.dispatchEvent(e);
});
const ok = () => key({ key: 'Enter', keyCode: 13 });
const mediaKey = (k: string) => act(() => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: k })); });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function mount() {
  render(<Player />);
  // Listeners are added across awaits; let the load pipeline settle.
  await wait(50);
  expect(calls).toContain('load');
  fire('playerState', { state: 'ready' });
  fire('playerState', { playing: true });
}

beforeEach(() => { vi.useFakeTimers(); listeners.clear(); calls.length = 0; onBackWhileHidden.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('Plex player: pausing shows the control bar and keeps it up', () => {
  it("the remote's Play/Pause key: bar up while paused, hides 5 s after playing again", async () => {
    await mount();
    expect(barShown()).toBe(false);

    mediaKey('playpause');
    expect(calls).toContain('pause');
    await wait(0);
    expect(barShown()).toBe(true);
    await wait(30_000);
    expect(barShown()).toBe(true);

    mediaKey('playpause');
    expect(calls.filter((c) => c === 'play')).toHaveLength(1);
    await wait(4_000);
    expect(barShown()).toBe(true);
    await wait(1_500);
    expect(barShown()).toBe(false);
  });

  it('OK (Enter, keyCode 13) on Play/Pause pauses and the bar stays; OK again resumes', async () => {
    await mount();
    ok();                       // bar hidden: OK shows it, focus on ▶❚❚
    expect(barShown()).toBe(true);
    expect(calls).not.toContain('pause');
    ok();                       // ▶❚❚ → pause
    expect(calls).toContain('pause');
    await wait(20_000);
    expect(barShown()).toBe(true);

    ok();                       // resume
    expect(calls).toContain('play');
    await wait(5_500);
    expect(barShown()).toBe(false);
  });

  it('a pause from outside the app (phone remote, system) reported by the plugin', async () => {
    await mount();
    fire('playerState', { paused: true });
    await wait(10_000);
    expect(barShown()).toBe(true);
    fire('playerState', { paused: false });
    await wait(5_500);
    expect(barShown()).toBe(false);
  });

  it('a stall is not a pause: the bar stays hidden', async () => {
    await mount();
    fire('playerState', { state: 'buffering' });
    fire('playerState', { playing: false });
    await wait(1_000);
    expect(barShown()).toBe(false);
  });

  it('Back while paused hides the bar as before, without leaving the film', async () => {
    await mount();
    mediaKey('pause');
    await wait(0);
    expect(barShown()).toBe(true);
    key({ key: 'Escape', keyCode: 27 });
    expect(barShown()).toBe(false);
    expect(onBackWhileHidden).not.toHaveBeenCalled();
    // Still paused: a key brings it back, and it holds.
    key({ key: 'ArrowDown', keyCode: 40 });
    await wait(10_000);
    expect(barShown()).toBe(true);
  });

  it('the quality menu shows the current speed', async () => {
    await mount();
    ok();
    for (let i = 0; i < 4; i++) key({ key: 'ArrowRight', keyCode: 39 }); // → quality
    ok();
    expect(screen.getByText(/Your speed:/).textContent).toContain('23.4 Mb/s');
  });

  it('plugin: paused leaves out the pre-buffer hold; bandwidth is main-slot only', () => {
    const body = (from: string) => plugin.slice(plugin.indexOf(from), plugin.indexOf('\n    }\n', plugin.indexOf(from)));
    expect(body('private fun reportPaused(')).toContain('!p.playWhenReady && !s.holding');
    expect(plugin).toMatch(/override fun onPlayWhenReadyChanged\([^)]*\) \{\s*reportPaused\(s, screenId\)/);
    expect(body('fun pause(call: PluginCall)')).toMatch(/releaseHold\(s\); s\.player\?\.pause\(\); reportPaused\(s, screenId\)/);
    expect(body('private fun scheduleBandwidthTick(')).toContain('if (screenId != MAIN) return');
    // Live TV's source, the Plex file's and the Plex conversion's: every HTTP source counts its bytes.
    expect(plugin.match(/\.setTransferListener\(meter\)/g)).toHaveLength(3);
  });
});
