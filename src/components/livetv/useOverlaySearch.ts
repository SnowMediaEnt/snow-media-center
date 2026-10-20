// Search over the picture (owner, 2026-10-20: "How can we still watch tv
// while we search? If we have something on, can we make it like the preview
// window or part screen or something, maybe light opaque background").
//
// The channel list over a full-screen channel (FullscreenChannelOverlay)
// starts with a "Search channels" row: ▲ from its first channel reaches it
// (▼ from its last comes round to it), OK on it opens the keyboard there. The
// picture plays on behind the same see-through list. What is typed is Live
// TV's own search (LiveSection's searchOpen / searchQuery), so the results
// are the list's: every service, never an adult channel or a hidden
// category's.
//
// The keyboard: Amazon's covers the bottom half of the screen, so while it
// is up the list draws the field and the first few results in the top half.
// It goes away by Back (Android closes it itself and says so:
// keyboardDidHide), by its own Done / Enter key, or by ▼ on a keyboard that
// sends arrows (▲ puts it away and stays on the field); then the highlight
// moves into the results (▲ from the first one is the field again).
// Amazon's keyboard sends a parting Enter as it closes, also when it is put
// away for us: an OK that soon after is not a press, or it would play the
// first result behind the viewer's back.
//
// Back, one layer at a time: the keyboard; then a search opened here (the
// list as it was, the highlight on the Search row); then the list. A search
// the list already had (opened in the list before the channel went full
// screen) is the list itself here: Back closes the list, as before. A pick
// plays the channel full screen the normal way and closes the list and a
// search opened here (LiveSection's pickFromOverlay).
//
// This hook holds where the highlight is (the field, or a row of the list),
// whether the keyboard is up, and whether the search was opened here.
// LiveSection owns the search itself and the keys: its key handler calls in.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, RefObject } from 'react';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import { isFieldActionKey } from '@/utils/fieldEnter';

/** After the keyboard is put away, its parting Enter is not a press (Amazon's keyboard). */
export const OVERLAY_DISMISS_GRACE_MS = 700;
/** After the keyboard is asked for, an Enter this soon is the echo of that OK, not "done". */
export const OVERLAY_OPEN_ECHO_MS = 800;

export interface OverlaySearchOptions {
  /** Live TV's search is open: its results are the list. */
  searchOpen: boolean;
  /** Rows in the list on screen (the results while searching). */
  count: number;
  /** Opens Live TV's search, empty. */
  open: () => void;
  /** Closes it: the list's own channels again. */
  leave: () => void;
  /** The list's highlight onto its first row. */
  toFirst: () => void;
  /** The list's close-after-a-while timer: off while typing, on again after. */
  idle: (on: boolean) => void;
}

export interface OverlaySearch {
  /** The highlight is on the Search row (the field). */
  onField: boolean;
  /** The keyboard is up on the field. */
  typing: boolean;
  /** The open search was opened here: Back leaves it, a pick closes it. */
  owned: boolean;
  inputRef: RefObject<HTMLInputElement>;
  /** The field's own focus events (the platform taking or giving focus). */
  onFieldFocus: (e: ReactFocusEvent<HTMLInputElement>) => void;
  onFieldBlur: () => void;
  /** The same, for key handlers bound once. */
  isOnField: () => boolean;
  owns: () => boolean;
  /** ▲ from the first row (▼ from the last). */
  toField: () => void;
  /** Off the field, into the list. */
  offField: () => void;
  /** OK on the field: the keyboard, the search opened if it was not. */
  start: () => void;
  /** A key while the keyboard is up. True when it was taken (letters and
   *  ◀ ▶ go on to the field untouched, Backspace deletes a letter). */
  typingKey: (e: KeyboardEvent) => boolean;
  /** An OK this soon after the keyboard went away is its parting Enter. */
  partingOk: () => boolean;
  /** Back: the keyboard, else a search opened here. False when neither was
   *  there to close (the list's own Back goes on). */
  back: () => boolean;
  /** The list closing: the keyboard put away, all forgotten. True when a
   *  search opened here was open (the caller closes it). */
  end: () => boolean;
}

interface State { onField: boolean; typing: boolean; owned: boolean }
const IDLE: State = { onField: false, typing: false, owned: false };

const swallow = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
const markBack = () => { (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now(); };

export function useOverlaySearch(opts: OverlaySearchOptions): OverlaySearch {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [state, setState] = useState<State>(IDLE);
  const stateRef = useRef(state);
  const update = useCallback((patch: Partial<State>) => {
    const next = { ...stateRef.current, ...patch };
    if (next.onField === stateRef.current.onField && next.typing === stateRef.current.typing && next.owned === stateRef.current.owned) return;
    stateRef.current = next;
    setState(next);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const openedAtRef = useRef(0);
  const dismissedAtRef = useRef(0);
  // The keyboard went away before the results were in (typed, then Back
  // within the list's short pause, or the line-ups still downloading): the
  // highlight moves into them once they come, if the viewer has not moved.
  const wantListRef = useRef(false);

  /** The keyboard is gone (or going): into the results when there are any. */
  const finish = useCallback((toList: boolean, hide: boolean) => {
    if (!stateRef.current.typing) return;
    dismissedAtRef.current = Date.now();
    const into = toList && optsRef.current.count > 0;
    wantListRef.current = toList && !into;
    // Set before the blur below, so the field's own blur finds it done.
    update({ typing: false, onField: !into });
    if (into) optsRef.current.toFirst();
    const el = inputRef.current;
    if (hide) void hideKeyboardForDpad(el);
    else el?.blur();
    optsRef.current.idle(true);
  }, [update]);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const count = opts.count;
  useEffect(() => {
    if (!wantListRef.current) return;
    const s = stateRef.current;
    if (!s.onField || s.typing) { wantListRef.current = false; return; }
    if (count <= 0) return;
    wantListRef.current = false;
    update({ onField: false });
    optsRef.current.toFirst();
  }, [count, update]);

  // The search closed some other way (a category opened from the list's
  // categories): nothing of it is left here.
  const searchOpen = opts.searchOpen;
  useEffect(() => {
    if (searchOpen) return;
    if (stateRef.current.typing) finishRef.current(false, true);
    if (stateRef.current.owned) update({ owned: false });
  }, [searchOpen, update]);

  // The platform closed the keyboard by itself (its own Back: JavaScript
  // never sees that press). The field lets go of the focus too, or the next
  // OK would be taken as the keyboard's "done", and the highlight moves into
  // the results. Its parting Enter is ignored for a moment (partingOk).
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { Keyboard } = await import('@capacitor/keyboard');
        const handle = await Keyboard.addListener('keyboardDidHide', () => {
          if (stateRef.current.typing) finishRef.current(true, false);
        });
        if (cancelled) { void handle.remove(); return; }
        stop = () => { void handle.remove(); };
      } catch { /* no keyboard plugin here (web, tests): Back and the keys still put it away */ }
    })();
    // Leaving Live TV with the keyboard up: put it away (the field goes with the page).
    return () => { cancelled = true; stop?.(); if (stateRef.current.typing) void hideKeyboardForDpad(null); };
  }, []);

  const start = useCallback(() => {
    // The field is drawn whenever the highlight is on it; without it there
    // is nowhere to type.
    const el = inputRef.current;
    if (!el) return;
    const o = optsRef.current;
    wantListRef.current = false;
    if (!o.searchOpen) { o.open(); update({ owned: true }); }
    update({ onField: true, typing: true });
    openedAtRef.current = Date.now();
    o.idle(false);
    // Writable before it is focused: React draws that a frame later.
    el.readOnly = false;
    void focusTextInputForDpad(el);
  }, [update]);

  const typingKey = useCallback((e: KeyboardEvent): boolean => {
    if (!stateRef.current.typing) return false;
    // Backspace deletes a letter here; it is not Back.
    if (e.key === 'Backspace') { e.stopPropagation(); return true; }
    if (e.key === 'Escape' || e.keyCode === 4) { swallow(e); markBack(); finish(true, true); return true; }
    if (isFieldActionKey(e) && !e.isComposing && e.keyCode !== 229) {
      swallow(e);
      // The OK that opened the keyboard, echoed (or held): not "done".
      if (e.repeat || Date.now() - openedAtRef.current < OVERLAY_OPEN_ECHO_MS) return true;
      finish(true, true);
      return true;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { swallow(e); finish(e.key === 'ArrowDown', true); return true; }
    // Letters, and ◀ ▶ along the text: the field's own.
    e.stopPropagation();
    return true;
  }, [finish]);

  const back = useCallback((): boolean => {
    wantListRef.current = false;
    const s = stateRef.current;
    if (s.typing) { finish(true, true); return true; }
    if (!s.owned || !optsRef.current.searchOpen) return false;
    // The list as it was, the highlight on the row the search was opened from.
    update({ owned: false, onField: true });
    optsRef.current.leave();
    return true;
  }, [finish, update]);

  const end = useCallback((): boolean => {
    wantListRef.current = false;
    const s = stateRef.current;
    const owned = s.owned && optsRef.current.searchOpen;
    update(IDLE);
    if (s.typing) {
      dismissedAtRef.current = Date.now();
      void hideKeyboardForDpad(inputRef.current);
    }
    return owned;
  }, [update]);

  const toField = useCallback(() => { wantListRef.current = false; update({ onField: true }); }, [update]);
  const offField = useCallback(() => { wantListRef.current = false; update({ onField: false }); }, [update]);
  const isOnField = useCallback(() => stateRef.current.onField, []);
  const owns = useCallback(() => stateRef.current.owned && optsRef.current.searchOpen, []);
  const partingOk = useCallback(() => Date.now() - dismissedAtRef.current < OVERLAY_DISMISS_GRACE_MS, []);

  // Focus the field never asked for (a Fire TV focuses a page's first box as
  // its keyboard window closes, and raises the keyboard on it): given back at
  // once. The field is read-only then too, so no keyboard comes up for it.
  const onFieldFocus = useCallback((e: ReactFocusEvent<HTMLInputElement>) => {
    if (!stateRef.current.typing) e.currentTarget.blur();
  }, []);
  // The platform took the focus away while typing: the keyboard went with it.
  const onFieldBlur = useCallback(() => {
    if (stateRef.current.typing) finishRef.current(true, false);
  }, []);

  return {
    onField: state.onField,
    typing: state.typing,
    owned: state.owned && opts.searchOpen,
    inputRef,
    onFieldFocus,
    onFieldBlur,
    isOnField,
    owns,
    toField,
    offField,
    start,
    typingKey,
    partingOk,
    back,
    end,
  };
}
