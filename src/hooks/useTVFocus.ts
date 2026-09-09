import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import { snapAllTVScrollToTop } from '@/utils/tvScroll';

type Direction = 'up' | 'down' | 'left' | 'right';
type NavTarget = string | null | undefined | (() => string | null | undefined);

export type TVFocusNavigationMap = Record<string, Partial<Record<Direction, NavTarget>>>;

interface UseTVFocusOptions {
  enabled?: boolean;
  initialFocusId?: string;
  focusableSelector?: string;
  navigation?: TVFocusNavigationMap;
  onBack?: () => void;
  onFocusChange?: (id: string) => void;
  scrollBlock?: ScrollLogicalPosition;
  /** When false, don't auto-focus any element on mount. Useful for embedded
   *  views where the parent decides when focus enters. */
  autoFocusOnMount?: boolean;
}


const isTextInput = (el: HTMLElement | null): el is HTMLInputElement | HTMLTextAreaElement =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

/**
 * The remote's OK button.
 *
 * A Fire TV remote sends KEYCODE_DPAD_CENTER (23), and some remotes send
 * ENTER (66). Depending on the WebView build those reach JavaScript with
 * event.key of 'Enter', 'Unidentified' or '' — so testing event.key alone
 * misses the press entirely. PlexPlayerOverlay, BufferingGuide, StoreScreen,
 * HowToGuide, ClaimAccountCard and RenewQR all accept 23/66 for exactly this
 * reason; this hook was the one place that did not.
 *
 * That was survivable while focusing a field opened the keyboard by itself.
 * Once OK became the way to open it, an OK that never arrives means a field
 * that can never be typed in.
 */
// NOT keyCode 66: in Android that is KEYCODE_ENTER, but in the DOM it is the
// letter B — matching it would swallow every 'b' the viewer types. 23 is
// unassigned in the DOM, so it is safe to read as DPAD_CENTER.
const isEnterKey = (e: KeyboardEvent) =>
  e.key === 'Enter' || e.key === 'Select'
  || e.code === 'Enter' || e.code === 'NumpadEnter'
  || e.keyCode === 13 || e.keyCode === 23;

/** Enter, or Space — both activate a focused control when not typing. */
const isOkKey = (e: KeyboardEvent) =>
  isEnterKey(e) || e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space' || e.keyCode === 32;

const isArrowKey = (e: KeyboardEvent) =>
  e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';

/**
 * The on-screen keyboard is left to the platform.
 *
 * Focusing a field raises it on both TV WebViews and phones, which is what a
 * viewer expects when they land on Username. The app no longer tries to hold
 * it back with inputmode="none" — see suppressIme below.
 */



/**
 * NO-OP on purpose.
 *
 * Blocking the keyboard until OK was pressed left viewers unable to type at
 * all: on several Fire TV / Android TV WebViews the later Keyboard.show() is
 * answered against an input connection built while inputmode was still
 * "none", so the keyboard never appeared however many times OK was pressed.
 * Landing on a field now simply lets the platform raise its own keyboard,
 * which is what every other TV app does.
 */
const suppressIme = (_el: HTMLElement | null) => {
  /* intentionally does nothing — see comment above */
};


/** The viewer pressed Enter on the field: give it its real keyboard back. */
const allowIme = (el: HTMLElement | null) => {
  if (!isTextInput(el)) return;
  const original = el.dataset.tvInputMode;
  if (original) el.setAttribute('inputmode', original);
  else el.removeAttribute('inputmode');
};

const isVisible = (el: HTMLElement) =>
  !el.hasAttribute('disabled') &&
  el.getAttribute('aria-disabled') !== 'true' &&
  el.dataset.tvDisabled !== 'true' &&
  el.offsetParent !== null;
export const useTVFocus = ({
  enabled = true,
  initialFocusId,
  focusableSelector = '[data-tv-focus-id]',
  navigation = {},
  onBack,
  onFocusChange,
  scrollBlock = 'nearest',
  autoFocusOnMount = true,
}: UseTVFocusOptions = {}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentIdRef = useRef<string | null>(initialFocusId ?? null);
  const didAutoFocusRef = useRef(false);
  // Whether WE opened the keyboard. Focus alone no longer opens it, so this is
  // an accurate record — and Back needs it: keying off "focus is in an input"
  // instead would trap the viewer on the screen, since the field keeps focus
  // after the keyboard closes.
  const imeOpenRef = useRef(false);
  // The element whose keyboard is open. focusById suppresses the IME on
  // whatever it focuses — and every managed element's onFocus calls focusById,
  // so opening the keyboard re-entered focusById and shut it again before it
  // could appear. This is the one element it must leave alone.
  const imeElRef = useRef<HTMLElement | null>(null);
  // Held in a ref, not read from the closure: callers pass an inline arrow, so
  // listing onBack in the listener's deps re-appended the window listener on
  // every render. That reshuffled it behind LiveTV's own capture handler, which
  // then got first refusal on every remote key.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  // One press of the remote's Back can reach us twice: the WebView delivers the
  // real key (keyCode 4), and LiveTV's Capacitor backButton listener
  // synthesizes an Escape on top of it. Handled separately that is two Backs —
  // the first closed the keyboard and the second left the screen, so there was
  // never a moment to arrow down to Sign In.
  const lastBackRef = useRef(0);
  const [currentFocusId, setCurrentFocusId] = useState<string | null>(initialFocusId ?? null);



  const getElements = useCallback(() => {
    const root = containerRef.current;
    if (!root) return [] as HTMLElement[];
    return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(isVisible);
  }, [focusableSelector]);

  const getAllElements = useCallback(() => {
    const root = containerRef.current;
    if (!root) return [] as HTMLElement[];
    return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector));
  }, [focusableSelector]);

  const getId = useCallback((el: HTMLElement) => {
    if (el.dataset.tvFocusId) return el.dataset.tvFocusId;
    const attrMatch = focusableSelector.match(/\[([^\]=]+)/)?.[1];
    return attrMatch ? el.getAttribute(attrMatch) ?? '' : '';
  }, [focusableSelector]);

  const focusById = useCallback((id?: string | null, block: ScrollLogicalPosition = scrollBlock) => {
    if (!id) return false;
    const elements = getElements();
    const target = elements.find((el) => getId(el) === id);
    if (!target) return false;

    document.querySelectorAll<HTMLElement>('[data-tv-focused="true"]').forEach((el) => {
      el.dataset.tvFocused = 'false';
    });
    target.dataset.tvFocused = 'true';
    target.tabIndex = target.tabIndex < 0 ? 0 : target.tabIndex;
    // Landing on a text field — by remote, tap or click — means the viewer can
    // type in it. Record that the keyboard is up so Backspace deletes a
    // character instead of being read as Back and leaving the screen.
    if (isTextInput(target)) {
      allowIme(target);
      imeOpenRef.current = true;
      imeElRef.current = target;
    } else {
      imeOpenRef.current = false;
      imeElRef.current = null;
    }

    target.focus({ preventScroll: true });
    // When focusing a top-of-page "back" control, snap the nearest scroll
    // container to absolute top so the safe-area padding isn't clipped.
    const isBackTop = /(^|-)back($|-)/i.test(id);
    const scroller = target.closest('.tv-scroll-container') as HTMLElement | null;
    if (isBackTop && scroller) {
      snapAllTVScrollToTop([scroller, containerRef.current]);
    } else {
      target.scrollIntoView({ block, inline: 'nearest', behavior: 'smooth' });
    }
    currentIdRef.current = id;
    setCurrentFocusId(id);
    onFocusChange?.(id);
    return true;
  }, [getElements, getId, onFocusChange, scrollBlock]);

  const findManagedElement = useCallback((target: HTMLElement | null) => {
    if (!target) return null;
    return getAllElements().find((el) => el === target || el.contains(target)) ?? null;
  }, [getAllElements]);

  const findSpatial = useCallback((direction: Direction) => {
    const elements = getElements();
    if (!elements.length) return null;
    const active = findManagedElement(document.activeElement as HTMLElement | null);
    const current = active ?? elements.find((el) => getId(el) === currentIdRef.current) ?? elements[0];
    const currentRect = current.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;

    let best: HTMLElement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    elements.forEach((candidate) => {
      if (candidate === current) return;
      const rect = candidate.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const dx = x - currentX;
      const dy = y - currentY;
      const inDirection =
        (direction === 'up' && dy < -8) ||
        (direction === 'down' && dy > 8) ||
        (direction === 'left' && dx < -8) ||
        (direction === 'right' && dx > 8);
      if (!inDirection) return;
      const primary = direction === 'up' || direction === 'down' ? Math.abs(dy) : Math.abs(dx);
      const secondary = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
      const score = primary + secondary * 1.8;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    return best ? getId(best) : null;
  }, [findManagedElement, getElements, getId]);

  const move = useCallback((direction: Direction) => {
    const currentEl = findManagedElement(document.activeElement as HTMLElement | null);
    const currentId = currentEl ? getId(currentEl) : currentIdRef.current;
    const rule = currentId ? navigation[currentId]?.[direction] : undefined;
    const ruledTarget = typeof rule === 'function' ? rule() : rule;
    if (ruledTarget === null) return true;
    const nextId = ruledTarget !== undefined ? ruledTarget : findSpatial(direction);
    return focusById(nextId ?? currentId);
  }, [findManagedElement, findSpatial, focusById, getId, navigation]);

  const activate = useCallback(() => {
    const currentEl = findManagedElement(document.activeElement as HTMLElement | null)
      ?? getElements().find((el) => getId(el) === currentIdRef.current);
    if (!currentEl) return;
    if (isTextInput(currentEl)) {
      allowIme(currentEl);
      imeOpenRef.current = true;
      imeElRef.current = currentEl;
      // Android builds the IME's input connection when a field GAINS focus, and
      // reads inputmode at that moment. The field is already focused here — it
      // is the highlighted one — so clearing the attribute now changes nothing
      // the IME can see, and Keyboard.show() is answered with the connection
      // built while inputmode was still "none". No keyboard, however many times
      // you press OK. Blur and refocus on the next frame to force a fresh
      // connection that reads the restored inputmode.
      currentEl.blur();
      requestAnimationFrame(() => {
        void focusTextInputForDpad(currentEl).then((opened) => {
          if (opened) return;
          // It did not open. Say so, rather than leaving the hook believing a
          // keyboard is up: otherwise the next OK is read as the keyboard's
          // Next key, walks down the form and submits it empty.
          imeOpenRef.current = false;
          imeElRef.current = null;
          suppressIme(currentEl);
        });
      });
      return;
    }
    currentEl.click();
  }, [findManagedElement, getElements, getId]);

  useEffect(() => {
    if (!enabled || !autoFocusOnMount) return;
    // Only auto-focus ONCE per mount. Re-enabling (e.g. when a child returns
    // focus to the parent) must NOT re-snap to initialFocusId — that races
    // with explicit focusById(...) calls made by the parent's return handler
    // and reliably overrides them (the auto-focus rAF is scheduled by React's
    // commit phase, AFTER the listener's rAF, so it wins on the next frame).
    if (didAutoFocusRef.current) return;
    didAutoFocusRef.current = true;
    const rafId = requestAnimationFrame(() => {
      const elements = getElements();
      const wanted = initialFocusId && elements.some((el) => getId(el) === initialFocusId)
        ? initialFocusId
        : getId(elements[0]);
      focusById(wanted, 'nearest');
    });
    return () => cancelAnimationFrame(rafId);
  }, [enabled, autoFocusOnMount, focusById, getElements, getId, initialFocusId]);


  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const active = document.activeElement as HTMLElement | null;
      const isLooseTarget = (el: HTMLElement | null) =>
        !el || el === document.body || el === document.documentElement || el === containerRef.current;
      const managedTarget = findManagedElement(target)
        ?? findManagedElement(active)
        ?? (isLooseTarget(target) && isLooseTarget(active)
          ? getAllElements().find((el) => getId(el) === currentIdRef.current)
          : null)
        ?? null;
      if (!managedTarget) return;

      const typing = isTextInput(target) || isTextInput(active) || !!target?.isContentEditable;
      // Close the keyboard but keep the field highlighted, so Back reads as
      // "done typing" rather than "the screen reset itself". Re-suppressing
      // first means the re-focus cannot raise it again.
      const closeIme = (el: HTMLElement | null) => {
        imeOpenRef.current = false;
        imeElRef.current = null;
        suppressIme(el);
        // Blur and leave focus off the field. The ring is drawn from
        // data-tv-focused, which focusById already set, and the handler below
        // falls back to currentIdRef when focus is loose — so navigation still
        // works. Re-focusing the input here risked the WebView raising the
        // keyboard again on the spot.
        void hideKeyboardForDpad(el);
      };
      const isBack = event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 4 || event.code === 'GoBack';
      if (isBack) {
        // Backspace is a delete key while the keyboard is up, not a Back.
        if (event.key === 'Backspace' && (imeOpenRef.current || typing)) return;
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now();
        // Swallow the echo of a press we already acted on.
        if (now - lastBackRef.current < 400) return;
        lastBackRef.current = now;
        // Tell the app's other Back listeners this press is spoken for.
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
        if (imeOpenRef.current) {
          closeIme(active ?? target);
          return;
        }
        onBackRef.current?.();
        return;
      }

      // A field whose keyboard shows Next means the field below, even when the
      // field is marked allow-enter so Enter can submit a form. Password on the
      // create-account form is both: it carries allow-enter for the sign-in
      // layout, where it is the last field, but in register mode the keyboard
      // says Next and First name is below it. Enter fell straight through to
      // the form, which submitted half-filled and answered "enter a first name".
      const enterField = isTextInput(active) ? active : (isTextInput(target) ? target : null);
      const wantsNext = enterField?.getAttribute('enterkeyhint') === 'next';

      // OK on a HIGHLIGHTED field means "let me type here". Only once the
      // keyboard is up does Enter carry the keyboard's own Next/Done meaning.
      //
      // Password carries data-tv-allow-enter so its Done key can submit the
      // form, but that ran on the plain highlight too: OK on Password submitted
      // with an empty password ("Please enter your username and password")
      // rather than opening the keyboard. The field could never be filled in,
      // and Back then had no keyboard to close so it left the screen instead.
      if (isEnterKey(event) && enterField && !imeOpenRef.current) {
        event.preventDefault();
        event.stopPropagation();
        activate();
        return;
      }

      if (typing && isEnterKey(event) && managedTarget.dataset.tvAllowEnter === 'true' && !wantsNext) return;

      // The keyboard's own Next / Done key arrives as Enter. Next means the
      // field below — not "open this field again", which is what activate()
      // did, and why Next appeared to do nothing at all. With no field below,
      // this is Done and the keyboard simply closes.
      if (isEnterKey(event) && enterField && imeOpenRef.current) {
        event.preventDefault();
        event.stopPropagation();
        const from = enterField;
        imeOpenRef.current = false;
        imeElRef.current = null;
        suppressIme(from);
        void hideKeyboardForDpad(from).then(() => {
          const before = currentIdRef.current;
          move('down');
          if (currentIdRef.current === before) return;
          const landed = getAllElements().find((el) => getId(el) === currentIdRef.current) ?? null;
          if (!isTextInput(landed)) return;
          // move() focused this field through focusById, which suppressed it —
          // so it is focused with inputmode="none" and its input connection is
          // already built. Clearing the attribute and calling focus() again
          // would be a no-op on an already-focused element, and the keyboard
          // would never appear on the second field. Force a real transition,
          // exactly as activate() does.
          allowIme(landed);
          imeElRef.current = landed;
          landed.blur();
          requestAnimationFrame(() => {
            void focusTextInputForDpad(landed).then((opened) => {
              imeOpenRef.current = opened;
              if (opened) return;
              imeElRef.current = null;
              suppressIme(landed);
            });
          });
        });
        return;
      }
      // While typing in INPUT/TEXTAREA/contentEditable, never swallow Space — the user must be able
      // to type spaces. Also let Enter pass through unless arrow navigation is needed.
      if (typing && (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space' || event.keyCode === 32)) return;
      if (typing && !isArrowKey(event) && !isEnterKey(event)) return;
      if (!isArrowKey(event) && !isOkKey(event)) return;


      event.preventDefault();
      event.stopPropagation();
      // Moving off a field closes the keyboard; the field we land on is
      // suppressed by focusById, so it cannot pop straight back up.
      if (typing && isArrowKey(event)) {
        imeOpenRef.current = false;
        imeElRef.current = null;
        suppressIme(active ?? target);
        void hideKeyboardForDpad(active ?? target);
      }

      if (isOkKey(event)) activate();
      if (event.key === 'ArrowUp') move('up');
      if (event.key === 'ArrowDown') move('down');
      if (event.key === 'ArrowLeft') move('left');
      if (event.key === 'ArrowRight') move('right');
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [activate, enabled, findManagedElement, focusById, getAllElements, getId, move]);

  const focusProps = useCallback((id: string) => ({
    'data-tv-focus-id': id,
    tabIndex: 0,
    onFocus: () => focusById(id, 'nearest'),
  }), [focusById]);

  return useMemo(() => ({
    containerRef,
    currentFocusId,
    focusById,
    move,
    focusProps,
  }), [currentFocusId, focusById, focusProps, move]);
};
