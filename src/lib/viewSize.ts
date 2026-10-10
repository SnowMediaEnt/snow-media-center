// How big the Guide and the Live TV logo wall ("Vibez") are drawn: Compact
// (more channels on the screen) or Large (easier to read). Chosen under Live
// TV › Settings › Appearance ("Size") and remembered on the device, like the
// other appearance choices (not per profile).
//
// Owner (ported from Tronix, build 43): the Guide showed 3 channels where 8
// fit, and the logo wall lost much of the screen to space around tall tiles.
// Compact is the default (most rows on screen, no wasted padding, square
// logos, the Guide's categories in a drawer at the left); Large is the older,
// bigger look, for anyone who finds Compact small.
import { useEffect, useState } from 'react';

export type ViewSize = 'compact' | 'large';

export const VIEW_SIZE_KEY = 'snow-view-size';
export const VIEW_SIZE_EVENT = 'smc:view-size';
export const DEFAULT_VIEW_SIZE: ViewSize = 'compact';
export const VIEW_SIZES: ViewSize[] = ['compact', 'large'];

const isSize = (v: unknown): v is ViewSize => v === 'compact' || v === 'large';

export const loadViewSize = (): ViewSize => {
  try {
    const v = localStorage.getItem(VIEW_SIZE_KEY);
    if (isSize(v)) return v;
  } catch { /* private mode */ }
  return DEFAULT_VIEW_SIZE;
};

export const saveViewSize = (size: ViewSize): void => {
  try { localStorage.setItem(VIEW_SIZE_KEY, size); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(VIEW_SIZE_EVENT, { detail: size })); } catch { /* ignore */ }
};

/** The saved size, live: changing it in Settings redraws whoever shows it. */
export function useViewSize(): ViewSize {
  const [size, setSize] = useState<ViewSize>(() => loadViewSize());
  useEffect(() => {
    const on = () => setSize(loadViewSize());
    on();
    window.addEventListener(VIEW_SIZE_EVENT, on);
    return () => window.removeEventListener(VIEW_SIZE_EVENT, on);
  }, []);
  return size;
}
