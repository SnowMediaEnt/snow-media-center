// Builds the content bar for THIS viewer, on the device.
//
// Three rows, in order:
//   continue  — what they watched last, channels and Plex titles alike;
//   live      — channels from their signed-in lines worth a look now: their
//               favourites, then more from the categories they actually watch,
//               each with what is on right now from the EPG;
//   for you   — Plex titles related to what they watched, straight from Plex.
//
// Nothing about a line ever leaves the device: the shared edge function only
// supplies Plex "recently added", which the bar appends after these rows.
import {
  loadCreds, loadSavedAccounts, getLiveStreams, getShortEpg, pickNowNext,
  type XtreamCreds, type XtreamLiveStream,
} from '@/lib/xtream';
import { buildLines } from '@/lib/liveLines';
import { loadFavoritesForLine, lineKey } from '@/lib/favoritesSync';
import { loadPlexServer, getPlexRelated, plexImageUrl } from '@/lib/plex';
import { currentViewer, loadWatchHistory, syncWatchHistoryFromCloud, channelKey, type WatchEntry } from '@/lib/watchHistory';

export type BarSource = 'history' | 'live' | 'foryou' | 'plex';

export interface BarChannel {
  host: string;
  username: string;
  streamId: number;
  name: string;
  icon?: string;
  categoryId?: string;
  num?: number;
}

export interface BarItem {
  id: string;
  source: BarSource;
  kind: string;
  title: string;
  subtitle?: string;
  poster?: string;
  ratingKey?: string;
  librarySectionID?: string | number;
  channel?: BarChannel;
}

const CONTINUE_MAX = 10;
const LIVE_MAX = 10;
const FORYOU_MAX = 10;
const EPG_BUDGET = 10;
const CLOUD_SYNC_MS = 10 * 60 * 1000;

let lastCloudSync = 0;
let lastCloudViewer = '';

const stripHost = (h: string) => h.replace(/^https?:\/\//, '');

const lineFor = (lines: XtreamCreds[], host: string, username: string): XtreamCreds | undefined =>
  lines.find((l) => lineKey(l) === lineKey({ host, username }));

const channelItem = (source: BarSource, line: XtreamCreds, s: XtreamLiveStream, subtitle?: string): BarItem => ({
  id: `ch-${channelKey(line, s.stream_id)}`,
  source,
  kind: 'channel',
  title: s.name,
  subtitle,
  poster: s.stream_icon || undefined,
  channel: { host: line.host, username: line.username, streamId: s.stream_id, name: s.name, icon: s.stream_icon || undefined, categoryId: s.category_id, num: s.num },
});

/** One "what's on now" lookup per channel, a fixed number of them, in series
 *  so the panel never sees a burst. Failures leave the subtitle as it was. */
async function fillNowPlaying(items: BarItem[], lines: XtreamCreds[]): Promise<void> {
  let budget = EPG_BUDGET;
  for (const it of items) {
    if (budget <= 0) break;
    if (!it.channel) continue;
    const line = lineFor(lines, it.channel.host, it.channel.username);
    if (!line) continue;
    budget -= 1;
    try {
      const { epg_listings } = await getShortEpg(line, it.channel.streamId, 2);
      const now = pickNowNext(epg_listings ?? []).now;
      if (now?.title) it.subtitle = now.title;
    } catch { /* keep the category / line label */ }
  }
}

export interface ViewerBar {
  viewer: string;
  items: BarItem[];
}

export async function buildViewerBar(): Promise<ViewerBar> {
  const viewer = await currentViewer();

  // History: the account's rows folded in every so often, local otherwise.
  let history: WatchEntry[];
  if (viewer !== 'device' && (viewer !== lastCloudViewer || Date.now() - lastCloudSync > CLOUD_SYNC_MS)) {
    history = await syncWatchHistoryFromCloud(viewer);
    lastCloudSync = Date.now(); lastCloudViewer = viewer;
  } else {
    history = loadWatchHistory(viewer);
  }

  // The lines signed in on this box. A remembered channel from a line that is
  // no longer here cannot be played, so it is not offered.
  let lines: XtreamCreds[] = [];
  try {
    const creds = await loadCreds();
    if (creds) lines = buildLines(creds, await loadSavedAccounts().catch(() => []));
  } catch { /* no Player sign-in */ }

  const plexServer = await loadPlexServer().catch(() => null);
  const plexPoster = (thumb?: string) => (plexServer?.base && plexServer.token ? plexImageUrl(plexServer.base, thumb, plexServer.token) : undefined);

  const items: BarItem[] = [];
  const seenChannels = new Set<string>();
  const seenPlex = new Set<string>();

  // ── continue watching ────────────────────────────────────────────────────
  for (const e of history) {
    if (items.length >= CONTINUE_MAX) break;
    if (e.kind === 'channel' && e.channel) {
      const line = lineFor(lines, e.channel.host, e.channel.username);
      if (!line) continue;
      seenChannels.add(e.key);
      items.push({
        id: `ch-${e.key}`, source: 'history', kind: 'channel', title: e.title,
        subtitle: e.subtitle, poster: e.poster ?? e.channel.icon,
        channel: { host: line.host, username: line.username, streamId: e.channel.streamId, name: e.title, icon: e.channel.icon, categoryId: e.channel.categoryId, num: e.channel.num },
      });
    } else if (e.kind === 'plex' && e.plex) {
      if (!plexServer) continue;
      seenPlex.add(e.key);
      items.push({
        id: `plex-${e.key}`, source: 'history', kind: e.plex.kind ?? 'movie', title: e.title,
        subtitle: e.subtitle, poster: e.poster ?? plexPoster(e.plex.thumb),
        ratingKey: e.plex.ratingKey, librarySectionID: e.plex.librarySectionID,
      });
    }
  }

  // ── live now ─────────────────────────────────────────────────────────────
  const live: BarItem[] = [];
  for (const line of lines) {
    if (live.length >= LIVE_MAX) break;
    // Favourites first.
    for (const f of loadFavoritesForLine(line).values()) {
      if (live.length >= LIVE_MAX) break;
      const key = channelKey(line, f.stream_id);
      if (seenChannels.has(key)) continue;
      seenChannels.add(key);
      live.push(channelItem('live', line, { stream_id: f.stream_id, name: f.name, category_id: f.category_id, stream_icon: f.stream_icon }, line.serverLabel ? `Favorite · ${line.serverLabel}` : 'Favorite'));
    }
  }
  // Then the categories they watch: up to two, a few channels from each.
  const watchedCats: Array<{ line: XtreamCreds; categoryId: string }> = [];
  for (const e of history) {
    if (e.kind !== 'channel' || !e.channel?.categoryId) continue;
    const line = lineFor(lines, e.channel.host, e.channel.username);
    if (!line) continue;
    if (watchedCats.some((c) => c.categoryId === e.channel!.categoryId && lineKey(c.line) === lineKey(line))) continue;
    watchedCats.push({ line, categoryId: e.channel.categoryId });
    if (watchedCats.length >= 2) break;
  }
  for (const { line, categoryId } of watchedCats) {
    if (live.length >= LIVE_MAX) break;
    try {
      const streams = await getLiveStreams(line, categoryId);
      let took = 0;
      for (const s of streams) {
        if (took >= 4 || live.length >= LIVE_MAX) break;
        const key = channelKey(line, s.stream_id);
        if (seenChannels.has(key)) continue;
        seenChannels.add(key);
        live.push(channelItem('live', line, s, line.serverLabel));
        took += 1;
      }
    } catch { /* that category is not reachable right now */ }
  }
  items.push(...live);

  await fillNowPlaying(items, lines);

  // ── for you: Plex titles like the last few they watched ──────────────────
  if (plexServer?.base && plexServer.token) {
    const seeds = history.filter((e) => e.kind === 'plex' && e.plex).slice(0, 3);
    const forYou: BarItem[] = [];
    for (const seed of seeds) {
      if (forYou.length >= FORYOU_MAX) break;
      try {
        const related = await getPlexRelated(plexServer.base, plexServer.token, seed.plex!.ratingKey, 6);
        for (const it of related) {
          if (forYou.length >= FORYOU_MAX) break;
          if (seenPlex.has(it.ratingKey)) continue;
          seenPlex.add(it.ratingKey);
          forYou.push({
            id: `plex-${it.ratingKey}`, source: 'foryou', kind: it.type, title: it.title,
            subtitle: `Because you watched ${seed.title}`, poster: plexPoster(it.thumb),
            ratingKey: it.ratingKey, librarySectionID: it.librarySectionID,
          });
        }
      } catch { /* Plex unreachable or no related hubs */ }
    }
    items.push(...forYou);
  }

  return { viewer, items };
}
