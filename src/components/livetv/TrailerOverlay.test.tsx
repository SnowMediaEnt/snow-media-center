/**
 * A trailer played inside SMC (owner, 2026-10-11: "with the fix to play in SMC
 * instead of going out and the pause fix as well"; Tronix 1039497): the
 * video in the video service's own embed, full screen over the page.
 *  - the embed's address: the privacy-enhanced host, its documented player
 *    parameters (autoplay, controls, no related videos, its player API with
 *    the page's origin);
 *  - Back closes it, one step, the focus back where it was, the frame gone;
 *    OK pauses and plays through the embed's player API; the video's end
 *    closes it;
 *  - the embed says it can't play (embedding turned off) or nothing plays in
 *    8 s: "This trailer can't play here" and "Open outside the app";
 *  - a touch screen: a Close button;
 *  - a Kids profile: nothing.
 */
import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn() }));

import TrailerOverlay, { TRAILER_BUFFERING_EXTRA_MS, TRAILER_START_MS } from './TrailerOverlay';
import { TRAILER_EMBED_ORIGINS, __resetTrailerForTests, trailerWebUrl } from '@/lib/trailer';
import { setKidsLevel } from '@/lib/kidsFilter';
import { MEDIA_KEY_EVENT } from '@/lib/mediaKeys';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

const ID = 'Ab3_dE-9xYz';
const EMBED = TRAILER_EMBED_ORIGINS[0];
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const frame = () => document.querySelector<HTMLIFrameElement>('[data-trailer-frame]');
const layer = () => q('[data-trailer-overlay]');
const press = (key: string, init: KeyboardEventInit = {}) => act(() => { fireEvent.keyDown(window, { key, ...init }); });
const fromEmbed = (data: unknown, origin = EMBED) => act(() => {
  window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), origin, source: frame()!.contentWindow }));
});
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const open = vi.fn();

/** A page with a Trailer button that draws the layer while it is up. */
function Page({ video = ID, onOpenOutside, closed }: { video?: string; onOpenOutside?: () => void; closed?: () => void }) {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <>
      <button type="button" data-was-here="" onClick={() => setShown(video)}>Trailer</button>
      {shown && <TrailerOverlay video={shown} onOpenOutside={onOpenOutside} onClose={() => { setShown(null); closed?.(); }} />}
    </>
  );
}
const show = (props: Parameters<typeof Page>[0] = {}) => {
  render(<Page {...props} />);
  const btn = q('[data-was-here]')!;
  act(() => { btn.focus(); });
  act(() => { fireEvent.click(btn); });
  return btn;
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  __resetTrailerForTests();
  open.mockReset();
  vi.stubGlobal('open', open);
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); setKidsLevel(null);
  __setPhoneModeForTests({ touch: false, phone: false });
});

describe('the trailer inside the app', () => {
  it('opens full screen with the embed\'s address and its documented parameters', () => {
    show();
    expect(layer()).not.toBeNull();
    expect(layer()!.getAttribute('role')).toBe('dialog');
    expect(layer()!.getAttribute('aria-modal')).toBe('true');
    expect(layer()!.getAttribute('aria-label')).toBe('Watch trailer');
    // Over everything, on the page's body (not inside the page or a player).
    expect(layer()!.parentElement).toBe(document.body);
    const src = new URL(frame()!.getAttribute('src')!);
    expect(src.origin).toBe(EMBED);
    expect(src.pathname).toBe(`/embed/${ID}`);
    expect(Object.fromEntries(src.searchParams)).toMatchObject({
      autoplay: '1', controls: '1', rel: '0', playsinline: '1', enablejsapi: '1', origin: window.location.origin,
    });
    expect(frame()!.getAttribute('allow')).toContain('autoplay');
    // No pop-ups and no taking the app's page away.
    expect(frame()!.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation');
    expect(frame()!.tabIndex).toBe(-1);
    // The remote's hint, on a TV.
    expect(q('[data-trailer-hint]')!.textContent).toBe('OK: pause or play · Back: close');
    expect(open).not.toHaveBeenCalled();
  });

  it('takes a link as well as an id', () => {
    show({ video: `https://www.youtube.com/watch?v=${ID}&t=3` });
    expect(new URL(frame()!.getAttribute('src')!).pathname).toBe(`/embed/${ID}`);
  });

  it('Back closes it, one step: the frame is gone and the focus goes back where it was', () => {
    const closed = vi.fn();
    const btn = show({ closed });
    expect(document.activeElement).toBe(layer());
    const below = vi.fn();
    window.addEventListener('keydown', below);
    press('Escape');
    window.removeEventListener('keydown', below);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(layer()).toBeNull();
    // Released: no frame left on the page.
    expect(document.querySelector('iframe')).toBeNull();
    // The press stopped at the layer: nothing under it took a second step.
    expect(below).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(btn);
  });

  it('the remote\'s Back as Android sends it (keyCode 4) closes it too', () => {
    show();
    press('Unidentified', { keyCode: 4 });
    expect(layer()).toBeNull();
  });

  it('the arrows do nothing and never reach the page under it', () => {
    show();
    const below = vi.fn();
    window.addEventListener('keydown', below);
    press('ArrowRight'); press('ArrowDown'); press('ArrowUp'); press('ArrowLeft');
    window.removeEventListener('keydown', below);
    expect(below).not.toHaveBeenCalled();
    expect(layer()).not.toBeNull();
  });

  it('OK (and the remote\'s Play/Pause) pauses and plays it through the embed\'s player API', () => {
    show();
    const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
    // Loaded: it asks for the embed's events.
    act(() => { fireEvent.load(frame()!); });
    expect(post).toHaveBeenCalledWith(expect.stringContaining('"event":"listening"'), EMBED);
    fromEmbed({ event: 'onReady' });
    fromEmbed({ event: 'infoDelivery', info: { playerState: 1 } });
    expect(layer()!.getAttribute('data-trailer-overlay')).toBe('playing');
    post.mockClear();
    press('Enter');
    expect(post).toHaveBeenLastCalledWith(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), EMBED);
    expect(layer()!.getAttribute('data-trailer-overlay')).toBe('paused');
    expect(q('[data-trailer-paused]')).not.toBeNull();
    press('Enter');
    expect(post).toHaveBeenLastCalledWith(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), EMBED);
    // A held OK is not another press.
    post.mockClear();
    press('Enter', { repeat: true });
    expect(post).not.toHaveBeenCalled();
    // The remote's Play/Pause, as the native side raises it.
    fromEmbed({ event: 'onStateChange', info: 1 });
    act(() => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: 'playpause' })); });
    expect(post).toHaveBeenLastCalledWith(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), EMBED);
    expect(post).toHaveBeenCalledTimes(1);
    // ... and as a key, where the WebView passes it on.
    press('MediaPlayPause');
    expect(post).toHaveBeenLastCalledWith(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), EMBED);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('messages from anywhere but the embed are ignored', () => {
    show();
    fromEmbed({ event: 'onError', info: 150 }, 'https://elsewhere.example.test');
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event: 'onError', info: 150 }), origin: EMBED, source: window })); });
    expect(q('[data-trailer-failed]')).toBeNull();
  });

  it('the video\'s end closes it', () => {
    const closed = vi.fn();
    show({ closed });
    fromEmbed({ event: 'onStateChange', info: 1 });
    fromEmbed({ event: 'onStateChange', info: 0 });
    expect(layer()).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('the embed can\'t play it (embedding turned off): "This trailer can\'t play here", OK opens it outside the app and closes the layer', async () => {
    show();
    fromEmbed({ event: 'onError', info: 150 });
    expect(q('[data-trailer-failed]')!.textContent).toContain("This trailer can't play here.");
    expect(frame()).toBeNull();
    const outside = q('[data-trailer-outside]')!;
    expect(outside.textContent).toContain('Open outside the app');
    expect(outside.getAttribute('data-focused')).toBe('true');
    expect(q('[data-trailer-failed]')!.textContent).toContain('Back closes this.');
    press('Enter');
    await flush();
    // The web build's way out (AppManager.openUrl): the watch page in a new tab.
    expect(open).toHaveBeenCalledWith(trailerWebUrl({ kind: 'video', id: ID }), '_blank', 'noopener,noreferrer');
    expect(layer()).toBeNull();
  });

  it('the page\'s own "Open outside the app" when it gives one', () => {
    const onOpenOutside = vi.fn();
    show({ onOpenOutside });
    fromEmbed({ event: 'onError', info: 101 });
    press('Enter');
    expect(onOpenOutside).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(layer()).toBeNull();
  });

  it('nothing plays within 8 s (offline, a blocked embed): the same fallback; Back still just closes it', async () => {
    show();
    await act(async () => { vi.advanceTimersByTime(TRAILER_START_MS - 100); });
    expect(q('[data-trailer-failed]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(q('[data-trailer-failed]')).not.toBeNull();
    press('Escape');
    expect(layer()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('still loading at 8 s (the embed says it is buffering): a little longer before it gives up; playing by then, it stays', async () => {
    show();
    fromEmbed({ event: 'onStateChange', info: 3 });
    await act(async () => { vi.advanceTimersByTime(TRAILER_START_MS + 100); });
    expect(q('[data-trailer-failed]')).toBeNull();
    fromEmbed({ event: 'onStateChange', info: 1 });
    await act(async () => { vi.advanceTimersByTime(TRAILER_BUFFERING_EXTRA_MS + 100); });
    expect(q('[data-trailer-failed]')).toBeNull();
    expect(layer()!.getAttribute('data-trailer-overlay')).toBe('playing');
  });

  it('not a video it knows: straight to the fallback, with nothing to open outside unless the page gives a way', () => {
    show({ video: 'https://videos.example.test/clip.mp4' });
    expect(frame()).toBeNull();
    expect(q('[data-trailer-failed]')).not.toBeNull();
    expect(q('[data-trailer-outside]')).toBeNull();
    press('Enter');
    expect(layer()).not.toBeNull();
    press('Escape');
    expect(layer()).toBeNull();
  });
});

describe('a touch screen', () => {
  beforeEach(() => { __setPhoneModeForTests({ touch: true, phone: true, portrait: true }); });

  it('a Close button (no remote hint) closes it', () => {
    show();
    expect(q('[data-trailer-hint]')).toBeNull();
    const x = q('[data-trailer-close]')!;
    expect(x.getAttribute('aria-label')).toBe('Close');
    act(() => { fireEvent.click(x); });
    expect(layer()).toBeNull();
  });

  it('when it can\'t play: "Open outside the app" and Close as buttons', () => {
    show();
    fromEmbed({ event: 'onError', info: 150 });
    const buttons = Array.from(document.querySelectorAll('[data-trailer-failed] button')).map((b) => b.textContent);
    expect(buttons).toEqual(['Open outside the app', 'Close']);
    act(() => { fireEvent.click(document.querySelectorAll<HTMLElement>('[data-trailer-failed] button')[1]); });
    expect(layer()).toBeNull();
  });
});

describe('a Kids profile', () => {
  it('nothing is drawn, and the page is told it closed', () => {
    setKidsLevel('kids');
    const closed = vi.fn();
    show({ closed });
    expect(layer()).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
