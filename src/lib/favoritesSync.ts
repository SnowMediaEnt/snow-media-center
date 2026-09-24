// Cloud sync for Player favourites.
//
// Favourites are saved against the STREAMING line (host + username), not an
// app user — most Player users never make a website account, and the line is
// what they mean by "my account". The server side is the `player-favorites`
// edge function, which verifies the line against the upstream panel on every
// call and is the only thing that touches the table.
//
// THE RULE: compare-and-set on a server version. No clocks.
//
// Every row has an opaque integer version. A device remembers the version it
// last synced with (meta.version) and quotes it on every write. The write
// applies only if the row still has that version; otherwise the server hands
// back the current list and the device merges its own changes into it and
// tries again. A device that never pulled, was offline for a week, or has a
// wrong clock cannot overwrite a newer list, because it cannot quote a version
// it has not seen.
//
// LOCAL STORAGE IS PER LINE. The list the Live TV screen shows is always the
// current line's. When the line changes, the outgoing list is stashed under
// its line and the incoming line's stash (if any) is restored — synchronously,
// before any network call, so a toggle made a moment after switching lands on
// the right line. Nothing is ever cleared: switching back restores the stash
// even with the cloud unreachable, and the cloud then reconciles on top.
// (Before sync existed favourites were one device-wide list, which is exactly
// how one person's channels would have landed in another person's account.)
//
// The remaining edges:
//   • An install from before sync existed has favourites but no meta. If the
//     cloud already has a list for that line, the two are unioned once.
//   • A merge on conflict is a UNION. It can never lose a favourite; the cost
//     is that a channel removed on one device while offline comes back if
//     another device still had it. Removals made online apply normally.
//   • A toggle made while the first pull is in flight is not lost: the local
//     list is re-read after the pull resolves and merged, not replaced.
//   • Pull failures (offline, panel down, function not deployed yet) leave
//     local alone; dirty state persists and the next successful reconcile
//     pushes it.
//
// Demo mode never syncs. Nothing here throws.

import { supabase } from '@/integrations/supabase/client';
import { isDemo } from '@/lib/demoMode';
import { MAIN_PROFILE, viewerProfileId } from '@/lib/viewer';
import { loadFavoritesData, saveFavoritesData, type FavChannel, type XtreamCreds } from '@/lib/xtream';

const META_KEY = 'snow-livetv-favs-meta-v2';
const STASH_PREFIX = 'snow-livetv-favs-byline:';
const PUSH_DEBOUNCE_MS = 1500;

interface FavMeta {
  /** `${host}|${username}` the local list belongs to. */
  line: string;
  /** Server version this device last synced with. null = never for this line. */
  version: number | null;
  /** Local changes not yet accepted by the server. */
  dirty: boolean;
  /** ms epoch of the last local toggle, for "did anything change while I was awaiting". */
  changedAt: number;
}

interface CloudGet {
  /** null = the cloud has nothing for this line yet. */
  favorites: FavChannel[] | null;
  version: number | null;
}

interface CloudSet {
  applied: boolean;
  favorites: FavChannel[];
  version: number | null;
}

// ── keys ───────────────────────────────────────────────────────────────────

/** Same normalisation the edge function applies. */
export const normalizeHost = (host: string): string => {
  let h = (host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (h === 'dstreams.xyz') h = 'dstreams.xyz:8080';
  return h;
};

export const lineKey = (creds: Pick<XtreamCreds, 'host' | 'username'>): string =>
  `${normalizeHost(creds.host)}|${creds.username.trim().toLowerCase()}`;

/** The list a favourite belongs to: the line, and on a profile other than the
 *  main one (profiles.ts) that profile's own list on the line. Everything
 *  below — meta, stash, the server copy — is keyed by this. */
const favKey = (creds: Pick<XtreamCreds, 'host' | 'username'>): string => {
  const p = viewerProfileId();
  return p === MAIN_PROFILE ? lineKey(creds) : `${lineKey(creds)}#p:${p}`;
};

// ── local meta + per-line stash ────────────────────────────────────────────

const loadMeta = (): FavMeta | null => {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<FavMeta>;
    if (typeof m.line !== 'string') return null;
    return {
      line: m.line,
      version: typeof m.version === 'number' ? m.version : null,
      dirty: m.dirty === true,
      changedAt: typeof m.changedAt === 'number' ? m.changedAt : 0,
    };
  } catch {
    return null;
  }
};

const saveMeta = (m: FavMeta): void => {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* ignore */ }
};

const isFavChannel = (v: unknown): v is FavChannel =>
  !!v && typeof v === 'object'
  && typeof (v as FavChannel).stream_id === 'number'
  && typeof (v as FavChannel).name === 'string';

const sanitize = (raw: unknown): FavChannel[] => {
  if (!Array.isArray(raw)) return [];
  const out: FavChannel[] = [];
  for (const v of raw) {
    if (!isFavChannel(v)) continue;
    out.push({
      stream_id: v.stream_id,
      name: v.name,
      num: typeof v.num === 'number' ? v.num : undefined,
      stream_icon: typeof v.stream_icon === 'string' ? v.stream_icon : undefined,
      category_id: typeof v.category_id === 'string' ? v.category_id : undefined,
      epg_channel_id: typeof v.epg_channel_id === 'string' ? v.epg_channel_id : undefined,
    });
  }
  return out;
};

/** Stash carries the list AND the meta, so a restored line remembers the
 *  version it last synced with instead of re-merging from scratch. */
interface Stash { favorites: FavChannel[]; version: number | null; dirty: boolean }

const stashFor = (line: string, s: Stash): void => {
  try { localStorage.setItem(STASH_PREFIX + line, JSON.stringify(s)); } catch { /* ignore */ }
};

const restoreFor = (line: string): Stash | null => {
  try {
    const raw = localStorage.getItem(STASH_PREFIX + line);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Stash>;
    return {
      favorites: sanitize(s.favorites),
      version: typeof s.version === 'number' ? s.version : null,
      dirty: s.dirty === true,
    };
  } catch {
    return null;
  }
};

const toMap = (list: FavChannel[]): Map<number, FavChannel> =>
  new Map(list.map((f) => [f.stream_id, f]));

/**
 * SYNCHRONOUS. Call before anything else when the Live TV screen gets its
 * credentials. If the local list belongs to a different line, it is stashed
 * under that line and this line's stash (or an empty list) takes its place.
 * Returns the list the screen must now show, or null if nothing changed.
 *
 * This runs before the network pull on purpose: the screen switches to the
 * right line's list immediately, so a toggle made while the pull is still in
 * flight modifies — and later pushes — the right line's favourites.
 */
export function prepareLocalForLine(
  creds: XtreamCreds,
  current: Map<number, FavChannel>,
): Map<number, FavChannel> | null {
  if (isDemo()) return null;
  const key = favKey(creds);
  const meta = loadMeta();
  if (meta?.line === key) return null;

  if (meta) {
    stashFor(meta.line, { favorites: [...current.values()], version: meta.version, dirty: meta.dirty });
  } else {
    // No meta: an install from before sync. Its list is the line's main
    // profile's (reconcile unions it with the cloud once, as a dirty stash
    // does). Another profile, a Kids one above all, parks it there and starts
    // from its own list.
    const main = lineKey(creds);
    if (key === main || current.size === 0) return null;
    const prev = restoreFor(main);
    stashFor(main, { favorites: [...union(prev?.favorites ?? [], [...current.values()]).values()], version: prev?.version ?? null, dirty: true });
  }
  const restored = restoreFor(key);
  saveMeta({
    line: key,
    version: restored?.version ?? null,
    dirty: restored?.dirty ?? false,
    changedAt: 0,
  });
  // The local store is the active line's list, so the incoming list replaces
  // the outgoing one (stashed above). Left in place, the outgoing list was
  // read back as this line's — every new profile showed the grown-up's
  // favourites and pushed them to the cloud as its own.
  const next = toMap(restored?.favorites ?? []);
  saveFavoritesData(next);
  return next;
}

// ── wire ───────────────────────────────────────────────────────────────────

interface WireResponse {
  ok?: boolean;
  reason?: string;
  applied?: boolean;
  favorites?: unknown;
  version?: number | null;
}

async function call(creds: XtreamCreds, body: Record<string, unknown>): Promise<WireResponse | null> {
  try {
    const { data, error } = await supabase.functions.invoke('player-favorites', {
      body: {
        host: normalizeHost(creds.host),
        username: creds.username.trim().toLowerCase(),
        password: creds.password,
        ...(viewerProfileId() !== MAIN_PROFILE ? { profile: viewerProfileId() } : {}),
        ...body,
      },
    });
    if (error) { console.warn('[favoritesSync] call failed:', error.message); return null; }
    const r = data as WireResponse | null;
    if (!r?.ok) { console.warn('[favoritesSync] refused:', r?.reason); return null; }
    return r;
  } catch (e) {
    console.warn('[favoritesSync] threw:', e);
    return null;
  }
}

async function pull(creds: XtreamCreds): Promise<CloudGet | null> {
  const r = await call(creds, { op: 'get' });
  if (!r) return null;
  if (r.favorites == null) return { favorites: null, version: null };
  return { favorites: sanitize(r.favorites), version: typeof r.version === 'number' ? r.version : null };
}

async function setRemote(
  creds: XtreamCreds,
  favorites: FavChannel[],
  baseVersion: number | null,
): Promise<CloudSet | null> {
  const r = await call(creds, { op: 'set', favorites, base_version: baseVersion });
  if (!r) return null;
  return {
    applied: r.applied === true,
    favorites: sanitize(r.favorites),
    version: typeof r.version === 'number' ? r.version : null,
  };
}

// ── merge ──────────────────────────────────────────────────────────────────

/** Union, cloud entries first so their metadata wins when both have a channel. */
const union = (cloud: FavChannel[], local: FavChannel[]): Map<number, FavChannel> => {
  const m = toMap(cloud);
  for (const f of local) if (!m.has(f.stream_id)) m.set(f.stream_id, f);
  return m;
};

/**
 * Push a list and settle the meta from the answer. On a version conflict the
 * server's list is unioned with ours and pushed once more against the version
 * it reported; whatever the outcome, the meta ends up telling the truth about
 * whether local changes are still unaccepted.
 *
 * Returns the list the device should now show when that differs from what it
 * pushed, else null.
 */
async function pushAndSettle(
  creds: XtreamCreds,
  list: FavChannel[],
  baseVersion: number | null,
  key: string,
): Promise<Map<number, FavChannel> | null> {
  const startedAt = Date.now();
  const res = await setRemote(creds, list, baseVersion);
  const after = loadMeta();
  // The line changed underneath us (account switch). Say nothing about it.
  if (!after || after.line !== key) return null;
  const changedSince = after.changedAt > startedAt;

  if (!res) {
    saveMeta({ ...after, dirty: true });
    return null;
  }
  if (res.applied) {
    saveMeta({ ...after, version: res.version, dirty: changedSince });
    return null;
  }

  // Conflict: someone else wrote first. Merge and retry exactly once.
  const merged = union(res.favorites, list);
  const res2 = await setRemote(creds, [...merged.values()], res.version);
  const after2 = loadMeta();
  if (!after2 || after2.line !== key) return merged;
  if (!res2) {
    saveMeta({ ...after2, version: res.version, dirty: true });
    return merged;
  }
  if (res2.applied) {
    saveMeta({ ...after2, version: res2.version, dirty: after2.changedAt > startedAt });
    return merged;
  }
  // Lost twice in a row — a very busy line. Adopt the latest, stay dirty, and
  // let the next toggle or reconcile carry our changes.
  const merged2 = union(res2.favorites, [...merged.values()]);
  saveMeta({ ...after2, version: res2.version, dirty: true });
  return merged2;
}

// ── reconcile on load ──────────────────────────────────────────────────────

/**
 * Called after prepareLocalForLine, once the Live TV screen has its
 * credentials. `getLocal` is a GETTER, not a snapshot: it is read after the
 * network round-trip so a toggle made while the pull was in flight is merged
 * rather than discarded.
 *
 * Returns the list the screen should now show, or null when the local list
 * is already right (or the cloud could not be reached).
 */
export async function reconcileFavoritesOnLoad(
  creds: XtreamCreds,
  getLocal: () => Map<number, FavChannel>,
): Promise<Map<number, FavChannel> | null> {
  if (isDemo()) return null;
  const key = favKey(creds);
  const startedAt = Date.now();

  const cloud = await pull(creds);
  if (!cloud) return null; // unreachable — local stays, dirty state persists

  const meta = loadMeta();
  const localList = [...getLocal().values()];

  // prepareLocalForLine has already made the local list this line's. If meta
  // names another line anyway (a caller skipped it), do not guess: leave the
  // screen alone and let the next mount sort it out.
  if (meta && meta.line !== key) return null;

  const changedDuring = !!meta && meta.changedAt >= startedAt;

  if (cloud.favorites === null) {
    // No row for this line yet.
    if (localList.length === 0) {
      saveMeta({ line: key, version: null, dirty: false, changedAt: meta?.changedAt ?? 0 });
      return null;
    }
    // Seed the cloud from this device. The base is null because we saw no
    // row; if one appears between the get and the set, pushAndSettle merges.
    saveMeta({ line: key, version: null, dirty: true, changedAt: meta?.changedAt ?? 0 });
    return pushAndSettle(creds, localList, null, key);
  }

  const cloudMap = toMap(cloud.favorites);

  if (!meta) {
    if (localList.length === 0) {
      // Fresh install, or first run on this line: the cloud is the truth.
      saveMeta({ line: key, version: cloud.version, dirty: false, changedAt: 0 });
      return cloudMap;
    }
    // Pre-sync install with favourites, meeting a cloud list another device
    // already made. Neither side is newer in any meaningful sense: keep both.
    const merged = union(cloud.favorites, localList);
    saveMeta({ line: key, version: cloud.version, dirty: true, changedAt: 0 });
    const settled = await pushAndSettle(creds, [...merged.values()], cloud.version, key);
    return settled ?? merged;
  }

  if (changedDuring || meta.dirty) {
    // We hold changes the cloud has not accepted. Merge them in and push
    // against the version we just saw.
    const merged = union(cloud.favorites, localList);
    saveMeta({ ...meta, version: cloud.version, dirty: true });
    const settled = await pushAndSettle(creds, [...merged.values()], cloud.version, key);
    return settled ?? merged;
  }

  if (meta.version !== cloud.version) {
    // Another device wrote since we last synced, and we have nothing pending.
    saveMeta({ ...meta, version: cloud.version, dirty: false });
    return cloudMap;
  }

  return null; // in sync
}

// ── push on change ─────────────────────────────────────────────────────────

let pushTimer: number | null = null;
let pending: {
  creds: XtreamCreds;
  favorites: FavChannel[];
  onAdopt: (m: Map<number, FavChannel>) => void;
} | null = null;

/**
 * Debounced push after a toggle. Marks the local list dirty for this line
 * immediately (so a crash before the push still gets reconciled next load),
 * coalesces a burst of presses into one write, and always sends the latest
 * list. `onAdopt` is called if a conflict merge produces a list the screen
 * should show instead of the one it pushed.
 */
export function scheduleFavoritesPush(
  creds: XtreamCreds,
  favorites: Map<number, FavChannel>,
  onAdopt: (m: Map<number, FavChannel>) => void,
): void {
  if (isDemo()) return;
  const key = favKey(creds);
  const prev = loadMeta();
  // prepareLocalForLine runs before the screen accepts toggles, so a mismatch
  // here means the caller skipped it. Refuse rather than push one line's list
  // into another's row; the local save has already happened.
  if (prev && prev.line !== key) return;
  const base: FavMeta = prev ?? { line: key, version: null, dirty: false, changedAt: 0 };
  saveMeta({ ...base, dirty: true, changedAt: Date.now() });

  pending = { creds, favorites: [...favorites.values()], onAdopt };
  if (pushTimer != null) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { pushTimer = null; void runPendingPush(); }, PUSH_DEBOUNCE_MS);
}

async function runPendingPush(): Promise<void> {
  const p = pending;
  pending = null;
  if (!p) return;
  const key = favKey(p.creds);
  const meta = loadMeta();
  if (!meta || meta.line !== key) return;
  const adopt = await pushAndSettle(p.creds, p.favorites, meta.version, key);
  if (adopt) p.onAdopt(adopt);
}

/** Flush a pending push immediately (used when the screen unmounts). */
export function flushFavoritesPush(): void {
  if (pushTimer != null) { window.clearTimeout(pushTimer); pushTimer = null; }
  void runPendingPush();
}

// ── every line at once ─────────────────────────────────────────────────────
//
// The Live TV pane shows all signed-in lines together, so favourites for
// more than one line are live at the same time. The rule above stands: the
// local list (FAVS_KEY_V2 + meta) belongs to the ACTIVE line — the one
// prepareLocalForLine was last called with. Every other line lives in its
// stash, and these four functions route each call to the right place so the
// screen never has to know which line is which.

const isActiveLine = (creds: XtreamCreds): boolean => {
  const meta = loadMeta();
  return !meta || meta.line === favKey(creds);
};

/** The list for a line, wherever it lives. */
export function loadFavoritesForLine(creds: XtreamCreds): Map<number, FavChannel> {
  if (isDemo() || isActiveLine(creds)) return loadFavoritesData();
  return toMap(restoreFor(favKey(creds))?.favorites ?? []);
}

/** Save a line's list locally: the active line's to the local store, any other line's to its stash. */
export function saveFavoritesForLine(creds: XtreamCreds, favorites: Map<number, FavChannel>): void {
  if (isDemo() || isActiveLine(creds)) { saveFavoritesData(favorites); return; }
  const key = favKey(creds);
  const prev = restoreFor(key);
  stashFor(key, { favorites: [...favorites.values()], version: prev?.version ?? null, dirty: true });
}

const stashPushTimers = new Map<string, number>();
const stashPending = new Map<string, { creds: XtreamCreds; favorites: FavChannel[]; onAdopt: (m: Map<number, FavChannel>) => void }>();

/** Push a stashed line against the version its stash last saw; settle the stash from the answer. */
async function pushStash(creds: XtreamCreds, list: FavChannel[]): Promise<Map<number, FavChannel> | null> {
  const key = favKey(creds);
  const before = restoreFor(key);
  const res = await setRemote(creds, list, before?.version ?? null);
  if (!res) { stashFor(key, { favorites: list, version: before?.version ?? null, dirty: true }); return null; }
  if (res.applied) { stashFor(key, { favorites: list, version: res.version, dirty: false }); return null; }
  const merged = union(res.favorites, list);
  const res2 = await setRemote(creds, [...merged.values()], res.version);
  if (res2?.applied) { stashFor(key, { favorites: [...merged.values()], version: res2.version, dirty: false }); return merged; }
  const final = res2 ? union(res2.favorites, [...merged.values()]) : merged;
  stashFor(key, { favorites: [...final.values()], version: res2?.version ?? res.version, dirty: true });
  return final;
}

/** Debounced push for whichever line changed. Same behaviour as scheduleFavoritesPush; different home. */
export function scheduleFavoritesPushForLine(
  creds: XtreamCreds,
  favorites: Map<number, FavChannel>,
  onAdopt: (m: Map<number, FavChannel>) => void,
): void {
  if (isDemo()) return;
  if (isActiveLine(creds)) { scheduleFavoritesPush(creds, favorites, onAdopt); return; }
  const key = favKey(creds);
  stashPending.set(key, { creds, favorites: [...favorites.values()], onAdopt });
  const t = stashPushTimers.get(key);
  if (t != null) window.clearTimeout(t);
  stashPushTimers.set(key, window.setTimeout(() => {
    stashPushTimers.delete(key);
    const p = stashPending.get(key);
    stashPending.delete(key);
    if (!p) return;
    void pushStash(p.creds, p.favorites).then((adopt) => { if (adopt) p.onAdopt(adopt); });
  }, PUSH_DEBOUNCE_MS));
}

/**
 * Reconcile one line with the cloud on load. The active line goes through
 * reconcileFavoritesOnLoad unchanged; a stashed line follows the same rule
 * against its stash: seed the cloud if it is empty, merge and push if the
 * stash is dirty, otherwise adopt whatever is newer.
 */
export async function reconcileFavoritesForLine(
  creds: XtreamCreds,
  getLocal: () => Map<number, FavChannel>,
): Promise<Map<number, FavChannel> | null> {
  if (isDemo()) return null;
  if (isActiveLine(creds)) return reconcileFavoritesOnLoad(creds, getLocal);
  const key = favKey(creds);
  const cloud = await pull(creds);
  if (!cloud) return null;
  const stash = restoreFor(key);
  const local = [...getLocal().values()];
  if (cloud.favorites === null) {
    if (local.length === 0) return null;
    return pushStash(creds, local);
  }
  if (!stash) {
    if (local.length === 0) {
      stashFor(key, { favorites: cloud.favorites, version: cloud.version, dirty: false });
      return toMap(cloud.favorites);
    }
    const merged = union(cloud.favorites, local);
    stashFor(key, { favorites: [...merged.values()], version: cloud.version, dirty: true });
    return (await pushStash(creds, [...merged.values()])) ?? merged;
  }
  if (stash.dirty) {
    const merged = union(cloud.favorites, local);
    stashFor(key, { favorites: [...merged.values()], version: cloud.version, dirty: true });
    return (await pushStash(creds, [...merged.values()])) ?? merged;
  }
  if (stash.version !== cloud.version) {
    stashFor(key, { favorites: cloud.favorites, version: cloud.version, dirty: false });
    return toMap(cloud.favorites);
  }
  return null;
}
