/**
 * The remote over a Plex trailer (the "pause fix" the owner asked for with
 * it): OK pauses and plays, a pause shows a card with the title and the
 * time, Back closes in one step whether it is playing or paused, and the
 * arrows do nothing. A touch screen gets Close and Pause / Play buttons.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlexTrailerControls from './PlexTrailerControls';
import { __setPhoneModeForTests } from '@/lib/phoneMode';
import type { VideoController } from './VideoPlayer';

const press = (key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { window.dispatchEvent(e); });
  return e;
};

function make(paused = false) {
  const controller = { togglePlay: vi.fn() } as unknown as VideoController & { togglePlay: ReturnType<typeof vi.fn> };
  const onClose = vi.fn();
  const getPosition = vi.fn(async () => ({ position: 43, duration: 150, playing: !paused }));
  const view = render(<PlexTrailerControls active title="Dune" paused={paused} controller={controller} getPosition={getPosition} onClose={onClose} />);
  return { controller, onClose, view };
}

afterEach(() => { cleanup(); __setPhoneModeForTests({ touch: false, phone: false }); });

describe('the trailer\'s remote', () => {
  it('OK pauses and plays; the arrows do nothing; a held OK is not a press', () => {
    const { controller, onClose } = make();
    expect(screen.getByText('OK: pause or play · Back: close')).toBeTruthy();
    press('Enter');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
    press('Enter', { repeat: true });
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) expect(press(k).defaultPrevented).toBe(true);
    // DPAD_CENTER without a key name, as some remotes send OK.
    press('Unidentified', { keyCode: 23 });
    expect(controller.togglePlay).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('paused: a card with the title and the time; Back closes in one step', async () => {
    const { onClose } = make(true);
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText('Dune · Trailer')).toBeTruthy();
    expect(await screen.findByText('0:43 / 2:30')).toBeTruthy();
    expect(screen.getByText('OK to resume · Back to close')).toBeTruthy();
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Back while it plays closes it too', () => {
    const { onClose } = make();
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the media keys to the player', () => {
    const { controller } = make();
    expect(press('MediaPlayPause').defaultPrevented).toBe(false);
    expect(controller.togglePlay).not.toHaveBeenCalled();
  });

  it('nothing while the player is not up', () => {
    const controller = { togglePlay: vi.fn() } as unknown as VideoController;
    const onClose = vi.fn();
    render(<PlexTrailerControls active={false} title="Dune" paused={false} controller={controller} getPosition={async () => ({ position: 0, duration: 0, playing: false })} onClose={onClose} />);
    press('Escape');
    press('Enter');
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[data-plex-trailer-controls]')).toBeNull();
  });

  it('a touch screen: Close and Pause / Play buttons', () => {
    __setPhoneModeForTests({ touch: true, phone: true });
    const { controller, onClose } = make();
    expect(screen.queryByText('OK: pause or play · Back: close')).toBeNull();
    fireEvent.click(screen.getByLabelText('Play/Pause'));
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
