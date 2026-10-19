/**
 * ◀ ▶ with the Plex bar hidden: "I press back on the D-pad expecting it to
 * jump back 10 seconds each time". Each ◀ is 10 s back and each ▶ 30 s
 * forward (as in Live TV's films), the bar stays down so the next ◀ jumps
 * again, quick presses add up from where the last one landed, and the time
 * shows on the picture. Any other key still brings the bar up.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/capacitor/SnowPlayer', () => ({
  SCREEN_FORMATS: [{ id: 'fit', label: 'Fit', hint: '' }],
  SCREEN_FORMAT_KEY: 'k',
  SnowPlayer: { setResizeMode: async () => ({ mode: 'fit' }), getResizeMode: async () => ({ mode: 'fit' }) },
}));
vi.mock('@/lib/bufferDiagnostics', () => ({
  beginStream: () => {}, endStream: () => {}, setBuffering: () => {}, recordPlayerRate: () => {},
  getPlayerSpeedKbps: () => 23400,
  formatMbps: (k: number | null) => (k == null ? '—' : `${(k / 1000).toFixed(1)} Mb/s`),
}));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }), set: async () => {} } }));
vi.mock('@/lib/opensubtitles', () => ({ searchOpenSubtitles: async () => ({ ok: false }), downloadOpenSubtitle: async () => ({ ok: false }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: () => {} }));

import PlexPlayerOverlay from './PlexPlayerOverlay';

const seekTo = vi.fn(async (_sec: number) => {});
const getPosition = vi.fn(async () => ({ position: 600, duration: 5400, playing: true }));

const barShown = () => screen.queryByLabelText('Play/Pause') !== null;
const note = () => document.querySelector('[data-plex-seek]')?.textContent ?? null;
const key = async (k: string) => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
};

beforeEach(() => {
  seekTo.mockClear();
  getPosition.mockClear();
  render(
    <PlexPlayerOverlay
      active title="The Film" controller={null} tracksTick={0}
      getPosition={getPosition} seekTo={seekTo}
      onBackWhileHidden={() => {}} qualityKey="original" onChangeQuality={() => {}}
      volume={1} onChangeVolume={() => {}} paused={false}
    />,
  );
});
afterEach(() => { document.body.innerHTML = ''; });

describe('Plex player: ◀ ▶ with the bar hidden', () => {
  it('each ◀ is 10 s back from where the last one landed; the bar stays down', async () => {
    expect(barShown()).toBe(false);
    await key('ArrowLeft');
    await key('ArrowLeft');
    await key('ArrowLeft');
    expect(seekTo.mock.calls.map((c) => c[0])).toEqual([590, 580, 570]);
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(barShown()).toBe(false);
    expect(note()).toBe('09:30 / 1:30:00');
  });

  it('▶ is 30 s forward', async () => {
    await key('ArrowRight');
    expect(seekTo).toHaveBeenLastCalledWith(630);
    expect(barShown()).toBe(false);
  });

  it('OK (or ▲ ▼) still brings the bar up instead', async () => {
    await key('ArrowUp');
    expect(barShown()).toBe(true);
    expect(seekTo).not.toHaveBeenCalled();
  });
});
