// How the Live TV channel rows are drawn in the Classic and Compact layouts:
// Normal (each channel on two lines: the name, then what's on) or Slim (one
// line per channel: number, logo, name, what's on and when it ends, about ten
// channels on the screen at once). Chosen under Player Settings › Appearance
// and remembered on the box, like the layout (not per profile).
//
// A customer coming from TiviMate found the list "clunky": seven tall rows
// where he was used to ten. The Guide and the Vibez logo wall draw their own
// rows (lib/viewSize) and are not changed by it; nor is a phone held upright,
// whose rows are sized for a finger.
import { useEffect, useState } from 'react';

export type LiveRowSize = 'normal' | 'slim';

export const LIVE_ROW_SIZE_KEY = 'snow-livetv-rows';
export const LIVE_ROW_SIZE_EVENT = 'livetv:rows';
export const DEFAULT_LIVE_ROW_SIZE: LiveRowSize = 'normal';
export const LIVE_ROW_SIZES: LiveRowSize[] = ['normal', 'slim'];

/** A slim row's slot in the virtual list (px): the 34px row and 2px above
 *  and below, like the other rows' slots. At 960x540 the Compact column has
 *  411px for its rows (10 slim rows, 6.8 normal ones) and Classic, which
 *  shares its height with the preview, 282px (7 slim rows, 3.4 normal). */
export const SLIM_ROW_SLOT = 38;
/** The row inside the slot (ChannelRow's slim variant is drawn this tall). */
export const SLIM_ROW_H = SLIM_ROW_SLOT - 4;

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
