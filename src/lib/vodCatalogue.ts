// The whole movie catalogue (get_vod_streams with no category), downloaded at
// most once per line per refresh and shared by "All Movies", Movies › Search
// and a film's "More in this series" row. It is the biggest list a panel
// serves, and a panel bans an address that asks it too much: one copy, kept.
//
// Keyed by the line, the refresh nonce ("Update Channels" means a fresh copy)
// and the Kids level (the list comes back filtered for it). One entry only: a
// second line or a refresh replaces it. A failed download is not kept, and
// closing Movies lets it go (releaseVodCatalogue).
import { getVodStreams, getXtreamRefreshNonce, type XtreamCreds, type XtreamVodStream } from '@/lib/xtream';
import { kidsLevel } from '@/lib/kidsFilter';

let kept: { key: string; p: Promise<XtreamVodStream[]> } | null = null;

const keyOf = (c: XtreamCreds): string =>
  `${c.host}|${c.username}|${getXtreamRefreshNonce()}|${kidsLevel() ?? ''}`;

/** The whole catalogue: the copy kept (or on its way), else one download. */
export function loadFullVodCatalogue(c: XtreamCreds): Promise<XtreamVodStream[]> {
  const key = keyOf(c);
  if (kept?.key === key) return kept.p;
  const p: Promise<XtreamVodStream[]> = getVodStreams(c).catch((e) => {
    if (kept?.p === p) kept = null;
    throw e;
  });
  kept = { key, p };
  return p;
}

/** Whether the box is short of memory (the native side marks it): the whole
 *  catalogue is then never downloaded for a related row alone. */
export function lowMemoryBox(): boolean {
  try { return document.documentElement.classList.contains('native-low-memory'); } catch { return false; }
}

/** Lets the catalogue go (Movies closed): tens of thousands of films are
 *  not kept in memory behind Live TV, Plex or the home screen. */
export function releaseVodCatalogue(): void { kept = null; }

export function __resetVodCatalogueForTests(): void { kept = null; }
