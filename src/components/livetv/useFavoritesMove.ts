// Favourites in the viewer's own order: the order Live TV's Favorites lists
// are drawn in (lib/favoritesOrder), and Move — one favourite lifted out of
// its place and carried along the list with the remote.
//
// LiveSection starts a move from a favourite's menu (hold OK → Move) and
// hands this the keys while it lasts:
//   ▲▼ one place up / down (a row in the logo wall, where ◀▶ are one place);
//      held, the key repeats and the favourite keeps going, stopping at the
//      list's ends (it never wraps round to the other end);
//   OK or Back puts it down there and saves the order;
//   every other key does nothing until then (no channel change, no side
//   menu, no favourite toggled by accident).
// The list draws the lifted row (MovingFavoriteFrame) and keeps it in view;
// Live TV losing the remote, or leaving it, puts it down where it got to.
// A touch screen has no ▲▼ to carry it: its menu offers Move up / Move
// down instead (stepOnce), one place a tap.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lineKey } from '@/lib/favoritesSync';
import type { FavChannel, XtreamCreds } from '@/lib/xtream';
import {
  favRefKey,
  favRefsOf,
  mineRefs,
  moveFavorite,
  saveFavOrder,
  useFavoritesOrder,
  withOtherLines,
  type FavOrder,
  type FavRef,
  type FavSortMode,
} from '@/lib/favoritesOrder';

export interface FavoritesMoveOptions {
  /** Every signed-in line, in the pane's order. */
  lines: XtreamCreds[];
  /** Each line's favourites (LiveSection's favsByLine), in the order they were added. */
  favsByLine: ReadonlyMap<string, ReadonlyMap<number, FavChannel>>;
  /** Live TV has the remote. A move still under way when it loses it is put down where it is. */
  active: boolean;
}

/** Which favourites the list on screen holds: one line's (its lineKey), or every line's (null). */
export type FavScope = string | null;

export interface FavoritesMove {
  /** What the Favorites lists are arranged by: the move under way, else the saved order. */
  order: FavOrder;
  mode: FavSortMode;
  /** The favourite being moved (favRefKey), or null. */
  movingKey: string | null;
  /** Lift a favourite (favRefKey) out of its place. */
  start: (key: string) => void;
  /** Put the favourite down where it is and save the order. */
  drop: () => void;
  /** A key while a favourite is lifted. `onIndex`: its new place in the list on screen. */
  onKey: (e: KeyboardEvent, ctx: { scope: FavScope; cols: number; onIndex: (i: number) => void }) => void;
  /** A touch screen's Move up / Move down: one place, saved at once. False when it could not go. */
  stepOnce: (key: string, scope: FavScope, delta: number) => boolean;
  /** Its place in the list on screen and how long that list is (for Move up / down). */
  placeOf: (key: string, scope: FavScope) => { index: number; count: number };
  /** Sort A–Z, or back to the viewer's own order (which A–Z never touches). */
  setMode: (mode: FavSortMode) => void;
}

/** The favourites the list on screen holds, by favRefKey. */
const shownSet = (present: readonly FavRef[], scope: FavScope): Set<string> =>
  new Set(present.filter((r) => scope === null || r.line === scope).map((r) => favRefKey(r.line, r.id)));

export function useFavoritesMove({ lines, favsByLine, active }: FavoritesMoveOptions): FavoritesMove {
  const saved = useFavoritesOrder();
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const lineKeys = useMemo(() => lines.map((l) => lineKey(l)), [lines]);
  // Every favourite on the box, line by line, as added. Lines whose list is
  // not loaded yet are left out of it, and their part of the saved order is
  // kept (withOtherLines).
  const present = useMemo(() => favRefsOf(lineKeys, favsByLine), [lineKeys, favsByLine]);
  const presentRef = useRef(present);
  presentRef.current = present;
  const loadedRef = useRef({ lineKeys, favsByLine });
  loadedRef.current = { lineKeys, favsByLine };

  const [moving, setMoving] = useState<{ key: string; keys: FavRef[] } | null>(null);
  // Read and written by the key handler between renders (a held ▼ repeats
  // faster than the screen redraws on a slow box).
  const movingRef = useRef(moving);

  const persist = useCallback((keys: FavRef[], mode: FavSortMode) => {
    const { lineKeys: all, favsByLine: favs } = loadedRef.current;
    const loaded = new Set(all.filter((k) => favs.has(k)));
    saveFavOrder({ mode, keys: withOtherLines(mineRefs(presentRef.current, keys), savedRef.current.keys, loaded) });
  }, []);

  const start = useCallback((key: string) => {
    movingRef.current = { key, keys: mineRefs(presentRef.current, savedRef.current.keys) };
    setMoving(movingRef.current);
  }, []);

  const drop = useCallback(() => {
    const m = movingRef.current;
    if (!m) return;
    movingRef.current = null;
    setMoving(null);
    persist(m.keys, 'mine');
  }, [persist]);

  const step = useCallback((scope: FavScope, delta: number): number | null => {
    const m = movingRef.current;
    if (!m) return null;
    // From the favourites there are now: one added meanwhile (a sync) is in it.
    const r = moveFavorite(mineRefs(presentRef.current, m.keys), shownSet(presentRef.current, scope), m.key, delta);
    if (!r) return null;
    movingRef.current = { key: m.key, keys: r.order };
    setMoving(movingRef.current);
    return r.index;
  }, []);

  const onKey = useCallback((e: KeyboardEvent, ctx: { scope: FavScope; cols: number; onIndex: (i: number) => void }) => {
    const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
    const isOk = e.key === 'Enter' || e.key === ' ';
    const arrow = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    if (isBack || isOk || arrow || e.key === 'ContextMenu' || e.keyCode === 82 || e.key === 'f' || e.key === 'F') {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    }
    if (isBack) {
      // The shell's own Back must not also act on this press (see LiveSection).
      (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
      drop();
      return;
    }
    // A repeat is the OK that picked Move still held down: not a drop.
    if (isOk) { if (!e.repeat) drop(); return; }
    const cols = Math.max(1, ctx.cols);
    const delta = e.key === 'ArrowUp' ? -cols : e.key === 'ArrowDown' ? cols
      : cols > 1 && e.key === 'ArrowLeft' ? -1 : cols > 1 && e.key === 'ArrowRight' ? 1 : 0;
    if (!delta) return;
    const i = step(ctx.scope, delta);
    if (i != null) ctx.onIndex(i);
  }, [drop, step]);

  const stepOnce = useCallback((key: string, scope: FavScope, delta: number) => {
    const r = moveFavorite(mineRefs(presentRef.current, savedRef.current.keys), shownSet(presentRef.current, scope), key, delta);
    if (r) persist(r.order, 'mine');
    return !!r;
  }, [persist]);

  const placeOf = useCallback((key: string, scope: FavScope) => {
    const list = mineRefs(presentRef.current, savedRef.current.keys).filter((r) => scope === null || r.line === scope);
    return { index: list.findIndex((r) => favRefKey(r.line, r.id) === key), count: list.length };
  }, []);

  const setMode = useCallback((mode: FavSortMode) => {
    // The own order is kept as it is: switching back shows it again.
    saveFavOrder({ mode, keys: savedRef.current.keys });
  }, []);

  // Live TV lost the remote mid-move (a dialog over the Player, the voice
  // overlay, another section): put down where it got to.
  useEffect(() => { if (!active) drop(); }, [active, drop]);
  // Leaving Live TV mid-move keeps where it got to, too.
  useEffect(() => () => {
    const m = movingRef.current;
    movingRef.current = null;
    if (m) persist(m.keys, 'mine');
  }, [persist]);

  const order = useMemo<FavOrder>(() => (moving ? { mode: 'mine', keys: moving.keys } : saved), [moving, saved]);
  return {
    order,
    mode: order.mode,
    movingKey: moving?.key ?? null,
    start,
    drop,
    onKey,
    stepOnce,
    placeOf,
    setMode,
  };
}
