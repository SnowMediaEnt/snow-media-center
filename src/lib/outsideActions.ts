// What happens to an outside service (lib/outsideSource) beyond its own
// record: what the box kept for it is cleared when it goes, it goes when the
// line that added it signs out, and a line too long unchecked is checked
// again. Apart from outsideSource.ts because it needs the Xtream client and
// the stores that import outsideSource.ts themselves (no import cycle).
//
// Nothing here sends anything about the outside service anywhere: the only
// request is a fresh check of OUR line (recheckLine), as the Player's own
// background reconcile does.
import { forgetCounts } from '@/lib/catalogCounts';
import { forgetFavoritesForLine, lineKey } from '@/lib/favoritesSync';
import { loadCollapsedLines, saveCollapsedLines, saveHiddenCategories } from '@/lib/liveLines';
import { forgetM3u } from '@/lib/m3u';
import {
  accountStale,
  lineOwnerKey,
  loadOutsideSources,
  markLineRefused,
  outsideAllowed,
  outsideCreds,
  ownerOnBox,
  removeOutsideSource,
  type OutsideSource,
} from '@/lib/outsideSource';
import { markReconciled, reconciledRecently, RECONCILE_URGENT_MS } from '@/lib/panelReconcile';
import { forgetChannelHistory } from '@/lib/watchHistory';
import {
  authenticateRouted,
  buildPlayerAccount,
  loadCreds,
  loadPlayerAccount,
  loadSavedAccounts,
  savePlayerAccount,
  type SavedAccount,
  type XtreamCreds,
} from '@/lib/xtream';

/**
 * Remove a service and everything the box kept for it: its favourites (every
 * profile's), hidden and folded categories, channel counts, its channels in
 * Recently watched, and its playlist (in memory and on the box).
 */
export async function forgetOutsideSource(src: OutsideSource): Promise<void> {
  const line = outsideCreds(src);
  const key = lineKey(line);
  forgetFavoritesForLine(line);
  saveHiddenCategories(key, new Set());
  const folded = loadCollapsedLines();
  if (folded.delete(key)) saveCollapsedLines(folded);
  forgetCounts(line);
  forgetChannelHistory((c) => lineKey({ host: c.host, username: c.username }) === key);
  if (line.m3u) forgetM3u(line.m3u, { disk: true });
  await removeOutsideSource(src.id);
}

/** Signing out of `line`: every outside service it added goes with it. Never throws. */
export async function forgetOutsideOwnedBy(line: Pick<XtreamCreds, 'host' | 'username'> | null | undefined): Promise<void> {
  const owner = lineOwnerKey(line);
  if (!owner) return;
  try {
    for (const src of await loadOutsideSources()) {
      if (src.owner === owner) await forgetOutsideSource(src);
    }
  } catch { /* the next sign-in finds it not on the box (ownerOnBox) */ }
}

/**
 * The line in use has an outside service but its account record is older
 * than STALE_MS: check it with its panel now (once per reconcile window, as
 * the Player's own reconcile). A fresh answer is saved (playerAccountRefresh
 * tells Live TV); a refused login is noted (markLineRefused). Never throws.
 */
export async function recheckLine(active: XtreamCreds | null | undefined, opts: { evenWithoutOne?: boolean } = {}): Promise<void> {
  try {
    if (!active || active.outside || !active.username || !active.password) return;
    // Settings asks with none saved yet: the first one can't be added on a stale line either.
    if (!opts.evenWithoutOne && !(await loadOutsideSources()).length) return;
    const acc = await loadPlayerAccount();
    if (acc && !accountStale(acc)) return;
    if (reconciledRecently(RECONCILE_URGENT_MS)) return;
    markReconciled();
    const res = await authenticateRouted(active.username, active.password);
    if (res.invalidLogin) { markLineRefused(active); return; }
    if (!res.server || !res.creds || !(res.ok || res.authedButBlocked)) return;
    const now = await loadCreds();
    if (!now || lineOwnerKey(now) !== lineOwnerKey(active)) return;
    await savePlayerAccount(buildPlayerAccount(res.server, res.creds, res.userInfo));
  } catch { /* offline: it stays hidden until a check gets through */ }
}

/** What Settings › Add service shows about the outside service on this box. */
export interface OutsideHere {
  /** The line in use: it becomes the owner of what is saved. */
  active: XtreamCreds | null;
  /** The line in use passes the rule (outsideAllowed). */
  allowed: boolean;
  /** The saved services (MAX_OUTSIDE_SOURCES at most). */
  sources: OutsideSource[];
  /** The first one's line is on this box: the one in use or a saved account. */
  ownerHere: boolean;
  /** The DreamStreams / Vibez lines saved on this box. */
  accounts: SavedAccount[];
}

/**
 * Read it all from the box. Nothing is asked of any server, except that a
 * line not checked with its panel lately is checked now (recheckLine: the
 * answer fires playerAccountRefresh, and the caller reads this again).
 * Never throws: when something can't be read, nothing is allowed.
 */
export async function readOutsideHere(): Promise<OutsideHere> {
  try {
    const [active, account, sources, accounts] = await Promise.all([
      loadCreds(),
      loadPlayerAccount(),
      loadOutsideSources(),
      loadSavedAccounts().catch((): SavedAccount[] => []),
    ]);
    const first = sources[0] ?? null;
    if (accountStale(account)) void recheckLine(active, { evenWithoutOne: true });
    return { active, allowed: outsideAllowed(active, account), sources, ownerHere: !!first && ownerOnBox(first, active, accounts), accounts };
  } catch {
    return { active: null, allowed: false, sources: [], ownerHere: false, accounts: [] };
  }
}
