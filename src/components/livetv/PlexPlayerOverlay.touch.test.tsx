/**
 * The Plex player by finger: a tap on the picture brings the bar up and puts
 * it away, a tap on a button does what OK does on it (without also toggling
 * the bar), menu rows and the seek bar take a finger, and Skip Intro takes a
 * tap. On a TV none of it is attached (Help keeps the click it always had).
 */
import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setPhoneModeForTests } from '@/lib/phoneMode';
import type { VideoController } from './VideoPlayer';
import type { PlayerPrompt } from './PlexPlayerOverlay';

const h = vi.hoisted(() => ({
  togglePlay: vi.fn(),
  setSubtitleTrack: vi.fn(),
  seekTo: vi.fn(async (_s: number) => {}),
}));

vi.mock('@/capacitor/SnowPlayer', () => ({
  SCREEN_FORMATS: [{ id: 'fit', labelKey: 'x', hintKey: 'y' }],
  SnowPlayer: { getResizeMode: async () => ({ mode: 'fit' }), setResizeMode: async () => ({ mode: 'fit' }) },
}));
vi.mock('@/hooks/useScreenFormat', () => ({ useScreenFormat: () => ({ format: 'fit', setFormat: async () => {} }) }));
vi.mock('@/lib/bufferDiagnostics', () => ({
  getPlayerSpeedKbps: () => null,
  formatMbps: () => '—',
}));
vi.mock('@/lib/opensubtitles', () => ({ searchOpenSubtitles: async () => ({ ok: false }), downloadOpenSubtitle: async () => ({ ok: false }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: () => {} }));

import PlexPlayerOverlay from './PlexPlayerOverlay';

const controller: VideoController = {
  play: () => {}, pause: () => {}, togglePlay: () => h.togglePlay(), seek: () => {},
  isPaused: () => false, isSeekable: () => true,
  getSubtitleTracks: () => [{ id: 3, label: 'English', active: false }],
  setSubtitleTrack: (id) => h.setSubtitleTrack(id),
  getAudioTracks: () => [], setAudioTrack: () => {},
};

function Player({ prompt = null }: { prompt?: PlayerPrompt | null }) {
  const root = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={root} data-testid="layer">
      <PlexPlayerOverlay
        active title="The Film" controller={controller} tracksTick={0}
        getPosition={async () => ({ position: 60, duration: 5400, playing: true })} seekTo={h.seekTo}
        onBackWhileHidden={() => {}} qualityKey="original" onChangeQuality={() => {}}
        volume={1} onChangeVolume={() => {}} paused={false} prompt={prompt} touchRoot={root}
      />
    </div>
  );
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const barUp = () => q('[aria-label="Play/Pause"]') !== null;
const at = (x: number, y: number) => [{ identifier: 0, clientX: x, clientY: y }];
const finger = async (el: Element, x = 300, y = 200) => {
  await act(async () => {
    fireEvent.touchStart(el, { touches: at(x, y), changedTouches: at(x, y) });
    fireEvent.touchEnd(el, { touches: [], changedTouches: at(x, y) });
  });
  await settle();
};
const tap = async (el: Element) => {
  await finger(el, 5, 5);
  await act(async () => { fireEvent.click(el); });
  await settle();
};
const layer = () => q('[data-testid="layer"]')!;

beforeEach(() => { h.togglePlay.mockReset(); h.setSubtitleTrack.mockReset(); h.seekTo.mockClear(); });
afterEach(() => { act(() => { __setPhoneModeForTests({ touch: false, phone: false }); }); });

describe('the Plex bar on a phone', () => {
  beforeEach(() => { act(() => { __setPhoneModeForTests({ touch: true, phone: true }); }); });

  it('a tap on the picture brings the bar up, the next puts it away', async () => {
    render(<Player />);
    expect(barUp()).toBe(false);
    await finger(layer());
    expect(barUp()).toBe(true);
    await finger(layer());
    expect(barUp()).toBe(false);
  });

  it('a tap on Play/Pause plays or pauses (OK), and the bar stays', async () => {
    render(<Player />);
    await finger(layer());
    await tap(q('[aria-label="Play/Pause"]')!);
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
    expect(barUp()).toBe(true);
    expect(q('[aria-label="Play/Pause"]')!.getAttribute('data-focused')).toBe('true');
  });

  it('subtitles: a tap opens the menu, a tap on a row picks it, a tap on the picture closes the menu first', async () => {
    render(<Player />);
    await finger(layer());
    await tap(q('[aria-label="Subtitles"]')!);
    expect(document.body.textContent).toContain('English');
    await finger(layer());
    expect(document.body.textContent).not.toContain('English');
    expect(barUp()).toBe(true);
    await tap(q('[aria-label="Subtitles"]')!);
    const row = Array.from(document.querySelectorAll('[data-focused]')).find((d) => d.textContent === 'English')!;
    await tap(row);
    expect(h.setSubtitleTrack).toHaveBeenLastCalledWith(3);
    expect(barUp()).toBe(true);
  });

  it('the seek bar: the film jumps where the finger lifts', async () => {
    render(<Player />);
    await finger(layer());
    const line = q('[data-howto="pp.seek"]')!;
    vi.spyOn(line, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000, top: 0, height: 6, right: 1000, bottom: 6, x: 0, y: 0, toJSON: () => ({}) });
    await act(async () => {
      fireEvent.touchStart(line, { touches: at(500, 3), changedTouches: at(500, 3) });
      fireEvent.touchEnd(line, { touches: [], changedTouches: at(500, 3) });
    });
    await settle();
    expect(h.seekTo).toHaveBeenLastCalledWith(2700);
    expect(barUp()).toBe(true);
  });

  it('Skip Intro takes a tap', async () => {
    const onOk = vi.fn();
    render(<Player prompt={{ kind: 'skip', label: 'Skip Intro', onOk }} />);
    const box = Array.from(document.querySelectorAll('[role="button"]')).find((d) => d.textContent?.includes('Skip Intro'))!;
    await tap(box);
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(barUp()).toBe(false);
  });
});

describe('the same bar on a TV', () => {
  it('has no touch handlers: taps and clicks on the picture and buttons do nothing', async () => {
    const onOk = vi.fn();
    render(<Player prompt={{ kind: 'skip', label: 'Skip Intro', onOk }} />);
    await finger(layer());
    expect(barUp()).toBe(false);
    expect(document.querySelector('[role="button"]')).toBeNull();
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowUp' }); });
    expect(barUp()).toBe(true);
    await tap(q('[aria-label="Play/Pause"]')!);
    expect(h.togglePlay).not.toHaveBeenCalled();
    expect(onOk).not.toHaveBeenCalled();
    expect(document.querySelector('[data-touch-chrome], [data-touch-track]')).toBeNull();
  });
});
