// A Plex title to open straight onto its page: a tile on the home screen's
// content bar (MediaBar), or Support handing the viewer back to the film they
// left for the Buffering Guide (PlexSection's stashPlexReturn). It travels in
// sessionStorage: the Player (LiveTV) sees it and opens Movies & Series, and
// PlexSection opens the page once its server is connected.
//
// The same path as a voice command's title (plexVoice.ts), with the same
// rules: looked at without clearing, cleared by Plex once it has mounted, and
// only good for a while, so a link Plex never picked up (it showed the
// expired-line screen, or the viewer went elsewhere) is not replayed on a
// later visit.

export interface PlexDeeplink {
  ratingKey: string;
  title?: string;
  librarySectionID?: string | number | null;
  kind?: string;
  /** The server the title lives on (a shared library on another server). */
  machineIdentifier?: string | null;
  /** When it was handed over (ms). Every link is stamped (handPlexDeeplink). */
  at?: number;
}

export const PLEX_DEEPLINK_KEY = 'smc-plex-deeplink';
/** A stored link older than this was never picked up and is not used. */
export const PLEX_DEEPLINK_TTL_MS = 2 * 60 * 1000;

/** Hand a title to Plex: stamped now. */
export function handPlexDeeplink(link: Omit<PlexDeeplink, 'at'>, now = Date.now()): void {
  try { sessionStorage.setItem(PLEX_DEEPLINK_KEY, JSON.stringify({ ...link, at: now })); } catch { /* ignore */ }
}

/** The stored link, if there is a fresh one. Looks without clearing (see
 *  peekPlexVoice): the raw copy lets the caller clear only what it read. */
export function peekPlexDeeplink(now = Date.now()): { link: PlexDeeplink; raw: string } | null {
  try {
    const raw = sessionStorage.getItem(PLEX_DEEPLINK_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PlexDeeplink | null;
    if (!v || v.ratingKey == null || String(v.ratingKey) === '') return null;
    if (typeof v.at === 'number' && now - v.at > PLEX_DEEPLINK_TTL_MS) return null;
    return { link: { ...v, ratingKey: String(v.ratingKey) }, raw };
  } catch { return null; }
}

/** Clear the stored link — only the copy `raw` when given, so one handed over
 *  since is left for its own reader. */
export function clearPlexDeeplink(raw?: string): void {
  try {
    if (raw === undefined || sessionStorage.getItem(PLEX_DEEPLINK_KEY) === raw) sessionStorage.removeItem(PLEX_DEEPLINK_KEY);
  } catch { /* ignore */ }
}

/** Support hands the viewer back: the link stashed when they left the film is
 *  good from now, however long they spent in the guide. */
export function renewPlexDeeplink(now = Date.now()): void {
  try {
    const raw = sessionStorage.getItem(PLEX_DEEPLINK_KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as PlexDeeplink | null;
    if (v?.ratingKey != null) sessionStorage.setItem(PLEX_DEEPLINK_KEY, JSON.stringify({ ...v, at: now }));
  } catch { /* ignore */ }
}
