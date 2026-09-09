import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import { markKeyboardVisible, onKeyboardVisibilityChange } from '@/utils/keyboardVisibility';
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
 * The on-screen keyboard is left entirely to the platform.
 *
 * There is no suppression here any more: no inputmode="none", no readonly
 * trap, no blur/refocus dance. Those all ended the same way — Android built
 * the input connection while the field was suppressed, and the later
 * Keyboard.show() was answered against that dead connection, so the keyboard
 * never appeared however many times OK was pressed. Explicit inputmode values
 * (email, numeric) set by the forms are left exactly as the forms wrote them.
 */

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
  // Whether the platform's on-screen keyboard is GENUINELY up, and for which
  // field. Deliberately not "a field is focused" and not "we called
  // Keyboard.show()": TV WebViews focus fields for D-pad navigation with no IME
  // at all, and they accept show() requests they then ignore. Only a
  // keyboardDidShow event, real editing evidence (input / composition), or a
  // browser where a focused field is immediately editable sets this true.
  // Everything that changes meaning once the keyboard is up — Enter as
  // Next/Done, Back closing the keyboard first — reads it, so a phantom value
  // is what silently submitted empty sign-in forms.
  const imeVisibleRef = useRef(false);
  const imeElRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  const keyboardOpen = useCallback(() => imeVisibleRef.current && !!imeElRef.current, []);
  useEffect(() => {
    mountedRef.current = true;
    // Platform lifecycle events, plus hard editing evidence for devices that
    // raise a keyboard without ever firing keyboardDidShow.
    const stop = onKeyboardVisibilityChange((open) => {
      imeVisibleRef.current = open;
      if (!open) imeElRef.current = null;
    });
    const evidence = (event: Event) => {
      const el = event.target as HTMLElement | null;
      if (!isTextInput(el)) return;
      imeElRef.current = el;
      imeVisibleRef.current = true;
      markKeyboardVisible();
    };
    window.addEventListener('beforeinput', evidence, true);
    window.addEventListener('compositionstart', evidence, true);
    return () => {
      mountedRef.current = false;
      stop();
      window.removeEventListener('beforeinput', evidence, true);
      window.removeEventListener('compositionstart', evidence, true);
    };
  }, []);
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
    // Highlighting a field is NOT the keyboard opening. Leave the IME record
    // alone when this is the very field whose keyboard we asked for — the
    // element's own onFocus calls straight back in here, which used to wipe the
    // record the moment the keyboard appeared. Otherwise clear it: the highlight
    // has moved, so nothing is being edited.
    if (target !== imeElRef.current) {
      imeVisibleRef.current = false;
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
      // Ask the platform for the keyboard on the field that is already focused.
      // Nothing is blurred first: that destroyed the input connection Android
      // had just built and was why the keyboard never appeared on TV.
      //
      // The request being accepted is NOT recorded as the keyboard being up —
      // only keyboardDidShow or real editing does that — so if a device ignores
      // the request, pressing OK again simply asks again.
      const el = currentEl;
      imeElRef.current = el;
      void focusTextInputForDpad(el).then((requested) => {
        // Never touch state or focus for a screen the viewer has left.
        if (!mountedRef.current || document.activeElement !== el) return;
        if (!requested) {
          if (imeElRef.current === el) imeElRef.current = null;
          return;
        }
        // In a browser — the Lovable preview, a phone browser — a focused field
        // is editable immediately, so the request is proof enough. On native we
        // wait for the platform to confirm.
        if (!Capacitor.isNativePlatform()) {
          imeElRef.current = el;
          imeVisibleRef.current = true;
        }
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
      // "done typing" rather than "the screen reset itself".
      const closeIme = (el: HTMLElement | null) => {
        imeVisibleRef.current = false;
        imeElRef.current = null;
        // Blur and leave focus off the field. The ring is drawn from
        // data-tv-focused, which focusById already set, and the handler below
        // falls back to currentIdRef when focus is loose — so remote navigation
        // still works once the keyboard is gone.
        void hideKeyboardForDpad(el);
      };
      const isBack = event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 4 || event.code === 'GoBack';
      if (isBack) {
        // Backspace deletes whenever a field is being edited — however the
        // viewer got into it, remote or tap — and is only Back otherwise.
        if (event.key === 'Backspace' && (keyboardOpen() || typing)) return;
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now();
        // Swallow the echo of a press we already acted on.
        if (now - lastBackRef.current < 400) return;
        lastBackRef.current = now;
        // Tell the app's other Back listeners this press is spoken for.
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
        if (keyboardOpen()) {
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
      // says Next and First name is below it.
      const enterField = isTextInput(active) ? active : (isTextInput(target) ? target : null);
      const wantsNext = enterField?.getAttribute('enterkeyhint') === 'next';
      const allowEnter = managedTarget.dataset.tvAllowEnter === 'true';

      // OK on a HIGHLIGHTED field means "let me type here" — never "submit".
      // While no keyboard is confirmed up this stays true on every press, so a
      // device that ignored the first request can simply be asked again, and
      // OK on Password can no longer submit an empty form.
      if (isEnterKey(event) && enterField && !keyboardOpen()) {
        event.preventDefault();
        event.stopPropagation();
        activate();
        return;
      }

      // The keyboard's own Next / Done key arrives as Enter.
      if (isEnterKey(event) && enterField && keyboardOpen()) {
        event.preventDefault();
        event.stopPropagation();
        const from = enterField;
        closeIme(from);
        // Done on the field the form marks as its submit key: submit, exactly
        // as the platform's own Done would.
        if (!wantsNext && allowEnter) {
          const form = from.form;
          const submitter = form?.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]');
          if (submitter) submitter.click();
          else form?.requestSubmit?.();
          return;
        }
        // Next means the field below — not "open this field again", which is
        // why Next used to appear to do nothing at all.
        void Promise.resolve().then(() => {
          if (!mountedRef.current) return;
          const before = currentIdRef.current;
          move('down');
          if (currentIdRef.current === before) return;
          const landed = getAllElements().find((el) => getId(el) === currentIdRef.current) ?? null;
          if (!isTextInput(landed)) return;
          // Carry on typing straight through a registration form: open the next
          // field's keyboard too, without needing another OK press.
          imeElRef.current = landed;
          void focusTextInputForDpad(landed).then((requested) => {
            if (!mountedRef.current || document.activeElement !== landed) return;
            if (!requested) {
              if (imeElRef.current === landed) imeElRef.current = null;
              return;
            }
            if (!Capacitor.isNativePlatform()) imeVisibleRef.current = true;
          });
        });
        return;
      }

      // contentEditable and anything else that carries allow-enter: let Enter
      // reach the form untouched.
      if (typing && isEnterKey(event) && allowEnter && !wantsNext) return;
      // While typing in INPUT/TEXTAREA/contentEditable, never swallow Space — the user must be able
      // to type spaces. Also let Enter pass through unless arrow navigation is needed.
      if (typing && (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space' || event.keyCode === 32)) return;
      if (typing && !isArrowKey(event) && !isEnterKey(event)) return;
      if (!isArrowKey(event) && !isOkKey(event)) return;


      event.preventDefault();
      event.stopPropagation();
      // Moving off a field closes the keyboard; the field we land on is only
      // highlighted, not opened, so it cannot pop straight back up.
      if (typing && isArrowKey(event)) {
        imeVisibleRef.current = false;
        imeElRef.current = null;
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
  }, [activate, enabled, findManagedElement, focusById, getAllElements, getId, keyboardOpen, move]);

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
