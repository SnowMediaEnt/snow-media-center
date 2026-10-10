// Phones and touch screens. SMC is built for the remote, but some customers
// open it on an Android phone or tablet. ONE answer for the whole app, worked
// out at boot and kept on <html> as two classes, so CSS and code agree:
//
//   is-touch    a touch screen that is not a TV: fingers scroll the lists, a
//               tap does what OK does. Phones and tablets.
//   is-phone    a phone-sized touch screen (shorter side under 520 CSS px).
//   is-upright  the upright phone layout: a phone held upright, or a tablet
//               narrower than UPRIGHT_TABLET_MAX_WIDTH held upright. Sideways
//               a phone or tablet keeps the TV layout (the app scales it to
//               fit, MainActivity.fitTvLayoutOnTouchScreen).
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
/** A tablet held upright, narrower than this (CSS px), takes the phone's
 *  upright layout: upright, the TV layout's side menu and panes left the
 *  channels a sliver and Home's top bar ran off the screen (Tronix ab2b621,
 *  Fire HD 7 / 8 / 10). Sideways it keeps the TV layout. The app lets the
 *  same screens turn (MainActivity.UPRIGHT_MAX_DP). */
export const UPRIGHT_TABLET_MAX_WIDTH = 820;

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

// The screen's orientation, not the page's shape: the on-screen keyboard
// shortens the page, and typing in a search box must not flip the layout.
const portraitNow = (): boolean => {
  try {
    const type = window.screen && window.screen.orientation && window.screen.orientation.type;
    if (typeof type === 'string' && type) return type.indexOf('portrait') === 0;
  } catch { /* fall back to the page's shape */ }
  try {
    const s = window.screen;
    if (s && s.width > 0 && s.height > 0) return s.height > s.width;
  } catch { /* the page's shape */ }
  try { return window.innerHeight > window.innerWidth; } catch { return false; }
};

let state: PhoneModeState = { touch: false, phone: false };
let portrait = false;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) { try { l(); } catch { /* ignore */ } } };

/** A touch screen that is not phone-sized, held upright and narrow (see
 *  UPRIGHT_TABLET_MAX_WIDTH): laid out as a phone held upright. */
const uprightTablet = (): boolean => {
  if (!state.touch || state.phone || !portrait) return false;
  const w = shortSideNow();
  return w > 0 && w < UPRIGHT_TABLET_MAX_WIDTH;
};
/** On a phone: 'portrait' or 'landscape' (sideways); on a narrow tablet held
 *  upright, 'portrait' too; null anywhere else (a TV, a tablet sideways). */
export const phoneLayoutNow = (): 'portrait' | 'landscape' | null =>
  (state.phone ? (portrait ? 'portrait' : 'landscape') : uprightTablet() ? 'portrait' : null);

/** <html>'s classes for the state now. */
function syncClasses(): void {
  try {
    const cl = document.documentElement.classList;
    const upright = phoneLayoutNow() === 'portrait';
    // Only on a change: a class write on <html> restyles the page.
    if (cl.contains('is-touch') !== state.touch) cl.toggle('is-touch', state.touch);
    if (cl.contains('is-phone') !== state.phone) cl.toggle('is-phone', state.phone);
    if (cl.contains('is-upright') !== upright) cl.toggle('is-upright', upright);
  } catch { /* no document */ }
}

function apply(next: PhoneModeState): void {
  const same = next.touch === state.touch && next.phone === state.phone;
  state = next;
  syncClasses();
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

/** The answer, applied: a phone (or nothing touch) at once; any other touch
 *  screen waits for a finger, unless it is held upright. A TV box's screen
 *  never is: upright, it is a tablet in someone's hands, touch at once, so its
 *  upright layout is there before the first tap and not swapped in under the
 *  finger (Tronix ab2b621). */
function settle(next: PhoneModeState, mobile: boolean): void {
  if (next.touch && !mobile && !state.touch && !portrait) {
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
  portrait = portraitNow();
  settle(phoneModeFrom(s), s.mobile);
  // Turning a phone or a tablet: the upright / sideways layouts follow, and
  // folding a tablet can change the phone-sized answer (once a frame).
  let frame = 0;
  const onResize = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      const p = portraitNow();
      const turned = p !== portrait;
      portrait = p;
      // Still waiting for a finger, and now upright: a tablet (see settle).
      if (p && disarmTouch) { disarmTouch(); apply({ touch: true, phone: phoneModeFrom(signals()).phone }); return; }
      if (!state.touch) return;
      const now = phoneModeFrom(signals());
      if (now.touch && now.phone !== state.phone) { apply({ touch: true, phone: now.phone }); return; }
      syncClasses();
      if (turned) notify();
    });
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  try { window.screen.orientation?.addEventListener?.('change', onResize); } catch { /* older engine */ }
  stopListening = () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    try { window.screen.orientation?.removeEventListener?.('change', onResize); } catch { /* older engine */ }
    if (frame) window.cancelAnimationFrame(frame);
  };
}
let stopListening: (() => void) | null = null;

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

/** 'portrait' / 'landscape' on a phone ('portrait' on a narrow tablet held
 *  upright), null on a TV, a tablet held sideways or a computer. Re-renders
 *  when the phone or tablet is turned. Sideways SMC draws its TV layout
 *  (scaled by the app), so code mostly asks for 'portrait': the upright
 *  phone layout. */
export function usePhoneLayout(): 'portrait' | 'landscape' | null {
  return useSyncExternalStore(subscribe, phoneLayoutNow, phoneLayoutNow);
}

/** Tests: what startPhoneMode listens to, off (a module loaded again for the
 *  next test would otherwise share the window with this one). */
export function __stopPhoneModeForTests(): void {
  stopListening?.();
  stopListening = null;
  disarmTouch?.();
  started = false;
}

/** Tests only: set the answer directly (whether a finger is driving, and
 *  whether the screen is held upright). */
export function __setPhoneModeForTests(next: PhoneModeState & { finger?: boolean; portrait?: boolean }): void {
  disarmTouch?.();
  fingerDriving = !!next.finger;
  portrait = !!next.portrait;
  apply({ touch: next.touch, phone: next.phone });
  notify();
}
