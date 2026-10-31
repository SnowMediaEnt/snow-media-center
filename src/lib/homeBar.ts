// What Home's content bar shows, as each viewer set it (Settings ›
// Home screen, or hold OK on the bar › Customize).
//
//   source: where the tiles come from — Live TV and Plex (the default),
//           Live TV only, Plex only, or Off (no bar at all: that is the
//           box's existing content-bar switch, useMediaBarEnabled);
//   show:   Recommendations (the default: what the bar always showed),
//           Continue watching only, or Favorites (the viewer's Live TV
//           favourites in their own order, then Plex My List).
//
// Kept per viewer profile (viewerProfileId), on the box. Off stays the box's
// own switch, as it always was.

import { useEffect, useState } from 'react';
import { onViewerChange, viewerProfileId } from '@/lib/viewer';
import { readMediaBarEnabled, setMediaBarEnabled, useMediaBarEnabled } from '@/hooks/useMediaBarEnabled';

export type BarSource = 'both' | 'live' | 'plex';
export type BarShow = 'recommended' | 'continue' | 'favorites';
export interface BarPrefs { source: BarSource; show: BarShow }

/** The Source choices, Off last (it is the bar's on/off switch). */
export const BAR_SOURCES: ReadonlyArray<BarSource | 'off'> = ['both', 'live', 'plex', 'off'];
export const BAR_SHOWS: readonly BarShow[] = ['recommended', 'continue', 'favorites'];
export const DEFAULT_BAR_PREFS: BarPrefs = { source: 'both', show: 'recommended' };

const STORE_PREFIX = 'smc-home-bar-v1:';
export const HOME_BAR_EVENT = 'smc:home-bar-changed';

export function loadBarPrefs(profile: string = viewerProfileId()): BarPrefs {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + profile);
    if (!raw) return DEFAULT_BAR_PREFS;
    const o = JSON.parse(raw) as { source?: unknown; show?: unknown };
    const source = (['both', 'live', 'plex'] as const).find((s) => s === o?.source) ?? 'both';
    const show = BAR_SHOWS.find((s) => s === o?.show) ?? 'recommended';
    return { source, show };
  } catch { return DEFAULT_BAR_PREFS; }
}

export function saveBarPrefs(prefs: BarPrefs, profile: string = viewerProfileId()): void {
  try { localStorage.setItem(STORE_PREFIX + profile, JSON.stringify(prefs)); } catch { /* the choice lasts until the app closes */ }
  try { window.dispatchEvent(new CustomEvent(HOME_BAR_EVENT, { detail: prefs })); } catch { /* ignore */ }
}

/** Pick a Source: Off switches the bar off; anything else switches it on. */
export function chooseBarSource(source: BarSource | 'off'): void {
  if (source === 'off') { setMediaBarEnabled(false); return; }
  saveBarPrefs({ ...loadBarPrefs(), source });
  if (!readMediaBarEnabled()) setMediaBarEnabled(true);
}

export function chooseBarShow(show: BarShow): void {
  saveBarPrefs({ ...loadBarPrefs(), show });
}

/** The bar's choices, kept current. `source` is 'off' while the bar is off. */
export function useBarPrefs(): { source: BarSource | 'off'; show: BarShow; prefs: BarPrefs } {
  const [enabled] = useMediaBarEnabled();
  const [prefs, setPrefs] = useState<BarPrefs>(() => loadBarPrefs());
  useEffect(() => {
    const read = () => {
      const next = loadBarPrefs();
      setPrefs((prev) => (prev.source === next.source && prev.show === next.show ? prev : next));
    };
    window.addEventListener(HOME_BAR_EVENT, read);
    const off = onViewerChange(read);
    return () => { window.removeEventListener(HOME_BAR_EVENT, read); off(); };
  }, []);
  return { source: enabled ? prefs.source : 'off', show: prefs.show, prefs };
}

/** Translation keys for the choices (Settings and the Customize panel). */
export const BAR_SOURCE_KEYS: Record<BarSource | 'off', string> = {
  both: 'homeEdit.bar.sourceBothChip', live: 'homeEdit.bar.sourceLiveChip', plex: 'homeEdit.bar.sourcePlexChip', off: 'homeEdit.bar.sourceOffChip',
};
export const BAR_SHOW_KEYS: Record<BarShow, string> = {
  recommended: 'homeEdit.bar.showRecommendedChip', continue: 'homeEdit.bar.showContinueChip', favorites: 'homeEdit.bar.showFavoritesChip',
};

/** The bar's heading for what it shows. */
export const BAR_HEADING_KEYS: Record<BarShow, string> = {
  recommended: 'home.mediaBar.heading', continue: 'homeEdit.bar.headingContinue', favorites: 'homeEdit.bar.headingFavorites',
};

/** Something the bar can hold: a channel (Live TV) or anything else (Plex). */
export interface BarTile { source: string; channel?: unknown }

const fromSource = (it: BarTile, source: BarSource) =>
  source === 'both' || (source === 'live' ? !!it.channel : !it.channel);

/**
 * The recommendation and continue rows for a Source and Show: the bar's own
 * list (viewer rows, then the shared Plex feed) with what was not asked for
 * left out. Continue keeps only what was being watched. (Favorites is its
 * own row: buildFavoritesBar.)
 */
export function filterBarItems<T extends BarTile>(items: readonly T[], prefs: BarPrefs): T[] {
  return items.filter((it) => fromSource(it, prefs.source) && (prefs.show !== 'continue' || it.source === 'history'));
}

/** Why the row for these choices is empty: a short hint's key. */
export function emptyHintKey(prefs: BarPrefs, ctx: { hasLines: boolean; hasPlex: boolean }): string {
  if (prefs.show === 'favorites') {
    if (prefs.source === 'plex') return 'homeEdit.bar.emptyMyList';
    return ctx.hasLines ? 'homeEdit.bar.emptyFavorites' : 'homeEdit.bar.emptyNoLive';
  }
  if (prefs.show === 'continue') return 'homeEdit.bar.emptyContinue';
  if (prefs.source === 'live' && !ctx.hasLines) return 'homeEdit.bar.emptyNoLive';
  if (prefs.source === 'plex' && !ctx.hasPlex) return 'homeEdit.bar.emptyNoPlex';
  return 'homeEdit.bar.emptyGeneric';
}
