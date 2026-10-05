// Fingers on a full-screen player (phones and tablets only).
//
// The players are built for the remote: OK brings the control bar up, ◀ ▶
// walk its buttons, OK presses one. On a touch screen the same things happen
// by finger:
//   - a tap on the picture toggles the bar (each player decides what that
//     means for it), a vertical swipe on it is ▲ / ▼ where the player has a
//     use for them (channels, the next video);
//   - a tap on a bar button or a menu row does what OK does on it (the
//     players pass their onClick handlers only on a touch screen);
//   - a finger on a bar's track (seek, volume) moves along it.
//
// A TV box never gets any of it: usePictureTouch installs no listener and
// useTrackTouch hands out no handler unless useTouchUI() is true, and the
// bars spread touchChrome() (an empty object on a TV). On a box, Enter on a
// DOM-focused <button> fires a click, so a click handler there would act
// twice; none is attached.
import { useEffect, useMemo, useRef, type RefObject, type TouchEvent as ReactTouchEvent } from 'react';
import { useTouchUI } from '@/lib/phoneMode';

/** A finger that moves less than this (CSS px) either way is a tap. */
export const TAP_SLOP_PX = 12;
/** Held longer than this, a finger that did not move is not a tap. */
export const TAP_MAX_MS = 600;
/** A vertical swipe goes at least this far (CSS px)… */
export const SWIPE_MIN_PX = 48;
/** …within this long. */
export const SWIPE_MAX_MS = 1000;

export type PictureGesture = 'tap' | 'up' | 'down' | null;

/**
 * What a finger did between touching the screen and leaving it: a tap, a
 * swipe up or down (mostly vertical), or nothing worth acting on (a slow
 * hold, a sideways or diagonal drag). Pure, for tests.
 */
export function classifyGesture(dx: number, dy: number, ms: number): PictureGesture {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax <= TAP_SLOP_PX && ay <= TAP_SLOP_PX) return ms <= TAP_MAX_MS ? 'tap' : null;
  if (ms <= SWIPE_MAX_MS && ay >= SWIPE_MIN_PX && ay >= 1.5 * ax) return dy < 0 ? 'up' : 'down';
  return null;
}

/** Marks a bar or popup menu: a finger there is not a tap on the picture. */
export const TOUCH_CHROME_ATTR = 'data-touch-chrome';
/** Spread on a bar or menu box: the marker on a touch screen, nothing on a TV. */
export const touchChrome = (on: boolean): Record<string, string> => (on ? { [TOUCH_CHROME_ATTR]: '' } : {});

/** Things that answer a tap themselves (their own click), and dialogs over the player. */
const OWN_TAP = 'button, a[href], input, select, textarea, [role="button"], [role="dialog"], [role="alertdialog"]';

export interface PictureTouchOptions {
  /** The player's root (a ref, or a selector): only a finger inside it counts. */
  within: RefObject<Element | null> | string;
  /** False while something else has the screen (a dialog, an error card). */
  enabled?: boolean;
  /** A tap on the picture. */
  onTap?: () => void;
  /** A vertical swipe on the picture; 'up' = the finger went up. */
  onSwipe?: (dir: 'up' | 'down') => void;
  /** A finger on a bar or menu (not on a button): activity, like a key. */
  onChrome?: () => void;
}

/**
 * Taps and vertical swipes on a full-screen player's picture. Window
 * listeners, like the players' own keydown listeners, and only on a touch
 * screen. A tap's touchend is cancelled so the browser's click that follows
 * does not land on the button the tap just brought up under the finger.
 */
export function usePictureTouch(opts: PictureTouchOptions): void {
  const touch = useTouchUI();
  const on = touch && opts.enabled !== false;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!on) return;
    let start: { id: number; x: number; y: number; at: number } | null = null;
    const inside = (el: Element): boolean => {
      const w = optsRef.current.within;
      if (typeof w === 'string') return !!el.closest(w);
      return !!w.current && w.current.contains(el);
    };
    const onStart = (e: TouchEvent) => {
      start = null;
      // A second finger: neither a tap nor a swipe (a pinch, a fumble).
      if (e.touches.length !== 1) return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el || !inside(el) || el.closest(OWN_TAP)) return;
      if (el.closest(`[${TOUCH_CHROME_ATTR}]`)) { optsRef.current.onChrome?.(); return; }
      const t = e.changedTouches[0];
      if (!t) return;
      start = { id: t.identifier, x: t.clientX, y: t.clientY, at: Date.now() };
    };
    const onEnd = (e: TouchEvent) => {
      const s = start;
      start = null;
      if (!s) return;
      const t = Array.from(e.changedTouches).find((c) => c.identifier === s.id);
      if (!t) return;
      const g = classifyGesture(t.clientX - s.x, t.clientY - s.y, Date.now() - s.at);
      if (g === 'tap') {
        if (e.cancelable) e.preventDefault();
        optsRef.current.onTap?.();
      } else if (g) {
        optsRef.current.onSwipe?.(g);
      }
    };
    const onCancel = () => { start = null; };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: false });
    window.addEventListener('touchcancel', onCancel);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
    };
  }, [on]);
}

export type DragPhase = 'move' | 'end' | 'cancel';

export interface TrackTouchProps {
  onTouchStart?: (e: ReactTouchEvent<HTMLElement>) => void;
  onTouchMove?: (e: ReactTouchEvent<HTMLElement>) => void;
  onTouchEnd?: (e: ReactTouchEvent<HTMLElement>) => void;
  onTouchCancel?: (e: ReactTouchEvent<HTMLElement>) => void;
}

/**
 * A finger on a bar's track (seek bar, volume): where along it (0..1) as it
 * lands and moves ('move'), and where it lifts ('end'); 'cancel' when the
 * system takes the touch away. Spread the result on the track, or on a bigger
 * box around it and pass the drawn track as `track` (fractions are measured
 * on that). No handlers on a TV or without `onDrag`.
 */
export function useTrackTouch(
  onDrag: ((fraction: number, phase: DragPhase) => void) | undefined,
  track?: RefObject<HTMLElement | null>,
): TrackTouchProps {
  const touch = useTouchUI();
  const on = touch && !!onDrag;
  const dragRef = useRef(onDrag);
  dragRef.current = onDrag;
  const lastRef = useRef<number | null>(null);

  return useMemo<TrackTouchProps>(() => {
    if (!on) return {};
    const fractionAt = (e: ReactTouchEvent<HTMLElement>): number | null => {
      const t = e.changedTouches[0];
      if (!t) return null;
      const el = track?.current ?? e.currentTarget;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0)) return null;
      return Math.min(1, Math.max(0, (t.clientX - r.left) / r.width));
    };
    return {
      onTouchStart: (e) => {
        // A second finger mid-drag ends it as a cancel, so the bar puts its
        // preview marker and highlight back instead of being left mid-seek.
        const was = lastRef.current;
        lastRef.current = null;
        if (e.touches.length !== 1) {
          if (was != null) dragRef.current?.(was, 'cancel');
          return;
        }
        const f = fractionAt(e);
        if (f == null) return;
        lastRef.current = f;
        dragRef.current?.(f, 'move');
      },
      onTouchMove: (e) => {
        if (lastRef.current == null) return;
        const f = fractionAt(e);
        if (f == null) return;
        lastRef.current = f;
        dragRef.current?.(f, 'move');
      },
      onTouchEnd: (e) => {
        if (lastRef.current == null) return;
        const f = fractionAt(e) ?? lastRef.current;
        lastRef.current = null;
        // No click after it on whatever is under the finger.
        if (e.cancelable) e.preventDefault();
        dragRef.current?.(f, 'end');
      },
      onTouchCancel: () => {
        const f = lastRef.current;
        lastRef.current = null;
        if (f != null) dragRef.current?.(f, 'cancel');
      },
    };
  }, [on, track]);
}
