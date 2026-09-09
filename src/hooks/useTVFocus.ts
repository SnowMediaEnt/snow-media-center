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
 * HIGHLIGHT IS NOT FOCUS.
 *
 * On a TV, moving the D-pad onto a text field is not the same as wanting to
 * type in it — but in an Android WebView, giving an input DOM focus raises the
 * on-screen keyboard. So a field that is merely highlighted never receives DOM
 * focus at all: focusById() draws the ring (data-tv-focused) and records the id,
 * and leaves focus loose. Pressing OK is what focuses it — a real, fresh focus,
 * which is exactly the path that has opened the Fire TV keyboard reliably for
 * every version of this app — and "typing" is simply "a text field is
 * document.activeElement", which the DOM answers truthfully.
 *
 * This replaces an inputmode="none" scheme that tried to keep a FOCUSED field's
 * keyboard shut and then hand it back on OK. Android builds the keyboard's
 * input connection when a field gains focus and reads inputmode then; toggling
 * the attribute on an already-focused field never reached it, and the keyboard
 * could not be opened at all.
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
  // Whether WE opened the keyboard. Focus alone no longer opens it, so this is
  // an accurate record — and Back needs it: keying off "focus is in an input"
  // instead would trap the viewer on the screen, since the field keeps focus
  // after the keyboard closes.
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
    if (isTextInput(target)) {
      // Ring only — see HIGHLIGHT IS NOT FOCUS. Drop whatever was focused so the
      // key handler falls back to currentIdRef, and so any open keyboard closes.
      // If the field already has focus (OK, or a real click), leave it be.
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== target && active !== document.body) active.blur();
    } else {
      target.focus({ preventScroll: true });
    }
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
      // The field is highlighted but not focused, so this is a real focus
      // transition: Android builds a fresh input connection and shows the
      // keyboard for it.
      void focusTextInputForDpad(currentEl);
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

      // Ground truth: a text field has DOM focus, so the keyboard is up.
      const typing = isTextInput(target) || isTextInput(active) || !!target?.isContentEditable;
      const field = isTextInput(active) ? active : (isTextInput(target) ? target : null);
      // Blur + Keyboard.hide(). The ring stays (data-tv-focused), and the
      // handler falls back to currentIdRef once focus is loose, so the viewer
      // is left on the same field, keyboard shut.
      const closeKeyboard = () => { void hideKeyboardForDpad(field ?? active ?? target); };

      const isBack = event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 4 || event.code === 'GoBack';
      if (isBack) {
        // Backspace is a delete key while the keyboard is up, not a Back.
        if (event.key === 'Backspace' && typing) return;
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now();
        // Swallow the echo of a press we already acted on.
        if (now - lastBackRef.current < 400) return;
        lastBackRef.current = now;
        // Tell the app's other Back listeners this press is spoken for.
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
        if (typing) { closeKeyboard(); return; }
        onBackRef.current?.();
        return;
      }

      if (typing && isEnterKey(event) && field) {
        // The keyboard's own Next / Done key arrives as Enter.
        //   Next  -> the field below, opening its keyboard if it is a field.
        //   Done  -> submit when the field allows it, otherwise just close.
        // A field marked allow-enter (Password) only submits when its keyboard
        // says Done: in register mode it says Next and First name is below it,
        // and letting Enter through submitted the form half-filled.
        const wantsNext = field.getAttribute('enterkeyhint') === 'next';
        if (!wantsNext && managedTarget.dataset.tvAllowEnter === 'true') return;
        event.preventDefault();
        event.stopPropagation();
        void hideKeyboardForDpad(field).then(() => {
          if (!wantsNext) return;
          const before = currentIdRef.current;
          move('down');
          if (currentIdRef.current === before) return;
          const landed = getAllElements().find((el) => getId(el) === currentIdRef.current) ?? null;
          // focusById only drew the ring, so this is a fresh focus too.
          if (isTextInput(landed)) void focusTextInputForDpad(landed);
        });
        return;
      }

      // While typing, every other key belongs to the keyboard — letters,
      // Space, everything — except the arrows, which leave the field.
      if (typing && !isArrowKey(event)) return;
      if (!isArrowKey(event) && !isOkKey(event)) return;

      event.preventDefault();
      event.stopPropagation();
      // Moving off a field closes its keyboard; the field we land on is only
      // highlighted, so nothing pops back up.
      if (typing && isArrowKey(event)) closeKeyboard();

      if (isOkKey(event)) activate();
      if (event.key === 'ArrowUp') move('up');
      if (event.key === 'ArrowDown') move('down');
      if (event.key === 'ArrowLeft') move('left');
      if (event.key === 'ArrowRight') move('right');
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [activate, enabled, findManagedElement, getAllElements, getId, move]);

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
