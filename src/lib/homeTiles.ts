// Home's four big tiles, as each viewer arranged them.
//
// Hold OK on a tile (or a finger on a touch screen) for its menu: Move it
// along the row, change it into a shortcut for another part of the app, or
// put the row back the way it came. There are always four (Home is laid out
// for four). Each one is a destination below: its own icon, name and colour,
// and the way the app already opens that place (a Player section, a Support
// tool, a screen) — nothing here is a new screen.
//
// WHAT IS KEPT: per viewer profile (viewerProfileId, as favoritesOrder keeps
// Live TV's own order), the four destinations left to right. On the box only.
// A Kids profile is not offered the menu (its Home stays as it is, the way
// its Settings stays short), and is only ever drawn its own places: a stored
// tile it may not open (or one the box cannot open: no Player, no recorder)
// is drawn as that slot's default instead, and nothing is lost — the stored
// row is left as it was.

import { useEffect, useState } from 'react';
import { onViewerChange, viewerProfileId } from '@/lib/viewer';
import type { KidsLevel } from '@/lib/kidsFilter';
import { homeCardIds } from '@/lib/kidsGameNavigation';
import { openPlayerFromHome, openSupportTool, type Navigate } from '@/lib/appActions';
import { openVoice } from '@/lib/voiceUi';

export type TileDest =
  | 'livetv' | 'plex' | 'support' | 'store' | 'kids-games'
  | 'guide' | 'gameday' | 'multi' | 'favorites' | 'recordings' | 'movies' | 'series'
  | 'search' | 'settings' | 'speedtest' | 'buffering' | 'ai-chat';

/** The tile's colour: one of Home's card gradients (index.css). */
export type TileColor = 'navy' | 'blue' | 'gold' | 'purple' | 'teal' | 'green' | 'slate' | 'rose' | 'red' | 'orange' | 'indigo';

export interface TileDef {
  id: TileDest;
  /** Translation keys (the first five keep the words Home always had). */
  titleKey: string;
  descKey: string;
  tagKey?: string;
  color: TileColor;
  /** Opens inside the Player (gone with it when the Player is switched off). */
  player?: boolean;
  /** Who may have it: everyone, grown-ups only, or Kids profiles only. */
  who: 'all' | 'grownup' | 'kids';
  /** Not on a Little or Kids profile (a Teens one has it): Game Day. */
  teenUp?: boolean;
  /** Needs the box's recorder. */
  recorder?: boolean;
}

/** Every destination, in the order the picker lists them. */
export const TILE_DESTS: readonly TileDef[] = [
  { id: 'livetv', titleKey: 'home.liveTv.title', descKey: 'home.liveTv.description', color: 'navy', player: true, who: 'all' },
  { id: 'plex', titleKey: 'home.plex.title', descKey: 'home.plex.description', tagKey: 'home.plex.tag', color: 'blue', player: true, who: 'all' },
  { id: 'support', titleKey: 'home.support.title', descKey: 'home.support.description', color: 'gold', who: 'all' },
  { id: 'store', titleKey: 'home.store.title', descKey: 'home.store.description', color: 'purple', who: 'grownup' },
  { id: 'kids-games', titleKey: 'home.kidsLounge.title', descKey: 'home.kidsLounge.description', color: 'purple', who: 'kids' },
  { id: 'guide', titleKey: 'homeEdit.dest.guideTitle', descKey: 'homeEdit.dest.guideDesc', color: 'teal', player: true, who: 'all' },
  { id: 'gameday', titleKey: 'homeEdit.dest.gameDayTitle', descKey: 'homeEdit.dest.gameDayDesc', color: 'green', player: true, who: 'all', teenUp: true },
  { id: 'multi', titleKey: 'homeEdit.dest.multiTitle', descKey: 'homeEdit.dest.multiDesc', color: 'slate', player: true, who: 'all' },
  { id: 'favorites', titleKey: 'homeEdit.dest.favoritesTitle', descKey: 'homeEdit.dest.favoritesDesc', color: 'rose', player: true, who: 'all' },
  { id: 'recordings', titleKey: 'homeEdit.dest.recordingsTitle', descKey: 'homeEdit.dest.recordingsDesc', color: 'red', player: true, who: 'grownup', recorder: true },
  { id: 'movies', titleKey: 'homeEdit.dest.moviesTitle', descKey: 'homeEdit.dest.moviesDesc', color: 'orange', player: true, who: 'all' },
  { id: 'series', titleKey: 'homeEdit.dest.seriesTitle', descKey: 'homeEdit.dest.seriesDesc', color: 'indigo', player: true, who: 'all' },
  { id: 'search', titleKey: 'homeEdit.dest.searchTitle', descKey: 'homeEdit.dest.searchDesc', color: 'teal', who: 'all' },
  { id: 'settings', titleKey: 'homeEdit.dest.settingsTitle', descKey: 'homeEdit.dest.settingsDesc', color: 'slate', who: 'all' },
  { id: 'speedtest', titleKey: 'homeEdit.dest.speedTestTitle', descKey: 'homeEdit.dest.speedTestDesc', color: 'green', who: 'all' },
  { id: 'buffering', titleKey: 'homeEdit.dest.bufferingTitle', descKey: 'homeEdit.dest.bufferingDesc', color: 'orange', who: 'all' },
  { id: 'ai-chat', titleKey: 'homeEdit.dest.aiChatTitle', descKey: 'homeEdit.dest.aiChatDesc', color: 'indigo', who: 'all' },
];

const BY_ID = new Map<TileDest, TileDef>(TILE_DESTS.map((d) => [d.id, d]));
export const tileDef = (id: TileDest): TileDef => BY_ID.get(id)!;
const isDest = (v: unknown): v is TileDest => typeof v === 'string' && BY_ID.has(v as TileDest);

export const TILE_COUNT = 4;

/** What this box and this viewer can have on a tile. */
export interface TileContext {
  kidsLevel: KidsLevel | null;
  playerEnabled: boolean;
  /** The box records (a native recorder, not the website demo). */
  recorder: boolean;
}

/** Whether this viewer may have, and this box can open, the destination. */
export function tileAllowed(id: TileDest, ctx: TileContext): boolean {
  const d = BY_ID.get(id);
  if (!d) return false;
  if (d.who === 'grownup' && ctx.kidsLevel) return false;
  if (d.who === 'kids' && !ctx.kidsLevel) return false;
  if (d.teenUp && (ctx.kidsLevel === 'little' || ctx.kidsLevel === 'kids')) return false;
  if (d.player && !ctx.playerEnabled) return false;
  if (d.recorder && !ctx.recorder) return false;
  return true;
}

/** The destinations the picker offers this viewer, in its order. */
export const pickableTiles = (ctx: TileContext): TileDef[] => TILE_DESTS.filter((d) => tileAllowed(d.id, ctx));

/** The four Home has always had: Live TV, Plex, Support and the Store (a
 *  Kids profile: its Game Lounge in the Store's place, before Support). */
export function defaultTiles(kids: KidsLevel | null): TileDest[] {
  return homeCardIds(true, kids) as TileDest[];
}

// ── storage ────────────────────────────────────────────────────────────────

const STORE_PREFIX = 'smc-home-tiles-v1:';
/** Fired on every save, so Home and Settings re-read. */
export const HOME_TILES_EVENT = 'smc:home-tiles-changed';

/** The profile's saved row, or null (never arranged: the defaults). */
export function loadSavedTiles(profile: string = viewerProfileId()): TileDest[] | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + profile);
    if (!raw) return null;
    const o = JSON.parse(raw) as { tiles?: unknown };
    if (!Array.isArray(o?.tiles) || o.tiles.length !== TILE_COUNT || !o.tiles.every(isDest)) return null;
    return o.tiles as TileDest[];
  } catch { return null; }
}

/** Save the profile's row (null: back to the defaults). False when the box would not keep it. */
export function saveTiles(tiles: readonly TileDest[] | null, profile: string = viewerProfileId()): boolean {
  let kept = true;
  try {
    if (tiles === null) localStorage.removeItem(STORE_PREFIX + profile);
    else localStorage.setItem(STORE_PREFIX + profile, JSON.stringify({ tiles: tiles.slice(0, TILE_COUNT) }));
  } catch { kept = false; }
  try { window.dispatchEvent(new CustomEvent(HOME_TILES_EVENT)); } catch { /* ignore */ }
  return kept;
}

/** The row to draw: the saved one (or the defaults), each tile this viewer
 *  may not have, or this box cannot open, shown as its slot's default, and
 *  then, with the Player off, the Player's tiles left out (Home always drew
 *  fewer cards then). */
export function arrangeTiles(saved: readonly TileDest[] | null, ctx: TileContext): TileDest[] {
  const defaults = defaultTiles(ctx.kidsLevel);
  const row = (saved && saved.length === TILE_COUNT ? saved : defaults).map((id, i) => (tileAllowed(id, { ...ctx, playerEnabled: true }) ? id : defaults[i]));
  // No tile twice (a default brought back in may repeat one moved elsewhere):
  // the repeat takes the first default not on the row.
  const seen = new Set<TileDest>();
  const out = row.map((id) => {
    if (!seen.has(id)) { seen.add(id); return id; }
    const free = defaults.find((d) => !seen.has(d) && !row.includes(d)) ?? pickableTiles({ ...ctx, playerEnabled: true }).find((d) => !seen.has(d.id) && !row.includes(d.id))?.id;
    if (free) { seen.add(free); return free; }
    return id;
  });
  return ctx.playerEnabled ? out : out.filter((id) => !tileDef(id).player);
}

/** The row with the tile at `from` carried to `to` (the others close up). */
export function moveTile(tiles: readonly TileDest[], from: number, to: number): TileDest[] {
  const out = tiles.slice();
  if (from < 0 || from >= out.length) return out;
  const at = Math.max(0, Math.min(out.length - 1, to));
  const [t] = out.splice(from, 1);
  out.splice(at, 0, t);
  return out;
}

/** The row with the tile at `slot` changed to `dest`. A destination already
 *  on another tile swaps places with it, so no place is there twice. */
export function setTile(tiles: readonly TileDest[], slot: number, dest: TileDest): TileDest[] {
  const out = tiles.slice();
  if (slot < 0 || slot >= out.length) return out;
  const other = out.indexOf(dest);
  if (other >= 0 && other !== slot) out[other] = out[slot];
  out[slot] = dest;
  return out;
}

/** Open what a tile is a shortcut to. Player places come Home on Back. */
export function openTile(id: TileDest, navigate: Navigate): void {
  switch (id) {
    case 'livetv': openPlayerFromHome({ section: 'live' }, navigate); break;
    case 'plex': openPlayerFromHome({ section: 'movies' }, navigate); break;
    case 'guide': openPlayerFromHome({ section: 'guide' }, navigate); break;
    case 'gameday': openPlayerFromHome({ section: 'gameday' }, navigate); break;
    case 'multi': openPlayerFromHome({ section: 'multi' }, navigate); break;
    case 'favorites': openPlayerFromHome({ section: 'live', open: 'favorites' }, navigate); break;
    case 'recordings': openPlayerFromHome({ section: 'live', open: 'recordings' }, navigate); break;
    case 'movies': openPlayerFromHome({ section: 'vod-movies' }, navigate); break;
    case 'series': openPlayerFromHome({ section: 'vod-series' }, navigate); break;
    case 'support': navigate('support'); break;
    case 'store': navigate('store'); break;
    case 'kids-games': navigate('kids-games'); break;
    case 'settings': navigate('settings'); break;
    case 'search': openVoice(); break;
    case 'speedtest': openSupportTool('speedtest', navigate); break;
    case 'buffering': openSupportTool('buffering', navigate); break;
    case 'ai-chat': openSupportTool('ai', navigate); break;
  }
}

/** The profile's saved row, kept current: re-read on every save and when
 *  the viewer changes profile. */
export function useSavedTiles(): TileDest[] | null {
  const [tiles, setTiles] = useState<TileDest[] | null>(() => loadSavedTiles());
  useEffect(() => {
    const read = () => {
      const next = loadSavedTiles();
      setTiles((prev) => (prev && next && prev.join() === next.join()) || (!prev && !next) ? prev : next);
    };
    window.addEventListener(HOME_TILES_EVENT, read);
    const off = onViewerChange(read);
    return () => { window.removeEventListener(HOME_TILES_EVENT, read); off(); };
  }, []);
  return tiles;
}
