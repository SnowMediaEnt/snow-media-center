// Live TV's Favorites in the viewer's own order, or A–Z (a viewer coming
// from TiviMate asked for both).
//
// WHAT IS KEPT: per viewer profile (viewerProfileId, the same split
// favoritesSync makes for the lists themselves), a sort mode — 'mine' (the
// viewer's own order, the default) or 'az' — and the viewer's own order. The
// order is ONE list across every line, so "Favorites · all services" and each
// line's own Favorites always agree: a line's list is the shared order with
// the other lines left out. Picking A–Z keeps the own order; going back to
// "my way" shows it again.
//
// WHAT IT IS NOT: the favourites themselves. Those stay per line in
// favoritesSync (saved on the box, synced with the account). The order only
// arranges what is there:
//   • a favourite the order does not name yet (added here, or on another box
//     and brought in by the sync) goes at the end, in the order it was added;
//   • a favourite that is gone is not shown; its entry is dropped the next
//     time the order is saved;
//   • a favourite the provider re-linked (LiveSection's healFavorites: the
//     same name, a new stream id) keeps its place: an entry whose id is gone
//     goes to a favourite of the same line with the same name that the order
//     does not name yet.
//
// KEPT ON THE BOX, NOT SYNCED. The player-favorites row does keep its array
// in order, so one line's order could ride along, but:
//   • the shared order spans several lines, and each line is its own row;
//   • a conflict merge puts the account's copy first (favoritesSync union),
//     so another box's order would quietly replace this one's;
//   • every move would be one more push, and every push signs in to the
//     provider's panel (panels ban bursts of sign-ins);
//   • A–Z or not is how this viewer likes to look at the list on this TV.
// Syncing it properly wants its own field on the server.

import { useEffect, useState } from 'react';
import { onViewerChange, viewerProfileId } from '@/lib/viewer';

export type FavSortMode = 'mine' | 'az';

/** One favourite as the order knows it: its line (favoritesSync lineKey),
 *  its stream id, and its name (what A–Z sorts by, and what finds a
 *  re-linked favourite its place). */
export interface FavRef {
  line: string;
  id: number;
  name: string;
}

export interface FavOrder {
  mode: FavSortMode;
  /** The viewer's own order, first to last. May name favourites that are
   *  gone and miss ones added since (see above). */
  keys: FavRef[];
}

const STORE_PREFIX = 'snow-livetv-fav-order-v1:';
/** Fired on every save, so every list on screen (Live TV, the Guide) re-reads. */
export const FAV_ORDER_EVENT = 'smc:fav-order-changed';
export const EMPTY_FAV_ORDER: FavOrder = { mode: 'mine', keys: [] };

/** A favourite's place in the order: its line and stream id. */
export const favRefKey = (line: string, id: number): string => `${line}|${id}`;
const refKey = (r: FavRef): string => favRefKey(r.line, r.id);
const nameKey = (line: string, name: string): string => `${line}|${name.trim().toLowerCase()}`;
const same = (r: FavRef): FavRef => r;

/** The profile's order (the box's copy; nothing here throws). */
export function loadFavOrder(profile: string = viewerProfileId()): FavOrder {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + profile);
    if (!raw) return EMPTY_FAV_ORDER;
    const o = JSON.parse(raw) as { mode?: unknown; keys?: unknown };
    const keys: FavRef[] = [];
    if (Array.isArray(o.keys)) {
      for (const k of o.keys) {
        // Stored as [line, id, name]: a few hundred of them stay small.
        if (!Array.isArray(k) || typeof k[0] !== 'string' || typeof k[1] !== 'number' || !Number.isFinite(k[1])) continue;
        keys.push({ line: k[0], id: k[1], name: typeof k[2] === 'string' ? k[2] : '' });
      }
    }
    return { mode: o.mode === 'az' ? 'az' : 'mine', keys };
  } catch {
    return EMPTY_FAV_ORDER;
  }
}

/** Save the profile's order and tell every list on screen. */
export function saveFavOrder(order: FavOrder, profile: string = viewerProfileId()): void {
  const seen = new Set<string>();
  const keys: Array<[string, number, string]> = [];
  for (const r of order.keys) {
    const k = refKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    keys.push([r.line, r.id, r.name]);
  }
  try { localStorage.setItem(STORE_PREFIX + profile, JSON.stringify({ mode: order.mode, keys })); } catch { /* full or blocked: the order on screen still holds */ }
  try { window.dispatchEvent(new CustomEvent(FAV_ORDER_EVENT)); } catch { /* ignore */ }
}

/**
 * `items` (every favourite in the list, in the order they were added) in the
 * viewer's own order: the ones `saved` names in its order, then the rest as
 * they came. A new array; `items` is left alone.
 */
export function mineOrder<T>(items: readonly T[], saved: readonly FavRef[], ref: (t: T) => FavRef): T[] {
  if (saved.length === 0 || items.length < 2) return items.slice();
  const refs = items.map(ref);
  const at = new Map<string, number>();
  refs.forEach((r, i) => { const k = refKey(r); if (!at.has(k)) at.set(k, i); });
  // Favourites the order does not name, by line and name: where a re-linked
  // favourite's new stream id is found.
  const named = new Set(saved.map(refKey));
  const unnamed = new Map<string, number[]>();
  refs.forEach((r, i) => {
    if (named.has(refKey(r))) return;
    const nk = nameKey(r.line, r.name);
    const list = unnamed.get(nk);
    if (list) list.push(i); else unnamed.set(nk, [i]);
  });
  const slotOf = new Array<number>(items.length).fill(-1);
  const bySlot = new Array<number | undefined>(saved.length);
  saved.forEach((s, slot) => {
    let i = at.get(refKey(s));
    if (i === undefined && s.name) i = unnamed.get(nameKey(s.line, s.name))?.shift();
    if (i === undefined || slotOf[i] >= 0) return;
    slotOf[i] = slot;
    bySlot[slot] = i;
  });
  const out: T[] = [];
  for (const i of bySlot) if (i !== undefined) out.push(items[i]);
  items.forEach((t, i) => { if (slotOf[i] < 0) out.push(t); });
  return out;
}

// One collator for every sort (building one per comparison is slow on
// Chromium 66). Natural numbers: "Channel 2" before "Channel 10". Case and
// accents do not count. The box's own language decides the rest.
let collator: Intl.Collator | null | undefined;
const compareNames = (a: string, b: string): number => {
  if (collator === undefined) {
    try { collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }); } catch { collator = null; }
  }
  if (collator) return collator.compare(a, b);
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** `items` A–Z by the name the list shows. Two with the same name keep the
 *  order they came in (Chromium 66's sort is not stable, so that is said
 *  outright, not left to the sort). */
export function azOrder<T>(items: readonly T[], name: (t: T) => string): T[] {
  return items
    .map((t, i) => ({ t, i, n: (name(t) || '').trim() }))
    .sort((a, b) => compareNames(a.n, b.n) || a.i - b.i)
    .map((x) => x.t);
}

/** A Favorites list as the viewer wants it: their own order, or A–Z (ties in their own order). */
export function arrangeFavorites<T>(items: readonly T[], order: FavOrder, ref: (t: T) => FavRef): T[] {
  const mine = mineOrder(items, order.keys, ref);
  return order.mode === 'az' ? azOrder(mine, (t) => ref(t).name) : mine;
}

/**
 * Move one favourite along the list on screen.
 *
 * `all` is every favourite in the viewer's order (mineOrder of all of them);
 * `shown` says which of them the list on screen holds (a line's Favorites
 * holds only that line's, "all services" holds every one). The favourite
 * `key` goes `delta` places along that list, held at its ends: it lands next
 * to the favourite now in that place, wherever the other lines' favourites
 * sit between them. Returns the new order and its place in the list on
 * screen, or null when it cannot go further.
 */
export function moveFavorite(
  all: readonly FavRef[],
  shown: ReadonlySet<string>,
  key: string,
  delta: number,
): { order: FavRef[]; index: number } | null {
  const list = all.filter((r) => shown.has(refKey(r)));
  const from = list.findIndex((r) => refKey(r) === key);
  if (from < 0 || delta === 0) return null;
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (to === from) return null;
  const moving = list[from];
  const anchor = refKey(list[to]);
  const order = all.filter((r) => refKey(r) !== key);
  const at = order.findIndex((r) => refKey(r) === anchor);
  order.splice(delta < 0 ? at : at + 1, 0, moving);
  return { order, index: to };
}

/**
 * The order to save after a change: `next` (every favourite of the lines
 * whose lists are loaded), then what the saved order said about any other
 * line — a service that is signed out for a while keeps its order.
 */
export function withOtherLines(next: readonly FavRef[], saved: readonly FavRef[], loaded: ReadonlySet<string>): FavRef[] {
  const out = next.slice();
  const seen = new Set(next.map(refKey));
  for (const r of saved) {
    const k = refKey(r);
    if (loaded.has(r.line) || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Every favourite of these lines, in the order they were added, as the order knows them. */
export function favRefsOf(lines: readonly string[], favsByLine: ReadonlyMap<string, ReadonlyMap<number, { stream_id: number; name: string }>>): FavRef[] {
  const out: FavRef[] = [];
  for (const line of lines) {
    for (const f of favsByLine.get(line)?.values() ?? []) out.push({ line, id: f.stream_id, name: f.name });
  }
  return out;
}

/** The same favourites in the viewer's own order (mineOrder for FavRefs). */
export const mineRefs = (present: readonly FavRef[], saved: readonly FavRef[]): FavRef[] => mineOrder(present, saved, same);

const sameOrder = (a: FavOrder, b: FavOrder): boolean =>
  a.mode === b.mode && a.keys.length === b.keys.length && a.keys.every((r, i) => {
    const o = b.keys[i];
    return r.line === o.line && r.id === o.id && r.name === o.name;
  });

/** The profile's order, kept current: re-read on every save (here or on
 *  another screen) and when the viewer changes profile. */
export function useFavoritesOrder(): FavOrder {
  const [order, setOrder] = useState<FavOrder>(() => loadFavOrder());
  useEffect(() => {
    const read = () => {
      const next = loadFavOrder();
      setOrder((prev) => (sameOrder(prev, next) ? prev : next));
    };
    window.addEventListener(FAV_ORDER_EVENT, read);
    const off = onViewerChange(read);
    return () => { window.removeEventListener(FAV_ORDER_EVENT, read); off(); };
  }, []);
  return order;
}
