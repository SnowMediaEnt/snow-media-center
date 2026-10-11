/**
 * A trailer played inside SMC (owner, 2026-10-11: "with the fix to play in SMC
 * instead of going out and the pause fix as well"; Tronix 1039497, 06f67c0):
 * the video in the video service's own embed, full screen over the page.
 *  - the embed's address: the privacy-enhanced host, its documented player
 *    parameters (autoplay, controls, no related videos, its player API with
 *    the page's origin); black under the picture, no spinner left under it;
 *  - once the embed answers, the layer subscribes to its state and errors;
 *  - Back closes it, one step, in every state: the page's own listener (added
 *    first, in the capture phase, as the real pages' are) stands aside, the
 *    focus goes back, the frame is gone;
 *  - OK pauses through the embed's player API, under our own opaque Paused
 *    card (the Fire TV's WebView draws nothing for a paused embed); OK resumes,
 *    and when the embed doesn't play again within 1.5 s the frame is rebuilt
 *    at the paused second; that one not playing either: it can't play here;
 *  - the embed says it can't play (embedding turned off) or nothing plays in
 *    8 s: "This trailer can't play here" and "Open outside the app";
 *  - the video's end, or the app going to the background, closes it;
 *  - a touch screen: a Close button; a Kids profile: nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({ state: [] as Array<(s: { isActive: boolean }) => void> }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (ev: string, fn: (s: { isActive: boolean }) => void) => {
      if (ev === 'appStateChange') app.state.push(fn);
      return { remove: async () => { app.state = app.state.filter((f) => f !== fn); } };
    },
  },
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn() }));

import TrailerOverlay, { TRAILER_BUFFERING_EXTRA_MS, TRAILER_RESUME_MS, TRAILER_START_MS } from './TrailerOverlay';
import { TRAILER_EMBED_ORIGINS, __resetTrailerForTests, trailerWebUrl } from '@/lib/trailer';
import { setKidsLevel } from '@/lib/kidsFilter';
import { MEDIA_KEY_EVENT } from '@/lib/mediaKeys';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

const ID = 'Ab3_dE-9xYz';
const EMBED = TRAILER_EMBED_ORIGINS[0];
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const frame = () => document.querySelector<HTMLIFrameElement>('[data-trailer-frame]');
const layer = () => q('[data-trailer-overlay]');
const status = () => layer()?.getAttribute('data-trailer-overlay');
const card = () => q('[data-trailer-paused]');
const press = (key: string, init: KeyboardEventInit = {}) => act(() => { fireEvent.keyDown(window, { key, ...init }); });
const fromEmbed = (data: unknown, origin = EMBED) => act(() => {
  window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), origin, source: frame()!.contentWindow }));
});
const cmd = (func: string, args: unknown[] = []) => JSON.stringify({ event: 'command', func, args });
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const open = vi.fn();

/**
 * A page with a Trailer button that draws the layer while it is up. Its own
 * key listener is on the window in the capture phase and added first, as
 * MoviesSection's and SeriesSection's are, so it hears every key before the
 * layer; like theirs, it stands aside while the layer is up.
 */
function Page({ video = ID, title, onOpenOutside, closed, pageKey }: {
  video?: string; title?: string; onOpenOutside?: () => void; closed?: () => void; pageKey?: (key: string) => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const shownRef = useRef<string | null>(null);
  const pageKeyRef = useRef(pageKey);
  pageKeyRef.current = pageKey;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (shownRef.current) return; pageKeyRef.current?.(e.key); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <>
      <button type="button" data-was-here="" onClick={() => { shownRef.current = video; setShown(video); }}>Trailer</button>
      {shown && (
        <TrailerOverlay
          video={shown}
          title={title}
          onOpenOutside={onOpenOutside}
          onClose={() => { shownRef.current = null; setShown(null); closed?.(); }}
        />
      )}
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
/** The embed's first answer (its length): the layer subscribes to its events. */
const answer = (len = 90) => fromEmbed({ event: 'initialDelivery', info: { duration: len } });
/** Open, the embed loaded, answering and playing at `at` s of `len` s. */
const playing = (at = 43.2, len = 90, title: string | null = 'Night Ferry') => {
  show({ title: title ?? undefined });
  act(() => { fireEvent.load(frame()!); });
  answer(len);
  fromEmbed({ event: 'infoDelivery', info: { playerState: 1, currentTime: at } });
  expect(status()).toBe('playing');
  return vi.spyOn(frame()!.contentWindow!, 'postMessage');
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  __resetTrailerForTests();
  app.state = [];
  open.mockReset();
  vi.stubGlobal('open', open);
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); setKidsLevel(null);
  __setPhoneModeForTests({ touch: false, phone: false });
});

describe('the trailer inside the app', () => {
  it('opens full screen with the embed\'s address and its documented parameters; black under the picture, no spinner under it', () => {
    show();
    expect(layer()).not.toBeNull();
    expect(layer()!.getAttribute('role')).toBe('dialog');
    expect(layer()!.getAttribute('aria-modal')).toBe('true');
    expect(layer()!.getAttribute('aria-label')).toBe('Watch trailer');
    expect(layer()!.className).toContain('bg-black');
    // Over everything, on the page's body (not inside the page or a player).
    expect(layer()!.parentElement).toBe(document.body);
    const src = new URL(frame()!.getAttribute('src')!);
    expect(src.origin).toBe(EMBED);
    expect(src.pathname).toBe(`/embed/${ID}`);
    expect(Object.fromEntries(src.searchParams)).toMatchObject({
      autoplay: '1', controls: '1', rel: '0', playsinline: '1', enablejsapi: '1', origin: window.location.origin,
    });
    expect(src.searchParams.has('start')).toBe(false);
    expect(frame()!.getAttribute('allow')).toContain('autoplay');
    // No pop-ups and no taking the app's page away.
    expect(frame()!.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation');
    expect(frame()!.tabIndex).toBe(-1);
    expect(frame()!.className).toContain('bg-black');
    expect(layer()!.querySelector('.animate-spin')).toBeNull();
    // The remote's hint, on a TV.
    expect(q('[data-trailer-hint]')!.textContent).toBe('OK: pause or play · Back: close');
    expect(open).not.toHaveBeenCalled();
  });

  it('takes a link as well as an id', () => {
    show({ video: `https://www.youtube.com/watch?v=${ID}&t=3` });
    expect(new URL(frame()!.getAttribute('src')!).pathname).toBe(`/embed/${ID}`);
  });

  it('asks for the embed\'s events once it has loaded; at its first answer subscribes to its state and its errors, once', () => {
    show();
    const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
    act(() => { fireEvent.load(frame()!); });
    expect(post).toHaveBeenCalledWith(expect.stringContaining('"event":"listening"'), EMBED);
    expect(post).not.toHaveBeenCalledWith(expect.stringContaining('addEventListener'), EMBED);
    answer();
    expect(post).toHaveBeenCalledWith(cmd('addEventListener', ['onStateChange']), EMBED);
    expect(post).toHaveBeenCalledWith(cmd('addEventListener', ['onError']), EMBED);
    post.mockClear();
    // It answered: no more asking, no second subscription.
    fromEmbed({ event: 'infoDelivery', info: { playerState: 1, currentTime: 1 } });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(post).not.toHaveBeenCalled();
  });

  it('Back closes it, one step: the page under it stands aside, the frame is gone and the focus goes back where it was', () => {
    const closed = vi.fn();
    const pageKey = vi.fn();
    const btn = show({ closed, pageKey });
    expect(document.activeElement).toBe(layer());
    const after = vi.fn();
    window.addEventListener('keydown', after);
    press('Escape');
    window.removeEventListener('keydown', after);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(layer()).toBeNull();
    // Released: no frame left on the page.
    expect(document.querySelector('iframe')).toBeNull();
    // The press stopped at the layer: the page (which heard it first) stood
    // aside, and nothing after the layer saw it.
    expect(pageKey).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(btn);
    // The next Back is the page's again.
    press('Escape');
    expect(pageKey).toHaveBeenCalledWith('Escape');
  });

  it('the remote\'s Back as Android sends it (keyCode 4) closes it too', () => {
    show();
    press('Unidentified', { keyCode: 4 });
    expect(layer()).toBeNull();
  });

  it('the arrows do nothing and never reach the page under it', () => {
    const pageKey = vi.fn();
    show({ pageKey });
    const after = vi.fn();
    window.addEventListener('keydown', after);
    press('ArrowRight'); press('ArrowDown'); press('ArrowUp'); press('ArrowLeft');
    window.removeEventListener('keydown', after);
    expect(pageKey).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(layer()).not.toBeNull();
  });

  it('messages from anywhere but the embed are ignored', () => {
    show();
    answer();
    fromEmbed({ event: 'onError', info: 150 }, 'https://elsewhere.example.test');
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event: 'onError', info: 150 }), origin: EMBED, source: window })); });
    expect(q('[data-trailer-failed]')).toBeNull();
  });

  it('the video\'s end closes it', () => {
    const closed = vi.fn();
    show({ closed });
    answer();
    fromEmbed({ event: 'onStateChange', info: 1 });
    fromEmbed({ event: 'onStateChange', info: 0 });
    expect(layer()).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('the embed can\'t play it (embedding turned off): at once "This trailer can\'t play here", OK opens it outside the app and closes the layer', async () => {
    show();
    act(() => { fireEvent.load(frame()!); });
    answer();
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
    answer();
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
    answer();
    fromEmbed({ event: 'onStateChange', info: 3 });
    await act(async () => { vi.advanceTimersByTime(TRAILER_START_MS + 100); });
    expect(q('[data-trailer-failed]')).toBeNull();
    fromEmbed({ event: 'onStateChange', info: 1 });
    await act(async () => { vi.advanceTimersByTime(TRAILER_BUFFERING_EXTRA_MS + 100); });
    expect(q('[data-trailer-failed]')).toBeNull();
    expect(status()).toBe('playing');
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

describe('paused, on a WebView that draws no paused frame (Tronix 06f67c0)', () => {
  it('OK pauses: our own opaque dark card over the frame, with the title, the tracked time and the keys', () => {
    const post = playing(43.2, 90);
    press('Enter');
    expect(post).toHaveBeenLastCalledWith(cmd('pauseVideo'), EMBED);
    expect(status()).toBe('paused');
    const c = card()!;
    expect(c.getAttribute('data-trailer-paused')).toBe('paused');
    expect(c.className).toContain('bg-black');
    expect(c.textContent).toContain('Paused');
    expect(q('[data-trailer-title]')!.textContent).toBe('Night Ferry');
    expect(q('[data-trailer-time]')!.textContent).toBe('0:43 / 1:30');
    expect(q('[data-trailer-time]')!.getAttribute('dir')).toBe('ltr');
    expect(c.textContent).toContain('OK to resume · Back to close');
    // The hint gives way to the card; the frame stays (a pause reloads nothing).
    expect(q('[data-trailer-hint]')).toBeNull();
    expect(frame()).not.toBeNull();
    // The embed's own last word on where it stopped wins.
    fromEmbed({ event: 'infoDelivery', info: { currentTime: 44.9 } });
    expect(q('[data-trailer-time]')!.textContent).toBe('0:44 / 1:30');
  });

  it('the time goes on between the embed\'s reports (at most 2 s guessed); no length known: the time alone; no title: none', async () => {
    const post = playing(10, 0, null);
    await act(async () => { vi.advanceTimersByTime(1000); });
    press('Enter');
    expect(post).toHaveBeenLastCalledWith(cmd('pauseVideo'), EMBED);
    expect(q('[data-trailer-time]')!.textContent).toBe('0:11');
    expect(q('[data-trailer-title]')).toBeNull();
    cleanup();
    playing(10, 90);
    await act(async () => { vi.advanceTimersByTime(30000); });
    press('Enter');
    expect(q('[data-trailer-time]')!.textContent).toBe('0:12 / 1:30');
  });

  it('OK resumes: play is sent; "playing" in time, the card goes and the frame is the same one; a held OK is not a press', async () => {
    const post = playing();
    press('Enter');
    const before = frame();
    const src = before!.getAttribute('src');
    post.mockClear();
    press('Enter', { repeat: true });
    expect(post).not.toHaveBeenCalled();
    press('Enter');
    expect(post).toHaveBeenLastCalledWith(cmd('playVideo'), EMBED);
    expect(status()).toBe('resuming');
    // Still covered while it starts again (a spinner on the card).
    expect(card()!.getAttribute('data-trailer-paused')).toBe('resuming');
    expect(card()!.querySelector('.animate-spin')).not.toBeNull();
    // OK again while it resumes: nothing more.
    post.mockClear();
    press('Enter');
    expect(post).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(TRAILER_RESUME_MS - 300); });
    fromEmbed({ event: 'onStateChange', info: 1 });
    expect(status()).toBe('playing');
    expect(card()).toBeNull();
    await act(async () => { vi.advanceTimersByTime(TRAILER_START_MS * 2); });
    expect(frame()).toBe(before);
    expect(frame()!.getAttribute('src')).toBe(src);
    expect(status()).toBe('playing');
  });

  it('no "playing" within 1.5 s of play: the frame is rebuilt at the paused second (start + autoplay), asked again for its events, once', async () => {
    const post = playing(43.6, 90);
    press('Enter');
    const before = frame();
    const firstSrc = new URL(before!.getAttribute('src')!);
    press('Enter');
    expect(post).toHaveBeenLastCalledWith(cmd('playVideo'), EMBED);
    // The paused embed answers "paused" again: the rebuild still decides.
    fromEmbed({ event: 'onStateChange', info: 2 });
    await act(async () => { vi.advanceTimersByTime(TRAILER_RESUME_MS - 100); });
    expect(frame()).toBe(before);
    await act(async () => { vi.advanceTimersByTime(200); });
    const after = frame()!;
    expect(after).not.toBe(before);
    const src = new URL(after.getAttribute('src')!);
    expect(src.origin).toBe(EMBED);
    expect(src.pathname).toBe(`/embed/${ID}`);
    expect(Object.fromEntries(src.searchParams)).toMatchObject({ start: '43', autoplay: '1', enablejsapi: '1', origin: window.location.origin });
    // Everything else as the first address.
    src.searchParams.delete('start');
    expect(src.toString()).toBe(firstSrc.toString());
    expect(document.querySelectorAll('[data-trailer-frame]')).toHaveLength(1);
    // Covered until the new frame plays.
    expect(card()!.getAttribute('data-trailer-paused')).toBe('resuming');
    // The new frame is asked for its events, subscribed at its first answer, and plays.
    const post2 = vi.spyOn(after.contentWindow!, 'postMessage');
    act(() => { fireEvent.load(after); });
    expect(post2).toHaveBeenCalledWith(expect.stringContaining('"event":"listening"'), EMBED);
    fromEmbed({ event: 'infoDelivery', info: { playerState: 1, currentTime: 43 } });
    expect(post2).toHaveBeenCalledWith(cmd('addEventListener', ['onStateChange']), EMBED);
    expect(post2).toHaveBeenCalledWith(cmd('addEventListener', ['onError']), EMBED);
    expect(status()).toBe('playing');
    expect(card()).toBeNull();
    await act(async () => { vi.advanceTimersByTime(TRAILER_START_MS * 2); });
    expect(frame()).toBe(after);
    // A second pause and resume that works: no rebuild. (Its last report was
    // 43 s, 16 s ago: at most 2 s are guessed past it.)
    press('Enter');
    expect(q('[data-trailer-time]')!.textContent).toBe('0:45 / 1:30');
    press('Enter');
    fromEmbed({ event: 'onStateChange', info: 1 });
    await act(async () => { vi.advanceTimersByTime(TRAILER_RESUME_MS * 2); });
    expect(frame()).toBe(after);
  });

  it('the rebuilt frame doesn\'t play either: "This trailer can\'t play here"', async () => {
    playing();
    press('Enter'); press('Enter');
    await act(async () => { vi.advanceTimersByTime(TRAILER_RESUME_MS + 100); });
    expect(status()).toBe('resuming');
    await act(async () => { vi.advanceTimersByTime(TRAILER_START_MS + 100); });
    expect(q('[data-trailer-failed]')).not.toBeNull();
  });

  it('paused: a late "playing" from the embed doesn\'t play under the card (paused again)', () => {
    const post = playing();
    press('Enter');
    post.mockClear();
    fromEmbed({ event: 'infoDelivery', info: { playerState: 1 } });
    expect(status()).toBe('paused');
    expect(card()).not.toBeNull();
    expect(post).toHaveBeenLastCalledWith(cmd('pauseVideo'), EMBED);
  });

  it('the embed pauses itself: the same card', () => {
    playing(61, 125);
    fromEmbed({ event: 'onStateChange', info: 2 });
    expect(status()).toBe('paused');
    expect(q('[data-trailer-time]')!.textContent).toBe('1:01 / 2:05');
  });

  it('the remote\'s Play/Pause does what OK does (its key, and the native side\'s media key); Play and Pause alone too', () => {
    const post = playing();
    press('MediaPlayPause');
    expect(post).toHaveBeenLastCalledWith(cmd('pauseVideo'), EMBED);
    expect(card()).not.toBeNull();
    press('MediaPlayPause');
    expect(post).toHaveBeenLastCalledWith(cmd('playVideo'), EMBED);
    expect(status()).toBe('resuming');
    fromEmbed({ event: 'onStateChange', info: 1 });
    post.mockClear();
    act(() => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: 'playpause' })); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenLastCalledWith(cmd('pauseVideo'), EMBED);
    expect(status()).toBe('paused');
    act(() => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: 'playpause' })); });
    expect(post).toHaveBeenLastCalledWith(cmd('playVideo'), EMBED);
    fromEmbed({ event: 'onStateChange', info: 1 });
    // Pause alone, then Play alone; Pause while paused and Play while playing send nothing.
    press('MediaPause');
    expect(status()).toBe('paused');
    post.mockClear();
    press('MediaPause');
    expect(post).not.toHaveBeenCalled();
    press('MediaPlay');
    expect(post).toHaveBeenLastCalledWith(cmd('playVideo'), EMBED);
    fromEmbed({ event: 'onStateChange', info: 1 });
    post.mockClear();
    press('MediaPlay');
    expect(post).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: 'pause' })); });
    expect(post).toHaveBeenLastCalledWith(cmd('pauseVideo'), EMBED);
  });

  for (const state of ['loading', 'playing', 'paused', 'resuming', 'rebuilt'] as const) {
    it(`Back closes it in one step (${state}), and nothing under it moves`, async () => {
      const pageKey = vi.fn();
      const btn = show({ title: 'Night Ferry', pageKey });
      if (state !== 'loading') { answer(); fromEmbed({ event: 'infoDelivery', info: { playerState: 1, currentTime: 5 } }); }
      if (state === 'paused' || state === 'resuming' || state === 'rebuilt') press('Enter');
      if (state === 'resuming' || state === 'rebuilt') press('Enter');
      if (state === 'rebuilt') await act(async () => { vi.advanceTimersByTime(TRAILER_RESUME_MS + 100); });
      expect(status()).toBe(state === 'rebuilt' ? 'resuming' : state);
      const after = vi.fn();
      window.addEventListener('keydown', after);
      press('Escape');
      window.removeEventListener('keydown', after);
      expect(layer()).toBeNull();
      expect(pageKey).not.toHaveBeenCalled();
      expect(after).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(btn);
      // No timer left behind does anything after it closed.
      await act(async () => { vi.advanceTimersByTime(TRAILER_START_MS * 3); });
      expect(layer()).toBeNull();
    });
  }
});

describe('the app going to the background', () => {
  it('Home (the app no longer active) closes it, once; coming back leaves it closed', async () => {
    const closed = vi.fn();
    show({ closed });
    await flush();
    expect(app.state.length).toBeGreaterThan(0);
    act(() => { app.state.forEach((f) => f({ isActive: true })); });
    expect(layer()).not.toBeNull();
    act(() => { app.state.forEach((f) => f({ isActive: false })); });
    expect(layer()).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
    // Its listener went with it.
    await flush();
    expect(app.state).toHaveLength(0);
  });

  it('the page hidden (visibilitychange) closes it too', () => {
    const closed = vi.fn();
    show({ closed });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    } finally {
      delete (document as unknown as { hidden?: boolean }).hidden;
    }
    expect(document.hidden).toBe(false);
    expect(layer()).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
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

  it('paused with the embed\'s own controls: no card over them, and its play button plays', () => {
    playing();
    fromEmbed({ event: 'onStateChange', info: 2 });
    expect(status()).toBe('paused');
    expect(card()).toBeNull();
    fromEmbed({ event: 'onStateChange', info: 1 });
    expect(status()).toBe('playing');
  });

  it('when it can\'t play: "Open outside the app" and Close as buttons', () => {
    show();
    answer();
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
