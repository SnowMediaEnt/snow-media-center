// Which shape the Live TV browse screen takes. Chosen under Player Settings →
// Appearance and remembered on the device; every layout runs on the same
// data, focus and playback code — only the panes and the row shape differ.
import { useEffect, useState } from 'react';

export type LiveLayout = 'classic' | 'compact' | 'grid';

export const LIVE_LAYOUT_EVENT = 'livetv:layout';
const KEY = 'snow-livetv-layout';
export const DEFAULT_LIVE_LAYOUT: LiveLayout = 'compact';

export const LIVE_LAYOUTS: Array<{ id: LiveLayout; label: string; desc: string }> = [
  { id: 'classic', label: 'Classic', desc: 'Categories beside a tall channel list, preview above it' },
  { id: 'compact', label: 'Compact', desc: 'Slim channel list, categories one press away, big preview' },
  { id: 'grid', label: 'Grid', desc: 'Categories beside a wall of channel logos, OK plays' },
];

const isLayout = (v: unknown): v is LiveLayout => v === 'classic' || v === 'compact' || v === 'grid';

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
