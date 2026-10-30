/**
 * The Plex bar's "Next episode" button: there while the episode has a next
 * one, after Forward 30 s in the ◀ ▶ order, OK on it plays the next episode
 * (EpisodeAutoplay's NextAction) and the bar goes down. Absent on the last
 * episode, where ▶ goes from Forward 30 s straight to Audio.
 */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import PlexPlayerOverlay, { type NextAction } from './PlexPlayerOverlay';

const getPosition = vi.fn(async () => ({ position: 600, duration: 2700, playing: true }));
const key = async (k: string) => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
};
const mount = (nextAction: NextAction | null) => render(
  <PlexPlayerOverlay
    active title="Pilot" controller={null} tracksTick={0}
    getPosition={getPosition} seekTo={async () => {}}
    onBackWhileHidden={() => {}} qualityKey="original" onChangeQuality={() => {}}
    volume={1} onChangeVolume={() => {}} paused={false}
    nextAction={nextAction}
  />,
);
const nextBtn = () => document.querySelector('[data-pp-next]');
const focusedLabel = () => document.querySelector('[data-pp-bar] button[data-focused="true"]')?.getAttribute('aria-label');

afterEach(() => { document.body.innerHTML = ''; });

describe('Plex player: Next episode in the bar', () => {
  it('sits at the end of the bar, after Help; OK plays the next episode and hides the bar', async () => {
    const run = vi.fn();
    mount({ detail: 'S1 · E2  Two', run });
    await key('ArrowDown'); // bar up on Play
    expect(nextBtn()).not.toBeNull();
    // Play, Forward, Audio, Subtitles, Quality, Format, Volume, Help, Next.
    for (let i = 0; i < 7; i++) await key('ArrowRight');
    expect(focusedLabel()).toBe('Help');
    await key('ArrowRight');
    expect(nextBtn()?.getAttribute('data-focused')).toBe('true');
    expect(document.querySelector('[data-remote-hint]')?.textContent).toContain('Two'); // the hint names it
    await key('Enter');
    expect(run).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-pp-bar]')).toBeNull();
  });

  it('is slim: 40 px tall, like a pill, not a big card', async () => {
    mount({ detail: 'S1 · E2  Two', run: () => {} });
    await key('ArrowDown');
    expect(nextBtn()?.className).toContain('h-10');
  });

  it('is absent on the last episode; ▶ goes from Forward 30 s to Audio', async () => {
    mount(null);
    await key('ArrowDown');
    expect(nextBtn()).toBeNull();
    await key('ArrowRight');
    await key('ArrowRight');
    expect(focusedLabel()).toBe('Audio');
  });
});
