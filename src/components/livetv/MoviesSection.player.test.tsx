/**
 * Live TV › VOD › a film: on a box it plays on the native player (the WebView
 * plays AC-3 / E-AC-3 / DTS films with no sound), with the file type the
 * panel's get_vod_info names, and at the shared player volume (never stuck
 * at 0 by the old VOD-only key). Back closes it.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type NativeArgs = { active: boolean; url: string | null; live?: boolean; volume: number };

const h = vi.hoisted(() => ({
  native: true,
  args: [] as NativeArgs[],
  videoProps: null as Record<string, unknown> | null,
}));

vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => h.native }));
vi.mock('@/hooks/useNativePlayer', () => ({
  useNativePlayer: (a: NativeArgs) => {
    h.args.push(a);
    return {
      controller: { getAudioTracks: () => [], setAudioTrack: () => {} },
      buffering: false, paused: false, error: null, audioWarning: null, engineNotice: null,
      retry: () => {}, seekTo: async () => {}, getPosition: async () => ({ position: 0, duration: 0, playing: true }),
    };
  },
}));
vi.mock('./VideoPlayer', () => ({
  default: (p: Record<string, unknown>) => { h.videoProps = p; return <div data-fake-video={String(p.src)} />; },
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: () => {}, startTimer: () => {}, stopTimer: () => {} }));
vi.mock('@/lib/xtream', async (orig) => {
  const real = await orig<typeof import('@/lib/xtream')>();
  return {
    ...real,
    getVodCategories: async () => [{ category_id: '5', category_name: 'Action', parent_id: 0 }],
    getVodStreams: async () => [{ stream_id: 77, name: 'Big Film', container_extension: 'mp4', stream_type: 'movie' }],
    // The panel's own answer for the film: an mkv, which the list didn't say.
    getVodInfo: async () => ({ info: { plot: 'A film.' }, movie_data: { stream_id: 77, container_extension: 'mkv' } }),
  };
});

import MoviesSection from './MoviesSection';

// jsdom has no ResizeObserver (the grid measures its rows with one).
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const creds = { host: 'http://panel.example:8080', username: 'user1', password: 'pass1', serverLabel: 'Test' };
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const key = async (k: string, extra: Record<string, unknown> = {}) => { await act(async () => { fireEvent.keyDown(window, { key: k, ...extra }); }); await settle(); };
const latest = () => h.args[h.args.length - 1];

async function openAndPlay() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<MoviesSection creds={creds as any} isActive onExitLeft={() => {}} />);
  await settle();
  await key('Enter'); // the first real category → its grid
  await key('Enter'); // the first film → its page (get_vod_info)
  await key('Enter'); // Play
}

beforeEach(() => {
  h.native = true; h.args = []; h.videoProps = null;
  localStorage.clear();
  document.documentElement.classList.remove('snowplayer-fullscreen');
});

describe('MoviesSection player', () => {
  it('a box plays the film on the native player, as the mkv get_vod_info names', async () => {
    await openAndPlay();
    const a = latest();
    expect(a).toBeTruthy();
    expect(a.active).toBe(true);
    expect(a.live).toBe(false);
    expect(a.url).toMatch(/\/movie\/user1\/pass1\/77\.mkv$/);
    expect(document.querySelector('[data-vod-player]')?.getAttribute('data-engine')).toBe('native');
    expect(document.querySelector('[data-fake-video]')).toBeNull();
    // Back closes the player (and with it the native stream).
    await key('Escape');
    expect(document.querySelector('[data-vod-player]')).toBeNull();
    expect(document.documentElement.classList.contains('snowplayer-fullscreen')).toBe(false);
  });

  it('the browser build plays the same film in the HTML5 player', async () => {
    h.native = false;
    await openAndPlay();
    expect(String(h.videoProps?.src)).toMatch(/\/movie\/user1\/pass1\/77\.mkv$/);
    expect(h.args).toHaveLength(0);
  });

  it('plays at the shared player volume, boost included, and ◀ ▶ step it', async () => {
    localStorage.setItem('snow-player-volume-v1', '1.3');
    await openAndPlay();
    expect(latest().volume).toBe(1.3);
    await key('ArrowRight');
    expect(latest().volume).toBe(1.35);
    expect(localStorage.getItem('snow-player-volume-v1')).toBe('1.35');
  });

  it('a volume left at 0 by the old VOD-only key no longer silences every film', async () => {
    localStorage.setItem('snow-livetv-volume-v1', '0');
    await openAndPlay();
    expect(latest().volume).toBeGreaterThan(0);
  });
});
