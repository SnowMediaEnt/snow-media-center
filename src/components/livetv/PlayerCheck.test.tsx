/**
 * "Add the 30 second check or a minute check into the help button on the
 * menu during playback" (owner, 2026-10-28): Plex's Help → "Check this stream
 * (1 minute)" measures the title on screen as it plays — never stopped,
 * reloaded or muted — for 60 s, a sample every 2 s (30 rows), in a slim strip
 * on top; Back cancels only the check; the verdict hides by itself; over 6 a
 * day says so in one line. Real overlay, real usePlayerCheck and real
 * lib/deviceCheck; only the plugin, the stats reads and the send are faked.
 * Also the Live TV "Still buffering?" dialog's button for it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listeners: new Map<string, Array<(d: Record<string, unknown>) => void>>(),
  calls: [] as string[],
  sent: [] as Array<Record<string, unknown>>,
  allowed: true,
}));

vi.mock('@/capacitor/SnowPlayer', () => ({
  SCREEN_FORMATS: [{ id: 'fit', label: 'Fit', hint: '' }],
  SCREEN_FORMAT_KEY: 'k',
  hasNativePlayer: () => true,
  SnowPlayer: {
    setRect: async () => {},
    load: async () => { h.calls.push('load'); },
    stop: async () => { h.calls.push('stop'); },
    seekTo: async () => {},
    setVolume: async (o: { volume: number }) => { h.calls.push(`volume:${o.volume}`); },
    play: async () => { h.calls.push('play'); },
    pause: async () => { h.calls.push('pause'); },
    getPosition: async () => ({ position: 60, duration: 5400, playing: true }),
    getAudioTracks: async () => ({ tracks: [] }),
    getSubtitleTracks: async () => ({ tracks: [] }),
    setResizeMode: async () => ({ mode: 'fit' }),
    getResizeMode: async () => ({ mode: 'fit' }),
    addListener: async (ev: string, cb: (d: Record<string, unknown>) => void) => {
      h.listeners.set(ev, [...(h.listeners.get(ev) ?? []), cb]);
      return { remove: () => { h.listeners.set(ev, (h.listeners.get(ev) ?? []).filter((f) => f !== cb)); } };
    },
  },
}));
vi.mock('@/lib/bufferDiagnostics', () => ({
  beginStream: () => {}, endStream: () => {}, setBuffering: () => {}, recordPlayerRate: () => {},
  getPlayerSpeedKbps: () => 23400,
  measureInternetKbps: async () => 48_000,
  formatMbps: (k: number | null) => (k == null ? '—' : `${(k / 1000).toFixed(1)} Mb/s`),
}));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => false }));
vi.mock('@/lib/deviceHealth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/deviceHealth')>('@/lib/deviceHealth');
  return {
    ...actual,
    checkAllowedToday: () => h.allowed,
    readVitals: async () => ({ memAvailMb: 800, memTotalMb: 1900, wifiRssi: -50 }),
    readStats: async () => ({
      state: 'ready', playing: true, bufferedAheadSec: 20, arrivalKbps: 9000, nowKbps: 9000, videoFormat: 'H264 1920x1080 6.0 Mb/s',
      droppedFrames: 0, cpuPct: 35, lastError: null, httpStatus: null, engine: 'exo', firstFrameMs: 900,
    }),
    sendCheckNow: async (e: Record<string, unknown>) => { h.sent.push(e); return { sent: true, id: 'check-1' }; },
  };
});
vi.mock('@/utils/quietMode', () => ({ enterQuiet: () => {}, exitQuiet: () => {} }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: () => {} }) } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }), set: async () => {} } }));
vi.mock('@/lib/opensubtitles', () => ({ searchOpenSubtitles: async () => ({ ok: false }), downloadOpenSubtitle: async () => ({ ok: false }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: () => {} }));

import { useNativePlayer } from '@/hooks/useNativePlayer';
import PlexPlayerOverlay from './PlexPlayerOverlay';
import BufferingHelpDialog from './BufferingHelpDialog';
import { PLAYER_CHECK_RESULT_MS, PlayerCheckStrip, usePlayerCheck } from './DeviceHealthParts';

const onBackWhileHidden = vi.fn();

function Player() {
  const native = useNativePlayer({ active: true, url: 'http://srv/film.mkv', volume: 1, live: false, health: { context: 'plex', title: 'The Film' } });
  const check = usePlayerCheck({ active: true, playing: { context: 'plex', title: 'The Film' }, playKey: 'rk-1' });
  return (
    <>
      <PlexPlayerOverlay
        active title="The Film" controller={native.controller} tracksTick={0}
        getPosition={native.getPosition} seekTo={native.seekTo}
        onBackWhileHidden={onBackWhileHidden} qualityKey="original" onChangeQuality={() => {}}
        volume={1} onChangeVolume={() => {}} paused={native.paused}
        onCheckStream={check.start} onBackFirst={check.handleBack}
      />
      <PlayerCheckStrip check={check} />
    </>
  );
}

const fire = (ev: string, data: Record<string, unknown>) => act(() => { (h.listeners.get(ev) ?? []).forEach((cb) => cb(data)); });
const key = (k: string, keyCode?: number) => act(() => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  if (keyCode != null) Object.defineProperty(e, 'keyCode', { get: () => keyCode });
  window.dispatchEvent(e);
});
const ok = () => { key('Enter', 13); act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); }); };
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const strip = () => document.querySelector('[data-player-check]');

async function mount() {
  render(<Player />);
  await wait(50);
  fire('playerState', { state: 'ready' });
  fire('playerState', { playing: true });
}

/** With the remote: OK shows the bar (on ▶❚❚), ▶ ×7 to Help, OK opens it, ▼ to the check, OK. */
async function startFromHelp() {
  ok();
  for (let i = 0; i < 7; i += 1) key('ArrowRight');
  ok();
  expect(screen.getByText('Check this stream (1 minute)')).toBeTruthy();
  key('ArrowDown');
  ok();
  await wait(0);
}

beforeEach(() => {
  vi.useFakeTimers(); h.listeners.clear(); h.calls.length = 0; h.sent.length = 0; h.allowed = true; onBackWhileHidden.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('Plex Help → Check this stream (1 minute)', () => {
  it('measures the title as it plays for 60 s (30 rows, every 2 s): never stopped, reloaded or muted', async () => {
    await mount();
    const before = [...h.calls];
    await startFromHelp();
    expect(strip()?.getAttribute('data-player-check')).toBe('running');
    await wait(32_000);
    expect(strip()?.textContent).toContain('Checking this stream… 34 s');
    expect(strip()?.textContent).toContain('Back cancels');
    await wait(32_000);
    expect(h.sent).toHaveLength(1);
    const e = h.sent[0] as { kind: string; context: string; title: string; samples: number[][]; data: Record<string, unknown> };
    expect(e).toMatchObject({ kind: 'check', context: 'plex', title: 'The Film' });
    expect(e.samples).toHaveLength(30);
    expect(e.samples[29][0]).toBe(58);
    expect(e.data).toMatchObject({ source: 'already_playing', seconds: 60, intervalSec: 2 });
    // Nothing done to the player by the check.
    const after = h.calls.slice(before.length);
    expect(after.filter((c) => c === 'load' || c === 'stop' || c.startsWith('volume:'))).toEqual([]);
    expect(strip()?.getAttribute('data-player-check')).toBe('result');
    expect(strip()?.textContent).toContain('Sent to Snow Media.');
    // The verdict goes by itself.
    await wait(PLAYER_CHECK_RESULT_MS + 100);
    expect(strip()).toBeNull();
  });

  it('Back during the check cancels only the check: the player stays, nothing is sent', async () => {
    await mount();
    await startFromHelp();
    await wait(10_000);
    expect(strip()).not.toBeNull();
    key('Escape');
    expect(strip()).toBeNull();
    expect(onBackWhileHidden).not.toHaveBeenCalled();
    await wait(70_000);
    expect(h.sent).toHaveLength(0);
    expect(h.calls).not.toContain('stop');
    // The next Back is the player's again (the bar has hidden by now: out).
    key('Escape');
    expect(onBackWhileHidden).toHaveBeenCalledTimes(1);
  });

  it('Back on the verdict hides it, not the player', async () => {
    await mount();
    await startFromHelp();
    await wait(65_000);
    expect(strip()?.getAttribute('data-player-check')).toBe('result');
    key('Escape');
    expect(strip()).toBeNull();
    expect(onBackWhileHidden).not.toHaveBeenCalled();
  });

  it('6 checks today already: one line says so, nothing runs', async () => {
    h.allowed = false;
    await mount();
    await startFromHelp();
    expect(strip()?.getAttribute('data-player-check')).toBe('limit');
    expect(strip()?.textContent).toContain('6 checks today');
    await wait(70_000);
    expect(h.sent).toHaveLength(0);
  });
});

describe('the check follows the player', () => {
  function Harness({ active, playKey }: { active: boolean; playKey: string }) {
    const check = usePlayerCheck({ active, playing: { context: 'live', title: 'Channel One' }, playKey });
    return (
      <>
        <button type="button" data-start="" onClick={check.start}>start</button>
        <PlayerCheckStrip check={check} />
      </>
    );
  }

  it('another channel, or the player closing, cancels it: nothing sent', async () => {
    const { rerender } = render(<Harness active playKey="a" />);
    fireEvent.click(document.querySelector('[data-start]') as HTMLElement);
    await wait(4_000);
    expect(strip()?.getAttribute('data-player-check')).toBe('running');
    rerender(<Harness active playKey="b" />);
    expect(strip()).toBeNull();
    await wait(0);
    fireEvent.click(document.querySelector('[data-start]') as HTMLElement);
    await wait(4_000);
    expect(strip()).not.toBeNull();
    rerender(<Harness active={false} playKey="b" />);
    expect(strip()).toBeNull();
    await wait(70_000);
    expect(h.sent).toHaveLength(0);
  });

  it("Back is the strip's own while it shows (a player that does not ask first)", async () => {
    render(<Harness active playKey="a" />);
    fireEvent.click(document.querySelector('[data-start]') as HTMLElement);
    await wait(2_000);
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    key('Escape');
    window.removeEventListener('keydown', behind);
    expect(strip()).toBeNull();
    expect(behind).not.toHaveBeenCalled();
  });
});

describe('Live TV "Still buffering?": the check button on its last step', () => {
  it('offers "Check this stream (1 minute)" and OK on it runs onCheck', async () => {
    const onCheck = vi.fn();
    render(
      <BufferingHelpDialog steps={['guide']} canReport onRestartDone={() => {}} onOpenGuide={() => {}} onReport={() => {}}
        onCheck={onCheck} onClose={() => {}} track={() => {}} armMs={0} />,
    );
    const btn = document.querySelector('[data-buffer-help-choice="check"]') as HTMLElement;
    expect(btn.textContent).toBe('Check this stream (1 minute)');
    key('ArrowRight');
    ok();
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('without onCheck there is no such button', () => {
    render(
      <BufferingHelpDialog steps={['guide']} canReport onRestartDone={() => {}} onOpenGuide={() => {}} onReport={() => {}}
        onClose={() => {}} track={() => {}} armMs={0} />,
    );
    expect(document.querySelector('[data-buffer-help-choice="check"]')).toBeNull();
    fireEvent.click(document.querySelector('[data-buffer-help-choice="report"]') as HTMLElement);
  });
});
