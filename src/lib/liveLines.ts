/**
 * The Live TV pane shows EVERY line signed in on this box at once, grouped
 * by service, so a viewer with a Dreamstreams line and a Vibez line does not
 * switch accounts to move between them. This module holds what that needs
 * on the device: which lines to show, which groups are folded up, and which
 * categories the viewer has hidden. Nothing here talks to a panel.
 */
import { lineKey } from '@/lib/favoritesSync';
import { outsideLinesFor, type OutsideState } from '@/lib/outsideSource';
import type { SavedAccount, XtreamCreds } from '@/lib/xtream';

/** Fired after a hidden-category change so an open Live TV pane re-reads. */
export const HIDDEN_CATEGORIES_EVENT = 'livetv:hidden-categories';
const HIDDEN_PREFIX = 'snow-livetv-hidden:';
const COLLAPSED_KEY = 'snow-livetv-collapsed-lines';

export { lineKey };

/**
 * The lines the pane shows: the active one first (it drives Movies, Series
 * and the account screen), then every other saved account that still has a
 * password. Two saved accounts on the same line count once.
 *
 * `outside` (lib/outsideSource, loadOutsideState): the service the viewer
 * added from elsewhere comes last, and only while the active line is an
 * active DreamStreams or Vibez one and the line that added it is on this box
 * (the active one or a saved account). Left out by the screens it does not
 * belong on: Game Day sends line data to our server, and the Home content bar
 * would download a whole playlist behind the viewer's back.
 */
export const buildLines = (active: XtreamCreds, saved: SavedAccount[], outside?: OutsideState | null): XtreamCreds[] => {
  const out: XtreamCreds[] = [active];
  const seen = new Set([lineKey(active)]);
  for (const a of saved) {
    if (!a.host || !a.username || !a.password) continue;
    const c: XtreamCreds = { host: a.host, username: a.username, password: a.password, output: a.output || 'm3u8', serverLabel: a.serverLabel };
    const k = lineKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  for (const c of outsideLinesFor(active, outside, saved)) {
    const k = lineKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
};

/** The name a group is shown under. Falls back to the host when a line was saved without a label. */
export const lineLabel = (c: XtreamCreds): string => c.serverLabel || c.host.replace(/^https?:\/\//, '');

export const loadHiddenCategories = (key: string): Set<string> => {
  try {
    const raw = localStorage.getItem(HIDDEN_PREFIX + key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.map(String));
    }
  } catch { /* ignore */ }
  return new Set();
};

export const saveHiddenCategories = (key: string, hidden: Set<string>): void => {
  try {
    if (hidden.size === 0) localStorage.removeItem(HIDDEN_PREFIX + key);
    else localStorage.setItem(HIDDEN_PREFIX + key, JSON.stringify([...hidden]));
  } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(HIDDEN_CATEGORIES_EVENT, { detail: { line: key } })); } catch { /* ignore */ }
};

export const loadCollapsedLines = (): Set<string> => {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.map(String));
    }
  } catch { /* ignore */ }
  return new Set();
};

export const saveCollapsedLines = (collapsed: Set<string>): void => {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch { /* ignore */ }
};
