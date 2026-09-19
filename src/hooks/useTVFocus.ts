import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import { snapAllTVScrollToTop } from '@/utils/tvScroll';

type Direction = 'up' | 'down' | 'left' | 'right';
type NavTarget = string | null | undefined | (() => string | null | undefined);

export type TVFocusNavigationMap = Record<string, Partial<Record<Direction, NavTarget>>>;

const focusIdUsable = (id: string) => {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector<HTMLElement>(`[data-tv-focus-id="${id}"]`);
  return !!el && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true' && el.offsetParent !== null;
};

/**
 * A navigation map from rows of focus ids: top to bottom, each left to right.
 *
 * Up and Down keep the column where the next row has one, and skip rows
 * whose control is missing or disabled at the moment of the press. Left and
 * Right stay inside the row and stop at its ends. Nothing ever falls through
 * to the spatial search, so the highlight cannot leap to whatever happens to
 * be nearest on screen — which on a screen of stacked cards was two buttons
 * past the one below.
 */
export const gridNavigation = (rows: string[][]): TVFocusNavigationMap => {
  const map: TVFocusNavigationMap = {};
  const vertical = (r: number, c: number, step: 1 | -1) => () => {
    for (let rr = r + step; rr >= 0 && rr < rows.length; rr += step) {
      const row = rows[rr];
      if (!row.length) continue;
      const pick = row[Math.min(c, row.length - 1)];
      if (focusIdUsable(pick)) return pick;
      const other = row.find(focusIdUsable);
      if (other) return other;
    }
    return null;
  };
  const horizontal = (r: number, c: number, step: 1 | -1) => () => {
    const row = rows[r];
    for (let cc = c + step; cc >= 0 && cc < row.length; cc += step) {
      if (focusIdUsable(row[cc])) return row[cc];
    }
    return null;
  };
  rows.forEach((row, r) => {
    row.forEach((id, c) => {
      map[id] = {
        up: vertical(r, c, -1),
        down: vertical(r, c, 1),
        left: horizontal(r, c, -1),
        right: horizontal(r, c, 1),
      };
    });
  });
  return map;
};

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
  /** Up/Down with nothing to land on scrolls the screen instead of doing
   *  nothing, so long read-only content (a ticket thread, an alert list)
   *  can still be seen with the remote. Off by default: screens with laid-out
   *  navigation maps rely on the highlight staying put at an edge. */
  scrollWhenStuck?: boolean;
}

// Ids for elements a selector matched by tag or role rather than by a
// data-tv-focus-id. Assigned once, on first sight, so the highlight has a
// stable name for the element for as long as it stays mounted.
let autoIdCounter = 0;

const isTextInput = (el: HTMLElement | null): el is HTMLInputElement | HTMLTextAreaElement =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

/**
 * The remote's OK button.
 *
 * A Fire TV remote sends KEYCODE_DPAD_CENTER (23), and some remotes send
 * ENTER (66). Depending on the WebView build those reach JavaScript with
 * event.key of 'Enter', 'Unidentified' or '' — so testing event.key alone
 * misses the press entirely.
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

const isVisible = (el: HTMLElement) =>
  !el.hasAttribute('disabled') &&
  el.getAttribute('aria-disabled') !== 'true' &&
  el.dataset.tvDisabled !== 'true' &&
  el.offsetParent !== null;

// How long after a Back-dismiss an Enter / OK / Space is treated as the
// keyboard's own after-effect rather than a press. Amazon's keyboard emits
// its action as it goes, and that lands on the page as a plain Enter.
const DISMISS_GRACE_MS = 700;
// One keyboard Enter can reach the page more than once (keydown, then the
// keyup fallback below). Within this window the second one is an echo.
const ENTER_ECHO_MS = 800;

/**
 * Remote-control focus for a screen.
 *
 * Text fields work the way they did on 1.6.x: the highlight landing on a
 * field focuses it, OK asks the platform for its keyboard, arrows and Back
 * put the keyboard away. The one addition is the keyboard's own Enter / Next
 * key: once a keyboard was asked for on a field and something was typed, the
 * next Enter moves on to the next text field (keyboard along), or after the
 * last one puts the keyboard away and lands on whatever follows — the form's
 * button. Nothing is submitted; that is the button's job.
 */
export const useTVFocus = ({
  enabled = true,
  initialFocusId,
  focusableSelector = '[data-tv-focus-id]',
  navigation = {},
  onBack,
  onFocusChange,
  scrollBlock = 'nearest',
  autoFocusOnMount = true,
  scrollWhenStuck = false,
}: UseTVFocusOptions = {}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentIdRef = useRef<string | null>(initialFocusId ?? null);
  const didAutoFocusRef = useRef(false);
  const [currentFocusId, setCurrentFocusId] = useState<string | null>(initialFocusId ?? null);
  // The field the keyboard was last asked for, and is presumed up on. Cleared
  // whenever the highlight moves, the keyboard is put away, or the platform
  // reports it hidden. Only ever a field inside this hook's own container.
  const openedRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  // Held in a ref, not read from the closure: callers pass an inline arrow, so
  // listing onBack in the listener's deps re-appended the window listener on
  // every render. That reshuffled it behind LiveTV's own capture handler, which
  // then got first refusal on every remote key.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  // One press of the remote's Back can reach us twice: the WebView delivers the
  // real key (keyCode 4), and LiveTV's Capacitor backButton listener
  // synthesizes an Escape on top of it. Handled separately that is two Backs —
  // the first closed the keyboard and the second left the screen.
  const lastBackRef = useRef(0);
  const lastDismissRef = useRef(0);
  const lastEnterRef = useRef(0);

  const ownsField = useCallback(
    (el: HTMLElement | null): el is HTMLInputElement | HTMLTextAreaElement =>
      isTextInput(el) && !!containerRef.current?.contains(el),
    [],
  );

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
    const fromAttr = attrMatch ? el.getAttribute(attrMatch) : null;
    if (fromAttr) return fromAttr;
    // A plain button/input/tab the selector picked up: name it now.
    autoIdCounter += 1;
    el.dataset.tvFocusId = `tvf-${autoIdCounter}`;
    return el.dataset.tvFocusId;
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
    // The highlight moved off the field the keyboard was on: forget it, so
    // an Enter on the new field asks for the keyboard rather than skipping.
    if (openedRef.current && openedRef.current !== target) openedRef.current = null;
    target.focus({ preventScroll: true });
    // When focusing a top-of-page "back" control, snap the nearest scroll
    // container to absolute top so the safe-area padding isn't clipped.
    const isBackTop = /(^|-)back($|-)/i.test(id);
    const scroller = target.closest('.tv-scroll-container') as HTMLElement | null;
    if (isBackTop && scroller) {
      snapAllTVScrollToTop([scroller, containerRef.current]);
    } else {
      // A smooth scroll on a Fire TV is a stutter, not a glide: the box
      // repaints the whole page a handful of times over the animation and the
      // viewer sees the list lurch. Jump straight there on those devices.
      const lowMemory = typeof document !== 'undefined'
        && document.documentElement.classList.contains('native-low-memory');
      target.scrollIntoView({ block, inline: 'nearest', behavior: lowMemory ? 'auto' : 'smooth' });
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
    if (!nextId && scrollWhenStuck && (direction === 'up' || direction === 'down')) {
      // The nearest ancestor that really scrolls. A screen's
      // .tv-scroll-container only grows (min-height), so on most screens the
      // overflow lives on the app root ([data-app-scroll-root]) above it.
      let scroller: HTMLElement | null = currentEl ?? containerRef.current;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 1
        && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
        scroller = scroller.parentElement;
      }
      const step = Math.round((scroller?.clientHeight ?? window.innerHeight) * 0.6) || 300;
      const top = direction === 'down' ? step : -step;
      if (scroller) scroller.scrollBy({ top, behavior: 'smooth' });
      else window.scrollBy({ top, behavior: 'smooth' });
    }
    return focusById(nextId ?? currentId);
  }, [findManagedElement, findSpatial, focusById, getId, navigation, scrollWhenStuck]);

  /** Ask the platform for the keyboard on a field this hook owns. */
  const openKeyboardOn = useCallback((field: HTMLInputElement | HTMLTextAreaElement) => {
    openedRef.current = field;
    void focusTextInputForDpad(field);
  }, []);

  /** Put the keyboard away and leave the field, highlight staying where it is. */
  const closeKeyboard = useCallback((el: HTMLElement | null) => {
    openedRef.current = null;
    void hideKeyboardForDpad(el);
  }, []);

  const activate = useCallback(() => {
    const currentEl = findManagedElement(document.activeElement as HTMLElement | null)
      ?? getElements().find((el) => getId(el) === currentIdRef.current);
    if (!currentEl) return;
    if (isTextInput(currentEl)) {
      openKeyboardOn(currentEl);
      return;
    }
    currentEl.click();
  }, [findManagedElement, getElements, getId, openKeyboardOn]);

  // The keyboard's Next: leave `field` for the next text field on this screen,
  // in reading order, and ask for the keyboard there. After the last field
  // the keyboard is put away and the highlight lands on whatever comes next,
  // which on every form in the app is its button.
  const advanceFrom = useCallback((field: HTMLInputElement | HTMLTextAreaElement) => {
    const elements = getElements();
    const here = findManagedElement(field) ?? field;
    const idx = elements.indexOf(here);
    const rest = idx >= 0 ? elements.slice(idx + 1) : [];
    const nextField = rest.find(
      (el): el is HTMLInputElement | HTMLTextAreaElement => isTextInput(el) && !el.disabled && !el.readOnly,
    );
    if (nextField) {
      focusById(getId(nextField));
      openKeyboardOn(nextField);
      return;
    }
    closeKeyboard(field);
    // Putting the keyboard away here is a dismissal like Back's: Amazon's
    // keyboard emits a parting Enter as it closes, which used to land on the
    // button we just moved to (a sign-in nobody pressed) or, with the field
    // still focused, re-open the keyboard on it.
    lastDismissRef.current = Date.now();
    const next = rest[0];
    if (next) focusById(getId(next));
  }, [closeKeyboard, findManagedElement, focusById, getElements, getId, openKeyboardOn]);

  /**
   * Is an Enter on this field the keyboard's "done here"? Only when the
   * keyboard was asked for on this very field and something was typed. An
   * empty field is still "open it": a box that ignored the request must stay
   * retryable, and skipping a blank field is the arrow keys' job.
   */
  const enterMeansNext = useCallback(
    (field: HTMLInputElement | HTMLTextAreaElement) =>
      openedRef.current === field && field.value.length > 0,
    [],
  );

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

  // The platform moving focus by itself. Chromium answers the keyboard's Next
  // by focusing the next form control directly, with no key event at all; the
  // highlight follows here, and the keyboard is taken to be on the new field.
  // A keyboardDidHide report, where the platform sends one, forgets the field.
  useEffect(() => {
    if (!enabled) { openedRef.current = null; return; }
    const root = containerRef.current;
    const onFocusIn = (event: FocusEvent) => {
      const el = event.target as HTMLElement | null;
      if (!ownsField(el)) {
        // The platform moved focus from the keyboard's field to something
        // that is not one (Next on the last field lands on the button): the
        // keyboard is going away, and its parting Enter must not press it.
        if (openedRef.current && el && containerRef.current?.contains(el)) {
          openedRef.current = null;
          lastDismissRef.current = Date.now();
        }
        return;
      }
      if (openedRef.current && openedRef.current !== el) openedRef.current = el;
      const managed = findManagedElement(el);
      if (!managed) return;
      const id = getId(managed);
      if (id !== currentIdRef.current) focusById(id);
    };
    root?.addEventListener('focusin', onFocusIn);
    let stopHide: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { Keyboard } = await import('@capacitor/keyboard');
        const handle = await Keyboard.addListener('keyboardDidHide', () => { openedRef.current = null; });
        if (cancelled) { void handle.remove(); return; }
        stopHide = () => { void handle.remove(); };
      } catch {
        // No keyboard plugin here (web, tests): Back and the arrows still clear it.
      }
    })();
    return () => {
      cancelled = true;
      root?.removeEventListener('focusin', onFocusIn);
      stopHide?.();
      openedRef.current = null;
    };
  }, [enabled, findManagedElement, focusById, getId, ownsField]);

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
      const now = Date.now();
      const isBack = event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 4 || event.code === 'GoBack';
      if (isBack) {
        // Backspace deletes whenever a field is being edited — however the
        // viewer got into it, remote or tap — and is only Back otherwise.
        if (event.key === 'Backspace' && typing) return;
        event.preventDefault();
        event.stopPropagation();
        // Swallow the echo of a press we already acted on.
        if (now - lastBackRef.current < 400) return;
        lastBackRef.current = now;
        // Tell the app's other Back listeners this press is spoken for.
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
        // Back on a field closes the keyboard and STAYS on that field: the
        // highlight is drawn from data-tv-focused, which focusById set, and
        // the handler falls back to currentIdRef once focus is loose.
        if (typing) {
          lastDismissRef.current = now;
          closeKeyboard(active ?? target);
          return;
        }
        onBackRef.current?.();
        return;
      }

      // A keyboard dismissed by Back must STAY dismissed: Amazon's keyboard
      // emits its action as it closes, which lands here as an Enter on the
      // field we just left. Nobody means "open it again" within 700 ms.
      if (isOkKey(event) && now - lastDismissRef.current < DISMISS_GRACE_MS) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const enterField = ownsField(active) ? active : (ownsField(target) ? target : null);
      const allowEnter = managedTarget.dataset.tvAllowEnter === 'true';
      // Enter on a text field is either OK ("let me type here") or the
      // keyboard's own Enter / Next ("done with this field"). A multiline box
      // keeps its newline, and a field marked allow-enter keeps its submit —
      // but only once typed in: OK on it still opens the keyboard.
      if (isEnterKey(event) && enterField) {
        const next = enterMeansNext(enterField);
        if (next && (enterField.tagName === 'TEXTAREA' || allowEnter)) return;
        event.preventDefault();
        event.stopPropagation();
        if (next && now - lastEnterRef.current < ENTER_ECHO_MS) return;
        // Stamped for an open as well as a move: the keyup of this same
        // press must not be read as a Next by the fallback below.
        lastEnterRef.current = now;
        if (next) advanceFrom(enterField);
        else openKeyboardOn(enterField);
        return;
      }

      if (typing && isEnterKey(event) && allowEnter) return;
      // While typing in INPUT/TEXTAREA/contentEditable, never swallow Space — the user must be able
      // to type spaces.
      if (typing && (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space' || event.keyCode === 32)) return;
      if (typing && !isArrowKey(event) && !isEnterKey(event)) return;
      if (!isArrowKey(event) && !isOkKey(event)) return;

      event.preventDefault();
      event.stopPropagation();
      // Moving off a field closes the keyboard; the field we land on is only
      // highlighted, not opened, so it cannot pop straight back up.
      if (typing && isArrowKey(event)) closeKeyboard(active ?? target);

      if (isOkKey(event)) activate();
      if (event.key === 'ArrowUp') move('up');
      if (event.key === 'ArrowDown') move('down');
      if (event.key === 'ArrowLeft') move('left');
      if (event.key === 'ArrowRight') move('right');
    };
    // With word prediction on, Amazon's keyboard can deliver its Enter
    // mid-composition (isComposing / keyCode 229), which the handler above
    // must ignore. The keyup survives: if it reaches a field the keyboard is
    // on, and no Enter was acted on just now, it is the viewer's Next.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isEnterKey(event)) return;
      const active = document.activeElement as HTMLElement | null;
      if (!ownsField(active) || active.tagName === 'TEXTAREA') return;
      if (findManagedElement(active)?.dataset.tvAllowEnter === 'true') return;
      const now = Date.now();
      if (now - lastEnterRef.current < ENTER_ECHO_MS) return;
      if (now - lastDismissRef.current < DISMISS_GRACE_MS) return;
      if (!enterMeansNext(active)) return;
      event.preventDefault();
      event.stopPropagation();
      lastEnterRef.current = now;
      advanceFrom(active);
    };
    window.addEventListener('keydown', handler, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', handler, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
    };
  }, [activate, advanceFrom, closeKeyboard, enabled, enterMeansNext, findManagedElement, getAllElements, getId, move, openKeyboardOn, ownsField]);

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
