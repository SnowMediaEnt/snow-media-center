import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import { isNativeKeyboardVisible, markKeyboardVisible, onKeyboardVisibilityChange } from '@/utils/keyboardVisibility';
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
  // keyboardDidShow event for a field THIS hook owns, or real editing evidence
  // inside its own container, sets this true.
  const imeVisibleRef = useRef(false);
  const imeElRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  // Every keyboard request carries a generation. Moving the highlight,
  // disabling the hook or unmounting bumps it, so a native show that resolves
  // late can never raise a keyboard for a field the viewer has already left.
  const requestGenRef = useRef(0);
  const pendingElRef = useRef<HTMLElement | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  /** True only for an editable field inside THIS hook's container. */
  const ownsElement = useCallback(
    (el: HTMLElement | null): el is HTMLInputElement | HTMLTextAreaElement =>
      isTextInput(el) && !!containerRef.current?.contains(el),
    [],
  );
  const keyboardOpen = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    const activeOwned = ownsElement(active);
    if (imeVisibleRef.current && imeElRef.current) {
      if (imeElRef.current === active) return true;
      // The highlight has moved off the field we recorded. Trust the record only
      // while focus is still somewhere on this hook's own screen — once
      // activeElement has left the container (body after a blur, another view)
      // an old field must never keep claiming the keyboard.
      if (active && containerRef.current?.contains(active) && !activeOwned) return true;
      if (!activeOwned) return false;
    }
    // Adoption. Tapping straight from one editable field to another does not
    // hide the platform keyboard, and the platform coalesces true -> true, so no
    // fresh keyboardDidShow arrives for the new field. If the platform still
    // reports a keyboard up and the focused field is one we own, it is ours.
    if (activeOwned && isNativeKeyboardVisible()) {
      imeElRef.current = active;
      imeVisibleRef.current = true;
      return true;
    }
    return false;
  }, [ownsElement]);
  // A native show that never settles must not hold the field hostage: after
  // this long the field becomes retryable again. A lapsed deadline is NOT
  // evidence of visibility — it only permits another request.
  const REQUEST_DEADLINE_MS = 3000;
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPendingTimer = useCallback(() => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);
  const clearIme = useCallback(() => {
    imeVisibleRef.current = false;
    imeElRef.current = null;
    requestGenRef.current += 1;
    clearPendingTimer();
    pendingElRef.current = null;
  }, [clearPendingTimer]);


  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearPendingTimer(); };
  }, [clearPendingTimer]);


  useEffect(() => {
    if (!enabled) { clearIme(); return; }
    const root = containerRef.current;
    // keyboardDidShow says A keyboard is up — not which field it belongs to.
    // Associate it with the editable field this hook owns and that is focused
    // (or awaiting its own request). Without that, a field focused by tap never
    // counted as open: Back left the screen and Next re-asked for a keyboard.
    const stop = onKeyboardVisibilityChange((open) => {
      if (!enabledRef.current || !mountedRef.current) return;
      if (!open) {
        imeVisibleRef.current = false;
        imeElRef.current = null;
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const el = ownsElement(active)
        ? active
        : (ownsElement(pendingElRef.current) ? pendingElRef.current : null);
      // Someone else's field: not ours to claim.
      if (!el) return;
      imeElRef.current = el;
      imeVisibleRef.current = true;
    });
    // Hard editing evidence, for devices that raise a keyboard without ever
    // firing keyboardDidShow. Scoped to this hook's own container so sibling
    // hooks cannot contaminate each other's state.
    const evidence = (event: Event) => {
      if (!enabledRef.current) return;
      const el = event.target as HTMLElement | null;
      if (!ownsElement(el)) return;
      imeElRef.current = el;
      imeVisibleRef.current = true;
      markKeyboardVisible();
    };
    root?.addEventListener('beforeinput', evidence, true);
    root?.addEventListener('compositionstart', evidence, true);
    return () => {
      stop();
      root?.removeEventListener('beforeinput', evidence, true);
      root?.removeEventListener('compositionstart', evidence, true);
      clearIme();
    };
  }, [clearIme, enabled, ownsElement]);

  /**
   * Ask the platform for the keyboard on a field this hook owns.
   *
   * One pending request per field: two quick OK presses must not fire two
   * native show calls. Once the request settles the field is retryable, so a
   * device that ignored it can simply be asked again. An accepted request is
   * never recorded as a visible keyboard.
   */
  const openKeyboardOn = useCallback(async (el: HTMLInputElement | HTMLTextAreaElement) => {
    if (pendingElRef.current === el) return;
    const gen = ++requestGenRef.current;
    pendingElRef.current = el;
    imeElRef.current = el;
    const isCancelled = () =>
      !mountedRef.current || !enabledRef.current || gen !== requestGenRef.current
      || !el.isConnected || el.disabled || !containerRef.current?.contains(el);
    try {
      await focusTextInputForDpad(el, { isCancelled });
    } finally {
      if (pendingElRef.current === el) pendingElRef.current = null;
      if (gen === requestGenRef.current && imeElRef.current === el && !imeVisibleRef.current
        && (!el.isConnected || !enabledRef.current)) {
        imeElRef.current = null;
      }
    }
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
    // has moved, so nothing is being edited, and any request still in flight
    // for the old field is invalidated so it cannot raise a keyboard now.
    if (target !== imeElRef.current) {
      imeVisibleRef.current = false;
      imeElRef.current = null;
      if (pendingElRef.current && pendingElRef.current !== target) {
        requestGenRef.current += 1;
        pendingElRef.current = null;
      }
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
      void openKeyboardOn(currentEl);
      return;
    }
    currentEl.click();
  }, [findManagedElement, getElements, getId, openKeyboardOn]);

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
      // Mid-composition keys (Android word suggestions, CJK IMEs) arrive as
      // Enter/keyCode 229 and must never submit a form or move the highlight.
      if (event.isComposing || event.keyCode === 229) return;
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
        // clearIme also bumps the request generation, so any show still in
        // flight is abandoned instead of re-opening what we just closed.
        clearIme();
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

      // A multiline box with no Next/Done behaviour asked for keeps ordinary
      // editing: Enter inserts a newline.
      const isMultiline = enterField?.tagName === 'TEXTAREA';
      if (isEnterKey(event) && enterField && isMultiline && !wantsNext && !allowEnter) return;

      // The keyboard's own Next / Done key arrives as Enter.
      if (isEnterKey(event) && enterField && keyboardOpen()) {
        event.preventDefault();
        event.stopPropagation();
        const from = enterField;
        // Done on the field the form marks as its submit key: submit, exactly
        // as the platform's own Done would.
        if (!wantsNext && allowEnter) {
          closeIme(from);
          const form = from.form;
          const submitter = form?.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]');
          if (submitter) submitter.click();
          else form?.requestSubmit?.();
          return;
        }
        // Next follows the FORM's own field order — the next editable field in
        // DOM order — not the spatial 'down' rule. On the billing register form
        // 'down' from First name lands on Submit, which skipped Last name even
        // though its keyboard said Next. Directional navigation is untouched.
        const fields = getElements().filter((el): el is HTMLInputElement | HTMLTextAreaElement =>
          isTextInput(el) && !el.disabled);
        const fromIdx = fields.indexOf(from);
        const nextField = fromIdx >= 0 ? fields[fromIdx + 1] ?? null : null;
        if (nextField) {
          // The keyboard is deliberately NOT hidden when moving between
          // editable fields: hiding is asynchronous, and its didHide would land
          // after the new field's didShow and wipe the new field's state.
          focusById(getId(nextField));
          void openKeyboardOn(nextField);
          return;
        }
        // Nothing editable follows: close the keyboard and let the layout's own
        // 'down' rule decide where the highlight goes (usually the submit
        // button).
        closeIme(from);
        void Promise.resolve().then(() => {
          if (!mountedRef.current || !enabledRef.current) return;
          move('down');
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
        clearIme();
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
  }, [activate, clearIme, enabled, findManagedElement, focusById, getAllElements, getElements, getId, keyboardOpen, move, openKeyboardOn]);

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
