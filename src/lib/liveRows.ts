// How the Live TV channel rows are drawn in the Classic and Compact layouts:
// Normal (each channel on two lines: the name, then what's on) or Slim (one
// line per channel: number, logo, name, what's on and when it ends, about ten
// channels on the screen at once). Chosen under Player Settings › Appearance
// and remembered per profile on the box, like the layout (lib/profiles
// PROFILE_KEYS).
//
// A customer coming from TiviMate found the list "clunky": seven tall rows
// where he was used to ten. The Guide and the Vibez logo wall draw their own
// rows (lib/viewSize) and are not changed by it; nor is a phone held upright,
// whose rows are sized for a finger. Normal rows were made thinner too
// (2026-10-23), then drawn like Tronix's list (2026-10-24, NORMAL_ROW_SLOT).
import { useEffect, useState } from 'react';

export type LiveRowSize = 'normal' | 'slim';

export const LIVE_ROW_SIZE_KEY = 'snow-livetv-rows';
export const LIVE_ROW_SIZE_EVENT = 'livetv:rows';
export const DEFAULT_LIVE_ROW_SIZE: LiveRowSize = 'normal';
export const LIVE_ROW_SIZES: LiveRowSize[] = ['normal', 'slim'];

/** A slim row's slot in the virtual list (px): the 34px row and 2px above
 *  and below, like the other rows' slots. At 960x540 the Compact column has
 *  411px for its rows (10 slim rows, 8.2 normal ones) and Classic, which
 *  shares its height with the preview, 282px (7 slim rows, 5.6 normal). */
export const SLIM_ROW_SLOT = 38;
/** The row inside the slot (ChannelRow's slim variant is drawn this tall). */
export const SLIM_ROW_H = SLIM_ROW_SLOT - 4;

/**
 * Normal rows' slot (px), the row drawn 4px shorter in it (ChannelRow), the
 * same in Classic and Compact since 2026-10-24: the Tronix channel list the
 * owner likes (a round logo; the name, its star and the programme's times on
 * the first line; what's on under it; a thin progress line under the words),
 * "maybe 10% thicker": its 42px row is 46 here.
 *   Classic: 5.6 rows in the 282px under the preview at 960x540 (was 5.2).
 *   Compact: 8.2 rows in 411px (was 8.9).
 * Before 2026-10-23 they were 84 (Classic) and 60 (Compact). Slim stays the
 * thinnest (38). A phone held upright keeps the 56px row in 60: its rows are
 * sized for a finger.
 */
export const NORMAL_ROW_SLOT = 50;
export const NORMAL_ROW_H = NORMAL_ROW_SLOT - 4;
export const CLASSIC_ROW_SLOT = NORMAL_ROW_SLOT;
export const COMPACT_ROW_SLOT = NORMAL_ROW_SLOT;
export const UPRIGHT_ROW_SLOT = 60;

/** The slot a channel row gets in the Classic or Compact list (the D-pad's
 *  scroll math uses it). Any other list layout draws Compact rows. */
export const listRowSlot = (layout: string, opts: { slim?: boolean; upright?: boolean } = {}): number =>
  opts.upright ? UPRIGHT_ROW_SLOT : opts.slim ? SLIM_ROW_SLOT : layout === 'classic' ? CLASSIC_ROW_SLOT : COMPACT_ROW_SLOT;

const isRowSize = (v: unknown): v is LiveRowSize => v === 'normal' || v === 'slim';

export const loadLiveRowSize = (): LiveRowSize => {
  try {
    const v = localStorage.getItem(LIVE_ROW_SIZE_KEY);
    if (isRowSize(v)) return v;
  } catch { /* private mode */ }
  return DEFAULT_LIVE_ROW_SIZE;
};

export const saveLiveRowSize = (size: LiveRowSize): void => {
  try { localStorage.setItem(LIVE_ROW_SIZE_KEY, size); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(LIVE_ROW_SIZE_EVENT, { detail: size })); } catch { /* ignore */ }
};

/** The saved row size, live: changing it in Settings redraws the list. */
export function useLiveRowSize(): LiveRowSize {
  const [size, setSize] = useState<LiveRowSize>(() => loadLiveRowSize());
  useEffect(() => {
    const on = () => setSize(loadLiveRowSize());
    window.addEventListener(LIVE_ROW_SIZE_EVENT, on);
    return () => window.removeEventListener(LIVE_ROW_SIZE_EVENT, on);
  }, []);
  return size;
}
