// Phones and touch screens. SMC is built for the remote, but some customers
// open it on an Android phone or tablet. ONE answer for the whole app, worked
// out at boot and kept on <html> as two classes, so CSS and code agree:
//
//   is-touch  a touch screen that is not a TV: fingers scroll the lists, a
//             tap does what OK does. Phones and tablets.
//   is-phone  a phone-sized touch screen (shorter side under 520 CSS px).
//
// TV boxes never get either, so every rule and branch keyed on them leaves
// the TV exactly as it was. A TV is what its user agent says (AFTxx, Android
// TV, BRAVIA, "TV"…). Touch needs a finger as the PRIMARY pointer (CSS
// `pointer: coarse`): a box driven by a remote reports none, an air mouse
// reports fine. A phone (its UA says "Mobile") is touch from the first frame;
// any other touch screen (a tablet, or a box whose firmware reports a virtual
// touch input) only once a finger is actually used, and a remote key first
// means a remote-driven box that is never switched.
//
// Ported from Tronix (src/lib/phoneMode.ts there).
import { useSyncExternalStore } from 'react';

/** A phone's shorter side is under this (CSS px); a TV layout is 540+. */
export const PHONE_MAX_SHORT_SIDE = 520;

/** The user agent names a TV (Fire TV, Android TV, Google TV, BRAVIA, "TV"). */
export const isTvUserAgent = (ua: string): boolean =>
  /Android TV|GoogleTV|Google TV|BRAVIA|SmartTV|\bAFT[A-Z0-9]+\b|Fire ?TV|FireOS|\bTV\b/i.test(ua);

export interface PhoneSignals {
  /** The user agent says it is a TV. */
  tv: boolean;
  /** The user agent says "Mobile" (a phone), not a tablet. */
  mobile: boolean;
  /** A finger is the primary pointer (CSS `pointer: coarse`). */
  coarse: boolean;
  /** The screen's shorter side, CSS px (0: unknown). */
  shortSide: number;
}

export interface PhoneModeState {
  touch: boolean;
  phone: boolean;
}

/** The rule itself. Pure (exported for tests). */
export function phoneModeFrom(s: PhoneSignals): PhoneModeState {
  if (s.tv || !s.coarse) return { touch: false, phone: false };
  const phone = s.shortSide > 0 && s.shortSide < PHONE_MAX_SHORT_SIDE;
  return { touch: true, phone };
}

const matches = (q: string): boolean => {
  try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches; } catch { return false; }
};

const shortSideNow = (): number => {
  try {
    const s = window.screen;
    const fromScreen = s && s.width > 0 && s.height > 0 ? Math.min(s.width, s.height) : 0;
    return fromScreen || Math.min(window.innerWidth || 0, window.innerHeight || 0);
  } catch { return 0; }
};

let state: PhoneModeState = { touch: false, phone: false };
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) { try { l(); } catch { /* ignore */ } } };

function apply(next: PhoneModeState): void {
  const same = next.touch === state.touch && next.phone === state.phone;
  state = next;
  try {
    const cl = document.documentElement.classList;
    // Only on a change: a class write on <html> restyles the page.
    if (cl.contains('is-touch') !== next.touch) cl.toggle('is-touch', next.touch);
    if (cl.contains('is-phone') !== next.phone) cl.toggle('is-phone', next.phone);
  } catch { /* no document */ }
  if (!same) notify();
}

const REMOTE_KEY_CODES = new Set([19, 20, 21, 22, 23]); // DPAD up/down/left/right/center
const isRemoteKey = (e: KeyboardEvent) => REMOTE_KEY_CODES.has(e.keyCode) || /^Arrow/.test(e.key || '');

// A touch screen that is not a phone waits for a finger; a remote key first
// disarms it for good.
let disarmTouch: (() => void) | null = null;
function armTouch(phone: boolean): void {
  if (disarmTouch) return;
  const onPointer = (e: Event) => {
    if (e.type === 'pointerdown' && (e as PointerEvent).pointerType !== 'touch') return;
    disarmTouch?.();
    apply({ touch: true, phone });
  };
  const onKey = (e: KeyboardEvent) => { if (isRemoteKey(e)) disarmTouch?.(); };
  window.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('touchstart', onPointer, { capture: true, passive: true } as AddEventListenerOptions);
  window.addEventListener('keydown', onKey, true);
  disarmTouch = () => {
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('touchstart', onPointer, true);
    window.removeEventListener('keydown', onKey, true);
    disarmTouch = null;
  };
}

// Who is driving right now: a finger or the remote. The remote's highlight
// keeps its row on screen (keepInView, scrollIntoView, the grids' follow);
// while a finger is scrolling, nothing may pull the list back to it.
let fingerDriving = false;
let driverWatched = false;
function watchDriver(): void {
  if (driverWatched) return;
  driverWatched = true;
  const finger = () => { fingerDriving = true; };
  window.addEventListener('touchstart', finger, { capture: true, passive: true } as AddEventListenerOptions);
  window.addEventListener('keydown', (e) => { if (isRemoteKey(e)) fingerDriving = false; }, true);
}

/** True on a touch screen whose last input was a finger, not a remote key:
 *  code that keeps the highlight on screen stands aside. Always false on a TV. */
export const fingerIsDriving = (): boolean => state.touch && fingerDriving;

// scrollIntoView is called from many screens to follow the remote's
// highlight. On a touch screen a finger's scroll (or a tap on a row half off
// the edge) must not be yanked back to it, so the call is skipped while a
// finger is driving. Installed only once the screen is known to be touch:
// a TV's scrollIntoView is never wrapped.
let scrollGuarded = false;
function guardScrollIntoView(): void {
  if (scrollGuarded || typeof Element === 'undefined') return;
  scrollGuarded = true;
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function guarded(this: Element, arg?: boolean | ScrollIntoViewOptions) {
    if (fingerIsDriving()) return;
    return original.call(this, arg as ScrollIntoViewOptions);
  };
}
listeners.add(() => { if (state.touch) { watchDriver(); guardScrollIntoView(); } });

/** The answer, applied: a phone (or nothing touch) at once; any other touch screen waits for a finger. */
function settle(next: PhoneModeState, mobile: boolean): void {
  if (next.touch && !mobile && !state.touch) {
    apply({ touch: false, phone: false });
    armTouch(next.phone);
    return;
  }
  disarmTouch?.();
  apply(next);
}

let started = false;
/** Works the answer out and keeps <html>'s classes in step. Once, at boot (main.tsx). */
export function startPhoneMode(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const signals = (): PhoneSignals => ({
    tv: isTvUserAgent(ua),
    mobile: /Mobile/i.test(ua),
    coarse: matches('(pointer: coarse)'),
    shortSide: shortSideNow(),
  });
  const s = signals();
  settle(phoneModeFrom(s), s.mobile);
  // Turning a phone or folding a tablet can change the phone-sized answer.
  let frame = 0;
  const onResize = () => {
    if (frame || !state.touch) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      const now = phoneModeFrom(signals());
      if (now.touch) apply({ touch: true, phone: now.phone });
    });
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
}

/** A touch screen that is not a TV (phones and tablets). */
export const isTouchUI = (): boolean => state.touch;
/** A phone-sized touch screen. */
export const isPhoneUI = (): boolean => state.phone;

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** True on a touch screen that is not a TV (re-renders when that is settled). */
export function useTouchUI(): boolean {
  return useSyncExternalStore(subscribe, isTouchUI, isTouchUI);
}

/** True on a phone-sized touch screen. */
export function usePhoneUI(): boolean {
  return useSyncExternalStore(subscribe, isPhoneUI, isPhoneUI);
}

/** Tests only: set the answer directly (and whether a finger is driving). */
export function __setPhoneModeForTests(next: PhoneModeState & { finger?: boolean }): void {
  disarmTouch?.();
  fingerDriving = !!next.finger;
  apply({ touch: next.touch, phone: next.phone });
}
