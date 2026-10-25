// Home, customised in place: hold OK on a bottom tile (or a finger on a touch
// screen) for its menu, or on the content bar for the bar's.
//
//   Tile menu   Move · Change shortcut · Reset to default · Cancel
//   Move        ◀ ▶ carry the tile along the row (the others close up), OK
//               puts it down there and saves, Back puts it back where it was
//               (Live TV's favourites Move: the same lifted look).
//   Picker      every place this viewer may have on a tile; one already on
//               Home swaps places with this one. Back: the menu again.
//   Bar menu    Customize · Hide content bar · Cancel
//   Customize   Show from (Live TV and Plex / Live TV only / Plex only / Off)
//               and Show (Recommendations / Continue watching / Favorites).
//
// THE LATCH. The OK that opened a layer is usually still held down, and a
// held OK repeats; some boxes' repeats do not say so (e.repeat). So a layer
// opened by OK takes no OK until that OK has been let go (keyup), as the
// Services list's hold menu does; and every OK it acts on latches it again
// until let go, so a held OK never runs on into the next layer.
//
// While any layer is up it has the remote (a capture listener on window, and
// aria-modal on the menus so Home's own handler and the bar's stand aside);
// hardware Back reaches it as an Escape (useOwnHardwareBack).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { moveTile, pickableTiles, saveTiles, setTile, type TileContext, type TileDest } from '@/lib/homeTiles';
import { BAR_SHOWS, BAR_SOURCES, chooseBarShow, chooseBarSource, type BarShow, type BarSource } from '@/lib/homeBar';
import { useOwnHardwareBack } from '@/hooks/useOwnHardwareBack';

export const TILE_MENU_ROWS = ['move', 'change', 'reset', 'cancel'] as const;
export type TileMenuRow = (typeof TILE_MENU_ROWS)[number];
export const BAR_MENU_ROWS = ['customize', 'hide', 'cancel'] as const;
export type BarMenuRow = (typeof BAR_MENU_ROWS)[number];
/** The picker's columns (its D-pad grid). */
export const PICKER_COLS = 5;

/** The Customize panel's places: each Source, each Show, then Done. */
export type CustomizeSpot = { col: 0; i: number } | { col: 1; i: number } | { col: 2; i: 0 };

/** Where a small menu sits: centred over the thing that was held. */
export interface Anchor { x: number; bottom: number }

export type EditorState =
  | null
  | { kind: 'tileMenu'; slot: number; focus: number; anchor: Anchor | null }
  | { kind: 'picker'; slot: number; focus: number }
  | { kind: 'move'; slot: number; from: number; row: TileDest[]; original: TileDest[] }
  | { kind: 'barMenu'; focus: number; anchor: Anchor | null }
  | { kind: 'barCustomize'; spot: CustomizeSpot };

export interface HomeEditorOptions {
  /** The four tiles, left to right, as saved (or the defaults). */
  row: TileDest[];
  ctx: TileContext;
  /** Bar choices on screen (Customize marks them). */
  barSource: BarSource | 'off';
  barShow: BarShow;
  /** Where Home's highlight goes: the tile in this slot. */
  onFocusTile: (slot: number) => void;
}

const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23;
const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
const swallow = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

const anchorOf = (selector: string, lift = 12): Anchor | null => {
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, bottom: Math.max(8, window.innerHeight - r.top + lift) };
  } catch { return null; }
};

export function useHomeEditor({ row, ctx, barSource, barShow, onFocusTile }: HomeEditorOptions) {
  const [state, setStateRaw] = useState<EditorState>(null);
  const stateRef = useRef<EditorState>(null);
  const setState = useCallback((s: EditorState) => { stateRef.current = s; setStateRaw(s); }, []);
  // False while the OK that opened (or last acted in) a layer is still down.
  const armedRef = useRef(true);
  const rowRef = useRef(row);
  rowRef.current = row;
  const onFocusRef = useRef(onFocusTile);
  onFocusRef.current = onFocusTile;
  const pickable = useMemo(() => pickableTiles(ctx), [ctx]);
  const pickableRef = useRef(pickable);
  pickableRef.current = pickable;
  const barRef = useRef({ barSource, barShow });
  barRef.current = { barSource, barShow };

  const close = useCallback(() => setState(null), [setState]);

  /** `viaOk`: opened by a held OK (latched until it is let go). */
  const openTileMenu = useCallback((slot: number, viaOk = false) => {
    armedRef.current = !viaOk;
    setState({ kind: 'tileMenu', slot, focus: 0, anchor: anchorOf(`[data-home-card="${slot}"]`) });
  }, [setState]);
  const openBarMenu = useCallback((viaOk = false) => {
    armedRef.current = !viaOk;
    setState({ kind: 'barMenu', focus: 0, anchor: anchorOf('[data-media-bar] [data-focused="true"]', 8) ?? anchorOf('[data-media-bar]', -40) });
  }, [setState]);
  const openBarCustomize = useCallback((viaOk = false) => {
    armedRef.current = !viaOk;
    const src = barRef.current.barSource;
    setState({ kind: 'barCustomize', spot: { col: 0, i: Math.max(0, BAR_SOURCES.indexOf(src)) } });
  }, [setState]);

  const startMove = useCallback((slot: number) => {
    const r = rowRef.current.slice();
    setState({ kind: 'move', slot, from: slot, row: r, original: r });
  }, [setState]);
  const moveBy = useCallback((delta: number) => {
    const s = stateRef.current;
    if (!s || s.kind !== 'move') return;
    const to = Math.max(0, Math.min(s.row.length - 1, s.slot + delta));
    if (to === s.slot) return;
    setState({ ...s, row: moveTile(s.row, s.slot, to), slot: to });
    onFocusRef.current(to);
  }, [setState]);
  const drop = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.kind !== 'move') return;
    if (s.row.join() !== s.original.join()) saveTiles(s.row);
    setState(null);
    onFocusRef.current(s.slot);
  }, [setState]);
  const cancelMove = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.kind !== 'move') return;
    setState(null);
    onFocusRef.current(s.from);
  }, [setState]);

  const pickTile = useCallback((slot: number, dest: TileDest) => {
    saveTiles(setTile(rowRef.current, slot, dest));
    setState(null);
    onFocusRef.current(slot);
  }, [setState]);

  const pressTileMenu = useCallback((which: TileMenuRow) => {
    const s = stateRef.current;
    if (!s || s.kind !== 'tileMenu') return;
    if (which === 'move') startMove(s.slot);
    else if (which === 'change') {
      const at = pickableRef.current.findIndex((d) => d.id === rowRef.current[s.slot]);
      setState({ kind: 'picker', slot: s.slot, focus: Math.max(0, at) });
    } else if (which === 'reset') {
      saveTiles(null);
      setState(null);
      onFocusRef.current(s.slot);
    } else { setState(null); onFocusRef.current(s.slot); }
  }, [setState, startMove]);

  const pressBarMenu = useCallback((which: BarMenuRow) => {
    if (which === 'customize') { setState({ kind: 'barCustomize', spot: { col: 0, i: Math.max(0, BAR_SOURCES.indexOf(barRef.current.barSource)) } }); return; }
    if (which === 'hide') chooseBarSource('off');
    setState(null);
  }, [setState]);

  const pressSpot = useCallback((spot: CustomizeSpot) => {
    if (spot.col === 0) chooseBarSource(BAR_SOURCES[spot.i]);
    else if (spot.col === 1) chooseBarShow(BAR_SHOWS[spot.i]);
    else setState(null);
  }, [setState]);

  /** One step back: the picker to its menu; everything else closes (Move puts the tile back). */
  const stepBack = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    if (s.kind === 'move') { cancelMove(); return; }
    if (s.kind === 'picker') {
      setState({ kind: 'tileMenu', slot: s.slot, focus: TILE_MENU_ROWS.indexOf('change'), anchor: anchorOf(`[data-home-card="${s.slot}"]`) });
      return;
    }
    if (s.kind === 'tileMenu') onFocusRef.current(s.slot);
    setState(null);
  }, [cancelMove, setState]);

  const open = state !== null;
  useOwnHardwareBack(open, stepBack);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s) return;
      const ok = isOk(e);
      const back = isBack(e);
      const arrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (!ok && !back && !arrow) return;
      swallow(e);
      if (back) {
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        stepBack();
        return;
      }
      if (ok) {
        if (e.repeat || !armedRef.current) return;
        armedRef.current = false;
        if (s.kind === 'tileMenu') pressTileMenu(TILE_MENU_ROWS[s.focus]);
        else if (s.kind === 'picker') { const d = pickableRef.current[s.focus]; if (d) pickTile(s.slot, d.id); }
        else if (s.kind === 'move') drop();
        else if (s.kind === 'barMenu') pressBarMenu(BAR_MENU_ROWS[s.focus]);
        else pressSpot(s.spot);
        return;
      }
      const up = e.key === 'ArrowUp';
      const down = e.key === 'ArrowDown';
      const left = e.key === 'ArrowLeft';
      const right = e.key === 'ArrowRight';
      if (s.kind === 'move') { if (left || right) moveBy(left ? -1 : 1); return; }
      if (s.kind === 'tileMenu' || s.kind === 'barMenu') {
        const n = s.kind === 'tileMenu' ? TILE_MENU_ROWS.length : BAR_MENU_ROWS.length;
        if (up || down) setState({ ...s, focus: Math.max(0, Math.min(n - 1, s.focus + (down ? 1 : -1))) });
        return;
      }
      if (s.kind === 'picker') {
        const n = pickableRef.current.length;
        const col = s.focus % PICKER_COLS;
        let f = s.focus;
        if (left && col > 0) f -= 1;
        else if (right && col < PICKER_COLS - 1 && f + 1 < n) f += 1;
        else if (up && f - PICKER_COLS >= 0) f -= PICKER_COLS;
        else if (down && f + PICKER_COLS < n) f += PICKER_COLS;
        else if (down && Math.floor(f / PICKER_COLS) < Math.floor((n - 1) / PICKER_COLS)) f = n - 1;
        if (f !== s.focus) setState({ ...s, focus: f });
        return;
      }
      // Customize: two columns of choices, Done under them.
      const sp = s.spot;
      const len = (c: 0 | 1) => (c === 0 ? BAR_SOURCES.length : BAR_SHOWS.length);
      let next: CustomizeSpot = sp;
      if (sp.col === 2) {
        if (up) next = { col: 0, i: len(0) - 1 };
      } else if (up && sp.i > 0) next = { col: sp.col, i: sp.i - 1 };
      else if (down) next = sp.i < len(sp.col) - 1 ? { col: sp.col, i: sp.i + 1 } : { col: 2, i: 0 };
      else if (right && sp.col === 0) next = { col: 1, i: Math.min(sp.i, len(1) - 1) };
      else if (left && sp.col === 1) next = { col: 0, i: Math.min(sp.i, len(0) - 1) };
      if (next !== sp) setState({ kind: 'barCustomize', spot: next });
    };
    // The OK that opened or last acted in a layer, let go: OK answers again.
    const onUp = (e: KeyboardEvent) => {
      if (!isOk(e)) return;
      armedRef.current = true;
      swallow(e);
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, [open, stepBack, pressTileMenu, pickTile, drop, moveBy, pressBarMenu, pressSpot, setState]);

  // Closed: the next layer starts unlatched unless an OK opens it.
  useEffect(() => { if (!open) armedRef.current = true; }, [open]);

  return {
    state,
    pickable,
    open,
    openTileMenu,
    openBarMenu,
    openBarCustomize,
    close,
    stepBack,
    moveBy,
    drop,
    pickTile,
    pressTileMenu,
    pressBarMenu,
    pressSpot,
    /** The row to draw: the one being moved, else the saved one. */
    previewRow: state?.kind === 'move' ? state.row : null,
    movingSlot: state?.kind === 'move' ? state.slot : -1,
    barSource,
    barShow,
    /** The saved row (the picker marks what is on Home). */
    rowForDraw: row,
  };
}

export type HomeEditor = ReturnType<typeof useHomeEditor>;

