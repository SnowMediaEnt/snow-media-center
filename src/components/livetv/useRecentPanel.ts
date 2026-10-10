// The Recently watched panel's state and keys: ▶ in Live TV brings up the
// last channels watched, and one channel at a time can be taken off it.
//
// LiveSection opens it (▶ with the full-screen bar hidden, ▶ at the right
// edge of the channel list) and hands it the keys while it is open:
//   ▲▼ move · OK switches to the channel (LiveSection's onPick: the normal
//   channel change) · hold OK, or ▶ then OK on Remove, takes that one channel
//   off Recently watched · ◀ (from Remove: back to the row) or Back closes it.
// Like the channel list over the picture, it closes itself after a while idle.
// Drawing: RecentChannelsPanel.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { XtreamCreds } from '@/lib/xtream';
import { loadWatchHistory, removeWatchEntry, WATCH_HISTORY_EVENT } from '@/lib/watchHistory';
import { viewerKey } from '@/lib/viewer';
import { recentChannelsFrom, type RecentChannel } from '@/lib/recentChannels';
import { kidsLevel } from '@/lib/kidsFilter';

/** Held this long, OK takes the channel off the list (as Hold OK elsewhere). */
export const RECENT_HOLD_MS = 600;
/** Closes itself after this long without a key. */
export const RECENT_IDLE_MS = 15_000;

export interface RecentPanelOptions {
  lines: XtreamCreds[];
  /** Hidden category ids per line (Hide Categories). */
  hidden: ReadonlyMap<string, ReadonlySet<string>>;
  /** A Kids profile: the category ids each line lets it open. */
  kidsCats: () => ReadonlyMap<string, ReadonlySet<string>> | null;
  /** The channel on screen (recentChannelId), to mark it and start past it. */
  playingId: () => string | null;
  /** OK on a row: the panel is already closed. */
  onPick: (c: RecentChannel) => void;
}

export interface RecentPanel {
  open: boolean;
  items: RecentChannel[];
  focus: number;
  /** The highlight is on the focused row's Remove. */
  onRemove: boolean;
  isOpen: () => boolean;
  openPanel: () => void;
  close: () => void;
  /** A keydown while it is open (LiveSection hands every one over). */
  key: (e: KeyboardEvent) => void;
  remove: (i: number) => void;
  pick: (i: number) => void;
}

const readRows = (o: RecentPanelOptions): RecentChannel[] => {
  try {
    return recentChannelsFrom(loadWatchHistory(viewerKey()), o.lines, { hidden: o.hidden, kidsCats: kidsLevel() ? o.kidsCats() : null });
  } catch { return []; }
};

export function useRecentPanel(opts: RecentPanelOptions): RecentPanel {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecentChannel[]>([]);
  const [focus, setFocus] = useState(0);
  const [onRemove, setOnRemove] = useState(false);
  const openRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;
  const idleRef = useRef<number | null>(null);
  const holdRef = useRef<number | null>(null);
  // OK held long enough removed the row: its release is not also a pick.
  const heldRef = useRef(false);

  const clearHold = () => { if (holdRef.current) { window.clearTimeout(holdRef.current); holdRef.current = null; } };
  const close = useCallback(() => {
    if (idleRef.current) { window.clearTimeout(idleRef.current); idleRef.current = null; }
    clearHold();
    heldRef.current = false;
    openRef.current = false;
    setOpen(false);
    setOnRemove(false);
  }, []);
  const poke = useCallback(() => {
    if (idleRef.current) window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(close, RECENT_IDLE_MS) as unknown as number;
  }, [close]);
  useEffect(() => () => {
    if (idleRef.current) window.clearTimeout(idleRef.current);
    if (holdRef.current) window.clearTimeout(holdRef.current);
  }, []);

  const openPanel = useCallback(() => {
    const rows = readRows(optsRef.current);
    const playing = optsRef.current.playingId();
    // On the channel before the one on screen: OK straight away is "back to
    // the last channel".
    const first = rows.findIndex((r) => r.id !== playing);
    setItems(rows);
    setFocus(first >= 0 ? first : 0);
    setOnRemove(false);
    heldRef.current = false;
    openRef.current = true;
    setOpen(true);
    poke();
  }, [poke]);

  // Something came into history while it is open (the channel on screen
  // after its few seconds): drawn again, the highlight kept on the same
  // channel.
  useEffect(() => {
    if (!open) return undefined;
    const reread = () => {
      const rows = readRows(optsRef.current);
      const at = itemsRef.current[focusRef.current]?.key;
      setItems(rows);
      const i = at ? rows.findIndex((r) => r.key === at) : -1;
      setFocus(i >= 0 ? i : Math.min(focusRef.current, Math.max(0, rows.length - 1)));
    };
    window.addEventListener(WATCH_HISTORY_EVENT, reread);
    return () => window.removeEventListener(WATCH_HISTORY_EVENT, reread);
  }, [open]);

  const pick = useCallback((i: number) => {
    const c = itemsRef.current[i];
    if (!c) return;
    close();
    optsRef.current.onPick(c);
  }, [close]);

  const remove = useCallback((i: number) => {
    const c = itemsRef.current[i];
    if (!c) return;
    poke();
    const rest = itemsRef.current.filter((r) => r !== c);
    itemsRef.current = rest;
    setItems(rest);
    setFocus(Math.min(i, Math.max(0, rest.length - 1)));
    if (!rest.length) setOnRemove(false);
    void removeWatchEntry('channel', c.key).catch(() => undefined);
  }, [poke]);

  // OK released before the hold: switch to the channel.
  useEffect(() => {
    if (!open) return undefined;
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (heldRef.current) { heldRef.current = false; return; }
      if (!holdRef.current) return;
      clearHold();
      pick(focusRef.current);
    };
    window.addEventListener('keyup', up, true);
    return () => window.removeEventListener('keyup', up, true);
  }, [open, pick]);

  const key = useCallback((e: KeyboardEvent) => {
    poke();
    const n = itemsRef.current.length;
    const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
    if (isBack) { close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setFocus((f) => (f + d + n) % n);
      return;
    }
    if (e.key === 'ArrowRight') { if (n) setOnRemove(true); return; }
    if (e.key === 'ArrowLeft') {
      if (onRemoveRef.current) setOnRemove(false);
      else close();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.repeat || !n) return;
      if (onRemoveRef.current) { remove(focusRef.current); return; }
      if (holdRef.current) return;
      heldRef.current = false;
      holdRef.current = window.setTimeout(() => {
        holdRef.current = null;
        heldRef.current = true;
        remove(focusRef.current);
      }, RECENT_HOLD_MS) as unknown as number;
    }
  }, [close, poke, remove]);

  const isOpen = useCallback(() => openRef.current, []);

  return { open, items, focus, onRemove, isOpen, openPanel, close, key, remove, pick };
}
