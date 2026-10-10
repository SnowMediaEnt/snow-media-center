// The film / episode bar by touch (Tronix 2ca8249, e5970ea): a tap on the
// picture brings the bar up, a tap on a button runs it, a tap on the timeline
// seeks there, Back leaves at once. A TV: no tap layer, Back hides the bar first.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VodControlBar from './VodControlBar';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

const make = () => {
  const controller = {
    togglePlay: vi.fn(), getSubtitleTracks: () => [], getAudioTracks: () => [{ id: 1, label: 'Main', active: true }],
    setSubtitleTrack: vi.fn(), setAudioTrack: vi.fn(), isSeekable: () => true,
  };
  const seekTo = vi.fn();
  const onClose = vi.fn();
  const r = render(
    <VodControlBar
      controller={controller as never} tracksTick={0} paused={false}
      getPosition={async () => ({ position: 100, duration: 1000, playing: true })}
      seekTo={seekTo} volume={1} maxVolume={1.5} onVolume={vi.fn()} onClose={onClose}
    />,
  );
  return { ...r, controller, seekTo, onClose };
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

afterEach(() => { cleanup(); __setPhoneModeForTests({ touch: false, phone: false }); });

describe('the film bar on a touch screen', () => {
  it('a tap on the picture shows the bar; a tap on Play runs it; a tap on the timeline seeks there', async () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    const { container, controller, seekTo } = make();
    fireEvent.click(container.querySelector('[data-vod-tap]')!);
    await flush();
    expect(container.querySelector('[data-vod-bar]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-bar-control="play"] button')!);
    expect(controller.togglePlay).toHaveBeenCalled();
    const tl = container.querySelector('[data-vod-timeline]') as HTMLElement;
    tl.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 12, right: 200, bottom: 12, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerUp(tl, { clientX: 100 });
    expect(seekTo).toHaveBeenCalledWith(500);
  });

  it('Back with the bar up leaves at once', async () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    const { container, onClose } = make();
    fireEvent.click(container.querySelector('[data-vod-tap]')!);
    await flush();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalled();
  });

  it('a TV: no tap layer; Back hides the bar first', async () => {
    const { container, onClose } = make();
    expect(container.querySelector('[data-vod-tap]')).toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
    await flush();
    expect(container.querySelector('[data-vod-bar]')).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).not.toHaveBeenCalled();
  });
});
