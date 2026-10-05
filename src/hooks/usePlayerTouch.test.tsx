/**
 * Fingers on a full-screen player (usePlayerTouch): what counts as a tap or a
 * swipe, that a tap on a button or a bar is not a tap on the picture, and
 * that nothing at all is listened to on a TV.
 */
import { cleanup, render, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setPhoneModeForTests } from '@/lib/phoneMode';
import { classifyGesture, touchChrome, usePictureTouch, useTrackTouch, type DragPhase } from './usePlayerTouch';

const at = (x: number, y: number) => [{ identifier: 0, clientX: x, clientY: y }];
/** A finger down at (x, y) and up at (x2, y2), on `el`. */
function swipe(el: Element, x: number, y: number, x2 = x, y2 = y) {
  fireEvent.touchStart(el, { touches: at(x, y), changedTouches: at(x, y) });
  return fireEvent.touchEnd(el, { touches: [], changedTouches: at(x2, y2) });
}

function Picture(props: { onTap: () => void; onSwipe: (d: 'up' | 'down') => void; onChrome: () => void; enabled?: boolean }) {
  const root = useRef<HTMLDivElement | null>(null);
  usePictureTouch({ within: root, ...props });
  return (
    <div>
      <div ref={root} data-testid="root">
        <div data-testid="picture" />
        <div data-testid="bar" {...touchChrome(true)}>
          <button type="button" data-testid="btn">Play</button>
          <span data-testid="title">Title</span>
        </div>
      </div>
      <div data-testid="outside" />
    </div>
  );
}

const setup = (enabled?: boolean) => {
  const h = { onTap: vi.fn(), onSwipe: vi.fn(), onChrome: vi.fn() };
  const r = render(<Picture {...h} enabled={enabled} />);
  return { ...h, ...r };
};

afterEach(() => { cleanup(); __setPhoneModeForTests({ touch: false, phone: false }); });

describe('classifyGesture', () => {
  it('a finger that barely moves, quickly, is a tap', () => {
    expect(classifyGesture(0, 0, 100)).toBe('tap');
    expect(classifyGesture(8, -10, 300)).toBe('tap');
  });
  it('a long hold that did not move is nothing', () => {
    expect(classifyGesture(2, 2, 2000)).toBeNull();
  });
  it('a mostly vertical move far enough is a swipe up or down', () => {
    expect(classifyGesture(5, -80, 250)).toBe('up');
    expect(classifyGesture(-10, 120, 300)).toBe('down');
  });
  it('a short drag, a sideways or diagonal one, or a slow one is nothing', () => {
    expect(classifyGesture(0, 30, 200)).toBeNull();
    expect(classifyGesture(120, 20, 200)).toBeNull();
    expect(classifyGesture(70, 80, 200)).toBeNull();
    expect(classifyGesture(0, 200, 3000)).toBeNull();
  });
});

describe('usePictureTouch on a touch screen', () => {
  it('a tap on the picture is a tap, and its click is cancelled', () => {
    __setPhoneModeForTests({ touch: true, phone: true });
    const { onTap, onSwipe, getByTestId } = setup();
    const notCancelled = swipe(getByTestId('picture'), 100, 100, 102, 101);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(notCancelled).toBe(false); // preventDefault: no click on what the tap brought up
  });

  it('a vertical swipe is a swipe, up or down', () => {
    __setPhoneModeForTests({ touch: true, phone: true });
    const { onTap, onSwipe, getByTestId } = setup();
    swipe(getByTestId('picture'), 100, 300, 105, 150);
    swipe(getByTestId('picture'), 100, 100, 95, 260);
    expect(onSwipe.mock.calls).toEqual([['up'], ['down']]);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('a button answers its own tap: not a tap on the picture', () => {
    __setPhoneModeForTests({ touch: true, phone: true });
    const { onTap, onChrome, getByTestId } = setup();
    swipe(getByTestId('btn'), 10, 10);
    expect(onTap).not.toHaveBeenCalled();
    expect(onChrome).not.toHaveBeenCalled();
  });

  it('a finger on the bar (not a button) is activity, not a tap', () => {
    __setPhoneModeForTests({ touch: true, phone: true });
    const { onTap, onChrome, getByTestId } = setup();
    swipe(getByTestId('title'), 10, 10);
    expect(onChrome).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('outside the player, or while disabled, nothing', () => {
    __setPhoneModeForTests({ touch: true, phone: true });
    const a = setup();
    swipe(a.getByTestId('outside'), 10, 10);
    expect(a.onTap).not.toHaveBeenCalled();
    a.unmount();
    const b = setup(false);
    swipe(b.getByTestId('picture'), 10, 10);
    expect(b.onTap).not.toHaveBeenCalled();
  });

  it('a second finger cancels the gesture', () => {
    __setPhoneModeForTests({ touch: true, phone: true });
    const { onTap, getByTestId } = setup();
    const el = getByTestId('picture');
    fireEvent.touchStart(el, { touches: [...at(10, 10), { identifier: 1, clientX: 50, clientY: 50 }], changedTouches: at(50, 50) });
    fireEvent.touchEnd(el, { touches: [], changedTouches: at(10, 10) });
    expect(onTap).not.toHaveBeenCalled();
  });
});

describe('usePictureTouch on a TV', () => {
  it('listens to nothing', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { onTap, onSwipe, getByTestId } = setup();
    swipe(getByTestId('picture'), 100, 100);
    swipe(getByTestId('picture'), 100, 300, 100, 100);
    expect(onTap).not.toHaveBeenCalled();
    expect(onSwipe).not.toHaveBeenCalled();
    expect(add.mock.calls.map((c) => c[0]).filter((t) => String(t).startsWith('touch'))).toEqual([]);
    add.mockRestore();
  });
});

function Track({ onDrag }: { onDrag?: (f: number, p: DragPhase) => void }) {
  const props = useTrackTouch(onDrag);
  return <div data-testid="track" {...props} />;
}

describe('useTrackTouch', () => {
  const rect = (el: Element) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 200, top: 0, height: 10, right: 300, bottom: 10, x: 100, y: 0, toJSON: () => ({}) });

  it('reports where along the track the finger is, then where it lifts', () => {
    __setPhoneModeForTests({ touch: true, phone: true });
    const onDrag = vi.fn();
    const { getByTestId } = render(<Track onDrag={onDrag} />);
    const el = getByTestId('track');
    rect(el);
    fireEvent.touchStart(el, { touches: at(150, 5), changedTouches: at(150, 5) });
    fireEvent.touchMove(el, { touches: at(250, 5), changedTouches: at(250, 5) });
    fireEvent.touchEnd(el, { touches: [], changedTouches: at(400, 5) });
    expect(onDrag.mock.calls).toEqual([[0.25, 'move'], [0.75, 'move'], [1, 'end']]);
  });

  it('a TV gets no handlers', () => {
    const onDrag = vi.fn();
    const { getByTestId } = render(<Track onDrag={onDrag} />);
    const el = getByTestId('track');
    rect(el);
    fireEvent.touchStart(el, { touches: at(150, 5), changedTouches: at(150, 5) });
    fireEvent.touchEnd(el, { touches: [], changedTouches: at(150, 5) });
    expect(onDrag).not.toHaveBeenCalled();
  });
});
