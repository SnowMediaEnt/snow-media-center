// Which shape the Live TV browse screen takes. Chosen under Player Settings →
// Appearance and remembered on the device; every layout runs on the same
// data, focus and playback code — only the panes and the row shape differ.
import { useEffect, useState } from 'react';

export type LiveLayout = 'classic' | 'compact' | 'grid' | 'guide';

export const LIVE_LAYOUT_EVENT = 'livetv:layout';
const KEY = 'snow-livetv-layout';
export const DEFAULT_LIVE_LAYOUT: LiveLayout = 'compact';

// `label` and `desc` are the English names, kept for the Appearance screen until it is
// converted; the Live TV screens show t(labelKey) and t(descKey).
export const LIVE_LAYOUTS: Array<{ id: LiveLayout; label: string; desc: string; labelKey: string; descKey: string }> = [
  { id: 'classic', label: 'Classic', desc: 'Categories beside a tall channel list, preview above it', labelKey: 'live.layouts.classicLabel', descKey: 'live.layouts.classicDesc' },
  { id: 'compact', label: 'Compact', desc: 'Slim channel list, categories one press away, big preview', labelKey: 'live.layouts.compactLabel', descKey: 'live.layouts.compactDesc' },
  // Shown as "Vibez": the layout Vibez viewers know. The id stays 'grid' so
  // boxes that already chose it keep it.
  { id: 'grid', label: 'Vibez', desc: 'Categories beside a wall of channel logos, OK plays (no preview)', labelKey: 'live.layouts.gridLabel', descKey: 'live.layouts.gridDesc' },
  // The Guide as Live TV's own layout (ported from Tronix build 43): Live TV
  // opens straight into the Guide (LiveTV.tsx draws GuideSection where Live
  // TV's list would be), and a channel picked there plays in Live TV's
  // player. The side menu's Guide entry stays as it was.
  { id: 'guide', label: 'Guide', desc: "The TV guide: channels and what's on, a preview above", labelKey: 'live.layouts.guideLabel', descKey: 'live.layouts.guideDesc' },
];

const isLayout = (v: unknown): v is LiveLayout => v === 'classic' || v === 'compact' || v === 'grid' || v === 'guide';

/** True once a layout has been chosen on this box — the first-open chooser
 *  shows until then. Any saved value counts, including the default. */
export const hasLiveLayoutChoice = (): boolean => {
  try { return isLayout(localStorage.getItem(KEY)); } catch { return true; }
};

export const loadLiveLayout = (): LiveLayout => {
  try {
    const v = localStorage.getItem(KEY);
    if (isLayout(v)) return v;
  } catch { /* private mode */ }
  return DEFAULT_LIVE_LAYOUT;
};

export const saveLiveLayout = (layout: LiveLayout): void => {
  try { localStorage.setItem(KEY, layout); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(LIVE_LAYOUT_EVENT, { detail: layout })); } catch { /* ignore */ }
};

/** The saved layout, live: changing it in Settings re-renders the section. */
export function useLiveLayout(): LiveLayout {
  const [layout, setLayout] = useState<LiveLayout>(() => loadLiveLayout());
  useEffect(() => {
    const on = () => setLayout(loadLiveLayout());
    window.addEventListener(LIVE_LAYOUT_EVENT, on);
    return () => window.removeEventListener(LIVE_LAYOUT_EVENT, on);
  }, []);
  return layout;
}

/** The logo wall drawn Compact (lib/viewSize, the default; ported from Tronix
 *  build 43): square logo cards, the number and name under each (a long name
 *  a step smaller on two lines, never a scrolling one), 8px apart, as many a
 *  row as fit the wall's measured inner width. A tile is never narrower than
 *  tvWallMinTile: 96px on a 960px-wide screen (6 a row beside the categories,
 *  8 with them folded to a strip), up to 120px on a box that draws 1920 CSS
 *  pixels. `rowH` is the slot (the tile and 4px above and below), which Live
 *  TV's virtualizer and D-pad scroll math use as they are. Null until the
 *  wall is measured (the Large wall's 5 tiles in 176px slots meanwhile). */
export interface TvWallLayout {
  cols: number;
  /** Space between two tiles across (px). */
  gap: number;
  /** The slot's height (px): the tile and 4px above and below. */
  rowH: number;
  /** One tile's width (px), as the grid's equal columns draw it. */
  tileW: number;
}
/** Space between two tiles, across and down (4px slot padding each side). */
export const TV_WALL_GAP = 8;
/** The tile's padding over and beside its square logo card. */
export const TV_WALL_PAD = 4;
/** Under the square: the number and name on up to two lines (16px lines,
 *  3px above and below). */
export const TV_WALL_NAME_H = 38;
/** The narrowest tile for a screen this many CSS pixels wide. */
export const tvWallMinTile = (screenW: number): number =>
  Math.round(Math.min(120, Math.max(96, 96 + ((screenW || 960) - 960) / 40)));
export function tvWallLayout(inner: number, screenW: number): TvWallLayout | null {
  if (!(inner > 0)) return null;
  const min = tvWallMinTile(screenW);
  const cols = Math.max(3, Math.floor((inner + TV_WALL_GAP) / (min + TV_WALL_GAP)));
  const tileW = (inner - TV_WALL_GAP * (cols - 1)) / cols;
  // The tile: its 1px border top and bottom, the padding over the logo, the
  // square (the tile less its borders and the padding each side), the name.
  const tileH = 2 + TV_WALL_PAD + (tileW - 2 - 2 * TV_WALL_PAD) + TV_WALL_NAME_H;
  return { cols, gap: TV_WALL_GAP, rowH: Math.ceil(tileH) + 8, tileW };
}

/** What the folded categories strip shows of the open category (Compact
 *  wall on a TV): its first letter or digit, upper case ("Events" → "E",
 *  "| Local B" → "L"). Leading spaces, punctuation and symbols (emoji too)
 *  are skipped; explicit ranges, as Chrome 66 can't be trusted with \p{L}. */
export const stripInitial = (label: string | null | undefined): string => {
  const rest = String(label ?? '').replace(/^(?:[\s\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00bf\u00d7\u00f7\u2000-\u2bff\u3000-\u303f\ud800-\udfff]|\ufe0f)+/, '');
  return (Array.from(rest)[0] ?? '').toUpperCase();
};
