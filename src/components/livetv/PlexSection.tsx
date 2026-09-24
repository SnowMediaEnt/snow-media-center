// Plex "Movies & Series" — auth gate → tabs (Home, Search, libraries, Request,
// Manage) → poster grid → native play. Fire-TV D-pad only.
//
// Perf-critical:
//   • Library items load in pages (60 first, then 200 at a time in the
//     background) and cache in a module-level map (TTL 20 min).
//   • Fetches only fire when the user ENTERS the grid or dwells 400ms on a
//     tab — arrow-scrubbing across tabs no longer triggers requests.
//   • Every network call carries a sequence id so late responses can't clobber
//     a newer tab's state.
//   • Row height in the virtualizer is measured with ResizeObserver so focus
//     rings can't be occluded by an under-estimated row.
//   • Poster images are loaded off the JS heap by PlexImage (see that file).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Loader2, AlertTriangle, RotateCw, Search as SearchIcon, Home as HomeIcon, Compass, Settings as SettingsIcon, Eye, EyeOff, LogOut, MessageSquare, Tv, Film, Ghost } from 'lucide-react';
import { activeSeason, loadSeasonRows, loadSharedSeason, loadStoredSeason, storeSeasonRow, type Season, type SharedSeasonRow } from '@/lib/plexSeasonal';
import { useVirtualizer } from '@tanstack/react-virtual';
// The module-level toast, not the hook: the hook subscribes its caller to
// every toast state change, which only <Toaster> needs.
import { toast } from '@/hooks/use-toast';
import { isFireTV } from '@/utils/platform';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { useNativePlayer } from '@/hooks/useNativePlayer';
import { usePlexAuth } from '@/hooks/usePlexAuth';
import {
  getPlexLibraries as _getPlexLibraries,
  getPlexLibraryItems as _getPlexLibraryItems,
  getPlexHub as _getPlexHub,
  getPlexRecentlyAdded,
  getPlexSectionRow,
  searchPlex as _searchPlex,
  getPlexPart,
  plexDirectUrl, plexTranscodeUrl, loadHiddenPlexLibs, saveHiddenPlexLibs,
  getCachedLibrary, setCachedLibrary, isLibraryCacheFresh,
  getCachedHub, getCachedHubStale, getCachedHubWithin, getHubEpoch, setCachedHub,
  resolutionLabel,
  PLEX_QUALITY_PRESETS, loadPlexQuality, savePlexQuality,
  getPlexAccount,
  setPlexImageFocus, preloadImages, plexPhotoTranscodeUrl, POSTER_TILE_W, POSTER_TILE_H,
  type PlexLibrary, type PlexItem, type PlexEpisode, type PlexPlayInfo, plexRouteLabel,
  setPlexPlaybackActive } from '@/lib/plex';
import { isDemo, DEMO_DIALOG_MSG } from '@/lib/demoMode';
import { isAdultLabel, isAdultPlexItem } from '@/lib/adultContent';
import { kidsAllowsPlex, kidsLevel } from '@/lib/kidsFilter';
import { peekPlexVoice, pickPlexVoiceMatch, plexVoiceQuery, plexVoiceSearchText, PLEX_VOICE_EVENT, PLEX_VOICE_KEY, type PlexVoiceIntent } from '@/lib/plexVoice';
import { commitSearch, fallbackSuggestions, fetchPopularSearches, loadRecentSearches } from '@/lib/plexSearches';
import { rankSuggestions, searchLooksThin, searchVariants } from '@/lib/plexFuzzy';
import {
  demoGetLibraries, demoGetLibraryItems, demoGetHub, demoSearchPlex,
} from '@/lib/plexDemo';
import PlexAuthScreen from './PlexAuthScreen';
import OverseerrRequestPanel from './OverseerrRequestPanel';
import { overseerrRequest, overseerrSearch, missingFromPlex, type OverseerrItem } from '@/lib/overseerr';
import { tmdbSized } from '@/lib/tmdbImage';
import PlexImage from './PlexImage';
import PlexLibraryRows from './PlexLibraryRows';
import PlexPosterTile from './PlexPosterTile';
import PlexDetail from './PlexDetail';
import PlexPlayerOverlay, { type PlayerPrompt, type SubtitleSearchContext } from './PlexPlayerOverlay';
import EpisodeAutoplay, { type NextEpisode } from './EpisodeAutoplay';
import PlexProgressReporter from './PlexProgressReporter';
import { continueWatching, initPlexProgress, mergeContinue, pullProgressFromCloud, resumeSeconds, PLEX_PROGRESS_EVENT } from '@/lib/plexProgress';
import { myList, pullFavoritesFromCloud, PLEX_FAVORITES_EVENT } from '@/lib/plexFavorites';
import type { SnowSubtitle } from '@/capacitor/SnowPlayer';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import { loadPlayerVolume, savePlayerVolume } from '@/utils/volume';
import { setPlexKeyOwner, isPlexKeyOwner } from './plexKeyOwner';
import { recordPlexWatch } from '@/lib/watchHistory';
import {
  becauseYouWatched, hiddenGems, surpriseMe, rediscover, pickGenres, genreRow,
  DECADES, decadeTitle, decadeRow, type DiscoverRow,
} from '@/lib/plexDiscover';
import SnowLoader from '@/components/SnowLoader';
import BufferingDiagnostics from './BufferingDiagnostics';
import { autoDropPreset, explainPlexStall } from '@/lib/plexStallVerdict';
import { getSnapshot as getDiagSnapshot, type DiagSnapshot } from '@/lib/bufferDiagnostics';
import { useTransientVisible } from '@/hooks/useTransientVisible';
import { pauseLoading, resumeLoading, waitForResume } from '@/lib/loadGate';

// ── data access indirection ────────────────────────────────────────────────
// In demo mode every Plex read is answered from the pre-built, scrubbed
// catalog served by the demo-plex-catalog edge function — no PMS is ever
// contacted. isDemo() is always false on native, so the shipped TV app keeps
// using the real network functions verbatim.
const DEMO = isDemo();
/** How long a server-side convert may take to start before falling back. */
const TRANSCODE_START_GRACE_MS = 30000;
/** How long a voice command's title is looked for before Search opens. */
const VOICE_WAIT_MS = 12000;
const getPlexLibraries = DEMO ? demoGetLibraries : _getPlexLibraries;
const getPlexLibraryItems = DEMO ? demoGetLibraryItems : _getPlexLibraryItems;
const getPlexHub = DEMO ? demoGetHub : _getPlexHub;
const searchPlex = DEMO ? demoSearchPlex : _searchPlex;
import { trackEvent, startTimer, stopTimer } from '@/lib/analytics';
import { isOwnPlexAccount, isProviderServer } from '@/lib/plexProvider';

const VideoPlayer = lazy(() => import('./VideoPlayer'));
const NATIVE_PLAYBACK = hasNativePlayer();

// Home's Released and Popular rails. These reuse the query syntax verified for
// the library rows — see plexLibraryRows.ts for why every bound below is
// load-bearing rather than decoration. `%3E%3E` is Plex's encoded "after"
// operator; without the bound, undated or unrated titles lead under :desc.
const PLEX_AFTER = '%3E%3E';
const HOME_RELEASED_QUERY = `type=1&sort=originallyAvailableAt:desc&originallyAvailableAt${PLEX_AFTER}=-2y`;
/** Most-played on THIS server. The viewCount bound is what makes the row
 *  meaningful: it keeps out everything nobody has played. */
const homeWatchedQuery = (t: number) => `type=${t}&sort=viewCount:desc&viewCount${PLEX_AFTER}=0`;
/** Fallback for a server with no watch history yet, so Popular is never an
 *  empty rail on a fresh install. */
const homeRatedQuery = (t: number) => `type=${t}&sort=audienceRating:desc&audienceRating${PLEX_AFTER}=7`;
/** New Episodes: the TV library's own Recently Aired query (see
 *  plexLibraryRows.ts for why the `episode.` prefix is mandatory). */
const HOME_AIRED_QUERY = `type=4&sort=episode.originallyAvailableAt:desc&episode.originallyAvailableAt${PLEX_AFTER}=-3mon`;
// Synthetic cache keys: getCachedHub is keyed by path, and these rails are
// stitched from several section queries rather than one hub path.
const HOME_RELEASED_KEY = 'smc:home/released';
const HOME_POPULAR_KEY = 'smc:home/popular';
const HOME_NEW_EPISODES_KEY = 'smc:home/new-episodes';
// Recently Added: one server-wide list, folded (getPlexRecentlyAdded).
const HOME_ADDED_KEY = 'smc:home/added';
/** These rails are fetched for the profile in use — with a Kids profile's
 *  certificates (getPlexSectionRow, kidsOnly) — so each Kids level keeps its
 *  own copy: a grown-up's would be filtered down to little, and a child's is
 *  not the whole server. */
const homeKey = (key: string): string => { const l = kidsLevel(); return l ? `${key}:kids-${l}` : key; };
/** Plays change by the day, not by the minute: Popular is kept half an
 *  hour, so the play-count sort (the slowest of Home's queries) runs that
 *  much less often. */
const POPULAR_TTL_MS = 30 * 60 * 1000;
// A hundred titles deep on Recently Added and Recently Released, so a busy
// server's last few weeks are all there; the rails only render the tiles
// near the highlight (RailBrowser), so the depth costs nothing on screen.
const HOME_RAIL_CAP = 100;

// A box the app already knows is short of memory (main.tsx: 1–2 GB, or a
// Fire TV) gets half-length rails, and Popular and New Episodes shorter
// still and only once Home is up: Popular asks the server to sort every
// library by play count, the slowest of Home's queries, and on such a box
// the Plex screen is where the renderer runs out of room.
const LOW_MEMORY = typeof document !== 'undefined' && document.documentElement.classList.contains('native-low-memory');
const RAIL_CAP = LOW_MEMORY ? 40 : HOME_RAIL_CAP;
/** How many per-library queries Home has in flight at once. All at once was
 *  a dozen requests on a six-library server, against a stick's socket pool. */
const HOME_PARALLEL = 2;

/** `fn` over `list`, at most `limit` at a time, results in list order. */
async function mapLimit<T, R>(list: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

/** The mixed rails (Home, Discover, Search) never show an adult title: not
 *  from an adult library, not with an adult certificate or genre, not by
 *  name. A library that is itself adult keeps its own tab; that is a place
 *  the viewer goes on purpose. */
/** On a Kids profile they also keep only what its certificates allow — rails
 *  kept from an earlier visit were fetched unfiltered. `own`: the profile's
 *  own Continue Watching and My List, which it could only have reached
 *  through the filter and which carry no certificate. */
const familyOnly = (items: PlexItem[] | null | undefined, adultKeys: Set<string>, own = false): PlexItem[] =>
  (items ?? []).filter((it) =>
    !(it.librarySectionID && adultKeys.has(String(it.librarySectionID))) &&
    !isAdultPlexItem({ title: it.title, grandparentTitle: it.grandparentTitle, contentRating: it.contentRating, genres: it.genres }) &&
    (own || !kidsLevel() || kidsAllowsPlex(it)));

/** Home's Recently Released rail: the cache, else the server, cached when it
 *  lands. Null when nothing came back, so a Wi-Fi blip is not cached. */
// One stitched load per server at a time. The settle screen and Home (when
// the settle cap lets Home in early) both asked for these at once; the
// second caller now joins the first. `gone` stays per caller, so one caller
// leaving never empties the other's answer — and the answer is cached
// whether or not anyone is still waiting for it, so a quick trip away and
// back does not pay for it twice.
const _stitchPending = new Map<string, Promise<PlexItem[] | null>>();
function shareStitch(key: string, load: () => Promise<PlexItem[] | null>): Promise<PlexItem[] | null> {
  const hit = _stitchPending.get(key);
  if (hit) return hit;
  const p = load().catch(() => null);
  _stitchPending.set(key, p);
  void p.then(() => { if (_stitchPending.get(key) === p) _stitchPending.delete(key); });
  return p;
}

async function loadReleased(base: string, token: string, libraries: PlexLibrary[], gone: () => boolean): Promise<PlexItem[] | null> {
  const key = homeKey(HOME_RELEASED_KEY);
  const cached = getCachedHub(base, key);
  if (cached) return cached;
  const movieKeys = libraries.filter((l) => l.type === 'movie').map((l) => l.key);
  if (!movieKeys.length) return null;
  const epoch = getHubEpoch();
  const merged = await shareStitch(`${base}|${key}|${movieKeys.join(',')}`, async () => {
    const lists = await mapLimit(movieKeys, HOME_PARALLEL, (k) =>
      getPlexSectionRow(base, token, k, HOME_RELEASED_QUERY, 50).catch(() => null));
    // Each section came back server-sorted; merging needs one more pass so a
    // two-library server does not show all of one then all of the other.
    const m = mergeRail(lists).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    if (m.length) setCachedHub(base, key, m, epoch);
    return m.length ? m : null;
  });
  return gone() ? null : merged;
}

/** Home's Popular rail: the films and series played most on this server,
 *  together, most plays first — on the shared account that is everyone's
 *  plays, "Popular on Snow Media". The rated fallback is for a server nobody
 *  has played anything on yet. Shorter on a low-memory box, whose settle
 *  screen does not wait for it (see LOW_MEMORY). */
async function loadPopular(base: string, token: string, libraries: PlexLibrary[], gone: () => boolean): Promise<PlexItem[] | null> {
  const key = homeKey(HOME_POPULAR_KEY);
  const cached = getCachedHubWithin(base, key, POPULAR_TTL_MS);
  if (cached) return cached;
  const allKeys = libraries
    .filter((l) => l.type === 'movie' || l.type === 'show')
    .map((l) => ({ key: l.key, t: l.type === 'movie' ? 1 : 2 }));
  if (!allKeys.length) return null;
  const epoch = getHubEpoch();
  const merged = await shareStitch(`${base}|${key}|${allKeys.map((k) => k.key).join(',')}`, async () => {
    const watched = await mapLimit(allKeys, HOME_PARALLEL, (s) =>
      getPlexSectionRow(base, token, s.key, homeWatchedQuery(s.t), LOW_MEMORY ? 12 : 30).catch(() => null));
    let m = rankRail(watched, (it) => it.viewCount);
    if (!m.length) {
      const rated = await mapLimit(allKeys, HOME_PARALLEL, (s) =>
        getPlexSectionRow(base, token, s.key, homeRatedQuery(s.t), LOW_MEMORY ? 10 : 20).catch(() => null));
      m = rankRail(rated, (it) => it.rating);
    }
    if (m.length) setCachedHub(base, key, m, epoch);
    return m.length ? m : null;
  });
  return gone() ? null : merged;
}

/** Home's New Episodes: the newest episode of each series that aired one in
 *  the last three months, across the TV libraries. Loaded once Home is up
 *  and drawn last, so its arrival moves nothing the viewer is looking at. */
async function loadNewEpisodes(base: string, token: string, libraries: PlexLibrary[], gone: () => boolean): Promise<PlexItem[] | null> {
  const key = homeKey(HOME_NEW_EPISODES_KEY);
  const cached = getCachedHub(base, key);
  if (cached) return cached;
  const showKeys = libraries.filter((l) => l.type === 'show').map((l) => l.key);
  if (!showKeys.length) return null;
  const epoch = getHubEpoch();
  const merged = await shareStitch(`${base}|${key}|${showKeys.join(',')}`, async () => {
    const lists = await mapLimit(showKeys, HOME_PARALLEL, (k) =>
      getPlexSectionRow(base, token, k, HOME_AIRED_QUERY, LOW_MEMORY ? 40 : 100).catch(() => null));
    const m = newestPerShow(lists);
    if (m.length) setCachedHub(base, key, m, epoch);
    return m.length ? m : null;
  });
  return gone() ? null : merged;
}

/** Per-section lists as one rail, highest `score` first. The lists are dealt
 *  out in turn before ranking, so a film library and a TV library alternate
 *  where scores tie — and throughout, if a list came back without scores
 *  (then the server's own order within each list stands). */
function rankRail(lists: Array<PlexItem[] | null>, score: (it: PlexItem) => number | undefined): PlexItem[] {
  const mixed: PlexItem[] = [];
  const longest = Math.max(0, ...lists.map((l) => l?.length ?? 0));
  for (let i = 0; i < longest; i++) for (const l of lists) { const it = l?.[i]; if (it) mixed.push(it); }
  const scored = mixed.every((it) => typeof score(it) === 'number');
  const ranked = !scored ? mixed : mixed
    .map((it, i) => ({ it, i, s: score(it) as number }))
    // The index breaks ties: Array#sort is not stable on an old WebView.
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ it }) => it);
  return mergeRail([ranked]);
}

/** Episodes, newest first, one per series (its newest). */
function newestPerShow(lists: Array<PlexItem[] | null>): PlexItem[] {
  const shows = new Set<string>();
  const mixed: PlexItem[] = [];
  const longest = Math.max(0, ...lists.map((l) => l?.length ?? 0));
  for (let i = 0; i < longest; i++) {
    for (const l of lists) {
      const it = l?.[i];
      if (!it) continue;
      const show = (it.grandparentTitle || it.title).toLowerCase();
      if (shows.has(show)) continue;
      shows.add(show);
      mixed.push(it);
    }
  }
  return mergeRail([mixed]);
}

/** Home's Recently Added (films and series together, see
 *  getPlexRecentlyAdded). The demo's catalog answers the hub path. */
const getHomeAdded = (base: string, token: string): Promise<PlexItem[]> => (DEMO
  ? demoGetHub(base, token, '/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=100')
  : getPlexRecentlyAdded(base, token, LOW_MEMORY ? 60 : 100));

/** Merge per-section results, drop duplicates, cap. */
const mergeRail = (lists: Array<PlexItem[] | null>): PlexItem[] => {
  const seen = new Set<string>();
  const out: PlexItem[] = [];
  for (const list of lists) {
    for (const it of list ?? []) {
      const id = String(it.ratingKey ?? `${it.title}:${it.year ?? ''}`);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(it);
    }
  }
  return out.slice(0, RAIL_CAP);
};

const COLS = 6;
const ROW_H_ESTIMATE = 250;   // pre-measure fallback for the virtualizer
const PAGE_FIRST = 60;
const PAGE_MORE = 200;

type TabType = 'home' | 'discover' | 'search' | 'seasonal' | 'movie' | 'show' | 'request' | 'manage';
interface Tab { key: string; title: string; type: TabType; libKey?: string; }
type MenuGroup = 'home' | 'libraries' | 'more';
interface MenuEntry { tabIdx: number; title: string; group: MenuGroup; key: string; }

interface Props {
  isActive: boolean;
  onExitLeft?: () => void;
  onExitUp?: () => void;
  /** Tear down Plex playback and route to Support → Buffering Guide. */
  onOpenBufferingGuide?: () => void;
  /** Plex needs a Live TV line first: take the viewer to that sign-in. */
  onNeedLiveTV?: () => void;
  /** Tear down Plex playback and route to Support (no auto-guide). */
  onOpenSupport?: () => void;
  /** Told when the player opens and closes, so the Player shell can hold its
   *  own notices until the film is over. */
  onFullscreenChange?: (on: boolean) => void;
}

// ─── RES BADGE (grid / rails) ──────────────────────────────────────────────
const ResChip = memo(({ label }: { label: string }) => {
  if (!label) return null;
  const gold = label === '4K';
  return (
    <span className={`absolute top-2 right-2 text-xs font-bold px-2 py-1 rounded-lg bg-black/70 ${gold ? 'text-brand-gold' : 'text-white/80'}`}>
      {label}
    </span>
  );
});
ResChip.displayName = 'ResChip';

// ─── RAILS (Home and Discover share this) ─────────────────────────────────
// A column of poster rails with one row/col cursor. Up off the first row and
// Left off a first tile hand focus back to the side menu.
interface RailBrowserProps {
  isActive: boolean;
  base: string;
  token: string;
  rows: DiscoverRow[];
  onPlay: (it: PlexItem) => void;
  onExitToTabs: () => void;
}
// Tile geometry for the rail window: w-[104px] tiles, gap-3 (12px).
const RAIL_TILE_PX = 116;
const RAIL_GAP_PX = 12;
/** Tiles kept in the DOM behind and ahead of the highlight. Sixteen ahead
 *  is a full 1080p row and change; the rest of a 100-title rail is a spacer. */
const NO_ITEMS: PlexItem[] = [];
const librarySig = (libs: PlexLibrary[]) => libs.map((l) => `${l.key}:${l.type}:${l.title}`).join('|');
// How long the side-menu cursor must rest on an entry before its panel opens.
const MENU_SETTLE_MS = 250;
// Tiles drawn either side of a rail's anchor: at least this many, more on a
// WebView wide enough to show more (see railSpan).
const RAIL_AHEAD = 16;
// Vertical window: rails drawn around the highlighted one (RAIL_ROWS_SPAN).
// Everything else is a heading over a blank of the measured rail height.
// About as many rails as fit on the screen, on each side: the highlight can
// sit at the bottom of the view (moving down) or the top (moving up), and
// every rail in view must be real.
const RAIL_ROWS_SPAN = (() => {
  const h = (typeof window !== 'undefined' && window.innerHeight) || 720;
  return Math.max(2, Math.ceil(h / 220));
})();
const RAIL_H_FALLBACK = 204;

const RailBrowser = memo(({ isActive, base, token, rows, onPlay, onExitToTabs }: RailBrowserProps) => {
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(0);

  // The highlight follows its rail, not its index. After playback Continue
  // Watching can appear (or vanish) above the rail the viewer was on, and a
  // refresh can shorten a rail; an index-only cursor then pointed at the
  // wrong rail, or past the end of one, with no tile lit.
  // Updated only when the viewer moves (row changes), never when the rails
  // change under the cursor — that is when it has to hold the old answer.
  const focusedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = rows[row]?.id;
    if (id) focusedIdRef.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);
  useEffect(() => {
    if (!rows.length) return;
    let idx = focusedIdRef.current ? rows.findIndex((r) => r.id === focusedIdRef.current) : -1;
    if (idx < 0) idx = Math.min(row, rows.length - 1);
    focusedIdRef.current = rows[idx].id;
    if (idx !== row) setRow(idx);
    const len = rows[idx].items.length;
    setCol((c) => Math.max(0, Math.min(c, len - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const rowRef = useRef(row); useEffect(() => { rowRef.current = row; }, [row]);
  const colRef = useRef(col); useEffect(() => { colRef.current = col; }, [col]);
  const rowsRef = useRef(rows); useEffect(() => { rowsRef.current = rows; }, [rows]);
  const onPlayRef = useRef(onPlay); useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  const onExitRef = useRef(onExitToTabs); useEffect(() => { onExitRef.current = onExitToTabs; }, [onExitToTabs]);

  // One click handler per rail index, made once and kept for the life of the
  // browser. Every tile is memoised; a fresh closure per tile per render undid
  // that on each keypress, and a handler list rebuilt whenever `rows` changed
  // re-rendered every tile each time a Discover row landed.
  const selectFnsRef = useRef<Array<(it: PlexItem) => void>>([]);
  const selectFor = (ri: number) => {
    let fn = selectFnsRef.current[ri];
    if (!fn) {
      fn = (it: PlexItem) => {
        const ci = rowsRef.current[ri]?.items.findIndex((x) => x.ratingKey === it.ratingKey) ?? -1;
        if (ci >= 0) { setRow(ri); setCol(ci); }
        onPlayRef.current(it);
      };
      selectFnsRef.current[ri] = fn;
    }
    return fn;
  };

  // Where the viewer left each rail. A rail keeps its window around that
  // column when the highlight moves to another rail, opens a title or goes to
  // the side menu, and coming back to the rail lands on it again. Before, a
  // rail that lost the highlight snapped its tiles to the first sixteen while
  // its scroll stayed put, so it showed an empty spacer, and regaining the
  // highlight remounted two dozen posters.
  const lastColRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const id = rows[row]?.id;
    // Only for the rail the cursor is really on: in the commit where rails
    // shift under it, rows[row] is briefly a different rail.
    if (id && id === focusedIdRef.current) lastColRef.current[id] = col;
  }, [row, col, rows]);
  const anchorOf = (ri: number) => {
    const r = rowsRef.current[ri];
    const c = r ? lastColRef.current[r.id] ?? 0 : 0;
    return r ? Math.min(c, Math.max(0, r.items.length - 1)) : 0;
  };
  // Tiles drawn either side of the anchor: at least a screen's worth, so the
  // part of a scrolled rail behind the cursor is never empty spacer on a wide
  // WebView (a 1920-px-wide one shows about sixteen tiles at once).
  const railSpan = useMemo(() => Math.max(RAIL_AHEAD, Math.ceil(((typeof window !== 'undefined' && window.innerWidth) || 1920) / RAIL_TILE_PX) + 1), []);
  // A rail that mounts (it came back into the vertical window below) starts
  // scrolled to its anchor, not to its start.
  const placedRef = useRef<WeakSet<HTMLDivElement>>(new WeakSet());
  const placeRail = (el: HTMLDivElement | null, ri: number) => {
    if (!el || placedRef.current.has(el)) return;
    placedRef.current.add(el);
    const a = anchorOf(ri);
    if (a > 0) el.scrollLeft = Math.max(0, (a + 1) * RAIL_TILE_PX - el.clientWidth);
  };

  // Rails far above or below the highlight are drawn as a heading over a
  // blank of the same height. Discover has up to fifteen rails; mounting every
  // one of them put ~240 posters (each with its own observer and timer) on a
  // stick at once.
  const railHRef = useRef(0);
  const measureRail = (el: HTMLDivElement | null) => { if (el && !railHRef.current) railHRef.current = el.offsetHeight; };

  // The focused tile scrolls itself into view, but only just: coming back up
  // to a rail left its heading above the top of the screen (the first rail's
  // name stayed hidden until the screen was reopened). Bring the whole rail,
  // heading included, into view after the tile has placed itself.
  const railBoxRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (!isActive) return;
    const id = rows[row]?.id;
    const box = id ? railBoxRefs.current[id] : null;
    if (box) box.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, isActive]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (!isPlexKeyOwner('browse')) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const keys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const r = rowRef.current, c = colRef.current;
      const currentRow = rowsRef.current[r];
      if (!currentRow) { if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') onExitRef.current(); return; }
      // Up and Down land where the viewer last was on that rail.
      if (e.key === 'ArrowUp') { if (r === 0) onExitRef.current(); else { setRow(r - 1); setCol(anchorOf(r - 1)); } }
      else if (e.key === 'ArrowDown') { if (r < rowsRef.current.length - 1) { setRow(r + 1); setCol(anchorOf(r + 1)); } }
      // Left off the first tile is the way into the side menu.
      else if (e.key === 'ArrowLeft') { if (c > 0) setCol(c - 1); else onExitRef.current(); }
      else if (e.key === 'ArrowRight') { if (c < currentRow.items.length - 1) setCol(c + 1); }
      else if (e.key === 'Enter' || e.key === ' ') {
        // A held OK repeats: the first press opens the title, and the repeat
        // would press Play on the page that just opened.
        if (e.repeat) return;
        const it = currentRow.items[c]; if (it) onPlayRef.current(it);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive]);

  return (
    <div className="flex flex-col gap-4">
      {rows.map((r, ri) => (
        <div key={r.id} data-plex-row={r.id} ref={(el) => { railBoxRefs.current[r.id] = el; }}>
          <div className="text-base font-quicksand font-semibold text-white/90 mb-2">{r.title}</div>
          {(ri < row - RAIL_ROWS_SPAN || ri > row + RAIL_ROWS_SPAN) ? (
            <div aria-hidden="true" style={{ height: railHRef.current || RAIL_H_FALLBACK }} />
          ) : (
          <div
            ref={(el) => {
              measureRail(el);
              if (!el) return;
              // The rail that mounts under the highlight is placed by its
              // focused tile; mark it so leaving it later does not re-place it.
              if (ri === row) placedRef.current.add(el); else placeRail(el, ri);
            }}
            className="flex gap-3 overflow-x-auto py-2 px-2 -mx-2"
          >
            {(() => {
              // Only the tiles near the highlight are real; the rest of the
              // rail is two spacers of the same width. A 100-title rail then
              // costs the DOM and the image decoder the same as a few dozen —
              // and a cursor move re-renders two tiles, not four hundred.
              const focusedRow = isActive && ri === row;
              const at = Math.max(0, Math.min(ri === row ? col : (lastColRef.current[r.id] ?? 0), r.items.length - 1));
              const start = Math.max(0, at - railSpan);
              const end = Math.min(r.items.length, at + railSpan);
              const before = start > 0 ? start * RAIL_TILE_PX - RAIL_GAP_PX : 0;
              const after = end < r.items.length ? (r.items.length - end) * RAIL_TILE_PX - RAIL_GAP_PX : 0;
              return (
                <>
                  {before > 0 && <div className="flex-shrink-0" style={{ width: before }} aria-hidden="true" />}
                  {r.items.slice(start, end).map((it, i) => {
                    const ci = start + i;
                    return (
                      <PlexPosterTile
                        key={it.ratingKey}
                        item={it}
                        base={base}
                        token={token}
                        focused={focusedRow && ci === col}
                        onSelect={selectFor(ri)}
                        eager={ri === row && ci !== col && Math.abs(ci - col) <= 3}
                      />
                    );
                  })}
                  {after > 0 && <div className="flex-shrink-0" style={{ width: after }} aria-hidden="true" />}
                </>
              );
            })()}
          </div>
          )}
        </div>
      ))}
    </div>
  );
});
RailBrowser.displayName = 'RailBrowser';

// ─── HOME PANEL ────────────────────────────────────────────────────────────
interface HomePanelProps {
  isActive: boolean;
  base: string;
  token: string;
  /** The libraries the viewer can see — Home's Released and Popular rails are
   *  built from them, so a hidden library never leaks back in here. */
  libraries: PlexLibrary[];
  /** Section keys of the adult libraries, for the server-wide hubs and
   *  search, which are not built from `libraries`. */
  adultKeys: Set<string>;
  onPlay: (it: PlexItem) => void;
  onExitToTabs: () => void;
  /** Bumped when the player closes (see PlexSection). */
  watchNonce?: number;
  /** The box is on the viewer's own Plex account: the server's Continue
   *  Watching is theirs too and joins the app's own. */
  serverResume?: boolean;
  /** Home's play-count rail: "Popular on Snow Media" on the shared account,
   *  where the plays are everyone's; "Most Watched" on a viewer's own. */
  popularTitle?: string;
}
const HomePanel = memo(({ isActive, base, token, libraries, adultKeys, onPlay, onExitToTabs, watchNonce = 0, serverResume = false, popularTitle = 'Most Watched' }: HomePanelProps) => {
  const onDeckPath = '/library/onDeck?X-Plex-Container-Start=0&X-Plex-Container-Size=30';
  const recentPath = homeKey(HOME_ADDED_KEY);
  // Seeded from the cache however old it is: rails already in memory are
  // shown at once and refreshed behind the viewer, instead of a spinner and
  // a full reload every time Home is revisited after five minutes.
  const [onDeck, setOnDeck] = useState<PlexItem[]>(() => getCachedHubStale(base, onDeckPath) ?? []);
  const [recent, setRecent] = useState<PlexItem[]>(() => getCachedHubStale(base, recentPath) ?? []);
  const [released, setReleased] = useState<PlexItem[]>(() => getCachedHubStale(base, homeKey(HOME_RELEASED_KEY)) ?? []);
  const [popular, setPopular] = useState<PlexItem[]>(() => getCachedHubStale(base, homeKey(HOME_POPULAR_KEY)) ?? []);
  const [newEpisodes, setNewEpisodes] = useState<PlexItem[]>(() => getCachedHubStale(base, homeKey(HOME_NEW_EPISODES_KEY)) ?? []);
  const [loading, setLoading] = useState(!(getCachedHubStale(base, onDeckPath) || getCachedHubStale(base, recentPath)));
  // Continue Watching: this viewer's own (plexProgress), kept current as
  // progress is saved. The server's On Deck is only asked for in the demo.
  const [ownContinue, setOwnContinue] = useState<PlexItem[]>(() => (DEMO ? [] : continueWatching()));
  useEffect(() => {
    if (DEMO) return;
    const refresh = () => setOwnContinue(continueWatching());
    refresh();
    window.addEventListener(PLEX_PROGRESS_EVENT, refresh);
    return () => window.removeEventListener(PLEX_PROGRESS_EVENT, refresh);
  }, [watchNonce]);
  // My List (plexFavorites), kept current as titles are added and removed.
  const [listItems, setListItems] = useState<PlexItem[]>(() => (DEMO ? [] : myList()));
  useEffect(() => {
    if (DEMO) return;
    const refresh = () => setListItems(myList());
    refresh();
    window.addEventListener(PLEX_FAVORITES_EVENT, refresh);
    return () => window.removeEventListener(PLEX_FAVORITES_EVENT, refresh);
  }, []);

  const [hubRetry, setHubRetry] = useState(0);
  const hubRetryRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let retry: number | null = null;
    const cachedOd = getCachedHub(base, onDeckPath);
    const cachedRa = getCachedHub(base, recentPath);
    if (cachedOd && cachedRa) { setLoading(false); return; }
    // Only a spinner when there is nothing at all to show meanwhile.
    if (!getCachedHubStale(base, onDeckPath) && !getCachedHubStale(base, recentPath)) setLoading(true);
    const epoch = getHubEpoch();
    // A failure resolves to null so it is NOT written to the 5-minute cache.
    // getCachedHub returns the stored array, and [] is truthy, so a cached
    // failure reads as a cache HIT and blocks every later refetch — Home stays
    // an empty rail across remounts until the TTL runs out.
    Promise.all([
      cachedOd ? Promise.resolve(cachedOd)
        : (DEMO || serverResume) ? getPlexHub(base, token, onDeckPath).catch(() => null)
          : Promise.resolve([] as PlexItem[]),
      cachedRa ? Promise.resolve(cachedRa) : getHomeAdded(base, token).catch(() => null),
    ]).then(([od, ra]) => {
      // Cache first, even if the viewer already moved on: the answer is paid
      // for, and the next visit should not ask again.
      if (od) setCachedHub(base, onDeckPath, od, epoch);
      if (ra) setCachedHub(base, recentPath, ra, epoch);
      if (cancelled) return;
      if (od) setOnDeck(od);
      if (ra) setRecent(ra);
      setLoading(false);
      // Nothing landed: re-arm once so a Wi-Fi blip during the first visit does
      // not leave Home permanently empty.
      if (!od && !ra && hubRetryRef.current < 3) {
        hubRetryRef.current += 1;
        retry = window.setTimeout(() => setHubRetry((v) => v + 1), 4000);
      }
    });
    return () => { cancelled = true; if (retry) window.clearTimeout(retry); };
  }, [base, token, hubRetry, serverResume, recentPath]);

  // After playback, Continue Watching changes: refetch just that rail, in the
  // background, keeping the rails on screen while it loads.
  const seenNonceRef = useRef(watchNonce);
  useEffect(() => {
    // The server's Continue Watching is only used in the demo and on the
    // viewer's own Plex account (see ownContinue).
    if (watchNonce === seenNonceRef.current || !(DEMO || serverResume)) return;
    seenNonceRef.current = watchNonce;
    let cancelled = false;
    const epoch = getHubEpoch();
    getPlexHub(base, token, onDeckPath)
      .then((od) => { setCachedHub(base, onDeckPath, od, epoch); if (!cancelled) setOnDeck(od); })
      .catch(() => { /* keep what is on screen */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchNonce]);

  // Released, Popular and New Episodes. None exists as a server-wide hub, so
  // each is stitched from the per-section query the library rows already
  // use. Runs after the two hubs above — Home is usable without these, and
  // on a stick the first screen should not fan out more requests than it has
  // to.
  const libKeysSig = libraries.map((l) => `${l.type}:${l.key}`).join(',');
  useEffect(() => {
    if (DEMO || !libraries.length) return;
    let cancelled = false;
    const gone = () => cancelled;
    // Normally Released and Popular are already in the cache: the settle
    // screen on connect loads them before Home is revealed, so nothing lands
    // mid-navigation. This is the path for a cache that lapsed while Plex
    // stayed open, for Popular on a low-memory box, and for New Episodes,
    // the last rail, which never holds up the settle screen.
    void (async () => {
      const rel = await loadReleased(base, token, libraries, gone);
      if (cancelled) return;
      if (rel) setReleased(rel);
      const pop = await loadPopular(base, token, libraries, gone);
      if (cancelled) return;
      if (pop) setPopular(pop);
      const eps = await loadNewEpisodes(base, token, libraries, gone);
      if (cancelled) return;
      if (eps) setNewEpisodes(eps);
    })();
    return () => { cancelled = true; };
    // libKeysSig stands in for `libraries`: the array identity changes on every
    // parent render, the section keys do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, token, libKeysSig]);

  const rows = useMemo<DiscoverRow[]>(() => {
    // Filtered here, after the cache, so a rail cached before a library was
    // marked adult is caught on replay too.
    const r: DiscoverRow[] = [];
    // This viewer's own (plexProgress). The server's On Deck belongs to the
    // shared provider account, so it was everyone's viewing mixed together.
    const cont = familyOnly(DEMO ? onDeck : serverResume ? mergeContinue(ownContinue, onDeck) : ownContinue, adultKeys, !DEMO && !serverResume);
    if (cont.length > 0) r.push({ id: 'continue', title: 'Continue Watching', items: cont.slice(0, RAIL_CAP) });
    const mine = familyOnly(listItems, adultKeys, true);
    if (mine.length > 0) r.push({ id: 'mylist', title: 'My List', items: mine.slice(0, RAIL_CAP) });
    r.push({ id: 'added', title: 'Recently Added', items: familyOnly(recent, adultKeys).slice(0, RAIL_CAP) });
    const rel = familyOnly(released, adultKeys);
    if (rel.length > 0) r.push({ id: 'released', title: 'Recently Released', items: rel });
    // Most played on this server (see loadPopular); says so on the tin.
    const pop = familyOnly(popular, adultKeys);
    if (pop.length > 0) r.push({ id: 'popular', title: popularTitle, items: pop });
    // Last: it lands after Home is up (see loadNewEpisodes).
    const eps = familyOnly(newEpisodes, adultKeys);
    if (eps.length > 0) r.push({ id: 'episodes', title: 'New Episodes', items: eps });
    return r;
  }, [onDeck, ownContinue, listItems, recent, released, popular, newEpisodes, adultKeys, serverResume, popularTitle]);

  if (loading) return <div className="h-full flex items-center justify-center text-brand-ice/70"><Loader2 className="w-5 h-5 animate-spin text-brand-gold mr-2" /> Loading…</div>;
  if (rows.length === 0) return <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm">Nothing here yet.</div>;

  return <RailBrowser isActive={isActive} base={base} token={token} rows={rows} onPlay={onPlay} onExitToTabs={onExitToTabs} />;
});
HomePanel.displayName = 'HomePanel';

// ─── DISCOVER PANEL ────────────────────────────────────────────────────────
// The browsing screen: what the Plex app's own home shows that ours does not.
// Loaded only when opened, in two waves — the three rows that need no lookup
// first, then genres and decades once those have landed — so a stick is never
// asked for a dozen requests at once. Every row is cached like Home's, so
// coming back is instant for five minutes.
const DISCOVER_KEY = 'smc:discover/';
const DiscoverPanel = memo(({ isActive, base, token, libraries, adultKeys, onPlay, onExitToTabs }: HomePanelProps) => {
  const [rawRows, setRows] = useState<DiscoverRow[]>(() => getCachedDiscover(base));
  // Cached or fresh, no adult title reaches a Discover row.
  const rows = useMemo<DiscoverRow[]>(
    () => rawRows.map((r) => ({ ...r, items: familyOnly(r.items, adultKeys) })).filter((r) => r.items.length > 0),
    [rawRows, adultKeys]);
  const [loading, setLoading] = useState(rows.length === 0);

  // Entering Discover starts a pending load at once instead of waiting out
  // the dwell below.
  const kickRef = useRef<(() => void) | null>(null);
  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; if (isActive) kickRef.current?.(); }, [isActive]);

  const libKeysSig = libraries.map((l) => `${l.type}:${l.key}`).join(',');
  useEffect(() => {
    if (DEMO || !libraries.length) { setLoading(false); return; }
    const cached = getCachedDiscover(base);
    if (cached.length) { setRows(cached); setLoading(false); return; }
    let cancelled = false;
    const acc: DiscoverRow[] = [];
    // Every row is cached the moment it lands, whether or not the viewer is
    // still here: CapacitorHttp cannot abort a request, so an answer that
    // arrives after the cursor moved on is already paid for. A later visit
    // finds it and skips that request.
    const epoch = getHubEpoch();
    // `fromCache`: a row taken from the cache is not written back, or its
    // timestamp would renew on every interrupted visit and it would never
    // be refreshed.
    const land = (id: string, title: string, items: PlexItem[] | null, fromCache = false) => {
      if (!items?.length) return;
      if (!fromCache) setCachedHub(base, `${DISCOVER_KEY}${id}`, items, epoch);
      if (cancelled) return;
      acc.push({ id, title, items });
      setRows(acc.slice());
    };
    const cachedRow = (id: string) => getCachedHubWithin(base, `${DISCOVER_KEY}${id}`, DISCOVER_TTL_MS);
    const run = async () => {
      // Wave 1, two at a time (each of these is itself one request per
      // library). Rows a previous, interrupted visit already loaded are
      // taken from the cache.
      const had = { gems: !!cachedRow('gems'), random: !!cachedRow('random'), again: !!cachedRow('again') };
      const wave1: Array<() => Promise<unknown>> = [
        () => becauseYouWatched(base, token).catch(() => null),
        () => (had.gems ? Promise.resolve(cachedRow('gems')) : hiddenGems(base, token, libraries).catch(() => null)),
        () => (had.random ? Promise.resolve(cachedRow('random')) : surpriseMe(base, token, libraries).catch(() => null)),
        () => (had.again ? Promise.resolve(cachedRow('again')) : rediscover(base, token, libraries).catch(() => null)),
      ];
      const [byw, gems, random, again] = await mapLimit(wave1, HOME_PARALLEL, (f) => f()) as [
        { title: string; items: PlexItem[] } | null, PlexItem[] | null, PlexItem[] | null, PlexItem[] | null];
      if (byw) land('byw', byw.title, byw.items);
      land('gems', 'Hidden Gems', gems, had.gems);
      land('random', 'Surprise Me', random, had.random);
      land('again', 'Rediscover', again, had.again);
      if (cancelled) return;
      setLoading(false);
      // Wave 2. Genre rows in the app's order, then the decades that have
      // anything in them.
      const genres = await pickGenres(base, token, libraries).catch(() => []);
      if (cancelled) return;
      for (const g of genres) {
        const id = `genre:${g.title.toLowerCase()}`;
        const hit = cachedRow(id);
        const items = hit ?? await genreRow(base, token, libraries, g.keys).catch(() => null);
        land(id, g.title, items, !!hit);
        if (cancelled) return;
      }
      for (const d of DECADES) {
        const id = `decade:${d}`;
        const hit = cachedRow(id);
        const items = hit ?? await decadeRow(base, token, libraries, d).catch(() => null);
        land(id, decadeTitle(d), items, !!hit);
        if (cancelled) return;
      }
      // Row order is what the cache replays, so remember it too. Written only
      // once every row is in: a partial order would replay as "done".
      setCachedHub(base, `${DISCOVER_KEY}order`, acc.map((r) => ({ ratingKey: r.id, title: r.title, type: 'row' })));
    };
    // The side menu mounts this panel as the cursor passes over it. Wait
    // until the cursor rests here, or the viewer comes in, before asking the
    // server for anything.
    let started = false;
    const start = () => { if (started || cancelled) return; started = true; window.clearTimeout(timer); void run(); };
    const timer = window.setTimeout(start, isActiveRef.current ? 0 : 400);
    kickRef.current = start;
    return () => { cancelled = true; window.clearTimeout(timer); kickRef.current = null; };
    // libKeysSig stands in for `libraries`; see HomePanel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, token, libKeysSig]);

  if (loading) return <div className="h-full flex items-center justify-center text-brand-ice/70"><Loader2 className="w-5 h-5 animate-spin text-brand-gold mr-2" /> Finding things to watch…</div>;
  if (rows.length === 0) return <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm">Nothing to discover yet — this server has no libraries to browse.</div>;

  return <RailBrowser isActive={isActive} base={base} token={token} rows={rows} onPlay={onPlay} onExitToTabs={onExitToTabs} />;
});
DiscoverPanel.displayName = 'DiscoverPanel';

// ─── SEASONAL PANEL (Halloween …) ─────────────────────────────────────────
// A holiday collection: a hand-picked list looked up on this server (see
// plexSeasonal.ts). Same loading manners as Discover: waits for the cursor to
// rest on the menu entry and lands one row at a time. What it finds is kept
// for half a day, across launches, so the lookups run about twice a day.
const SeasonalPanel = memo(({ isActive, base, token, libraries, adultKeys, season, clientIdentifier, onPlay, onExitToTabs }: HomePanelProps & { season: Season; clientIdentifier?: string }) => {
  const libKeysSig = libraries.map((l) => `${l.type}:${l.key}`).join(',');
  // Rows and titles as the Hub last set them (kept with the stored rows), else
  // the list that shipped with the app.
  const orderShared = useCallback((rows: SharedSeasonRow[]): DiscoverRow[] => {
    try { localStorage.setItem(`smc-season-order:${season.id}`, JSON.stringify(rows.map((r) => [r.id, r.title]))); } catch { /* ignore */ }
    return rows.filter((r) => r.items.length).map((r) => ({ id: r.id, title: r.title, items: r.items }));
  }, [season]);
  const order = useCallback((got: Record<string, PlexItem[]>): DiscoverRow[] => {
    let defs: Array<[string, string]> = season.rows.map((r) => [r.id, r.title]);
    try {
      const saved = JSON.parse(localStorage.getItem(`smc-season-order:${season.id}`) || 'null') as Array<[string, string]> | null;
      if (Array.isArray(saved) && saved.length) defs = saved;
    } catch { /* ignore */ }
    return defs.filter(([id]) => got[id]?.length).map(([id, title]) => ({ id, title, items: got[id] }));
  }, [season]);
  const [rawRows, setRows] = useState<DiscoverRow[]>(() => order(loadStoredSeason(season.id, base, libKeysSig)));
  const rows = useMemo<DiscoverRow[]>(
    () => rawRows.map((r) => ({ ...r, items: familyOnly(r.items, adultKeys) })).filter((r) => r.items.length > 0),
    [rawRows, adultKeys]);
  const [loading, setLoading] = useState(rows.length === 0);
  const [done, setDone] = useState(false);

  const kickRef = useRef<(() => void) | null>(null);
  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; if (isActive) kickRef.current?.(); }, [isActive]);

  useEffect(() => {
    if (DEMO || !libraries.length) { setLoading(false); setDone(true); return; }
    let cancelled = false;
    const epoch = getHubEpoch();
    const got = loadStoredSeason(season.id, base, libKeysSig);
    // Rows already stored (empty ones too) are not looked up again.
    const have = new Set(Object.keys(got));
    setRows(order(got));
    if (season.rows.every((r) => have.has(r.id))) { setLoading(false); setDone(true); return; }
    const run = async () => {
      // The shared answer first: one request, the same rows for everyone.
      const shared = await loadSharedSeason(season.id, clientIdentifier, libraries);
      if (cancelled) return;
      if (shared && epoch === getHubEpoch()) {
        for (const r of shared) {
          storeSeasonRow(season.id, base, libKeysSig, r.id, r.items);
          got[r.id] = r.items;
        }
        setRows(orderShared(shared));
        setLoading(false); setDone(true);
        return;
      }
      await loadSeasonRows(base, token, libraries, season, (def, items) => {
        if (epoch !== getHubEpoch()) return; // signed out meanwhile
        storeSeasonRow(season.id, base, libKeysSig, def.id, items);
        if (cancelled) return;
        got[def.id] = items;
        setRows(order(got));
        if (items.length) setLoading(false);
      }, () => cancelled, (id) => have.has(id));
      if (!cancelled) { setLoading(false); setDone(true); }
    };
    let started = false;
    const start = () => { if (started || cancelled) return; started = true; window.clearTimeout(timer); void run(); };
    const timer = window.setTimeout(start, isActiveRef.current ? 0 : 400);
    kickRef.current = start;
    return () => { cancelled = true; window.clearTimeout(timer); kickRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, token, libKeysSig, season, clientIdentifier]);

  if (loading && rows.length === 0) return <div className="h-full flex items-center justify-center text-brand-ice/70"><Loader2 className="w-5 h-5 animate-spin text-brand-gold mr-2" /> Gathering the {season.title} collection…</div>;
  if (rows.length === 0) return <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm">{done ? `None of the ${season.title} collection is on this server yet.` : 'Loading…'}</div>;

  return <RailBrowser isActive={isActive} base={base} token={token} rows={rows} onPlay={onPlay} onExitToTabs={onExitToTabs} />;
});
SeasonalPanel.displayName = 'SeasonalPanel';

/** Replay a cached Discover: the order row lists the ids, each row is its
 *  own cached hub. Anything missing (TTL lapsed) means a fresh load. */
// Discover is a page of suggestions, most of them random picks: it does not
// go stale in five minutes, and reloading it replaced every row under the
// viewer with a reshuffled one. Kept for half an hour.
const DISCOVER_TTL_MS = 30 * 60 * 1000;
function getCachedDiscover(base: string): DiscoverRow[] {
  const order = getCachedHubWithin(base, `${DISCOVER_KEY}order`, DISCOVER_TTL_MS);
  if (!order?.length) return [];
  const out: DiscoverRow[] = [];
  for (const o of order) {
    const items = getCachedHubWithin(base, `${DISCOVER_KEY}${o.ratingKey}`, DISCOVER_TTL_MS);
    if (!items) return [];
    out.push({ id: o.ratingKey, title: o.title, items });
  }
  return out;
}

// ─── SEARCH PANEL ──────────────────────────────────────────────────────────
type SearchPanelProps = Omit<HomePanelProps, 'libraries'> & { initialQuery?: string };
interface SearchChip { label: string; group: 'didyoumean' | 'popular' | 'recent'; item?: PlexItem }

/** One search result. Memoised: the grid re-rendered every result on every
 *  cursor move and keystroke. Same look as before (rounded-2xl, title only). */
const SearchTile = memo(({ item: it, base, token, focused, onSelect }: {
  item: PlexItem; base: string; token: string; focused: boolean; onSelect: (it: PlexItem) => void;
}) => {
  const label = resolutionLabel(it.videoResolution);
  return (
    <div
      ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
      onClick={() => onSelect(it)}
      className={`tv-ring relative cursor-pointer rounded-2xl overflow-hidden border border-white/10 ${focused ? 'scale-105 z-10' : ''}`}
      data-focused={focused ? 'true' : 'false'}>
      {/* padding-bottom, not aspect-ratio: see PlexPosterTile. */}
      <div className="relative h-0" style={{ paddingBottom: '150%' }}>
        {/* eager + focusExempt: at most a few rows of results, and they are
            the thing on screen. The viewport gate and focus-mode parking
            could leave them on the grey placeholder. */}
        <PlexImage base={base} path={it.thumb} token={token} w={180} h={270} eager focusExempt className="absolute inset-0 w-full h-full object-cover" />
        <ResChip label={label} />
      </div>
      <div className={`px-2 py-1 text-sm font-nunito font-semibold truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>{it.title}</div>
    </div>
  );
});
SearchTile.displayName = 'SearchTile';

// Cover art for a suggested search ("Popular", "Recent"): the top movie or
// show that search finds on this server. Remembered for the session, so the
// row paints at once the next time the box opens.
// Kept per Kids level as well: a poster found on a grown-up profile is not
// one a Kids profile may see.
const _chipArt = new Map<string, PlexItem | null>();
const chipArtKey = (base: string, label: string) => `${base}|${kidsLevel() ?? ''}|${label.toLowerCase()}`;

/** A suggestion as a poster: the title's art, the search underneath. */
const ChipTile = memo(({ chip, art, base, token, focused, onPick }: {
  chip: SearchChip; art: PlexItem | null | undefined; base: string; token: string; focused: boolean; onPick: (c: SearchChip) => void;
}) => {
  const it = chip.item ?? art ?? null;
  return (
    <div
      ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
      onClick={() => onPick(chip)}
      className={`tv-ring relative cursor-pointer rounded-2xl overflow-hidden border border-white/10 ${focused ? 'scale-105 z-10' : ''}`}
      data-focused={focused ? 'true' : 'false'}>
      <div className="relative h-0" style={{ paddingBottom: '150%' }}>
        {it?.thumb ? (
          <PlexImage base={base} path={it.thumb} token={token} w={180} h={270} eager focusExempt className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand-navy/70 to-black/80 p-3 text-center">
            <span className="text-lg font-quicksand font-bold text-white/85 leading-snug">{chip.label}</span>
          </div>
        )}
      </div>
      <div className={`px-2 py-1 text-sm font-nunito font-semibold truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>{chip.label}</div>
    </div>
  );
});
ChipTile.displayName = 'ChipTile';

const SearchPanel = memo(({ isActive, base, token, adultKeys, onPlay, onExitToTabs, initialQuery }: SearchPanelProps) => {
  // A voice search arrives with its words already typed.
  const [query, setQuery] = useState(initialQuery ?? '');
  // What the server answered; `results` is that with adult titles removed.
  const [rawResults, setResults] = useState<PlexItem[]>([]);
  const results = useMemo(() => familyOnly(rawResults, adultKeys), [rawResults, adultKeys]);
  const [loading, setLoading] = useState(false);
  // 'chips' is the suggestion rows shown before anything is typed.
  const [zone, setZone] = useState<'input' | 'chips' | 'grid' | 'request'>('input');
  // "Not on Plex yet? Request it": what Overseerr finds for the same search
  // that this server does not have. OK asks, then requests (approved
  // automatically; shows with every season).
  const [reqItems, setReqItems] = useState<OverseerrItem[]>([]);
  const [reqCursor, setReqCursor] = useState(0);
  const [reqSent, setReqSent] = useState<Record<number, 'requested' | 'already'>>({});
  const [confirmReq, setConfirmReq] = useState<OverseerrItem | null>(null);
  const [confirmIdx, setConfirmIdx] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [chipIdx, setChipIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);

  // Suggestions: the fleet's popular searches (or, until there are enough,
  // the server's most-played titles), then this box's own recent ones.
  // Neither on a Kids profile: the popular list is whatever grown-ups across
  // the fleet searched for, and the recent one is the whole box's.
  const [popular, setPopular] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>(() => (kidsLevel() ? [] : loadRecentSearches()));
  // "Did you mean": the closest titles when the search comes back thin
  // (see plexFuzzy.ts) — a dropped apostrophe or colon, a letter off.
  const [didYouMean, setDidYouMean] = useState<PlexItem[]>([]);
  useEffect(() => {
    if (kidsLevel()) return;
    let cancelled = false;
    void fetchPopularSearches().then((list) => {
      if (cancelled) return;
      if (list.length) { setPopular(list); return; }
      const mostWatched = getCachedHubStale(base, homeKey(HOME_POPULAR_KEY)) ?? [];
      const recentlyAdded = getCachedHub(base, homeKey(HOME_ADDED_KEY)) ?? [];
      setPopular(fallbackSuggestions([...mostWatched, ...recentlyAdded].map((it) => it.title)));
    });
    return () => { cancelled = true; };
  }, [base]);
  const chips = useMemo<SearchChip[]>(() => {
    // With something typed, the only chips are "Did you mean"; the popular
    // and recent rows belong to the empty box.
    if (query.trim()) {
      return familyOnly(didYouMean, adultKeys).slice(0, COLS).map((it) => ({ label: it.year ? `${it.title} (${it.year})` : it.title, group: 'didyoumean' as const, item: it }));
    }
    // One row of posters per group, so Up/Down move between the rows.
    const seen = new Set<string>();
    const out: SearchChip[] = [];
    let n = 0;
    for (const label of popular) { const k = label.toLowerCase(); if (n < COLS && !seen.has(k)) { seen.add(k); out.push({ label, group: 'popular' }); n++; } }
    n = 0;
    for (const label of recent) { const k = label.toLowerCase(); if (n < COLS && !seen.has(k)) { seen.add(k); out.push({ label, group: 'recent' }); n++; } }
    return out;
  }, [popular, recent, didYouMean, query, adultKeys]);
  const showChips = chips.length > 0;

  // Posters for the suggestion rows, two searches at a time.
  const [chipArtTick, setChipArtTick] = useState(0);
  useEffect(() => {
    const todo = chips.filter((c) => !c.item && !_chipArt.has(chipArtKey(base, c.label)));
    if (!todo.length) return;
    let cancelled = false;
    void mapLimit(todo, HOME_PARALLEL, async (c) => {
      if (cancelled) return;
      let hit: PlexItem | null = null;
      try {
        const r = familyOnly(await searchPlex(base, token, c.label), searchCtxRef.current.adultKeys);
        hit = r.find((it) => !!it.thumb) ?? null;
      } catch { hit = null; }
      _chipArt.set(chipArtKey(base, c.label), hit);
      if (!cancelled) setChipArtTick((t) => t + 1);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chips, base]);

  // A search the viewer meant — they went down into the results or opened
  // one — is what "Popular searches" counts and what this box remembers.
  const committedRef = useRef('');
  const commit = useCallback((q: string) => {
    const t = q.trim();
    if (!t || committedRef.current === t) return;
    committedRef.current = t;
    commitSearch(t);
    if (!kidsLevel()) setRecent(loadRecentSearches());
  }, []);

  // Debounced search: 400ms + stale-seq guard so only the latest keystroke wins.
  //
  // Keyed on the query alone. The server address, token and adult-library
  // list are read through refs: when the connection upgrade swapped the
  // address, or the library list arrived, the same search ran again (up to
  // five requests) and the highlight jumped back to the first result. The
  // adult filter is applied at render instead (resultsShown below), so a
  // late library list still filters what is on screen.
  const searchCtxRef = useRef({ base, token, adultKeys });
  searchCtxRef.current = { base, token, adultKeys };
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setDidYouMean([]); setReqItems([]); return; }
    const mySeq = ++seqRef.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      try { trackEvent('player_search', 'player', { scope: 'plex', query: q.slice(0, 64) }); } catch { /* ignore */ }
      void (async () => {
        const ctx = searchCtxRef.current;
        let r: PlexItem[] = [];
        try { r = await searchPlex(ctx.base, ctx.token, q); } catch { r = []; }
        if (mySeq !== seqRef.current) return;
        setResults(r); setCursor(0); setLoading(false);
        const family = familyOnly(r, searchCtxRef.current.adultKeys);
        // Alongside: what could be requested for this search. Not on a Kids
        // profile: Overseerr's answer is every film and series of that name,
        // unrated, with its poster and synopsis — and a Kids profile does not
        // request titles (the Request tab is gone for it too).
        if (kidsLevel()) setReqItems([]);
        else {
          void overseerrSearch(q).then((found) => {
            if (mySeq !== seqRef.current) return;
            setReqItems(missingFromPlex(found, family, COLS));
            setReqCursor(0);
          });
        }
        if (!searchLooksThin(q, family)) { setDidYouMean([]); return; }
        // Thin answer. Search for the pieces of what was typed and score
        // everything that comes back against it.
        const variants = searchVariants(q);
        const lists = await mapLimit(variants, HOME_PARALLEL, (v) =>
          searchPlex(ctx.base, ctx.token, v).catch(() => [] as PlexItem[]));
        if (mySeq !== seqRef.current) return;
        const shown = new Set(family.map((it) => String(it.ratingKey)));
        const near = rankSuggestions(q, familyOnly([...lists.flat(), ...r], searchCtxRef.current.adultKeys), shown);
        setDidYouMean(near);
        if (near.length) { try { trackEvent('plex_search_suggest', 'player', { query: q.slice(0, 64), hits: near.length }); } catch { /* ignore */ } }
      })();
    }, 400);
    return () => { window.clearTimeout(t); };
  }, [query]);


  useEffect(() => { if (isActive && zone === 'input') inputRef.current?.focus(); }, [isActive, zone]);
  // Typing again leaves the chips behind; clearing the box brings them back.
  useEffect(() => { if (zone === 'chips' && !showChips) setZone('input'); }, [zone, showChips]);
  useEffect(() => { setChipIdx((i) => Math.min(i, Math.max(0, chips.length - 1))); }, [chips.length]);

  const zoneRef = useRef(zone); useEffect(() => { zoneRef.current = zone; }, [zone]);
  const cursorRef = useRef(cursor); useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const reqItemsRef = useRef(reqItems); useEffect(() => { reqItemsRef.current = reqItems; }, [reqItems]);
  const reqSentRef = useRef(reqSent); useEffect(() => { reqSentRef.current = reqSent; }, [reqSent]);
  const reqCursorRef = useRef(reqCursor); useEffect(() => { reqCursorRef.current = reqCursor; }, [reqCursor]);
  const confirmReqRef = useRef(confirmReq); useEffect(() => { confirmReqRef.current = confirmReq; }, [confirmReq]);
  const confirmIdxRef = useRef(confirmIdx); useEffect(() => { confirmIdxRef.current = confirmIdx; }, [confirmIdx]);
  const requestingRef = useRef(requesting); useEffect(() => { requestingRef.current = requesting; }, [requesting]);
  useEffect(() => {
    const w = window as unknown as { __plexRequestAsk?: boolean };
    w.__plexRequestAsk = !!confirmReq;
    return () => { w.__plexRequestAsk = false; };
  }, [confirmReq]);
  // Leaving the row when it empties (a new search found nothing to request).
  useEffect(() => { if (zone === 'request' && reqItems.length === 0) setZone(results.length ? 'grid' : 'input'); }, [zone, reqItems.length, results.length]);
  // Already on its way: say so instead of asking again.
  const askRequest = useCallback((it: OverseerrItem) => {
    if (kidsLevel()) return;
    if (reqSentRef.current[it.id] || it.status === 2 || it.status === 3) {
      toast({ title: 'Already requested', description: `${it.title} is already on its way to Plex.` });
      return;
    }
    setConfirmIdx(0);
    setConfirmReq(it);
  }, []);
  const askRequestRef = useRef(askRequest);
  const sendRequest = useCallback(async (it: OverseerrItem) => {
    if (requestingRef.current || kidsLevel()) return;
    setRequesting(true);
    const res = await overseerrRequest(it);
    setRequesting(false);
    setConfirmReq(null);
    if (res === 'failed') {
      toast({ title: "Couldn't send that request", description: 'Please try again in a minute.', variant: 'destructive' });
      return;
    }
    setReqSent((m) => ({ ...m, [it.id]: res }));
    try { trackEvent('plex_request', 'player', { media: it.mediaType, title: it.title.slice(0, 80), result: res }); } catch { /* ignore */ }
    toast({
      title: res === 'already' ? 'Already requested' : 'Requested!',
      description: res === 'already'
        ? `${it.title} is already on its way.`
        : `${it.title} will be added to Plex${it.mediaType === 'tv' ? ', every season' : ''}, usually within a few hours. We'll let you know when it's ready.`,
    });
  }, []);
  const chipIdxRef = useRef(chipIdx); useEffect(() => { chipIdxRef.current = chipIdx; }, [chipIdx]);
  const chipsRef = useRef(chips); useEffect(() => { chipsRef.current = chips; }, [chips]);
  const showChipsRef = useRef(showChips); useEffect(() => { showChipsRef.current = showChips; }, [showChips]);
  const queryRef = useRef(query); useEffect(() => { queryRef.current = query; }, [query]);
  const resultsRef = useRef(results); useEffect(() => { resultsRef.current = results; }, [results]);
  const onPlayRef = useRef(onPlay); useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  const onExitRef = useRef(onExitToTabs); useEffect(() => { onExitRef.current = onExitToTabs; }, [onExitToTabs]);
  const pickChip = useCallback((chip: SearchChip) => {
    // A "Did you mean" chip is a real title: open it. The others are
    // searches: run them.
    if (chip.item) { commit(queryRef.current); onPlayRef.current(chip.item); return; }
    setQuery(chip.label);
    commit(chip.label);
    setZone('input');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [commit]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (!isPlexKeyOwner('browse')) return;
      // The "Request it?" question owns the remote while it is up.
      if (confirmReqRef.current) {
        const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
        const k = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '];
        if (!isBack && !k.includes(e.key)) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (isBack) { setConfirmReq(null); return; }
        if (e.key === 'ArrowLeft') setConfirmIdx(0);
        else if (e.key === 'ArrowRight') setConfirmIdx(1);
        else if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          const it = confirmReqRef.current;
          if (confirmIdxRef.current === 0 && it) void sendRequest(it);
          else setConfirmReq(null);
        }
        return;
      }
      const t = e.target as HTMLElement;
      const inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (zoneRef.current === 'input') {
        // Left with the caret at the start (or nothing typed) is "back to the
        // menu", the same as everywhere else in Plex. Without this the WebView's
        // own spatial navigation took the key and lit up the whole panel.
        if (inInput && e.key === 'ArrowLeft') {
          const el = inputRef.current;
          const atStart = !el || !el.value || (el.selectionStart ?? 0) === 0;
          if (atStart) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); el?.blur(); onExitRef.current(); }
          return;
        }
        if (inInput && e.key === 'ArrowDown') {
          // Chips sit above the results, so they come first when there are any.
          if (showChipsRef.current) {
            e.preventDefault(); e.stopPropagation(); inputRef.current?.blur(); setZone('chips'); setChipIdx(0);
          } else if (resultsRef.current.length > 0) {
            e.preventDefault(); e.stopPropagation(); inputRef.current?.blur(); setZone('grid'); setCursor(0);
            commit(queryRef.current);
          } else if (reqItemsRef.current.length > 0) {
            e.preventDefault(); e.stopPropagation(); inputRef.current?.blur(); setZone('request'); setReqCursor(0);
            commit(queryRef.current);
          }
        } else if (inInput && e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); inputRef.current?.blur(); onExitRef.current();
        }
        return;
      }
      if (inInput) return;
      const keys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (zoneRef.current === 'chips') {
        // Each group is one row of posters. Left/Right move along the row,
        // Up/Down move between rows keeping the column (Up off the top row
        // is the search box, Down off the last is the results), OK searches.
        const list = chipsRef.current;
        const i = chipIdxRef.current;
        const groups: number[][] = [];
        list.forEach((c, k) => {
          if (k === 0 || list[k - 1].group !== c.group) groups.push([]);
          groups[groups.length - 1].push(k);
        });
        const gi = groups.findIndex((g) => g.includes(i));
        const row = groups[gi] ?? [];
        const col = Math.max(0, row.indexOf(i));
        if (e.key === 'ArrowUp') {
          if (gi > 0) { const up = groups[gi - 1]; setChipIdx(up[Math.min(col, up.length - 1)]); }
          else { setZone('input'); setTimeout(() => inputRef.current?.focus(), 0); }
        }
        else if (e.key === 'ArrowDown') {
          if (gi >= 0 && gi < groups.length - 1) { const dn = groups[gi + 1]; setChipIdx(dn[Math.min(col, dn.length - 1)]); }
          else if (resultsRef.current.length > 0) { setZone('grid'); setCursor(Math.min(col, resultsRef.current.length - 1)); commit(queryRef.current); }
          else if (reqItemsRef.current.length > 0) { setZone('request'); setReqCursor(Math.min(col, reqItemsRef.current.length - 1)); }
        }
        else if (e.key === 'ArrowLeft') { if (col > 0) setChipIdx(row[col - 1]); else onExitRef.current(); }
        else if (e.key === 'ArrowRight') { if (col + 1 < row.length) setChipIdx(row[col + 1]); }
        else if (e.key === 'Enter' || e.key === ' ') { if (e.repeat) return; const c = list[i]; if (c) pickChip(c); }
        return;
      }
      if (zoneRef.current === 'request') {
        const list = reqItemsRef.current;
        const i = reqCursorRef.current;
        if (e.key === 'ArrowLeft') { if (i > 0) setReqCursor(i - 1); else onExitRef.current(); }
        else if (e.key === 'ArrowRight') { if (i + 1 < list.length) setReqCursor(i + 1); }
        else if (e.key === 'ArrowUp') {
          const n = resultsRef.current.length;
          if (n > 0) { setZone('grid'); setCursor(Math.min(n - 1, Math.floor((n - 1) / COLS) * COLS + i)); }
          else if (showChipsRef.current) { setZone('chips'); setChipIdx(Math.max(0, chipsRef.current.length - 1)); }
          else { setZone('input'); setTimeout(() => inputRef.current?.focus(), 0); }
        }
        else if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          const it = list[i];
          if (it) askRequestRef.current(it);
        }
        return;
      }
      const total = resultsRef.current.length;
      const cur = cursorRef.current;
      if (e.key === 'ArrowUp') {
        if (cur >= COLS) setCursor(cur - COLS);
        else if (showChipsRef.current) {
          const list = chipsRef.current;
          const lastGroup = list.length ? list[list.length - 1].group : null;
          const lastRow = list.map((c, k) => ({ c, k })).filter(({ c }) => c.group === lastGroup).map(({ k }) => k);
          setZone('chips');
          setChipIdx(lastRow.length ? lastRow[Math.min(cur, lastRow.length - 1)] : 0);
        }
        else { setZone('input'); setTimeout(() => inputRef.current?.focus(), 0); }
      }
      else if (e.key === 'ArrowDown') {
        if (cur + COLS < total) setCursor(cur + COLS);
        else if (reqItemsRef.current.length > 0) { setZone('request'); setReqCursor(Math.min(cur % COLS, reqItemsRef.current.length - 1)); }
      }
      else if (e.key === 'ArrowLeft') { if (cur % COLS !== 0) setCursor(cur - 1); else onExitRef.current(); }
      else if (e.key === 'ArrowRight') { if ((cur % COLS) < COLS - 1 && cur + 1 < total) setCursor(cur + 1); }
      else if (e.key === 'Enter' || e.key === ' ') { if (e.repeat) return; const it = resultsRef.current[cur]; if (it) { commit(queryRef.current); onPlayRef.current(it); } }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, commit, pickChip, sendRequest]);

  const pickChipAt = useCallback((c: SearchChip) => {
    const idx = chipsRef.current.indexOf(c);
    if (idx >= 0) setChipIdx(idx);
    pickChip(c);
  }, [pickChip]);
  const rows = Math.ceil(results.length / COLS);
  // One click handler for every result, so a cursor move or a keystroke only
  // re-renders the tiles whose highlight changed (SearchTile is memoised).
  const selectResult = useCallback((it: PlexItem) => {
    const idx = resultsRef.current.findIndex((x) => x.ratingKey === it.ratingKey);
    setZone('grid');
    if (idx >= 0) setCursor(idx);
    commit(queryRef.current);
    onPlayRef.current(it);
  }, [commit]);
  return (
    <div className="flex flex-col gap-4">
      <div data-focused={isActive && zone === 'input' ? 'true' : 'false'} className="tv-ring flex items-center gap-2 px-4 py-3 rounded-xl bg-black/40 border border-white/10">
        <SearchIcon className="w-4 h-4 text-brand-ice/60" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setZone('input')}
          placeholder="Search movies & shows…"
          className="flex-1 bg-transparent outline-none text-white font-nunito text-base placeholder:text-brand-ice/50"
        />
        {loading && <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />}
      </div>
      {showChips && (
        <div className="flex flex-col gap-5 py-2">
          {(['didyoumean', 'popular', 'recent'] as const).map((group) => {
            const mine = chips.map((c, i) => ({ c, i })).filter(({ c }) => c.group === group);
            if (!mine.length) return null;
            return (
              <div key={group}>
                <div className="text-xs uppercase tracking-wider text-brand-ice/60 font-nunito mb-2">
                  {group === 'didyoumean' ? 'Did you mean' : group === 'popular' ? 'Popular searches' : 'Recent on this box'}
                </div>
                <div className="grid grid-cols-6 gap-3" data-art-tick={chipArtTick}>
                  {mine.map(({ c, i }) => (
                    <ChipTile
                      key={`${group}:${c.label}`}
                      chip={c}
                      art={c.item ? undefined : _chipArt.get(chipArtKey(base, c.label))}
                      base={base}
                      token={token}
                      focused={isActive && zone === 'chips' && chipIdx === i}
                      onPick={pickChipAt}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {results.length === 0 ? (
        showChips || reqItems.length ? null : <div className="text-brand-ice/70 font-nunito text-sm text-center py-6">{query.trim() ? (loading ? 'Searching…' : 'No results.') : 'Type to search Plex.'}</div>
      ) : (
        <div className="grid grid-cols-6 gap-3">
          {Array.from({ length: rows * COLS }).map((_, idx) => {
            const it = results[idx];
            if (!it) return <div key={idx} />;
            return (
              <SearchTile key={it.ratingKey} item={it} base={base} token={token}
                focused={isActive && zone === 'grid' && cursor === idx} onSelect={selectResult} />
            );
          })}
        </div>
      )}
      {reqItems.length > 0 && (
        <div>
          {results.length === 0 && !loading ? (
            <>
              <div className="text-xl font-quicksand font-bold text-white mb-1">“{query.trim()}” isn’t on Plex yet</div>
              <div className="text-base text-brand-ice/70 font-nunito mb-3">Pick it below and press OK to request it — we will add it to Plex for you and let you know when it’s ready.</div>
            </>
          ) : (
            <>
              <div className="text-xs uppercase tracking-wider text-brand-ice/60 font-nunito mb-1">Not on Plex yet? Request it</div>
              <div className="text-sm text-brand-ice/50 font-nunito mb-2">Press OK on a title and we will add it to Plex for you, and let you know when it’s ready.</div>
            </>
          )}
          <div className="grid grid-cols-6 gap-3">
            {reqItems.map((it, i) => (
              <RequestTile
                key={`${it.mediaType}:${it.id}`}
                item={it}
                sent={reqSent[it.id]}
                focused={isActive && zone === 'request' && reqCursor === i && !confirmReq}
                onPick={() => { setZone('request'); setReqCursor(i); askRequest(it); }}
              />
            ))}
          </div>
        </div>
      )}
      {confirmReq && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70" role="dialog" aria-label="Request this title?">
          <div className="max-w-2xl w-full mx-6 rounded-3xl border border-brand-gold/40 bg-[#0b1220] p-7 shadow-2xl">
            <div className="flex items-start text-left">
              {confirmReq.posterUrl && (
                <img src={tmdbSized(confirmReq.posterUrl, 'w185')} alt="" className="w-32 h-48 rounded-xl object-cover mr-6 flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wider text-brand-gold font-nunito font-bold">
                  {confirmReq.mediaType === 'tv' ? 'Show' : 'Movie'} · not on Plex yet
                </div>
                <div className="mt-1 text-2xl font-quicksand font-bold text-white leading-tight">
                  {confirmReq.title}{confirmReq.year ? ` (${confirmReq.year})` : ''}
                </div>
                {confirmReq.overview && (
                  <p className="mt-2 text-sm text-white/70 font-nunito leading-snug" style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {confirmReq.overview}
                  </p>
                )}
                <p className="mt-3 text-base text-white/85 font-nunito">
                  {confirmReq.mediaType === 'tv'
                    ? 'Request it and every season is added to Plex, usually within a few hours. We will let you know when it’s ready.'
                    : 'Request it and it is added to Plex, usually within a few hours. We will let you know when it’s ready.'}
                </p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" disabled={requesting} onClick={() => void sendRequest(confirmReq)}
                className={`h-12 rounded-xl text-lg font-quicksand font-bold bg-brand-gold text-slate-900 ${confirmIdx === 0 ? 'ring-4 ring-brand-ice scale-105' : ''}`}>
                {requesting ? 'Sending…' : 'Request'}
              </button>
              <button type="button" onClick={() => setConfirmReq(null)}
                className={`h-12 rounded-xl text-lg font-quicksand font-bold bg-slate-800 border border-slate-600 text-white ${confirmIdx === 1 ? 'ring-4 ring-brand-ice scale-105' : ''}`}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
SearchPanel.displayName = 'SearchPanel';

/** A title Overseerr can fetch: its poster, and where it stands. */
const RequestTile = memo(({ item: it, sent, focused, onPick }: {
  item: OverseerrItem; sent?: 'requested' | 'already'; focused: boolean; onPick: () => void;
}) => {
  const state = sent ? 'Requested' : it.status === 4 ? 'Partly on Plex' : it.status >= 2 ? 'Requested' : null;
  return (
    <div
      ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
      onClick={onPick}
      className={`tv-ring relative cursor-pointer rounded-2xl overflow-hidden border border-dashed border-brand-gold/40 ${focused ? 'scale-105 z-10' : ''}`}
      data-focused={focused ? 'true' : 'false'}>
      <div className="relative h-0" style={{ paddingBottom: '150%' }}>
        {it.posterUrl
          ? <img src={tmdbSized(it.posterUrl, 'w185')} alt="" decoding="async" className="absolute inset-0 w-full h-full object-cover opacity-80" />
          : <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand-navy/70 to-black/80 p-3 text-center"><span className="text-base font-quicksand font-bold text-white/85">{it.title}</span></div>}
        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/75 text-[11px] font-nunito font-semibold text-white/90">{it.mediaType === 'tv' ? 'Show' : 'Movie'}</span>
        <span className={`absolute bottom-2 left-2 right-2 px-2 py-1 rounded-lg text-center text-xs font-nunito font-bold ${state ? 'bg-emerald-600/85 text-white' : 'bg-brand-gold/90 text-slate-900'}`}>
          {state ?? '+ Request'}
        </span>
      </div>
      <div className={`px-2 py-1 text-sm font-nunito font-semibold truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>
        {it.title}{it.year ? ` (${it.year})` : ''}
      </div>
    </div>
  );
});
RequestTile.displayName = 'RequestTile';

// ─── SETTINGS PANEL (formerly Manage) ──────────────────────────────────────
interface ManagePanelProps {
  isActive: boolean;
  libraries: PlexLibrary[];
  hidden: string[];
  /** Why the last library fetch failed, or null. Shown so an empty list on
   *  the TV says what happened instead of just "none". */
  librariesError: string | null;
  onToggle: (key: string) => void;
  onExitToTabs: () => void;
  serverName?: string;
  owned?: boolean;
  accountToken?: string;
  onSignOut: () => void;
}
/** Playback failures where the bytes stopped arriving, as opposed to a codec
 *  the device cannot decode. RECONNECT_EXHAUSTED comes from our own plugin;
 *  ERROR_CODE_IO_* are ExoPlayer's own names, forwarded verbatim. */
function isNetworkPlaybackError(code?: string): boolean {
  if (!code) return false;
  return code === 'RECONNECT_EXHAUSTED' || code.indexOf('ERROR_CODE_IO') === 0;
}

const ManagePanel = memo(({ isActive, libraries, hidden, librariesError, onToggle, onExitToTabs, serverName, owned, accountToken, onSignOut }: ManagePanelProps) => {
  const hiddenCount = libraries.filter((l) => hidden.indexOf(l.key) >= 0).length;
  const [cursor, setCursor] = useState(0);
  const [account, setAccount] = useState<{ username?: string; email?: string } | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);
  const cursorRef = useRef(cursor); useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const libsRef = useRef(libraries); useEffect(() => { libsRef.current = libraries; }, [libraries]);
  // The list can shrink under a stationary cursor (a library disappears from
  // the server). Without this nothing is highlighted until the next D-pad press.
  useEffect(() => { setCursor((c) => Math.min(c, libraries.length)); }, [libraries.length]);
  const onToggleRef = useRef(onToggle); useEffect(() => { onToggleRef.current = onToggle; }, [onToggle]);
  const onExitRef = useRef(onExitToTabs); useEffect(() => { onExitRef.current = onExitToTabs; }, [onExitToTabs]);
  const onSignOutRef = useRef(onSignOut); useEffect(() => { onSignOutRef.current = onSignOut; }, [onSignOut]);
  const confirmRef = useRef(confirmSignOut); useEffect(() => { confirmRef.current = confirmSignOut; }, [confirmSignOut]);

  useEffect(() => {
    if (!accountToken) return;
    let cancelled = false;
    void getPlexAccount(accountToken).then((a) => { if (!cancelled) setAccount(a); });
    return () => { cancelled = true; };
  }, [accountToken]);

  const disarmConfirm = useCallback(() => {
    if (confirmTimerRef.current) { window.clearTimeout(confirmTimerRef.current); confirmTimerRef.current = null; }
    setConfirmSignOut(false);
  }, []);

  // Confirmed sign-out: reuse the existing usePlexAuth signOut path
  // (clearPlexToken → clears token + saved server + catalog caches) — no
  // second token-clearing path. Analytics suppressed centrally in DEMO.
  const doSignOut = useCallback(() => {
    disarmConfirm();
    try { trackEvent('plex_signout', 'player', {}); } catch { /* ignore */ }
    onSignOutRef.current();
  }, [disarmConfirm]);

  useEffect(() => () => { if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current); }, []);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (!isPlexKeyOwner('browse')) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const keys = ['ArrowUp','ArrowDown','Enter',' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const c = cursorRef.current;
      const total = libsRef.current.length + 1; // + Sign out row at end
      const signOutIdx = libsRef.current.length;
      if (e.key === 'ArrowUp') {
        if (c === 0) onExitRef.current();
        else setCursor(c - 1);
        if (confirmRef.current) disarmConfirm();
      } else if (e.key === 'ArrowDown') {
        // Clamp at the last row — house style is clamped ends, never wrap.
        setCursor(Math.min(c + 1, total - 1));
        if (confirmRef.current) disarmConfirm();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (e.repeat) return; // a held OK must not act twice
        if (c === signOutIdx) {
          if (confirmRef.current) {
            doSignOut();
          } else {
            setConfirmSignOut(true);
            if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
            confirmTimerRef.current = window.setTimeout(() => setConfirmSignOut(false), 5000);
          }
          return;
        }
        const lib = libsRef.current[c];
        if (lib) onToggleRef.current(lib.key);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, disarmConfirm, doSignOut]);

  const accountLine = account?.username || account?.email;
  const ownedLine = isProviderServer(serverName) ? 'Provider server' : owned === true ? 'You own this server' : owned === false ? 'Shared with you' : '';

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-2">
      {(serverName || ownedLine || accountLine) && (
        <div className="mb-3 rounded-xl bg-black/30 border border-white/10 px-4 py-3">
          {serverName && <div className="font-quicksand font-bold text-white">{serverName}</div>}
          {ownedLine && <div className="text-xs font-nunito text-brand-ice/70 mt-1">{ownedLine}</div>}
          {accountLine && <div className="text-xs font-nunito text-brand-ice/70 mt-1">{accountLine}</div>}
        </div>
      )}
      {librariesError && libraries.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 font-nunito text-xs text-amber-200">
          This list may be out of date — the last refresh failed: {librariesError}
        </div>
      )}
      {libraries.length === 0 ? (
        <div className="font-nunito text-sm space-y-1">
          <div className="text-brand-ice/70">
            {librariesError ? 'Could not load your libraries.' : 'No libraries found on this server.'}
          </div>
          {librariesError && <div className="text-amber-300 text-xs">{librariesError}</div>}
          <div className="text-brand-ice/70 text-xs">
            {librariesError
              ? 'The server answered, but this request failed. Check it is online and that this Plex account still has access.'
              : 'This account has no movie or TV libraries shared on it. Music and photo libraries are not listed here.'}
          </div>
        </div>
      ) : hiddenCount === libraries.length ? (
        <div className="font-nunito text-sm space-y-2">
          <div className="text-brand-ice/70">All {libraries.length} libraries are hidden, so no tabs appear.</div>
          <div className="text-brand-ice/70 text-xs">Pick one below to show it again.</div>
          <div className="text-xs uppercase tracking-wide text-brand-ice/70 pt-1">Show / hide libraries</div>
          {libraries.map((lib, i) => {
            const focused = isActive && cursor === i;
            return (
              <div key={lib.key}
                ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest' }); }}
                onClick={() => { setCursor(i); onToggle(lib.key); }}
                className={`tv-ring flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 cursor-pointer ${focused ? 'bg-brand-gold/20 scale-[1.02] z-10' : 'bg-black/40'}`}
                data-focused={focused ? 'true' : 'false'}>
                <div>
                  <div className="font-quicksand text-white">{lib.title}</div>
                  <div className="text-xs font-nunito text-brand-ice/70 uppercase">{lib.type}</div>
                </div>
                <span className="flex items-center gap-2 text-xs text-brand-ice/70"><EyeOff className="w-4 h-4" /> Hidden</span>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="text-xs uppercase tracking-wide text-brand-ice/70 mb-1">Show / hide libraries</div>
          {libraries.map((lib, i) => {
            const focused = isActive && cursor === i;
            const isHidden = hidden.indexOf(lib.key) >= 0;
            return (
              <div key={lib.key}
                ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest' }); }}
                onClick={() => { setCursor(i); onToggle(lib.key); }}
                className={`tv-ring flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 cursor-pointer ${focused ? 'bg-brand-gold/20 scale-[1.02] z-10' : 'bg-black/40'}`}
                data-focused={focused ? 'true' : 'false'}>
                <div>
                  <div className="font-quicksand text-white">{lib.title}</div>
                  <div className="text-xs font-nunito text-brand-ice/70 uppercase">{lib.type}</div>
                </div>
                {isHidden
                  ? <span className="flex items-center gap-2 text-xs text-brand-ice/70"><EyeOff className="w-4 h-4" /> Hidden</span>
                  : <span className="flex items-center gap-2 text-xs text-brand-gold"><Eye className="w-4 h-4" /> Visible</span>}
              </div>
            );
          })}
        </>
      )}
      {(() => {
        const signOutIdx = libraries.length;
        const focused = isActive && cursor === signOutIdx;
        return (
          <div key="__signout"
            ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest' }); }}
            onClick={() => {
              setCursor(signOutIdx);
              if (confirmSignOut) { doSignOut(); }
              else {
                setConfirmSignOut(true);
                if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
                confirmTimerRef.current = window.setTimeout(() => setConfirmSignOut(false), 5000);
              }
            }}
            className={`tv-ring mt-3 flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer ${confirmSignOut ? 'tv-ring-danger border-red-500/40' : 'border-white/10'} ${focused ? (confirmSignOut ? 'bg-red-500/25 scale-[1.02] z-10' : 'bg-brand-gold/20 scale-[1.02] z-10') : (confirmSignOut ? 'bg-red-500/15' : 'bg-black/40')}`}
            data-focused={focused ? 'true' : 'false'}>
            <LogOut className={`w-4 h-4 ${confirmSignOut ? 'text-red-300' : 'text-brand-ice/70'}`} />
            <div className={`font-quicksand ${confirmSignOut ? 'text-red-200' : 'text-white'}`}>
              {confirmSignOut ? "Press OK again to sign out — you'll need a new code to sign back in" : 'Sign out of Plex'}
            </div>
          </div>
        );
      })()}
    </div>
  );
});
ManagePanel.displayName = 'ManagePanel';

// ─── POST-LINK CONFIRMATION CARD ───────────────────────────────────────────
interface JustLinkedCardProps {
  conn: { base: string; token: string; name: string; owned?: boolean } | null;
  accountToken?: string | null;
  onContinue: () => void;
  onSignOut: () => void;
}
const JustLinkedCard = memo(({ conn, accountToken, onContinue, onSignOut }: JustLinkedCardProps) => {
  const [account, setAccount] = useState<{ username?: string; email?: string } | null>(null);
  const [focusIdx, setFocusIdx] = useState(0); // 0=Continue, 1=Sign out
  const focusRef = useRef(focusIdx); useEffect(() => { focusRef.current = focusIdx; }, [focusIdx]);
  const onContinueRef = useRef(onContinue); useEffect(() => { onContinueRef.current = onContinue; }, [onContinue]);
  const onSignOutRef = useRef(onSignOut); useEffect(() => { onSignOutRef.current = onSignOut; }, [onSignOut]);

  useEffect(() => {
    const token = accountToken ?? conn?.token;
    if (!token) return;
    let cancelled = false;
    void getPlexAccount(token).then((a) => { if (!cancelled) setAccount(a); });
    return () => { cancelled = true; };
  }, [accountToken, conn?.token]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isPlexKeyOwner('browse')) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      if (isBack) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        onContinueRef.current();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        setFocusIdx((i) => (i === 0 ? 1 : 0));
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (e.repeat) return; // a held OK must not act twice
        if (focusRef.current === 0) onContinueRef.current();
        else onSignOutRef.current();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  const accountLine = account?.username || account?.email;
  const showOwnedWarning = conn?.owned === true && !isProviderServer(conn?.name);
  const showProviderReassure = conn?.owned === true && isProviderServer(conn?.name);

  return (
    <div className="min-h-screen flex items-center justify-center p-8 text-white">
      <div className="w-full max-w-lg rounded-3xl bg-slate-900/90 border border-white/10 p-8 text-center shadow-2xl">
        <h2 className="text-2xl font-quicksand font-bold mb-2">Connected to {conn?.name || 'Plex'}</h2>
        {accountLine && <p className="text-brand-ice/70 font-nunito text-sm mb-4">as {accountLine}</p>}
        {showOwnedWarning && (
          <div className="mb-6 rounded-xl bg-red-500/15 border border-red-500/40 px-4 py-3 text-left">
            <p className="text-red-200 font-quicksand font-semibold text-sm mb-1">Heads up</p>
            <p className="text-red-100/90 font-nunito text-sm">
              This looks like <span className="font-bold">YOUR OWN</span> Plex server. If you meant to use your provider's service, sign out and send them the code instead.
            </p>
          </div>
        )}
        {showProviderReassure && (
          <p className="text-brand-ice/70 font-nunito text-sm mb-4">You're all set — this is your provider's server.</p>
        )}
        <div className="mt-4 flex items-center justify-center gap-3">
          <button type="button"
            data-focused={focusIdx === 0 ? 'true' : 'false'}
            onClick={onContinue}
            className={`tv-ring tv-ring-contrast px-6 py-3 rounded-xl font-quicksand font-bold ${focusIdx === 0 ? 'bg-brand-gold text-black scale-105 z-10' : 'bg-white/10 text-white'}`}>
            Continue
          </button>
          <button type="button"
            data-focused={focusIdx === 1 ? 'true' : 'false'}
            onClick={onSignOut}
            className={`tv-ring tv-ring-contrast px-6 py-3 rounded-xl font-quicksand font-semibold ${focusIdx === 1 ? 'bg-brand-gold text-black scale-105 z-10' : 'bg-white/10 text-white'}`}>
            Sign out
          </button>
        </div>
        <p className="text-center text-xs text-brand-ice/60 font-nunito mt-4">◀ ▶ select · OK activate · Back continues</p>
      </div>
    </div>
  );
});
JustLinkedCard.displayName = 'JustLinkedCard';

// ─── MAIN ──────────────────────────────────────────────────────────────────
const PlexSection = memo(({ isActive, onExitLeft, onExitUp, onOpenBufferingGuide, onOpenSupport, onNeedLiveTV, onFullscreenChange }: Props) => {
  const {
    status, conn, pinCode, error, justLinked, accountToken, providerNote, providerAvailable,
    clearJustLinked, startLink, cancelLink, signOut, retryConnect, linkWithProvider, reportAuthFailure,
  } = usePlexAuth();

  const deeplinkRef = useRef<{ ratingKey: string; title?: string; librarySectionID?: string | number | null; kind?: string; machineIdentifier?: string | null } | null>(
    (() => {
      try {
        const raw = sessionStorage.getItem('smc-plex-deeplink');
        if (!raw) return null;
        sessionStorage.removeItem('smc-plex-deeplink');
        return JSON.parse(raw);
      } catch { return null; }
    })(),
  );

  // A voice command's "watch The Office" / "search for Batman" (see
  // appActions.openPlexTitle and plexVoice.ts): taken from sessionStorage when
  // Plex opens for it, or from the event when Plex is already open.
  // Looked at in a state initializer and cleared once mounted. It used to be
  // read and cleared during render, and a first render React throws away
  // (Plex arrives lazily, and an interrupted render starts over) took it with
  // it: the render that stayed found nothing, and Plex opened on Home.
  const [voiceAtMount] = useState(() => peekPlexVoice());
  const voiceRef = useRef<PlexVoiceIntent | null>(voiceAtMount?.intent ?? null);
  useEffect(() => {
    // Only the copy read above: a newer one belongs to the event below.
    try { if (voiceAtMount && sessionStorage.getItem(PLEX_VOICE_KEY) === voiceAtMount.raw) sessionStorage.removeItem(PLEX_VOICE_KEY); } catch { /* ignore */ }
  }, [voiceAtMount]);
  const [voiceTick, setVoiceTick] = useState(0);
  // Search opened by a command: the words to type, and a count, so the same
  // words said again open a fresh search box.
  const [voiceSearch, setVoiceSearch] = useState<{ q: string; n: number } | null>(null);
  // The title a command asked for is being looked up: said in place of Home,
  // which is not loaded behind it (see the voice effect).
  const [voiceWait, setVoiceWait] = useState<string | null>(() => (voiceAtMount?.intent.open ? plexVoiceQuery(voiceAtMount.intent.query) : null));
  useEffect(() => {
    const on = (e: Event) => {
      try { sessionStorage.removeItem(PLEX_VOICE_KEY); } catch { /* ignore */ }
      const d = (e as CustomEvent<PlexVoiceIntent>).detail;
      if (d?.query) { voiceRef.current = { query: d.query, open: !!d.open, at: d.at }; setVoiceTick((t) => t + 1); }
    };
    window.addEventListener(PLEX_VOICE_EVENT, on);
    return () => window.removeEventListener(PLEX_VOICE_EVENT, on);
  }, []);

  const [libraries, setLibraries] = useState<PlexLibrary[]>([]);
  // Error from the last library fetch, or null. Rendered in Settings so a
  // failure is readable on the TV instead of looking identical to a server
  // that genuinely has no libraries.
  const [librariesError, setLibrariesError] = useState<string | null>(null);
  const [libRetry, setLibRetry] = useState(0);
  const libRetryRef = useRef(0);
  const [hidden, setHidden] = useState<string[]>([]);
  const [libIdx, setLibIdx] = useState(0);
  const [items, setItems] = useState<PlexItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [zone, setZone] = useState<'tabs' | 'grid'>('tabs');
  // The side menu's focused entry, by tab key; `libIdx` is the selected tab.
  const [menuKey, setMenuKey] = useState<string | null>(null);
  // What a library tab shows: the new row view, or the old A-Z grid reached
  // through "Browse all". Keyed by libKey so switching libraries cannot carry
  // one library's mode into another — the panels all render in the SAME slot
  // of the ternary below, so React reconciles by position and nothing resets
  // on its own.
  const [libraryMode, setLibraryMode] = useState<Record<string, 'rows' | 'grid'>>({});
  const currentMode = (k?: string) => (k ? libraryMode[k] ?? 'rows' : 'rows');
  const libraryModeRef = useRef(libraryMode);
  useEffect(() => { libraryModeRef.current = libraryMode; }, [libraryMode]);
  const [cursor, setCursor] = useState(0);

  const [fullscreen, setFullscreen] = useState(false);
  const [volume, setVolume] = useState<number>(() => loadPlayerVolume());
  const changeVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolume(clamped);
    savePlayerVolume(clamped);
    // useNativePlayer applies `volume` to the native player whenever it is
    // active; calling SnowPlayer.setVolume here as well sent it twice.
  }, []);
  const [detailItem, setDetailItem] = useState<PlexItem | null>(null);
  // Opened straight onto a title (the home content bar, or Support handing
  // the viewer back). Home is not loaded behind that page: its hubs and
  // stitched rails competed with the title's own metadata and the Play
  // request, on the path meant to be quickest. Home loads on Back instead.
  const [deepLinked, setDeepLinked] = useState(false);
  const [playing, setPlaying] = useState<PlexItem | null>(null);
  const playingKeyRef = useRef<string | null>(null);
  playingKeyRef.current = playing?.ratingKey ?? null;
  const [playingTitle, setPlayingTitle] = useState('');
  const [playingResLabel, setPlayingResLabel] = useState('');

  // How long people actually watch in Movies & Series, per title. The play
  // counts alone never showed whether anyone stayed past the first minute.
  // Timed while the player is up only: `playing` stays set after the player
  // closes, so the timer used to run on through browsing until the next play.
  useEffect(() => {
    if (DEMO || !playing || !fullscreen) return;
    try {
      startTimer('watch', 'plex_watch', 'player', {
        title: playingTitle || playing.title,
        type: playing.type ?? 'movie',
      });
    } catch { /* ignore */ }
    return () => { try { stopTimer('watch'); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, playingTitle, fullscreen]);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [useTranscode, setUseTranscode] = useState(false);
  // Read by the slow-load timer, which is armed outside React's render.
  const useTranscodeRef = useRef(false);
  useTranscodeRef.current = useTranscode;
  // The playing file's average bitrate (kbps), for the buffering card.
  const [fileKbps, setFileKbps] = useState<number | undefined>(undefined);
  const [startPos, setStartPos] = useState<number | undefined>(undefined);
  const [tracksTick, setTracksTick] = useState(0);
  const [subCtx, setSubCtx] = useState<SubtitleSearchContext | undefined>(undefined);
  const [extraSubs, setExtraSubs] = useState<SnowSubtitle[] | undefined>(undefined);
  const [qualityKey, setQualityKey] = useState<string>('original');
  useEffect(() => { void loadPlexQuality().then(setQualityKey); }, []);
  // Is this box on the viewer's own Plex account (not the shared provider
  // account)? Then its progress is also reported to Plex and the server's
  // Continue Watching / resume points are theirs too. Unknown = shared.
  const [ownPlexAccount, setOwnPlexAccount] = useState(false);
  useEffect(() => {
    const tok = accountToken ?? conn?.token;
    if (!tok || DEMO) { setOwnPlexAccount(false); return; }
    let gone = false;
    void getPlexAccount(tok)
      .then((a) => isOwnPlexAccount(a))
      .then((own) => { if (!gone) setOwnPlexAccount(own); })
      .catch(() => { /* stays shared */ });
    return () => { gone = true; };
  }, [accountToken, conn?.token]);

  // This viewer's resume points and Continue Watching: from the box at once,
  // then brought up to date from their account (another box they use).
  useEffect(() => {
    if (DEMO) return;
    void initPlexProgress().then(() => Promise.all([pullProgressFromCloud(), pullFavoritesFromCloud()]));
  }, []);

  // Image focus mode: while a detail page is open, the browse grid, rails and
  // search results park their loads so the detail page's own images own the
  // image bandwidth — its poster/backdrop load with priority, and its cast,
  // seasons, episodes and filmography load focus-exempt but viewport-gated.
  useEffect(() => {
    setPlexImageFocus(!!detailItem);
    return () => { setPlexImageFocus(false); };
  }, [detailItem]);

  // Post-connect warm-up: preload the first screen (Home rails + first ~12
  // poster URLs + library list) before revealing the tabs+grid UI. Runs ONCE
  // per connect. Deep-links skip warm-up (they route straight to detail).
  const [warmedUp, setWarmedUp] = useState(false);
  const warmedRef = useRef(false);
  // The library effect below publishes its in-flight request here so the
  // settle screen can wait on the same one instead of asking twice.
  const libsPromiseRef = useRef<Promise<PlexLibrary[]> | null>(null);
  useEffect(() => {
    if (status !== 'ready' || !conn) return;
    // Fail-safe, NOT just an early return: if warm-up already ran we must still
    // OPEN the gate. This effect keys on the `conn` object, so any reconnect —
    // even one that resolves to the identical base — runs this cleanup
    // (cancelled = true) on the in-flight warm-up and then re-enters here. A
    // bare `return` left `warmedUp` false forever and parked Plex on
    // "Loading your library…" with no libraries and no way out. The separate
    // library effect below re-fetches on its own, so revealing early is safe.
    if (warmedRef.current) { setWarmedUp(true); return; }
    warmedRef.current = true;
    if (deeplinkRef.current || voiceRef.current) { setWarmedUp(true); return; }
    let cancelled = false;
    const gone = () => cancelled;
    const base = conn.base;
    const token = conn.token;
    const onDeckPath = '/library/onDeck?X-Plex-Container-Start=0&X-Plex-Container-Size=30';
    const recentPath = homeKey(HOME_ADDED_KEY);
    // The settle screen. Everything Home is about to show is loaded HERE,
    // behind the loader, so that once Home appears nothing else lands: no
    // rail arriving mid-scroll and re-laying the list, no dozen requests and
    // poster decodes competing with the remote for the first ten seconds.
    // A few seconds of "Getting Plex ready…" reads as loading; the same
    // seconds spent stuttering under the thumb read as a broken app.
    //
    // Every step is capped, and the whole thing is capped (SETTLE_MAX_MS),
    // so a slow relay hop shows Home with whatever has landed rather than a
    // loader forever; the panels fetch what is still missing.
    const SETTLE_MAX_MS = 9000;
    const settle = (async () => {
      // 1. The two server-wide hubs.
      // A failure resolves to null, NOT []. An empty array is a legitimate
      // answer ("this hub is empty") and gets cached for 5 minutes; caching a
      // Wi-Fi blip that way left Home showing a bare heading over an empty
      // rail, surviving even a full remount, until the TTL expired.
      const [od, ra] = await Promise.all([
        (getCachedHub(base, onDeckPath) ? Promise.resolve(getCachedHub(base, onDeckPath) as PlexItem[]) : getPlexHub(base, token, onDeckPath).catch(() => null)),
        (getCachedHub(base, recentPath) ? Promise.resolve(getCachedHub(base, recentPath) as PlexItem[]) : getHomeAdded(base, token).catch(() => null)),
      ]);
      if (cancelled) return;
      if (od) setCachedHub(base, onDeckPath, od);
      if (ra) setCachedHub(base, recentPath, ra);
      // 2. The libraries, from the library effect's own request (it ran in
      //    this same commit, after this effect; the microtask lets it start).
      await Promise.resolve();
      let libs: PlexLibrary[] = [];
      try { libs = (await libsPromiseRef.current) ?? []; } catch { /* the library effect retries; Home can do without the stitched rails */ }
      if (cancelled) return;
      // 3. The stitched rails, from the same libraries Home will use: not
      //    hidden, not adult — so the cache Home reads matches what it shows.
      let hiddenKeys: string[] = [];
      try { hiddenKeys = await loadHiddenPlexLibs(); } catch { /* none */ }
      const forHome = libs.filter((l) => hiddenKeys.indexOf(l.key) < 0 && !isAdultLabel(l.title));
      const rel = forHome.length ? await loadReleased(base, token, forHome, gone) : null;
      if (cancelled) return;
      // Not on a low-memory box: Home loads it once it is up (LOW_MEMORY).
      const pop = forHome.length && !LOW_MEMORY ? await loadPopular(base, token, forHome, gone) : null;
      if (cancelled) return;
      // 4. The posters on the first screen: the opening tiles of each rail,
      //    at the size the tiles draw them, so Home paints from the browser
      //    cache. Small transcodes (~10 KB each), not the full posters the
      //    old preload pulled. https only; http URLs go through the data-URI
      //    path and would only stall here.
      const posters: string[] = [];
      if (/^https:\/\//i.test(base)) {
        for (const list of [od, ra, rel, pop]) {
          for (const it of (list || []).slice(0, 12)) {
            if (it.thumb) posters.push(plexPhotoTranscodeUrl(base, it.thumb, token, POSTER_TILE_W, POSTER_TILE_H));
          }
        }
      }
      await preloadImages(posters, 3000);
    })();
    const settled = settle.catch(() => undefined);
    const cap = new Promise<void>((resolve) => {
      const t = window.setTimeout(resolve, SETTLE_MAX_MS);
      void settled.then(() => window.clearTimeout(t));
    });
    void Promise.race([settled, cap]).then(() => { if (!cancelled) setWarmedUp(true); });
    return () => { cancelled = true; };
  }, [status, conn]);


  useEffect(() => { void loadHiddenPlexLibs().then(setHidden); }, []);

  // plex_open — once per mount when the section becomes active.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!isActive || openedRef.current) return;
    openedRef.current = true;
    try { trackEvent('plex_open', 'player'); } catch { /* ignore */ }
  }, [isActive]);


  // Switching to a DIFFERENT Plex server invalidates the section keys we are
  // holding. Drop them so the tab strip cannot show the previous server's
  // libraries while the new list loads. Keyed on clientIdentifier, not base, so
  // a relay escape (same server, new address) leaves the strip alone.
  const libServerRef = useRef<string | null>(null);
  useEffect(() => {
    const id = conn?.clientIdentifier ?? null;
    if (id && libServerRef.current && libServerRef.current !== id) {
      setLibraries([]); setLibrariesError(null); libRetryRef.current = 0;
    }
    if (id) libServerRef.current = id;
  }, [conn]);

  // Load libraries when connected. `libRetry` re-arms this on failure — see
  // the catch below.
  useEffect(() => {
    if (status !== 'ready' || !conn) return;
    let cancelled = false;
    let timer: number | null = null;
    const inflight = getPlexLibraries(conn.base, conn.token, { fresh: true });
    libsPromiseRef.current = inflight;
    inflight
      .then((libs) => {
        if (cancelled) return;
        // Keep the same array when nothing changed. A connection upgrade (same
        // server, new address) refetches the list, and a new array rebuilt
        // the adult-library set, the tabs and the current tab — which re-ran
        // the open search and reset every panel keyed on them.
        setLibraries((prev) => (librarySig(prev) === librarySig(libs) ? prev : libs));
        setLibrariesError(null); libRetryRef.current = 0;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // RETRY. Without this a single throw was terminal: nothing in this
        // effect's deps ever changes again, so the tab strip stayed at
        // Home · Search · Request · Settings for the rest of the session on a
        // server that came back online seconds later.
        const n = libRetryRef.current;
        if (n < 4) {
          libRetryRef.current = n + 1;
          timer = window.setTimeout(() => setLibRetry((v) => v + 1), 3000 * 2 ** n);
        }
        // Keep whatever is already on screen — a transient hiccup on a
        // reconnect must not empty the tab strip — and record WHY, so the
        // empty state can say what happened instead of looking identical to a
        // server that genuinely has no libraries. Deliberately NO auto-repair
        // here: a throw is usually a Wi-Fi blip, and discarding the saved
        // server over one would strand a box whose PMS is on the LAN while
        // the internet is down.
        const msg = (e as Error)?.message || 'Could not reach the server';
        setLibrariesError(msg);
        // 401 is not a blip: the token is dead. The hook decides whether it
        // is the provider's (replaceable from the Live TV line) or a member's
        // own (left alone) — a no-op for everything but the provider case.
        if (/HTTP 401\b/.test(msg)) reportAuthFailure();
      });
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [status, conn, libRetry, reportAuthFailure]);

  const visibleLibraries = useMemo(
    () => libraries.filter((l) => hidden.indexOf(l.key) < 0),
    [libraries, hidden],
  );
  // An adult library keeps its tab; it never feeds the mixed rails. The keys
  // also catch its titles when they arrive through a server-wide hub.
  const adultKeys = useMemo(
    () => new Set(libraries.filter((l) => isAdultLabel(l.title)).map((l) => String(l.key))),
    [libraries],
  );
  const familyLibraries = useMemo(
    () => visibleLibraries.filter((l) => !adultKeys.has(String(l.key))),
    [visibleLibraries, adultKeys],
  );

  // Decided once per Plex visit: the menu does not reshuffle at midnight.
  const [season] = useState<Season | null>(() => activeSeason());
  const tabs = useMemo<Tab[]>(() => {
    const t: Tab[] = [
      { key: '__home', title: 'Home', type: 'home' },
      { key: '__discover', title: 'Discover', type: 'discover' },
      { key: '__search', title: 'Search', type: 'search' },
    ];
    // In season (e.g. Halloween): its own entry at the top of the libraries.
    if (season) t.push({ key: `__season_${season.id}`, title: season.title, type: 'seasonal' });
    for (const l of visibleLibraries) {
      t.push({ key: l.key, title: l.title, type: (l.type === 'show' ? 'show' : 'movie'), libKey: l.key });
    }
    // A Kids profile does not request titles or change Plex's settings.
    if (!kidsLevel()) {
      t.push({ key: '__request', title: 'Request', type: 'request' });
      t.push({ key: '__manage', title: 'Settings', type: 'manage' });
    }
    return t;
  }, [visibleLibraries, season]);

  const currentTab = tabs[libIdx];
  const homeIdx = 0;

  // The side menu, top to bottom: Home, Discover and Search, the libraries,
  // then Request and Settings — grouped, not in tab order.
  const menuEntries = useMemo<MenuEntry[]>(() => {
    const out: MenuEntry[] = [];
    const order: MenuGroup[] = ['home', 'libraries', 'more'];
    for (const g of order) {
      tabs.forEach((t, i) => {
        const group: MenuGroup = (t.type === 'home' || t.type === 'discover' || t.type === 'search') ? 'home' : (t.type === 'movie' || t.type === 'show' || t.type === 'seasonal') ? 'libraries' : 'more';
        if (group === g) out.push({ tabIdx: i, title: t.title, group, key: t.key });
      });
    }
    return out;
  }, [tabs]);
  const menuEntriesRef = useRef(menuEntries); useEffect(() => { menuEntriesRef.current = menuEntries; }, [menuEntries]);
  const menuIdx = useMemo(() => {
    const i = menuEntries.findIndex((m) => m.key === menuKey);
    if (i >= 0) return i;
    return Math.max(0, menuEntries.findIndex((m) => m.tabIdx === libIdx));
  }, [menuEntries, menuKey, libIdx]);

  // Hold OK on a library in the menu to hide it (Settings brings it back).
  // Short press enters it. Timer on keydown, decided on keyup — the same
  // pattern the channel list uses for its long-press.
  const menuHoldTimerRef = useRef<number | null>(null);
  const menuHoldFiredRef = useRef(false);

  // Leaving the content puts the menu's focus on the selected tab's entry.
  const exitToMenu = useCallback(() => {
    const t = menuEntriesRef.current.find((m) => m.tabIdx === libIdxRef.current);
    if (t) setMenuKey(t.key);
    setZone('tabs');
  }, []);

  // The side-menu highlight moves on every press, but the panel on the right
  // only changes once the cursor has rested for a moment. Switching on every
  // press mounted Home's rails, Discover's rows and Settings' account lookup
  // just to scroll past them on the way to a library. Entering (Right, OK, a
  // click) commits the pending tab first, so what opens is always the entry
  // under the highlight.
  const pendingTabRef = useRef<number | null>(null);
  const tabTimerRef = useRef<number | null>(null);
  const cancelPendingTab = useCallback(() => {
    if (tabTimerRef.current != null) { window.clearTimeout(tabTimerRef.current); tabTimerRef.current = null; }
    pendingTabRef.current = null;
  }, []);
  const commitPendingTab = useCallback(() => {
    const p = pendingTabRef.current;
    cancelPendingTab();
    if (p != null && p !== libIdxRef.current) setLibIdx(p);
  }, [cancelPendingTab]);
  const queueTab = useCallback((tabIdx: number) => {
    if (tabIdx === libIdxRef.current && pendingTabRef.current == null) return;
    if (tabTimerRef.current != null) window.clearTimeout(tabTimerRef.current);
    pendingTabRef.current = tabIdx;
    tabTimerRef.current = window.setTimeout(() => { tabTimerRef.current = null; commitPendingTab(); }, MENU_SETTLE_MS);
  }, [commitPendingTab]);
  useEffect(() => () => { if (tabTimerRef.current != null) window.clearTimeout(tabTimerRef.current); }, []);
  // Tab to stay on across a tabs-list change (see the pin effect below).
  const wantTabKeyRef = useRef<string | null>(null);

  useEffect(() => { if (libIdx >= tabs.length) setLibIdx(tabs.length - 1); }, [tabs.length, libIdx]);

  // Un-hiding a library from Settings INSERTS a tab before Request/Settings, so
  // the same libIdx now points at a different tab and the user is silently
  // dropped onto Request mid-keypress. (Hiding shrinks the strip and the clamp
  // above happens to cover it — growth had no equivalent.) Pin by key across
  // the change instead of trusting the index.
  useEffect(() => {
    const k = wantTabKeyRef.current;
    if (!k) return;
    wantTabKeyRef.current = null;
    const i = tabs.findIndex((t) => t.key === k);
    if (i >= 0 && i !== libIdx) setLibIdx(i);
  }, [tabs, libIdx]);

  // ── Deep-link: ONE effect that opens the detail overlay directly. Works
  //    even when the target library is hidden/reordered or hasn't loaded.
  useEffect(() => {
    let cancelled = false;
    const dl = deeplinkRef.current;
    if (!dl || status !== 'ready' || !conn) return;
    deeplinkRef.current = null;

    const kind = dl.kind;
    const type = kind === 'episode' || kind === 'show' ? kind : 'movie';

    // Deep links bypass the normal openDetail callback — claim the D-pad and
    // pause background paging here too, synchronously with the state update.
    const openDetail = (payload: PlexItem) => {
      setPlexKeyOwner('detail');
      pauseLoading();
      setDetailItem(payload);
    };

    if (dl.machineIdentifier && conn.clientIdentifier && dl.machineIdentifier !== conn.clientIdentifier) {
      const title = dl.title || '';
      if (!title) { toast({ title: 'This title lives on a different Plex server' }); return; }
      searchPlex(conn.base, conn.token, title)
        .then((results) => {
          // An orphaned continuation must never touch the key-owner token, the
          // load gate, or state — the unmount cleanup already ran resumeLoading
          // (a no-op), so a late pauseLoading() here would silently park every
          // library pager on the next visit.
          if (cancelled) return;
          const norm = (s: string) => s.trim().toLowerCase();
          const match = results.find((r) => norm(r.title) === norm(title)) || results[0];
          if (match) { setDeepLinked(true); openDetail(match); }
          else toast({ title: 'This title lives on a different Plex server' });
        })
        .catch(() => { if (cancelled) return; toast({ title: 'This title lives on a different Plex server' }); });
      return () => { cancelled = true; };
    }

    setDeepLinked(true);
    openDetail({ ratingKey: String(dl.ratingKey), title: dl.title ?? '', type });
    return () => { cancelled = true; };
  }, [status, conn, toast]);

  // ── Library items loader — paged, cached, sequence-guarded, and only
  //    fires when the user enters the grid or dwells 400ms on the tab.
  const seqRef = useRef(0);
  useEffect(() => {
    if (!conn || !currentTab || (currentTab.type !== 'movie' && currentTab.type !== 'show') || !currentTab.libKey) {
      // The same empty array every time, so a menu step to a non-library tab
      // does not re-render all of Plex for a state that did not change.
      setItems((prev) => (prev.length ? NO_ITEMS : prev)); setItemsLoading(false); setCursor(0);
      return;
    }
    const libKey = currentTab.libKey;
    // Rows mode (the only mode a library opens in) draws PlexLibraryRows,
    // which asks the server for each row itself. This loader feeds the A-Z
    // grid alone; left ungated it paged the WHOLE library into memory, 200
    // titles at a time, on every library visit — fifteen requests and fifteen
    // re-renders of this component for a 3,000-title library nobody saw.
    if ((libraryModeRef.current[libKey] ?? 'rows') !== 'grid') {
      setItems((prev) => (prev.length ? NO_ITEMS : prev)); setItemsLoading(false); setCursor(0);
      return;
    }
    const mySeq = ++seqRef.current;
    let cancelled = false;
    let dwellTimer: number | null = null;

    // Instant paint from cache (fresh OR stale — a background refresh follows
    // if stale). Skips the "flash of empty grid" on tab return.
    const cached = getCachedLibrary(conn.base, libKey);
    if (cached) {
      setItems(cached.items);
      setCursor(0);
      if (isLibraryCacheFresh(cached) && cached.complete) {
        setItemsLoading(false);
        return () => { cancelled = true; };
      }
    } else {
      setItems([]);
      setCursor(0);
    }

    const load = async () => {
      setItemsLoading(true);
      try {
        // First page — small (60) for fastest first paint.
        const first = await getPlexLibraryItems(conn.base, conn.token, libKey, 0, PAGE_FIRST);
        if (cancelled || mySeq !== seqRef.current) return;
        setItems(first.items);
        setCachedLibrary(conn.base, libKey, first.items, first.totalSize, first.items.length >= first.totalSize);
        setItemsLoading(false);

        // Background pages of 200. Sequential (never in parallel) so we don't
        // blow up the heap with concurrent JSON payloads.
        let loaded = first.items.length;
        const total = first.totalSize;
        let acc = first.items;
        while (!cancelled && mySeq === seqRef.current && loaded < total) {
          await waitForResume(); // parked while a detail page owns the screen
          if (cancelled || mySeq !== seqRef.current) return;
          const page = await getPlexLibraryItems(conn.base, conn.token, libKey, loaded, PAGE_MORE);
          if (cancelled || mySeq !== seqRef.current) return;
          if (page.items.length === 0) break;
          acc = acc.concat(page.items);
          loaded += page.items.length;
          setItems(acc);
          setCachedLibrary(conn.base, libKey, acc, page.totalSize || total, loaded >= (page.totalSize || total));
        }
      } catch {
        if (!cancelled && mySeq === seqRef.current) setItemsLoading(false);
      }
    };

    // Zone === 'grid' → load immediately; otherwise wait 400ms of tab dwell.
    if (zoneRef.current === 'grid') {
      void load();
    } else {
      dwellTimer = window.setTimeout(() => { void load(); }, 400);
    }
    return () => {
      cancelled = true;
      if (dwellTimer != null) window.clearTimeout(dwellTimer);
    };
    // NOTE: intentionally NOT depending on `zone` — that would re-fire on
    // grid entry, cancelling the debounce mid-flight. We check zoneRef inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, currentTab]);

  // If the user enters the grid before the 400ms dwell fires, kick the fetch
  // immediately by re-issuing the effect: bump seq and re-run the loader.
  const zoneRef = useRef(zone); useEffect(() => { zoneRef.current = zone; }, [zone]);
  useEffect(() => {
    if (zone !== 'grid') return;
    // Rows mode never needs the whole section paged into memory — that preload
    // is what made opening a large library slow, and it exists only to feed
    // the A-Z grid. Read through the ref so this does not become a dependency
    // of an effect that must only re-run on zone changes.
    {
      // Read the tab through the same refs the keydown handler uses, so this
      // effect keeps its [zone]-only dependency list.
      const lk = tabsRef.current[libIdxRef.current]?.libKey;
      if (lk && (libraryModeRef.current[lk] ?? 'rows') !== 'grid') return;
    }
    if (!conn || !currentTab || (currentTab.type !== 'movie' && currentTab.type !== 'show') || !currentTab.libKey) return;
    const cached = getCachedLibrary(conn.base, currentTab.libKey);
    if (cached && isLibraryCacheFresh(cached) && cached.complete) return;
    if (items.length > 0 && itemsLoading) return;
    // Only trigger if we haven't started yet — bumping seqRef reruns via key change is unavailable, so we call a lightweight starter.
    // Actual kickoff happens naturally the next render when zoneRef.current !== 'grid' path already elapsed; if items are still empty, force by mutating currentTab dep indirectly is complex. Instead, do a direct micro-fetch:
    let cancelled = false;
    const mySeq = ++seqRef.current;
    (async () => {
      setItemsLoading(true);
      try {
        const first = await getPlexLibraryItems(conn.base, conn.token, currentTab.libKey!, 0, PAGE_FIRST);
        if (cancelled || mySeq !== seqRef.current) return;
        setItems(first.items);
        setCachedLibrary(conn.base, currentTab.libKey!, first.items, first.totalSize, first.items.length >= first.totalSize);
        setItemsLoading(false);
        let loaded = first.items.length;
        const total = first.totalSize;
        let acc = first.items;
        while (!cancelled && mySeq === seqRef.current && loaded < total) {
          await waitForResume(); // parked while a detail page owns the screen
          if (cancelled || mySeq !== seqRef.current) return;
          const page = await getPlexLibraryItems(conn.base, conn.token, currentTab.libKey!, loaded, PAGE_MORE);
          if (cancelled || mySeq !== seqRef.current) return;
          if (page.items.length === 0) break;
          acc = acc.concat(page.items);
          loaded += page.items.length;
          setItems(acc);
          setCachedLibrary(conn.base, currentTab.libKey!, acc, page.totalSize || total, loaded >= (page.totalSize || total));
        }
      } catch {
        if (!cancelled && mySeq === seqRef.current) setItemsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone]);

  // ── Row-height measurement (ResizeObserver on the scroll container) so
  //    posters can't overlap the row below them.
  //
  // ATTACHED VIA A CALLBACK REF, NOT AN EFFECT. The scroll container does not
  // exist on the first commit — the warm-up gate near the bottom of this file
  // returns the loader instead — so a `useEffect(..., [])` ran once against a
  // null ref, bailed, and never ran again. rowH stayed at the 250px estimate
  // for the life of the session while the real rows were 400-500px tall, and
  // every row was drawn on top of the one above it. A callback ref fires the
  // moment the node actually mounts, whenever that is.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [rowH, setRowH] = useState<number>(ROW_H_ESTIMATE);
  const rowHRef = useRef(rowH); useEffect(() => { rowHRef.current = rowH; }, [rowH]);
  const rowObserverRef = useRef<ResizeObserver | null>(null);

  // Only the A-Z grid uses rowH. The observer below sits on the shared
  // scroll container, so without this gate the menu's 200 ms width
  // transition re-measured and re-rendered this whole component once per
  // frame on every trip between the menu and Home, for a number Home never
  // reads.
  // True only when a library is actually showing the A-Z grid. Library tabs
  // open in rows mode (PlexLibraryRows), which never reads rowH; gating on
  // "is a library tab" still re-measured and re-rendered this component on
  // every frame of the menu's width animation.
  const isGridTab = (currentTab?.type === 'movie' || currentTab?.type === 'show')
    && !!currentTab?.libKey && (libraryMode[currentTab.libKey] ?? 'rows') === 'grid';
  const isGridTabRef = useRef(isGridTab); isGridTabRef.current = isGridTab;
  const measureRowH = useCallback((el: HTMLElement) => {
    if (!isGridTabRef.current) return;
    const cs = getComputedStyle(el);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const gap = 12; // gap-3, between columns
    const inner = Math.max(0, el.clientWidth - padL - padR);
    if (inner <= 0) return;   // not laid out yet; the observer will fire again
    const colW = (inner - gap * (COLS - 1)) / COLS;
    const posterH = colW * 1.5; // aspect-[2/3]
    const titleArea = 30;       // text-sm (20px line) + py-1 (8) + card border (2)
    const rowGap = 12;
    const next = Math.max(200, Math.ceil(posterH + titleArea + rowGap));
    setRowH((prev) => (prev !== next ? next : prev));
  }, []);

  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    rowObserverRef.current?.disconnect();
    rowObserverRef.current = null;
    if (!el) return;
    measureRowH(el);
    const ro = new ResizeObserver(() => measureRowH(el));
    ro.observe(el);
    rowObserverRef.current = ro;
  }, [measureRowH]);

  useEffect(() => () => { rowObserverRef.current?.disconnect(); }, []);
  // Arriving on a library tab: measure once now, since nothing resized.
  useEffect(() => { if (isGridTab && scrollRef.current) measureRowH(scrollRef.current); }, [isGridTab, measureRowH]);

  const rows = Math.ceil(items.length / COLS);
  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHRef.current,
    overscan: isFireTV() ? 1 : 3,
    // The scroll element wraps every panel. Enabled everywhere, the
    // virtualizer listened to Home's and Discover's scrolling too and
    // re-rendered all of Plex (synchronously, inside the scroll event) on
    // every vertical move, for a grid that was not on screen.
    enabled: isGridTab,
    useFlushSync: false,
  });
  useEffect(() => { rowVirtualizer.measure(); /* eslint-disable-next-line */ }, [rowH]);

  useEffect(() => {
    if (zone !== 'grid') return;
    // Rows mode never needs the whole section paged into memory — that preload
    // is what made opening a large library slow, and it exists only to feed
    // the A-Z grid. Read through the ref so this does not become a dependency
    // of an effect that must only re-run on zone changes.
    {
      // Read the tab through the same refs the keydown handler uses, so this
      // effect keeps its [zone]-only dependency list.
      const lk = tabsRef.current[libIdxRef.current]?.libKey;
      if (lk && (libraryModeRef.current[lk] ?? 'rows') !== 'grid') return;
    }
    const row = Math.floor(cursor / COLS);
    rowVirtualizer.scrollToIndex(row, { align: 'auto' });
  }, [cursor, zone, rowVirtualizer]);

  // ── Playback ────────────────────────────────────────────────────────
  // Hoisted so openDetail can write to it synchronously (see comment below).
  const detailRef = useRef(detailItem);
  const openDetail = useCallback((item: PlexItem) => {
    // Claim the D-pad SYNCHRONOUSLY (before the React state update): the
    // key-owner token is the only mechanism correct in the layout→passive-
    // effect gap, where a browse-side capture listener and PlexDetail's
    // pre-paint useLayoutEffect listener would otherwise both be live.
    setPlexKeyOwner('detail');
    pauseLoading();
    // Set the ref SYNCHRONOUSLY too, so the main keydown effect below can
    // short-circuit on the very next event (fast D-pad press right after OK).
    detailRef.current = item;
    setDetailItem(item);
  }, []);
  // The voice command: the title it names opens its page; with no clear
  // match (or for "search for …") Search opens with the words typed.
  //
  // Keyed on the command and the connection only. It also re-ran when the
  // library list landed (the tab count changed), which cancelled the search
  // in flight — and the command had already been cleared, so nothing ran
  // again and Plex sat on Home. The command is now cleared only once it has
  // been acted on, so a run cut short (a reconnect, a new address for the
  // same server) searches again; the tabs are read through tabsRef.
  const adultKeysRef = useRef(adultKeys); adultKeysRef.current = adultKeys;
  useEffect(() => {
    const v = voiceRef.current;
    if (!v || status !== 'ready' || !conn) return;
    let cancelled = false;
    let handled = false;
    const words = plexVoiceQuery(v.query);
    const finish = () => {
      handled = true;
      if (voiceRef.current === v) voiceRef.current = null;
      setVoiceWait(null);
    };
    // Plex's own player is up: the viewer has asked for something else.
    if (fullscreenRef.current) exitFullscreen();
    const goSearch = () => {
      if (cancelled || handled) return;
      finish();
      if (detailRef.current) closeDetail();
      setVoiceSearch((s) => ({ q: words, n: (s?.n ?? 0) + 1 }));
      const i = tabsRef.current.findIndex((t) => t.type === 'search');
      if (i >= 0) { cancelPendingTab(); setLibIdx(i); setMenuKey(tabsRef.current[i].key); }
      setZone('grid');
    };
    if (!v.open) { goSearch(); return () => { cancelled = true; }; }
    setVoiceWait(words);
    // A server this slow gets Search, which asks again, not a longer wait.
    const cap = window.setTimeout(goSearch, VOICE_WAIT_MS);
    // Titles from an adult library are ruled out by its key; the library list
    // is normally in by now, and otherwise on its way (the library effect's
    // own request), so wait a little for it rather than decide without it.
    const libs = libsPromiseRef.current;
    const libsIn = libs
      ? Promise.race([libs.catch(() => null), new Promise<null>((r) => { window.setTimeout(() => r(null), 2500); })])
      : Promise.resolve(null);
    void Promise.all([searchPlex(conn.base, conn.token, plexVoiceSearchText(v.query)), libsIn])
      .then(([results, list]) => {
        if (cancelled || handled) return;
        window.clearTimeout(cap);
        const keys = new Set(adultKeysRef.current);
        for (const l of list ?? []) if (isAdultLabel(l.title)) keys.add(String(l.key));
        const hit = pickPlexVoiceMatch(words, familyOnly(results, keys));
        if (!hit) { goSearch(); return; }
        finish();
        setDeepLinked(true);
        openDetail(hit);
      })
      .catch(goSearch);
    return () => { cancelled = true; window.clearTimeout(cap); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when Plex is ready or a new command arrives
  }, [status, conn, voiceTick]);

  const closeDetail = useCallback(() => {
    setPlexKeyOwner('browse');
    resumeLoading();
    detailRef.current = null;
    setDetailItem(null);
    setDeepLinked(false);
  }, []);
  // Safety nets so the key-owner token can never get stuck on 'detail':
  // unmount resets to browse, and layer changes driven by OTHER paths
  // (fullscreen flips, programmatic detail clears) re-derive the owner —
  // repairing the load gate alongside it so token and gate can never diverge.
  useEffect(() => () => { setPlexKeyOwner('browse'); resumeLoading(); }, []);
  useEffect(() => {
    if (fullscreen) { setPlexKeyOwner('player'); return; }
    if (detailItem) { setPlexKeyOwner('detail'); return; }
    setPlexKeyOwner('browse'); resumeLoading();
  }, [fullscreen, detailItem]);

  // Bumped each time the player closes. The browse view stays mounted under
  // the player now, so the few things that change because something was
  // watched (Continue Watching, the detail page's Resume point) refresh on
  // this instead of on a remount.
  const [watchNonce, setWatchNonce] = useState(0);
  const wasFullscreenRef = useRef(false);
  const onFullscreenChangeRef = useRef(onFullscreenChange); onFullscreenChangeRef.current = onFullscreenChange;
  useEffect(() => {
    if (wasFullscreenRef.current && !fullscreen) setWatchNonce((n) => n + 1);
    wasFullscreenRef.current = fullscreen;
    onFullscreenChangeRef.current?.(fullscreen);
  }, [fullscreen]);
  useEffect(() => () => { onFullscreenChangeRef.current?.(false); }, []);

  // Demo mode: playback is the one thing the website embed can't do, so every
  // play/quality/audio action opens a short explainer instead.
  const [demoNotice, setDemoNotice] = useState(false);

  const playRatingKey = useCallback(async (ratingKey: string, title: string, resumeSec?: number, ctx?: SubtitleSearchContext, resLabel?: string, knownPartKey?: string) => {
    if (DEMO) { setDemoNotice(true); return; }
    if (!conn) return;
    // Reset one-shot rescue guards so replaying the same title after backing
    // out regains its silent auto-revert and zero-audio safety-net.
    autoRevertRef.current = null;
    audioSafetyRef.current = null;
    // Owner directive: playback ALWAYS starts at Original / direct play. A
    // persisted quality preset must never influence how playback STARTS —
    // picking a preset DURING playback still works via changeQuality below.
    // Reset quality state so the overlay's Quality menu reflects reality.
    setQualityKey('original');
    setUseTranscode(false);
    setFileKbps(undefined);
    // What the file needs, for the buffering card. Off the start path.
    void getPlexPart(conn.base, conn.token, ratingKey)
      .then((p) => setFileKbps((cur) => (playingKeyRef.current === ratingKey ? p.bitrateKbps : cur)))
      .catch(() => { /* card just won't show it */ });
    // Flip fullscreen ON *before* any await so the loading UI paints
    // immediately — otherwise the user stares at the grid for the ~1-3s
    // getPlexPart round-trip and mashes OK, queueing up phantom presses.
    setPlaying({ ratingKey, title, type: 'movie', thumb: '' });
    setPlayingTitle(title);
    setPlayingResLabel(resLabel ?? '');
    setStartPos(resumeSec && resumeSec > 0 ? resumeSec : undefined);
    setSubCtx(ctx ?? { title });
    setExtraSubs(undefined);
    setStreamUrl(null);
    setFullscreen(true);
    try {
      // The detail page and the episode list already have the file's part key
      // from their own metadata; asking the server again only delayed the
      // start by a round trip.
      const partKey = knownPartKey ?? (await getPlexPart(conn.base, conn.token, ratingKey)).partKey;
      // Always direct-play the original. If a title's audio genuinely can't be
      // decoded, the onTracksChanged zero-audio safety net reloads it as a
      // transcode automatically — no pre-emptive transcode.
      const url = partKey ? plexDirectUrl(conn.base, partKey, conn.token) : plexTranscodeUrl(conn.base, ratingKey, conn.token);
      setStreamUrl(url);
    } catch {
      setStreamUrl(plexTranscodeUrl(conn.base, ratingKey, conn.token));
      setUseTranscode(true);
    }
  }, [conn]);


  // Which path the stream takes (LAN / direct / Plex relay, http vs https).
  // Logged with every play so the Hub can tell a throttled-relay box from a
  // slow-server one, and shown in the player's Help menu + buffering card.
  const routeLabel = conn ? plexRouteLabel(conn.route, conn.base) : '';
  // The buffering card's verdict, told what this video needs.
  const qualityCapKbps = PLEX_QUALITY_PRESETS.find((p) => p.key === qualityKey)?.maxVideoBitrateKbps;
  const stallNeedKbps = useTranscode ? (qualityCapKbps ?? fileKbps) : fileKbps;
  const explainStall = useCallback((snap: DiagSnapshot) => explainPlexStall(snap, {
    fileKbps, targetKbps: qualityCapKbps, transcoding: useTranscode, route: conn?.route,
  }), [fileKbps, qualityCapKbps, useTranscode, conn?.route]);
  const playFromDetail = useCallback((it: PlexItem, resumeSec?: number, ctx?: SubtitleSearchContext, partKey?: string) => {
    // ratingKey feeds the content bar's "Popular this week" (media-bar-feed).
    try { trackEvent('plex_play', 'player', { title: it.title, type: it.type ?? 'movie', ratingKey: it.ratingKey, route: conn?.route ?? 'unknown', secure: !!conn?.base.startsWith('https://') }); } catch { /* ignore */ }
    if (!DEMO) recordPlexWatch(it);
    void playRatingKey(it.ratingKey, it.title, resumeSec, ctx, resolutionLabel(it.videoResolution), partKey);
  }, [playRatingKey, conn]);
  const playEpisode = useCallback((ep: PlexEpisode, ctx?: SubtitleSearchContext) => {
    // The SHOW is what to come back to and what "more like this" keys off.
    const show = detailRef.current;
    try { trackEvent('plex_play', 'player', { title: ep.title, type: 'episode', ratingKey: ep.ratingKey, showKey: show?.ratingKey, route: conn?.route ?? 'unknown', secure: !!conn?.base.startsWith('https://') }); } catch { /* ignore */ }
    if (!DEMO && show) recordPlexWatch({ ...show, type: 'show', grandparentTitle: undefined }, undefined);
    // Pick up where this viewer stopped (their own progress, see plexProgress).
    void playRatingKey(ep.ratingKey, ep.title, resumeSeconds(ep.ratingKey), ctx, '', ep.partKey);
  }, [playRatingKey, conn]);

  // Skip Intro / Up Next (EpisodeAutoplay). The next episode starts in place,
  // from the start, with the same subtitle search context an episode opened
  // from its show would have.
  const [playerPrompt, setPlayerPrompt] = useState<PlayerPrompt | null>(null);
  // What is playing, once EpisodeAutoplay has read it (for PlexProgressReporter).
  const [playInfo, setPlayInfo] = useState<PlexPlayInfo | null>(null);
  const autoNextRef = useRef<(() => boolean) | null>(null);
  const registerAutoNext = useCallback((fn: (() => boolean) | null) => { autoNextRef.current = fn; }, []);
  const playNextEpisode = useCallback((ep: NextEpisode, info: PlexPlayInfo) => {
    try { trackEvent('plex_play', 'player', { title: ep.title, type: 'episode', ratingKey: ep.ratingKey, showKey: info.showKey, autoNext: true, route: conn?.route ?? 'unknown', secure: !!conn?.base.startsWith('https://') }); } catch { /* ignore */ }
    if (!DEMO && info.showKey) {
      recordPlexWatch({ ratingKey: info.showKey, title: info.showTitle || ep.title, type: 'show', thumb: info.showThumb }, undefined);
    }
    const ctx: SubtitleSearchContext = { title: ep.title, grandparentTitle: info.showTitle, season: ep.seasonIndex, episode: ep.index };
    setPlayerPrompt(null);
    void playRatingKey(ep.ratingKey, ep.title, undefined, ctx, '', ep.partKey);
  }, [playRatingKey, conn]);

  // (plex_error tracked below, once `native` is declared.)



  const handleLoadExternalSubtitle = useCallback((sub: SnowSubtitle, resumeSec: number) => {
    setExtraSubs([sub]);
    setStartPos(resumeSec);
    setStreamUrl((prev) => { if (prev) window.setTimeout(() => setStreamUrl(prev), 60); return null; });
  }, []);

  // Switch quality on the fly: rebuilds the stream URL for the currently
  // playing ratingKey, preserving any downloaded subtitle sidecars and the
  // exact resume position. Uses the SAME setStreamUrl(null) → restore trick
  // as external-subtitle loading so the native player fully re-inits.
  const changeQuality = useCallback((presetKey: string, resumeSec: number) => {
    if (DEMO) { setDemoNotice(true); return; }
    void savePlexQuality(presetKey);
    setQualityKey(presetKey);
    if (!conn || !playing) return;
    const preset = PLEX_QUALITY_PRESETS.find((p) => p.key === presetKey);
    const goingTranscode = !!(preset && preset.key !== 'original' && (preset.maxVideoBitrateKbps || preset.videoResolution));
    setUseTranscode(goingTranscode);
    setStartPos(resumeSec > 0 ? resumeSec : undefined);
    if (goingTranscode && preset) {
      const url = plexTranscodeUrl(conn.base, playing.ratingKey, conn.token, {
        maxVideoBitrateKbps: preset.maxVideoBitrateKbps,
        videoResolution: preset.videoResolution,
      });
      setStreamUrl(() => { window.setTimeout(() => setStreamUrl(url), 60); return null; });
      return;
    }
    // Original — direct play via existing getPlexPart path.
    void (async () => {
      let url = '';
      try {
        const { partKey } = await getPlexPart(conn.base, conn.token, playing.ratingKey);
        url = partKey
          ? plexDirectUrl(conn.base, partKey, conn.token)
          : plexTranscodeUrl(conn.base, playing.ratingKey, conn.token);
      } catch {
        url = plexTranscodeUrl(conn.base, playing.ratingKey, conn.token);
        setUseTranscode(true);
      }
      setStreamUrl(() => { window.setTimeout(() => setStreamUrl(url), 60); return null; });
    })();
  }, [conn, playing]);

  // Manual audio rescue: user pressed "Fix audio" in the Audio menu. Reload
  // the currently-playing item as an audio-only transcode (AAC) — video
  // stays direct-streamed. No-op if already transcoding, or nothing playing.
  const fixAudioTranscode = useCallback((resumeSec: number) => {
    if (DEMO) { setDemoNotice(true); return; }
    if (!conn || !playing || useTranscode) return;
    try { trackEvent('plex_fix_audio', 'player', { ratingKey: playing.ratingKey }); } catch { /* ignore */ }
    setUseTranscode(true);
    setStartPos(resumeSec > 0 ? resumeSec : undefined);
    const url = plexTranscodeUrl(conn.base, playing.ratingKey, conn.token);
    setStreamUrl(() => { window.setTimeout(() => setStreamUrl(url), 60); return null; });
  }, [conn, playing, useTranscode]);




  const nativeActive = NATIVE_PLAYBACK && fullscreen && !!streamUrl;
  // Safety net: DIRECT playback of an unknown-codec file where ExoPlayer
  // silently deselects the audio → zero audio tracks after load. Reload as
  // Plex transcode. Guarded per (ratingKey, direct/transcode) so it fires
  // exactly once per title.
  const audioSafetyRef = useRef<string | null>(null);
  const onTracksChanged = useCallback(() => {
    setTracksTick((n) => n + 1);
    if (!nativeActive || useTranscode || !playing || !conn) return;
    const key = playing.ratingKey;
    if (audioSafetyRef.current === key) return;
    try {
      void (async () => {
        // Readiness gate — prime() fires this callback immediately after
        // load() resolves, before ExoPlayer parses the container. Without
        // this gate getAudioTracks() returns [] and we wrongly reload into
        // transcode ("Fixing audio…") on virtually every direct play.
        try {
          const pos = await SnowPlayer.getPosition();
          if (!pos || pos.duration <= 0) return;
        } catch { return; }
        if (audioSafetyRef.current === key) return;
        const { tracks } = await SnowPlayer.getAudioTracks();
        if (tracks && tracks.length > 0 && tracks.some(t => t.selected)) return;
        if (audioSafetyRef.current === key) return;
        audioSafetyRef.current = key;
        try { toast({ title: 'Fixing audio…' }); } catch { /* ignore */ }
        let resume: number | undefined;
        try {
          const p = await SnowPlayer.getPosition();
          if (p.position > 0) resume = p.position;
        } catch { /* ignore */ }
        setStartPos(resume);
        setUseTranscode(true);
        const url = plexTranscodeUrl(conn.base, key, conn.token);
        setStreamUrl(() => { window.setTimeout(() => setStreamUrl(url), 60); return null; });
      })();
    } catch { /* ignore */ }
  }, [nativeActive, useTranscode, playing, conn, toast]);
  const slowLoadTimerRef = useRef<number | null>(null);
  const stillLoadingRef = useRef(true);
  const clearSlowLoadTimer = useCallback(() => {
    if (slowLoadTimerRef.current !== null) {
      window.clearTimeout(slowLoadTimerRef.current);
      slowLoadTimerRef.current = null;
    }
  }, []);
  const setSlowLoadRef = useRef<(v: boolean) => void>(() => { /* filled below */ });
  const onPlayStateChangeCb = useCallback((paused: boolean) => {
    // Playing is authoritative — kill the "Still preparing…" overlay AND its
    // watchdog timer the moment the native player reports it's rolling.
    if (!paused) {
      stillLoadingRef.current = false;
      clearSlowLoadTimer();
      setSlowLoadRef.current(false);
    }
  }, [clearSlowLoadTimer]);
  // Forward-referenced from armSlowLoadTimer (declared below) so app-resume
  // reloads from the hook can re-arm the slow-load watchdog.
  const armSlowLoadTimerRef = useRef<() => void>(() => { /* set below */ });
  const native = useNativePlayer({
    active: nativeActive,
    url: nativeActive ? streamUrl : null,
    volume,
    live: false,
    startPosition: startPos,
    subtitles: extraSubs,
    onTracksChanged,
    onPlayStateChange: onPlayStateChangeCb,
    onEnded: () => {
      // An episode with the next one lined up carries straight on.
      if (autoNextRef.current?.()) return;
      setPlexKeyOwner(detailRef.current ? 'detail' : 'browse'); setFullscreen(false); setStreamUrl(null); setUseTranscode(false);
    },
    onReload: () => { armSlowLoadTimerRef.current?.(); },
  });
  // Reset the safety-net guard whenever the underlying title changes.
  useEffect(() => { audioSafetyRef.current = null; }, [playing?.ratingKey]);

  useEffect(() => {
    if (!nativeActive) return;
    document.documentElement.classList.add('snowplayer-fullscreen');
    return () => { document.documentElement.classList.remove('snowplayer-fullscreen'); };
  }, [nativeActive]);

  // Tell background probes to stand down while a stream is on screen. The relay
  // escape fans out across every candidate connection at once, and the relay it
  // is trying to escape is already speed-capped — that probe competing with
  // playback is exactly the stutter it exists to prevent.
  useEffect(() => {
    setPlexPlaybackActive(fullscreen);
    return () => setPlexPlaybackActive(false);
  }, [fullscreen]);

  // Auto-fallback to Plex-side transcode when native playback errors — most
  // notably AUDIO_DECODE from the Media3 plugin (Fire TV rejected the direct
  // codec / offload path). Preserves the current playhead so switching feels
  // like a hiccup, not a restart.
  useEffect(() => {
    if (!(nativeActive && native.error && !useTranscode && playing && conn)) return;
    // A network drop is NOT a codec problem. RECONNECT_EXHAUSTED and every
    // ERROR_CODE_IO_* mean the bytes stopped arriving; switching to a
    // server-side transcode cannot help, and if it happens to succeed the user
    // is stuck transcoding — degraded picture, extra load on the PMS — for the
    // rest of the film because of a Wi-Fi hiccup. Leave the URL alone and let
    // the reconnect path below handle it.
    if (isNetworkPlaybackError(native.error.code)) return;
    void (async () => {
      let resume: number | undefined;
      try {
        const p = await native.getPosition();
        if (p.position > 0) resume = p.position;
      } catch { /* ignore */ }
      setStartPos(resume);
      setUseTranscode(true);
      setStreamUrl(plexTranscodeUrl(conn.base, playing.ratingKey, conn.token));
    })();
  }, [native.error, nativeActive, useTranscode, playing, conn, native]);

  // Same fallback for SILENT audio: a Dolby/DTS-only file on a device with no
  // matching decoder raises no error at all — ExoPlayer just deselects the
  // audio track and the movie plays mute. The native layer now reports that
  // as audioWarning, so treat it exactly like AUDIO_DECODE: hand decoding to
  // the Plex server (transcode outputs AAC every device can play).
  useEffect(() => {
    if (!(nativeActive && native.audioWarning && !native.error && !useTranscode && playing && conn)) return;
    void (async () => {
      let resume: number | undefined;
      try {
        const p = await native.getPosition();
        if (p.position > 0) resume = p.position;
      } catch { /* ignore */ }
      setStartPos(resume);
      setUseTranscode(true);
      setStreamUrl(plexTranscodeUrl(conn.base, playing.ratingKey, conn.token));
    })();
  }, [native.audioWarning, native.error, nativeActive, useTranscode, playing, conn, native]);

  // Slow-load watchdog: if the native player hasn't emitted 'ready' within
  // 8s of the fullscreen flipping on, expose a Retry button so the user can
  // kick the pipeline instead of staring at a stalled spinner.
  const [slowLoad, setSlowLoad] = useState(false);
  setSlowLoadRef.current = setSlowLoad;
  // Fullscreen title bar: visible for 4 s after mount / title change / a
  // buffering flip, then hides. watchKeys=false — any key opens
  // PlexPlayerOverlay, which already shows the title at the bottom.
  // fullscreen in deps so a same-title replay re-shows it; NOT native.buffering —
  // the diagnostics card owns the top-right corner during a stall.
  // Only while the player is up: its 4 s timer used to re-render all of Plex
  // after mount and after every player close, for a bar that was not shown.
  const [titleShown] = useTransientVisible(4000, { watchKeys: false, deps: [playingTitle, streamUrl], enabled: fullscreen });
  const armSlowLoadTimer = useCallback(() => {
    clearSlowLoadTimer();
    stillLoadingRef.current = true;
    setSlowLoad(false);
    // Converting has to fill the server's first segments before anything
    // plays: on a 4K or HEVC file, or a remote server, that routinely takes
    // longer than 8 s. Giving up at 8 s is what made every "1080p · 8 Mbps"
    // pick bounce straight back to Original.
    slowLoadTimerRef.current = window.setTimeout(() => {
      if (stillLoadingRef.current) setSlowLoad(true);
      slowLoadTimerRef.current = null;
    }, useTranscodeRef.current ? TRANSCODE_START_GRACE_MS : 8000) as unknown as number;
  }, [clearSlowLoadTimer]);
  useEffect(() => { armSlowLoadTimerRef.current = armSlowLoadTimer; }, [armSlowLoadTimer]);
  useEffect(() => {
    if (!fullscreen) { clearSlowLoadTimer(); stillLoadingRef.current = false; setSlowLoad(false); return; }
    armSlowLoadTimer();
    return () => { clearSlowLoadTimer(); };
  }, [fullscreen, streamUrl, clearSlowLoadTimer, armSlowLoadTimer]);
  // Only clear the slow-load watchdog when playback ACTUALLY starts — i.e.
  // the native player reports playing or the polled position advances past 0.
  // The onPlayStateChangeCb above already clears on the 'playing' event; this
  // interval is a belt-and-braces poll in case that event is missed.
  useEffect(() => {
    if (!fullscreen || !streamUrl) return;
    let lastPos: number | null = null;
    let alive = true;
    const id = window.setInterval(async () => {
      // Nothing left to watch for: playback already started once. A stall
      // mid-film flips `native` and re-runs this effect, and without this it
      // polled the player across the bridge every 1.5 s for the whole stall.
      if (!stillLoadingRef.current) { window.clearInterval(id); return; }
      try {
        const p = await native.getPosition();
        if (!alive) return;
        const advanced = p.duration > 0 && lastPos !== null && p.position > lastPos + 0.1;
        lastPos = p.position;
        if (p.playing || advanced) {
          stillLoadingRef.current = false;
          clearSlowLoadTimer();
          setSlowLoad(false);
          // Its only job is done; it re-arms for the next streamUrl.
          window.clearInterval(id);
        }
      } catch { /* ignore */ }
    }, 1500);
    return () => { alive = false; window.clearInterval(id); };
  }, [fullscreen, streamUrl, native, clearSlowLoadTimer]);

  // Auto-rescue: if the slow-load watchdog fires while we're playing a
  // TRANSCODE stream, the server's transcoder is almost certainly stuck.
  // Silently revert to direct play instead of showing the Retry panel.
  const autoRevertRef = useRef<string | null>(null);
  useEffect(() => {
    if (!(slowLoad && useTranscode && playing && conn)) return;
    const key = playing.ratingKey;
    if (autoRevertRef.current === key) return;
    autoRevertRef.current = key;
    let cancelled = false;
    void (async () => {
      let resume: number | undefined = startPos;
      try {
        const p = await native.getPosition();
        if (p.position > 0) resume = p.position;
      } catch { /* ignore */ }
      if (cancelled) return;
      let url = '';
      let fellBack = false;
      try {
        const { partKey } = await getPlexPart(conn.base, conn.token, key);
        url = partKey ? plexDirectUrl(conn.base, partKey, conn.token) : plexTranscodeUrl(conn.base, key, conn.token);
      } catch {
        url = plexTranscodeUrl(conn.base, key, conn.token);
        fellBack = true;
      }
      if (cancelled) return;
      setUseTranscode(fellBack);
      setQualityKey('original');
      setStartPos(resume);
      setSlowLoad(false);
      stillLoadingRef.current = true;
      setStreamUrl(() => { window.setTimeout(() => setStreamUrl(url), 60); return null; });
      try { toast({ title: "The Plex server couldn't convert this in time", description: 'Playing original quality instead.' }); } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [slowLoad, useTranscode, playing, conn, native, startPos, toast]);

  // Reset the auto-revert guard when a new title starts.
  useEffect(() => { autoRevertRef.current = null; }, [playing?.ratingKey]);

  // Automatic quality, like the Plex app's. Playback starts at Original; if
  // the file keeps buffering because it is bigger than what arrives (a 1080p
  // remux runs 25-40 Mb/s), drop once to the quality the connection carries
  // and say so. A stall still going after 6 s, or a second stall, counts; the
  // first load does not. Once per title, and never while already converting.
  const autoDropRef = useRef<{ key: string | null; stalls: number; done: boolean }>({ key: null, stalls: 0, done: false });
  useEffect(() => { autoDropRef.current = { key: playing?.ratingKey ?? null, stalls: 0, done: false }; }, [playing?.ratingKey]);
  useEffect(() => {
    if (!(nativeActive && native.buffering && !useTranscode && playing && conn)) return;
    if (stillLoadingRef.current) return;
    const st = autoDropRef.current;
    if (st.done || st.key !== playing.ratingKey) return;
    st.stalls += 1;
    let cancelled = false;
    const drop = async () => {
      if (cancelled || st.done) return;
      const preset = autoDropPreset(fileKbps, getDiagSnapshot());
      if (!preset) return;
      st.done = true;
      let resume = 0;
      try { const p = await native.getPosition(); resume = p.position; } catch { /* from the start */ }
      if (cancelled) return;
      try { trackEvent('plex_auto_quality', 'player', { preset: preset.key, fileKbps: fileKbps ?? 0 }); } catch { /* ignore */ }
      changeQuality(preset.key, resume);
      try { toast({ title: `Switched to ${preset.label} to stop the buffering`, description: 'Change it any time under Quality.' }); } catch { /* ignore */ }
    };
    const timer = window.setTimeout(() => { void drop(); }, st.stalls >= 2 ? 0 : 6000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [native.buffering, nativeActive, useTranscode, playing, conn, fileKbps, native, changeQuality]);

  // Network-class failure while playing: retry by itself the moment the device
  // reports connectivity again, instead of parking on "Playback Error" until
  // someone finds the remote. One shot per error — a genuinely dead stream
  // still surfaces the panel.
  const netRetriesRef = useRef(0);
  useEffect(() => { netRetriesRef.current = 0; }, [playing?.ratingKey]);
  useEffect(() => {
    if (!(nativeActive && native.error && isNetworkPlaybackError(native.error.code))) return;
    if (netRetriesRef.current >= 6) return;   // ~2 min of trying, then it's the user's call
    let done = false;
    const kick = () => {
      if (done) return;
      done = true;
      netRetriesRef.current += 1;
      native.retry();
    };
    // Instant path: the OS told us the interface came back.
    window.addEventListener('online', kick);
    // Fallback path: Android reports navigator.onLine from the interface, which
    // stays true when it is the internet beyond it that dropped. Back off so a
    // genuinely dead stream is not hammered.
    const t = window.setTimeout(kick, Math.min(60_000, 4000 * 2 ** netRetriesRef.current));
    return () => { window.removeEventListener('online', kick); window.clearTimeout(t); };
  }, [nativeActive, native.error, native, playing]);

  // plex_error — track native player fatal error transitions (single fire per message).
  const lastPlexErrRef = useRef<string | null>(null);
  useEffect(() => {
    const msg = native.error?.message ?? null;
    if (msg && msg !== lastPlexErrRef.current) {
      lastPlexErrRef.current = msg;
      try {
        trackEvent('player_error', 'player', {
          kind: 'plex',
          channel_or_title: playingTitle || playing?.title || '',
          server: conn?.name || '',
        });
      } catch { /* ignore */ }
    } else if (!msg) {
      lastPlexErrRef.current = null;
    }
  }, [native.error, playingTitle, playing, conn]);

  const exitFullscreen = useCallback(() => {
    // Synchronous owner hand-back: the Back keydown that closes the player
    // must never also be seen by PlexDetail (episodes → seasons pop).
    setPlexKeyOwner(detailRef.current ? 'detail' : 'browse');
    setFullscreen(false); setStreamUrl(null); setUseTranscode(false);
  }, []);

  // The overlay's Help and Support exits, made once per title rather than on
  // every render: fresh closures here re-rendered the whole playback overlay
  // every time Plex rendered during a film.
  const playingRef = useRef(playing); playingRef.current = playing;
  const stashPlexReturn = useCallback(() => {
    // Stash movie context so Support can hand it back to Plex on close.
    try {
      const p = playingRef.current;
      if (p) {
        sessionStorage.setItem('smc-guide-origin', 'plex-movie');
        sessionStorage.setItem('smc-plex-deeplink', JSON.stringify({
          ratingKey: p.ratingKey,
          title: p.title,
          librarySectionID: (p as unknown as { librarySectionID?: string | number | null }).librarySectionID ?? null,
          kind: p.type ?? 'movie',
        }));
      }
    } catch { /* ignore */ }
  }, []);
  const overlayOpenGuide = useMemo(() => (onOpenBufferingGuide
    ? () => { stashPlexReturn(); exitFullscreen(); onOpenBufferingGuide(); }
    : undefined), [onOpenBufferingGuide, stashPlexReturn, exitFullscreen]);
  const overlayOpenSupport = useMemo(() => (onOpenSupport
    ? () => { stashPlexReturn(); exitFullscreen(); onOpenSupport(); }
    : undefined), [onOpenSupport, stashPlexReturn, exitFullscreen]);

  const toggleHidden = useCallback((key: string) => {
    wantTabKeyRef.current = tabsRef.current[libIdxRef.current]?.key ?? null;
    setHidden((prev) => {
      const has = prev.indexOf(key) >= 0;
      const next = has ? prev.filter((k) => k !== key) : [...prev, key];
      void saveHiddenPlexLibs(next);
      return next;
    });
  }, []);

  // ── refs for keyboard ───────────────────────────────────────────────
  const cursorRef = useRef(cursor);
  const menuIdxRef = useRef(menuIdx); useEffect(() => { menuIdxRef.current = menuIdx; }, [menuIdx]);
  // The focused menu entry scrolls into view when the highlight moves, not on
  // every render: an inline scroll callback ran (with a forced layout) each
  // time anything re-rendered Plex while the menu was open.
  const menuBtnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useLayoutEffect(() => {
    if (!isActive || fullscreen || zone !== 'tabs') return;
    menuBtnRefs.current[menuIdx]?.scrollIntoView({ block: 'nearest' });
  }, [menuIdx, zone, isActive, fullscreen]);
  const libIdxRef = useRef(libIdx); const itemsRef = useRef(items);
  const tabsRef = useRef(tabs); const fullscreenRef = useRef(fullscreen);
  // detailRef declared earlier (near openDetail); ref-sync effect below.
  const nativeErrRef = useRef(native.error); const nativeRetryRef = useRef(native.retry);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { libIdxRef.current = libIdx; }, [libIdx]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);
  useEffect(() => { detailRef.current = detailItem; }, [detailItem]);
  useEffect(() => { nativeErrRef.current = native.error; }, [native.error]);
  useEffect(() => { nativeRetryRef.current = native.retry; }, [native.retry]);

  const goHome = useCallback(() => { cancelPendingTab(); setLibIdx(homeIdx); setZone('tabs'); }, [cancelPendingTab]);

  // Single keydown effect. STRUCTURAL RULE: while `detailItem` OR `fullscreen`
  // is set, this handler is TORN DOWN entirely — the detail overlay / player
  // overlay wire their own capture listeners. That guarantees exactly ONE
  // capture listener is active at a time, so a fast D-pad press right after
  // Enter can't be handled by both the grid AND the detail page.
  useEffect(() => {
    if (!isActive) return;
    // Pre-stream fullscreen (streamUrl not resolved yet): keep a MINIMAL Back
    // handler so the user is never stuck on a black loading screen while the
    // native decoder acquires. Everything else is deferred to the overlay.
    if (fullscreen && (!streamUrl || slowLoad || !!native.error)) {
      const backOnly = (e: KeyboardEvent) => {
        const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
        if (!isBack) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        // Hand the D-pad back synchronously so the same Back can't leak
        // into the detail page's listener.
        setPlexKeyOwner(detailRef.current ? 'detail' : 'browse');
        setFullscreen(false); setStreamUrl(null); setUseTranscode(false);
      };
      window.addEventListener('keydown', backOnly, true);
      return () => window.removeEventListener('keydown', backOnly, true);
    }
    if (detailItem || fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (!isPlexKeyOwner('browse')) return;
      if (detailRef.current || fullscreenRef.current) return;
      const target = e.target as HTMLElement;
      const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
      // Search's "Request it?" question closes on Back; it handles the key.
      if (isBack && (window as unknown as { __plexRequestAsk?: boolean }).__plexRequestAsk) return;

      // Not-ready statuses (auth screen etc): only Back is handled here — all
      // other keys pass through to whatever else is listening.
      if (status !== 'ready') {
        if (isBack) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          try { cancelLink(); } catch { /* no-op */ }
          onExitLeft?.();
        }
        return;
      }

      if (isBack) {
        // A library in rows mode owns its own Back: it clears a filter, leaves
        // the chip bar, or calls exitToMenu itself. This listener runs FIRST
        // (it registered before the panel's), so it must step aside here or
        // the panel never sees the key and a set filter can't be undone.
        const rt = tabsRef.current[libIdxRef.current];
        if (
          zoneRef.current === 'grid' && rt && rt.libKey
          && (rt.type === 'movie' || rt.type === 'show')
          && (libraryModeRef.current[rt.libKey] ?? 'rows') === 'rows'
        ) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        // Inside a library's A-Z grid, Back returns to that library's rows
        // rather than jumping to the Home tab. Gated on zone === 'grid' so it
        // cannot eat Back while the user is up on the tab strip — from there
        // Back must still be one press to leave, exactly as it is on every
        // other tab type.
        const bt = tabsRef.current[libIdxRef.current];
        if (
          zoneRef.current === 'grid' && bt && bt.libKey
          && (bt.type === 'movie' || bt.type === 'show')
          && libraryModeRef.current[bt.libKey] === 'grid'
        ) {
          setLibraryMode((m) => ({ ...m, [bt.libKey!]: 'rows' }));
          return;
        }
        // Content → the side menu; the menu → out of Plex.
        if (zoneRef.current === 'grid') { exitToMenu(); return; }
        onExitLeft?.();
        return;
      }

      const t = tabsRef.current[libIdxRef.current];
      // Hand the content area to whichever panel owns it. A library tab in
      // ROWS mode is owned by PlexLibraryRows exactly the way Home/Search/
      // Request/Manage own theirs — without this the grid branch below also
      // runs, against an items array that rows mode deliberately never fills.
      // Up would bounce the user back to the tab strip and Down/Left/Right
      // would do nothing, and because both listeners are window-capture the
      // winner depends on which effect re-registered last — so it looked
      // intermittent.
      if (zoneRef.current === 'grid' && t) {
        if (t.type === 'home' || t.type === 'discover' || t.type === 'search' || t.type === 'seasonal' || t.type === 'request' || t.type === 'manage') return;
        if (
          (t.type === 'movie' || t.type === 'show') && t.libKey
          && (libraryModeRef.current[t.libKey] ?? 'rows') === 'rows'
        ) return;
      }

      if (inInput) return;

      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();

      if (zoneRef.current === 'tabs') {
        const entries = menuEntriesRef.current;
        const mi = Math.min(menuIdxRef.current, entries.length - 1);
        const moveTo = (i: number) => {
          const next = entries[i];
          if (!next) return;
          setMenuKey(next.key);
          // The panel follows once the cursor rests (see queueTab).
          queueTab(next.tabIdx);
        };
        if (e.key === 'ArrowUp') { if (mi > 0) moveTo(mi - 1); }
        else if (e.key === 'ArrowDown') { if (mi < entries.length - 1) moveTo(mi + 1); }
        else if (e.key === 'ArrowLeft') { /* never leave Plex via arrows */ }
        else if (e.key === 'ArrowRight') { commitPendingTab(); setZone('grid'); }
        else if (e.key === 'Enter' || e.key === ' ') {
          if (e.repeat) return;
          const cur = entries[mi];
          const t = cur ? tabsRef.current[cur.tabIdx] : undefined;
          // Only a library can be hidden; anything else opens on the press.
          if (!t || !t.libKey || (t.type !== 'movie' && t.type !== 'show')) { commitPendingTab(); setZone('grid'); return; }
          if (menuHoldTimerRef.current || menuHoldFiredRef.current) return;
          const libKey = t.libKey; const title = t.title;
          menuHoldTimerRef.current = window.setTimeout(() => {
            menuHoldTimerRef.current = null;
            menuHoldFiredRef.current = true;
            toggleHidden(libKey);
            toast({ title: `${title} hidden`, description: 'Bring it back any time under Settings.' });
          }, 600) as unknown as number;
        }
        return;
      }

      // grid zone (movie/show libraries)
      const total = itemsRef.current.length;
      const cur = cursorRef.current;
      if (e.key === 'ArrowUp') { if (cur < COLS) setZone('tabs'); else setCursor(cur - COLS); }
      else if (e.key === 'ArrowDown') { if (cur + COLS < total) setCursor(cur + COLS); }
      else if (e.key === 'ArrowLeft') { if (cur % COLS !== 0) setCursor(cur - 1); }
      else if (e.key === 'ArrowRight') { if ((cur % COLS) < COLS - 1 && cur + 1 < total) setCursor(cur + 1); }
      else if (e.key === 'Enter' || e.key === ' ') { if (e.repeat) return; const it = itemsRef.current[cur]; if (it) openDetail(it); }
    };
    // Release before the hold threshold is a short press: enter the library.
    const keyup = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (menuHoldTimerRef.current) {
        window.clearTimeout(menuHoldTimerRef.current);
        menuHoldTimerRef.current = null;
        if (zoneRef.current === 'tabs') { commitPendingTab(); setZone('grid'); }
      }
      menuHoldFiredRef.current = false;
    };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('keyup', keyup, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keyup', keyup, true);
      if (menuHoldTimerRef.current) { window.clearTimeout(menuHoldTimerRef.current); menuHoldTimerRef.current = null; }
    };
    // NOTE: PlexSection intentionally does NOT register its own
    // CapApp.backButton listener. The Player (LiveTV.tsx) already converts
    // hardware Back into a synthetic Escape KeyboardEvent, which flows through
    // this exact capture chain. Registering our own listener caused double-
    // fires (each listener popped one level, exiting Plex on the first press).
  }, [isActive, status, onExitLeft, onExitUp, openDetail, goHome, exitToMenu, toggleHidden, toast, cancelLink, detailItem, fullscreen, streamUrl, slowLoad, native.error, queueTab, commitPendingTab]);

  // Demo notice owns the D-pad while open: swallow every key so focus can't
  // leak into the grid behind it. OK / Back / Escape dismiss.
  useEffect(() => {
    if (!demoNotice) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') {
        setDemoNotice(false);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [demoNotice]);

  const demoNoticeOverlay = demoNotice ? (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 px-6"
      role="dialog" aria-modal="true">
      <div className="max-w-md w-full rounded-xl border border-brand-gold/40 bg-[#0b1622] p-6 text-center shadow-2xl">
        <p className="font-nunito text-white/90 text-base leading-relaxed">{DEMO_DIALOG_MSG}</p>
        <button type="button" autoFocus onClick={() => setDemoNotice(false)}
          className="mt-5 px-6 py-2 rounded-lg bg-brand-gold text-black font-semibold font-nunito focus:outline-none focus:ring-2 focus:ring-white">
          OK
        </button>
      </div>
    </div>
  ) : null;

  // ── render: auth gate ───────────────────────────────────────────────
  if (status === 'loading' || status === 'connecting') {
    return <div className="min-h-screen flex items-center justify-center text-white"><div className="w-full max-w-md"><SnowLoader size="md" label="Connecting to Plex…" /></div></div>;
  }
  if (status !== 'ready') {
    return <PlexAuthScreen status={status} pinCode={pinCode} error={error} providerNote={providerNote} providerAvailable={providerAvailable} onStartLink={startLink} onLinkWithProvider={() => { void linkWithProvider(); }} onNeedLiveTV={onNeedLiveTV} onRetry={() => { void retryConnect(); }} onSignOut={() => { void signOut(); }} onCancel={() => { cancelLink(); onExitLeft?.(); }} />;
  }

  // ── render: post-link confirmation ──────────────────────────────────
  // Shown ONCE after a fresh PIN link succeeds, before warm-up/browse UI.
  if (justLinked && status === 'ready' && !fullscreen && !detailItem) {
    return (
      <JustLinkedCard
        conn={conn}
        accountToken={accountToken ?? conn?.token}
        onContinue={() => clearJustLinked()}
        onSignOut={() => { void signOut(); }}
      />
    );
  }

  // ── render: warm-up ─────────────────────────────────────────────────
  // Delay revealing the tabs+grid until Home rails + first ~12 posters have
  // loaded (or 8s cap). Back during warm-up still exits Plex via the keydown
  // effect above (status==='ready', no detail/fullscreen).
  if (!warmedUp && !fullscreen && !detailItem) {
    return (
      <div className="min-h-screen flex-1 flex flex-col items-center justify-center gap-4 bg-black/40 text-white">
        <div className="w-full max-w-md">
          <SnowLoader size="md" label="Getting Plex ready…" />
        </div>
        <p className="text-xs font-nunito text-brand-ice/70">Plex · {conn?.name}</p>
      </div>
    );
  }


  // ── render: fullscreen ──────────────────────────────────────────────
  // The player is a layer over the browse view, not a replacement for it.
  // Returning only the player used to unmount the detail page and every
  // panel, so closing it rebuilt all of them from scratch: the episode list
  // was gone (back to the show page), every rail went back to its first
  // tile, the metadata and hubs were fetched again and every poster
  // flashed. The browse view now stays mounted underneath, hidden, and
  // everything in it is inactive while the player is up.
  const playerLayer = fullscreen ? (
      <div className={`fixed inset-0 z-[60] text-white ${NATIVE_PLAYBACK ? 'bg-transparent' : 'bg-black'}`}>
        {!NATIVE_PLAYBACK && streamUrl && (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><div className="w-full max-w-md"><SnowLoader size="lg" label="Loading…" /></div></div>}>
            <VideoPlayer src={streamUrl} volume={volume} className="w-full h-full" />
          </Suspense>
        )}
        {NATIVE_PLAYBACK && !native.error && !slowLoad && (!streamUrl || !nativeActive || native.buffering) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-full max-w-md">
              <SnowLoader size="lg" label={streamUrl && nativeActive ? 'Buffering…' : 'Loading…'} />
            </div>
          </div>
        )}
        {NATIVE_PLAYBACK && !native.error && slowLoad && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center">
            <div className="w-full max-w-md mb-3">
              <SnowLoader size="md" />
            </div>
            <p className="font-quicksand font-semibold mb-1">Still preparing…</p>
            <p className="text-sm text-brand-ice/70 font-nunito mb-4">Your Plex server is slow to respond.</p>
            <button onClick={() => {
              if (!streamUrl && playing) {
                // No stream URL resolved yet — native.retry() would be a no-op.
                // Re-invoke the current item's play path from scratch.
                armSlowLoadTimer();
                void playRatingKey(playing.ratingKey, playing.title, startPos, subCtx, playingResLabel);
              } else {
                armSlowLoadTimer();
                native.retry();
              }
            }} autoFocus data-focused="true" className="tv-ring tv-ring-contrast flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold">
              <RotateCw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}
        {NATIVE_PLAYBACK && native.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-brand-gold mb-3" />
            <p className="font-quicksand font-semibold mb-1">Playback Error</p>
            <p className="text-sm text-brand-ice/80 font-nunito max-w-md mb-4">{native.error.message}</p>
            <button onClick={() => { armSlowLoadTimer(); native.retry(); }} autoFocus data-focused="true" className="tv-ring tv-ring-contrast flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold">
              <RotateCw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}
        {titleShown && (
          <div className="absolute top-0 left-0 right-0 p-4 pr-96 bg-gradient-to-b from-black/80 to-transparent pointer-events-none animate-fade-in">
            <p className="font-quicksand font-bold text-white truncate">
              {playingTitle}{useTranscode ? ' · transcoding' : ''}
              {playingResLabel && (
                <span className={`ml-2 align-middle text-xs font-bold px-2 py-1 rounded-lg bg-black/70 ${playingResLabel === '4K' ? 'text-brand-gold' : 'text-white/80'}`}>{playingResLabel}</span>
              )}
            </p>
          </div>
        )}
        {NATIVE_PLAYBACK && !native.error && (
          <BufferingDiagnostics buffering={native.buffering} showHelpHint footnote={routeLabel ? `Route: ${routeLabel}` : undefined} explain={explainStall} needKbps={stallNeedKbps} />
        )}
        {NATIVE_PLAYBACK && !native.error && (
          <PlexPlayerOverlay
            active={nativeActive && !slowLoad}
            title={playingTitle}
            resolutionLabel={playingResLabel}
            controller={native.controller}
            tracksTick={tracksTick}
            getPosition={native.getPosition}
            seekTo={native.seekTo}
            onBackWhileHidden={exitFullscreen}
            routeLabel={routeLabel}
            subtitleContext={subCtx}
            onLoadExternalSubtitle={handleLoadExternalSubtitle}
            qualityKey={qualityKey}
            onChangeQuality={changeQuality}
            onOpenBufferingGuide={overlayOpenGuide}
            onOpenSupport={overlayOpenSupport}
            volume={volume}
            onChangeVolume={changeVolume}
            onFixAudio={fixAudioTranscode}
            prompt={playerPrompt}
          />
        )}
        {conn && !DEMO && (
          <PlexProgressReporter
            active={nativeActive && !slowLoad}
            ratingKey={fullscreen ? playing?.ratingKey ?? null : null}
            info={playInfo}
            getPosition={native.getPosition}
            server={ownPlexAccount ? { base: conn.base, token: conn.token } : null}
          />
        )}
        {conn && (
          <EpisodeAutoplay
            active={nativeActive && !slowLoad}
            base={conn.base}
            token={conn.token}
            ratingKey={fullscreen ? playing?.ratingKey ?? null : null}
            getPosition={native.getPosition}
            seekTo={native.seekTo}
            onPrompt={setPlayerPrompt}
            onPlayNext={playNextEpisode}
            onInfo={setPlayInfo}
            registerEnded={registerAutoNext}
          />
        )}

      </div>
  ) : null;


  // ── render: browse ─────────────────────────────────────────────────
  const totalH = rowVirtualizer.getTotalSize();
  // Folded whenever the remote is over in the content. While the detail page
  // or the player is up the menu is not on screen at all, so this is only
  // about the browse view.
  const menuCollapsed = zone !== 'tabs';
  const menuIcon = (t: Tab) =>
    t.type === 'home' ? HomeIcon : t.type === 'discover' ? Compass : t.type === 'search' ? SearchIcon : t.type === 'seasonal' ? Ghost : t.type === 'manage' ? SettingsIcon
    : t.type === 'request' ? MessageSquare : t.type === 'show' ? Tv : Film;
  return (
    <>
    {/* visibility, not display: a display:none subtree loses every scroll
        position (the rails' and the content column's), and the viewer came
        back to rails scrolled to their start. Hidden this way it paints
        nothing, so the video under the WebView shows through as before. */}
    <div className="flex-1 min-h-0 flex overflow-hidden bg-black/30 text-white" style={fullscreen ? { visibility: 'hidden' } : undefined}>
      {/* SIDE MENU: Home / Discover / Search, the libraries, then Request / Settings.
          It snaps between widths rather than animating: a width transition
          re-laid-out every rail and poster in the content column on each of
          its frames, on every trip between the menu and the content. */}
      {/* The menu folds to its icons while the viewer is over in the content,
          so the rows get the room; Left off a first tile or Back opens it
          again with the highlight on the open entry (exitToMenu). */}
      <div
        onClick={() => { if (menuCollapsed) exitToMenu(); }}
        className={`flex-shrink-0 border-r border-white/10 bg-black/40 flex flex-col pb-2 overflow-y-auto overflow-x-hidden ${menuCollapsed ? 'w-14 cursor-pointer' : 'w-56'}`}
        // Plex fills the screen with no header above it, so the top of this
        // column is the top of the panel — and a TV's overscan takes the
        // first 2–4% of that. The server line was the thing being cut off.
        style={{ paddingTop: '3.5vh' }}
      >
        <div className={`pb-1 text-xs font-nunito text-brand-ice/60 truncate ${menuCollapsed ? 'px-0 text-center' : 'px-5'}`}>{menuCollapsed ? 'Plex' : `Plex · ${conn?.name}`}</div>
        {menuEntries.map((m, i) => {
          const focused = isActive && !fullscreen && zone === 'tabs' && menuIdx === i;
          const tab = tabs[m.tabIdx];
          const selected = libIdx === m.tabIdx;
          const first = i === 0 || menuEntries[i - 1].group !== m.group;
          const Icon = menuIcon(tab);
          return (
            <div key={m.key}>
              {/* A hairline between groups instead of HOME / LIBRARIES / MORE
                  headings — the icons already say what each row is, and the
                  headings only pushed the libraries further down the rail. */}
              {first && i > 0 && <div className="mx-4 my-2 border-t border-white/10" aria-hidden="true" />}
              <button
                ref={(el) => { menuBtnRefs.current[i] = el; }}
                data-focused={focused ? 'true' : 'false'}
                title={menuCollapsed ? m.title : undefined}
                onClick={(e) => { if (menuCollapsed) return; e.stopPropagation(); cancelPendingTab(); setMenuKey(m.key); if (m.tabIdx !== libIdx) setLibIdx(m.tabIdx); setZone('grid'); }}
                // appearance-none: an old WebView (X96 / T95 Android 9) paints the OS
                // button face over a <button> whose only background is the reset's
                // `transparent` — a row of light pills with invisible text. The
                // focused row escaped because its ring is a box-shadow, which
                // turns the native theme off. So does appearance: none.
                className={`tv-ring appearance-none relative w-full flex items-center gap-2.5 h-10 rounded-lg mx-2 font-nunito text-sm ${menuCollapsed ? 'justify-center px-0' : 'text-left px-3'} ${
                  focused ? 'bg-white/10 text-white font-semibold' : selected ? 'text-white font-semibold' : 'text-brand-ice/85'}`}
                style={{ width: 'calc(100% - 1rem)' }}
              >
                {selected && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-brand-gold" aria-hidden="true" />}
                <Icon className={`w-4 h-4 flex-shrink-0 ${selected ? 'text-brand-gold opacity-100' : 'opacity-80'}`} />
                {!menuCollapsed && <span className="truncate">{m.title}</span>}
              </button>
            </div>
          );
        })}
        {!menuCollapsed && <div className="mt-auto px-5 pt-4 pb-2 text-xs font-nunito text-brand-ice/50">▶ into rows · Hold OK hide a library · Back exit</div>}
      </div>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div ref={attachScroll} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 pb-4" style={{ paddingTop: '3.5vh' }}>
        {deepLinked && detailItem ? null : voiceWait && zone === 'tabs' && currentTab?.type === 'home' ? (
          // A voice command's title is being looked up. Home is not loaded
          // behind it (its hubs would compete with the search); entering the
          // content before it lands shows Home as usual.
          <div className="h-full flex items-center justify-center text-brand-ice/80 font-nunito text-base">
            <Loader2 className="w-5 h-5 animate-spin text-brand-gold mr-2" /> Finding “{voiceWait}” on Plex…
          </div>
        ) : currentTab?.type === 'home' && conn ? (
          <HomePanel
            isActive={isActive && zone === 'grid' && !detailItem && !fullscreen}
            base={conn.base}
            token={conn.token}
            libraries={familyLibraries}
            adultKeys={adultKeys}
            onPlay={openDetail}
            onExitToTabs={exitToMenu}
            watchNonce={watchNonce}
            serverResume={ownPlexAccount}
            // Plays on the provider's server under the shared account are
            // every Snow Media viewer's.
            popularTitle={!ownPlexAccount && isProviderServer(conn.name) ? 'Popular on Snow Media' : 'Most Watched'}
          />
        ) : currentTab?.type === 'discover' && conn ? (
          <DiscoverPanel
            isActive={isActive && zone === 'grid' && !detailItem && !fullscreen}
            base={conn.base}
            token={conn.token}
            libraries={familyLibraries}
            adultKeys={adultKeys}
            onPlay={openDetail}
            onExitToTabs={exitToMenu}
          />
        ) : currentTab?.type === 'seasonal' && conn && season ? (
          <SeasonalPanel
            isActive={isActive && zone === 'grid' && !detailItem && !fullscreen}
            base={conn.base}
            token={conn.token}
            libraries={familyLibraries}
            adultKeys={adultKeys}
            season={season}
            clientIdentifier={conn.clientIdentifier}
            onPlay={openDetail}
            onExitToTabs={exitToMenu}
          />
        ) : currentTab?.type === 'search' && conn ? (
          <SearchPanel key={voiceSearch ? `voice:${voiceSearch.n}` : 'search'} initialQuery={voiceSearch?.q} isActive={isActive && zone === 'grid' && !detailItem && !fullscreen} base={conn.base} token={conn.token} adultKeys={adultKeys} onPlay={openDetail} onExitToTabs={exitToMenu} />

        ) : currentTab?.type === 'request' ? (
          <OverseerrRequestPanel isActive={isActive && zone === 'grid' && !detailItem && !fullscreen} onExitToTabs={exitToMenu} />
        ) : currentTab?.type === 'manage' ? (
          <ManagePanel isActive={isActive && zone === 'grid' && !detailItem && !fullscreen} libraries={libraries} hidden={hidden} librariesError={librariesError} onToggle={toggleHidden} onExitToTabs={exitToMenu} serverName={conn?.name} owned={conn?.owned} accountToken={accountToken ?? conn?.token} onSignOut={() => { void signOut(); }} />
        ) : (currentTab?.type === 'movie' || currentTab?.type === 'show')
             && currentTab.libKey && conn && currentMode(currentTab.libKey) === 'rows' ? (
          // key: the panels share one slot in this ternary, so without an
          // explicit key React reconciles Movies -> TV Shows to the SAME
          // instance and every piece of row state, cursor and cache seed
          // carries over. isActive matches every sibling panel exactly — with
          // a bare isActive the panel's capture handler stays live on the tab
          // strip and eats the arrows that move between tabs.
          <PlexLibraryRows
            key={currentTab.libKey}
            isActive={isActive && zone === 'grid' && !detailItem && !fullscreen}
            // isCurrent is NOT gated on zone: it drives prefetch, and the
            // point of prefetch is to run while the user is still up on the
            // tab strip, exactly as the old grid's dwell loader did.
            isCurrent={isActive}
            base={conn.base}
            token={conn.token}
            libKey={currentTab.libKey}
            libTitle={currentTab.title}
            sectionType={currentTab.type === 'show' ? 'show' : 'movie'}
            onOpen={openDetail}
            onExitToTabs={exitToMenu}
            watchNonce={watchNonce}
            serverResume={ownPlexAccount}
          />
        ) : itemsLoading && items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/70 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-gold" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm">Nothing here yet.</div>
        ) : (
          <div style={{ height: totalH, position: 'relative', width: '100%' }}>
            {rowVirtualizer.getVirtualItems().map((vr) => {
              const start = vr.index * COLS;
              const rowItems = items.slice(start, start + COLS);
              return (
                <div key={vr.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: rowH, transform: `translateY(${vr.start}px)` }} className="grid gap-3">
                  <div className="grid grid-cols-6 gap-3">
                    {rowItems.map((it, ci) => {
                      const idx = start + ci;
                      return conn ? (
                        <PlexPosterTile
                          key={it.ratingKey}
                          item={it}
                          base={conn.base}
                          token={conn.token}
                          width="fill"
                          scrollIntoView={false}
                          focused={isActive && zone === 'grid' && cursor === idx}
                          onClick={() => { setCursor(idx); openDetail(it); }}
                        />
                      ) : null;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>


      {detailItem && conn && (
        <PlexDetail
          // A voice command can open a title while another one's page is up;
          // the page takes its title once, when it mounts.
          key={detailItem.ratingKey}
          isActive={isActive && !fullscreen}
          base={conn.base}
          token={conn.token}
          item={detailItem}
          onPlay={playFromDetail}
          onPlayEpisode={playEpisode}
          onBack={closeDetail}
          watchNonce={watchNonce}
          serverResume={ownPlexAccount}
        />
      )}
    </div>
    {playerLayer}
    {demoNoticeOverlay}
    </>
  );
});


PlexSection.displayName = 'PlexSection';
export default PlexSection;
