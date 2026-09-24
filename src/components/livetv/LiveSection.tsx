import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
import { ChevronDown, ChevronRight, Loader2, Search, Star, Tv } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  loadFavoritesData,
  loadSavedAccounts,
  SAVED_ACCOUNTS_REFRESH_EVENT,
  getLiveCategories,
  getLiveStreams,
  forgetLiveStreams,
  getShortEpg,
  buildLiveStreamUrl,
  buildNativeLiveUrl,
  countLiveStreams,
  pickNowNext,
  XTREAM_REFRESH_EVENT,
  type FavChannel,
  type XtreamCreds,
  type XtreamCategory,
  type XtreamLiveStream,
  type EpgNowNext,
} from '@/lib/xtream';
import {
  prepareLocalForLine,
  flushFavoritesPush,
  loadFavoritesForLine,
  saveFavoritesForLine,
  scheduleFavoritesPushForLine,
  reconcileFavoritesForLine,
  lineKey,
} from '@/lib/favoritesSync';
import {
  buildLines,
  lineLabel,
  loadHiddenCategories,
  loadCollapsedLines,
  saveCollapsedLines,
  HIDDEN_CATEGORIES_EVENT,
} from '@/lib/liveLines';
import {
  countsAreFresh,
  expireCounts,
  formatCount,
  readCounts,
  recordCounts,
  tallyByCategory,
  type CatalogCounts,
} from '@/lib/catalogCounts';
import { runAfter } from '@/utils/idle';
import { keepInView } from '@/utils/keepInView';
import { isPlaybackQuiet } from '@/utils/quietMode';
import { loadPlayerVolume, savePlayerVolume } from '@/utils/volume';
import { isFireTV, isLowMemoryBox } from '@/utils/platform';
import { trackEvent, startTimer, stopTimer } from '@/lib/analytics';
import ChannelRow from './ChannelRow';
import PlayerControlBar, { type BarControlId } from './PlayerControlBar';
import BufferingDiagnostics from './BufferingDiagnostics';
import SnowLoader from '@/components/SnowLoader';
import { useTransientVisible } from '@/hooks/useTransientVisible';
import type { VideoController } from './VideoPlayer';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { useNativePlayer } from '@/hooks/useNativePlayer';
import { isDemo, DEMO_DIALOG_MSG } from '@/lib/demoMode';
import { useLiveLayout, hasLiveLayoutChoice, type LiveLayout } from '@/lib/liveLayout';
import { peekIntent, clearIntent, type ReportIntent } from '@/lib/appActions';
import { bestChannel } from '@/lib/voiceCommands';
import { isChannelDown, isChannelFailure, signalChannel, useDownChannels } from '@/lib/channelStatus';
import LiveLayoutChooser from '@/components/livetv/LiveLayoutChooser';
import { recordChannelWatch } from '@/lib/watchHistory';
import { kidsAllowsChannel, kidsLevel } from '@/lib/kidsFilter';
import { onMediaKey } from '@/lib/mediaKeys';
import {
  demoGetLiveCategories,
  demoGetLiveStreams,
  demoGetShortEpg,
} from '@/lib/xtreamDemo';

const VideoPlayer = lazy(() => import('./VideoPlayer'));
const ReportChannelDialog = lazy(() => import('./ReportChannelDialog'));

const NATIVE_PLAYBACK = hasNativePlayer();
// Demo latch (?demo=1) — canned lineup, no provider contact, no <video> mount.
const DEMO = isDemo();
// Demo call-site swap (Plex pattern): fixtures answer every read in demo.
const fetchLiveCategories = DEMO ? demoGetLiveCategories : getLiveCategories;
const fetchLiveStreams = DEMO ? demoGetLiveStreams : getLiveStreams;
const fetchShortEpg = DEMO ? demoGetShortEpg : getShortEpg;


interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
  onBack: () => void;
  onNavigate?: (view: string) => void;
}


type Pane = 'categories' | 'channels';
const FAV_ID = '__favorites__';
const ALL_ID = '__all__';
// Slot height per layout. The row inside must match (see ChannelRow): the
// D-pad scroll math below is written against the slot, never measured.
//   classic: the 80px row in an 84px slot · compact: 56px in 60px ·
//   grid: a row of GRID_COLS tiles, 168px tall in a 176px slot.
const rowHeightFor = (l: LiveLayout): number => (l === 'classic' ? 84 : l === 'grid' ? 176 : 60);
const GRID_COLS = 5;
const CAT_ROW_HEIGHT = 48; // px — matches py-2.5 + text-sm + 4px vertical gap (space-y-1)
const CAT_FOCUS_PAD = 8;   // px — breathing room so the focus ring is never flush to the pane edge
const EPG_MAX_CONCURRENT = 5;
const EPG_CACHE_MAX = 400;
// Cloud favourites pulls, per line, shared across Live TV visits.
const FAV_PULL_FRESH_MS = 10 * 60_000;
const WATCH_RECORD_DWELL_MS = 6000;
// A pull that came back empty-handed (offline looks the same as "nothing
// new") is retried sooner.
const FAV_PULL_EMPTY_RETRY_MS = 2 * 60_000;
const _favPulls = new Map<string, { at: number; done: boolean; got: boolean; p: Promise<Map<number, FavChannel> | null> }>();
const EPG_TTL_MS = 15 * 60_000;
const PREVIEW_DEBOUNCE_MS = 700;

const formatTime = (ms?: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** One row of the category pane: a service header, Favorites, All, or a category — always with the line it belongs to. */
interface CatEntry {
  id: string;
  name: string;
  count?: number;
  isFav?: boolean;
  isAll?: boolean;
  isHeader?: boolean;
  collapsedHeader?: boolean;
  line: XtreamCreds;
  lineKey: string;
  catId?: string;
}
const EMPTY_COUNTS: CatalogCounts = { total: null, byCat: {}, at: 0 };
const EMPTY_FAVS: Map<number, FavChannel> = new Map();
const favKey = (f: { stream_id: number; name: string }) => f.name.trim().toLowerCase();
const toFav = (s: XtreamLiveStream): FavChannel => ({
  stream_id: s.stream_id,
  name: s.name,
  num: s.num,
  stream_icon: s.stream_icon,
  category_id: s.category_id,
  epg_channel_id: s.epg_channel_id,
});

const favToStream = (f: FavChannel): XtreamLiveStream => ({
  stream_id: f.stream_id,
  name: f.name,
  num: f.num,
  stream_icon: f.stream_icon,
  category_id: f.category_id,
  epg_channel_id: f.epg_channel_id,
});

const LiveSection = memo(({ creds, isActive, onExitLeft, onExitUp, onBack: _onBack, onNavigate }: Props) => {
  // ── every signed-in line, in one pane ──────────────────────────────────
  // The active line (`creds`) drives Movies, Series and the account screen;
  // here it is simply first. Every other saved account follows as its own
  // group, so a viewer with two services scrolls one list instead of
  // switching accounts.
  const [lines, setLines] = useState<XtreamCreds[]>(() => [creds]);
  const linesSettledRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const saved = DEMO ? [] : await loadSavedAccounts().catch(() => []);
      if (!cancelled) { linesSettledRef.current = true; setLines(buildLines(creds, saved)); }
    };
    void load();
    window.addEventListener(SAVED_ACCOUNTS_REFRESH_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(SAVED_ACCOUNTS_REFRESH_EVENT, load); };
  }, [creds]);
  const grouped = lines.length > 1;
  const activeKey = lineKey(creds);

  // Folded groups, remembered on the box.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsedLines());
  const toggleCollapsed = useCallback((k: string) => {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      saveCollapsedLines(n);
      try { trackEvent('live_group_toggle', 'player', { collapsed: n.has(k) }); } catch { /* ignore */ }
      return n;
    });
  }, []);

  // Categories the viewer hid from Settings → Hide Categories, per line.
  const [hidden, setHidden] = useState<Map<string, Set<string>>>(new Map());
  useEffect(() => {
    const read = () => setHidden(new Map(lines.map((l) => [lineKey(l), loadHiddenCategories(lineKey(l))])));
    read();
    window.addEventListener(HIDDEN_CATEGORIES_EVENT, read);
    return () => window.removeEventListener(HIDDEN_CATEGORIES_EVENT, read);
  }, [lines]);

  // Which line a stream came from. Every list is tagged as it arrives, so
  // playback, EPG and favourites resolve the right service without guessing.
  const streamLineRef = useRef(new WeakMap<object, XtreamCreds>());
  const tagLine = useCallback((list: XtreamLiveStream[], line: XtreamCreds) => {
    for (const st of list) streamLineRef.current.set(st, line);
    return list;
  }, []);
  const lineFor = useCallback(
    (st: XtreamLiveStream | FavChannel | null | undefined): XtreamCreds => (st && streamLineRef.current.get(st)) || creds,
    [creds],
  );

  const [categoriesByLine, setCategoriesByLine] = useState<Map<string, XtreamCategory[]>>(new Map());
  const [catsLoading, setCatsLoading] = useState<Set<string>>(new Set());
  const categoriesLoading = catsLoading.size > 0;
  /** The active line's categories — what the weekly count and the first-focus rule look at. */
  const categories = categoriesByLine.get(activeKey) ?? [];

  // Per-category lazy cache. Key is category_id (or ALL_ID for the explicit
  // "All channels" bucket). Favorites are NOT in here — they render from
  // persisted FavChannel metadata.
  const [streamsByCat, setStreamsByCat] = useState<Map<string, XtreamLiveStream[]>>(new Map());
  const [loadingCat, setLoadingCat] = useState<string | null>(null);

  // How many channels this line's service carries, remembered between
  // launches. Every list that arrives feeds it; the badges read from it, so a
  // category the viewer has not opened this session still shows its size.
  const [countsByLine, setCountsByLine] = useState<Map<string, CatalogCounts>>(new Map());
  useEffect(() => { setCountsByLine(new Map(lines.map((l) => [lineKey(l), readCounts(l, 'live')]))); }, [lines]);
  const noteCountsFor = useCallback((line: XtreamCreds, patch: { total?: number; byCat?: Record<string, number> }) => {
    const next = recordCounts(line, 'live', patch);
    setCountsByLine((prev) => new Map(prev).set(lineKey(line), next));
  }, []);
  const counts = countsByLine.get(activeKey) ?? EMPTY_COUNTS;
  const noteCounts = useCallback((patch: { total?: number; byCat?: Record<string, number> }) => noteCountsFor(creds, patch), [creds, noteCountsFor]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // The list filters once typing pauses: each keystroke scanned every name in
  // every line's full line-up (30k+ strings) on the main thread.
  const [searchQ, setSearchQ] = useState('');
  useEffect(() => {
    if (!searchQuery) { setSearchQ(''); return; }
    const t = window.setTimeout(() => setSearchQ(searchQuery), 150);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  // Favourites, one list per line. The active line's list is the local store;
  // every other line's lives in its stash (favoritesSync routes both). Read
  // through the router from the first frame: on a profile's first visit the
  // local store is still the last profile's list until the effect below
  // switches it, and a Kids profile must not flash the grown-up's channels.
  const [favsByLine, setFavsByLine] = useState<Map<string, Map<number, FavChannel>>>(
    () => new Map([[activeKey, loadFavoritesForLine(creds)]]),
  );
  const favoritesOf = useCallback((line: XtreamCreds) => favsByLine.get(lineKey(line)) ?? EMPTY_FAVS, [favsByLine]);
  const isFav = useCallback((st: XtreamLiveStream | FavChannel | null | undefined) => !!st && favoritesOf(lineFor(st)).has(st.stream_id), [favoritesOf, lineFor]);
  // A list the cloud settled on (conflict merge, or another device's newer
  // copy). Saved and shown, but NOT marked as a local change — it came from
  // the server, so pushing it back would be a no-op at best.
  const adoptFavoritesFor = useCallback((line: XtreamCreds, m: Map<number, FavChannel>) => {
    saveFavoritesForLine(line, m);
    setFavsByLine((prev) => new Map(prev).set(lineKey(line), m));
  }, []);
  const commitFavorites = useCallback((line: XtreamCreds, n: Map<number, FavChannel>) => {
    // Local first, cloud second: the list is already saved, so a failed push
    // loses nothing on this device. Debounced. If the push finds another
    // device wrote first, the merged list comes back through adoptFavoritesFor.
    saveFavoritesForLine(line, n);
    scheduleFavoritesPushForLine(line, n, (m) => adoptFavoritesFor(line, m));
  }, [adoptFavoritesFor]);
  const toggleFavorite = useCallback((ch: XtreamLiveStream | FavChannel) => {
    const line = lineFor(ch);
    setFavsByLine((prev) => {
      const n = new Map(prev.get(lineKey(line)) ?? EMPTY_FAVS);
      if (n.has(ch.stream_id)) n.delete(ch.stream_id);
      else n.set(ch.stream_id, {
        stream_id: ch.stream_id,
        name: ch.name,
        num: (ch as XtreamLiveStream).num,
        stream_icon: ch.stream_icon,
        category_id: ch.category_id,
        epg_channel_id: (ch as XtreamLiveStream).epg_channel_id,
      });
      commitFavorites(line, n);
      return new Map(prev).set(lineKey(line), n);
    });
  }, [lineFor, commitFavorites]);

  /**
   * A favourite that no longer plays is usually one the provider re-linked:
   * the channel is still there under the same name, with a new stream id.
   * Whenever a list arrives, every favourite of that line whose id is gone
   * from it but whose name is in it is re-pointed at the current stream —
   * and saved and pushed, so the fix reaches the cloud and other boxes. A
   * partial (per-category) list only judges favourites of that category.
   */
  const healFavorites = useCallback((line: XtreamCreds, list: XtreamLiveStream[], catId: string | null) => {
    setFavsByLine((prev) => {
      const cur = prev.get(lineKey(line));
      if (!cur || cur.size === 0 || list.length === 0) return prev;
      const ids = new Set(list.map((st) => st.stream_id));
      const byName = new Map<string, XtreamLiveStream>();
      for (const st of list) { const k = favKey(st); if (!byName.has(k)) byName.set(k, st); }
      const n = new Map(cur);
      let changed = 0;
      for (const f of cur.values()) {
        if (ids.has(f.stream_id)) continue;
        if (catId && f.category_id && String(f.category_id) !== catId) continue;
        const hit = byName.get(favKey(f));
        if (!hit || n.has(hit.stream_id)) continue;
        n.delete(f.stream_id);
        n.set(hit.stream_id, toFav(hit));
        changed++;
      }
      if (!changed) return prev;
      try { trackEvent('favorite_relinked', 'player', { service: line.serverLabel ?? null, count: changed, how: 'auto' }); } catch { /* ignore */ }
      commitFavorites(line, n);
      return new Map(prev).set(lineKey(line), n);
    });
  }, [commitFavorites]);

  /** Hold OK on a favourite → "Refresh channel link": the same re-point, on demand, for one channel. */
  const refreshFavorite = useCallback(async (f: XtreamLiveStream | FavChannel): Promise<'fixed' | 'same' | 'missing' | 'failed'> => {
    const line = lineFor(f);
    try {
      const catId = f.category_id ? String(f.category_id) : undefined;
      // A genuinely fresh copy, not the list kept from earlier in the visit.
      if (catId) forgetLiveStreams(line, catId);
      const inCat = catId ? await fetchLiveStreams(line, catId) : [];
      tagLine(inCat, line);
      let list = inCat;
      let hit = list.find((st) => st.stream_id === f.stream_id) ? null : list.find((st) => favKey(st) === favKey(f));
      if (list.some((st) => st.stream_id === f.stream_id)) return 'same';
      if (!hit) {
        forgetLiveStreams(line);
        list = tagLine(await fetchLiveStreams(line), line);
        if (list.some((st) => st.stream_id === f.stream_id)) return 'same';
        hit = list.find((st) => favKey(st) === favKey(f)) ?? null;
      }
      if (!hit) return 'missing';
      const found = hit;
      setFavsByLine((prev) => {
        const n = new Map(prev.get(lineKey(line)) ?? EMPTY_FAVS);
        n.delete(f.stream_id);
        n.set(found.stream_id, toFav(found));
        commitFavorites(line, n);
        return new Map(prev).set(lineKey(line), n);
      });
      // The list this favourite came from is stale too: drop it so it refetches.
      setStreamsByCat((prev) => { const n = new Map(prev); for (const k of n.keys()) if (k.startsWith(lineKey(line) + '|')) n.delete(k); return n; });
      try { trackEvent('favorite_relinked', 'player', { service: line.serverLabel ?? null, count: 1, how: 'manual' }); } catch { /* ignore */ }
      return 'fixed';
    } catch {
      return 'failed';
    }
  }, [lineFor, tagLine, commitFavorites]);

  // Pull the cloud copy of every line once per sign-in and reconcile it with
  // what this device has (favoritesSync.ts owns the rule). Keyed on the set
  // of lines, not on the creds objects, so a re-render with equal objects
  // does not re-pull. A pending push is flushed on unmount so a toggle made
  // just before leaving the screen is not lost.
  const linesKey = lines.map((l) => lineKey(l)).join(',');
  useEffect(() => {
    let cancelled = false;
    // FIRST, synchronously: make the local store the active line's. If the
    // user just switched accounts, the previous line's favourites are stashed
    // and this line's come back before any network call.
    const switched = prepareLocalForLine(creds, loadFavoritesData());
    const initial = new Map<string, Map<number, FavChannel>>();
    for (const line of lines) {
      const k = lineKey(line);
      initial.set(k, k === activeKey ? (switched ?? loadFavoritesData()) : loadFavoritesForLine(line));
    }
    setFavsByLine(initial);
    // THEN the cloud, line by line. The local list is passed as a GETTER so it
    // is read after the pull resolves — a toggle made during the round-trip
    // is merged, not overwritten.
    // Once per line every 10 minutes, not on every return to Live TV; a pull
    // already on its way (the saved accounts arriving re-runs this) is shared.
    for (const line of lines) {
      const k = lineKey(line);
      const prev = _favPulls.get(k);
      let p: Promise<Map<number, FavChannel> | null>;
      if (prev && !prev.done) p = prev.p;
      else if (prev && Date.now() - prev.at < (prev.got ? FAV_PULL_FRESH_MS : FAV_PULL_EMPTY_RETRY_MS)) continue;
      else {
        const entry = { at: Date.now(), done: false, got: false, p: reconcileFavoritesForLine(line, () => loadFavoritesForLine(line)) };
        entry.p.then((next) => { entry.done = true; entry.got = !!next; }, () => { _favPulls.delete(k); });
        _favPulls.set(k, entry);
        p = entry.p;
      }
      void p.then((next) => {
        if (cancelled || !next) return;
        adoptFavoritesFor(line, next);
      }, () => { /* offline: local favourites stand */ });
    }
    return () => { cancelled = true; flushFavoritesPush(); };
  }, [linesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [volume, setVolume] = useState<number>(() => loadPlayerVolume());
  useEffect(() => { savePlayerVolume(volume); }, [volume]);
  // "Vol NN%" pill (shown while the bar is hidden) only lingers 3 s after a change.
  const [volPillShown] = useTransientVisible(3000, { watchKeys: false, deps: [volume], initial: false });

  const [pane, setPane] = useState<Pane>('categories');
  // Start on Favorites (0). A separate effect bumps to the first REAL category
  // (index 2) once categories arrive, but only if the user hasn't moved yet.
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [channelIdx, setChannelIdx] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchFocusedRef = useRef(searchFocused);
  useEffect(() => { searchFocusedRef.current = searchFocused; }, [searchFocused]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);



  // Tracks whether the user has explicitly moved category focus.
  const userMovedRef = useRef(false);
  // "All channels" loads ~12K rows — never auto-load. Only fetch when the
  // user explicitly opens that bucket (Enter / click).
  const allOptedInRef = useRef(false);

  const [playingChannelId, setPlayingChannelId] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // "Report a problem" dialog — owns the keyboard while open.
  const [reportFor, setReportFor] = useState<XtreamLiveStream | null>(null);
  const reportForRef = useRef<XtreamLiveStream | null>(null);
  useEffect(() => { reportForRef.current = reportFor; }, [reportFor]);
  // D-pad long-press (hold OK ~600ms) on a focused channel → open report.
  const enterTimerRef = useRef<number | null>(null);
  const enterFiredRef = useRef(false);
  const cancelEnterTimer = useCallback(() => {
    if (enterTimerRef.current) { window.clearTimeout(enterTimerRef.current); enterTimerRef.current = null; }
  }, []);



  // --- Fullscreen control bar (TiviMate-style) ---
  const videoControllerRef = useRef<VideoController | null>(null);
  const [barVisible, setBarVisible] = useState(true);
  const [barFocus, setBarFocus] = useState<BarControlId>('play');
  const [isPaused, setIsPaused] = useState(false);
  const [subMenuOpen, setSubMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [volMenuOpen, setVolMenuOpen] = useState(false);
  const [subMenuFocus, setSubMenuFocus] = useState(-1); // -1 = Off
  const [audioMenuFocus, setAudioMenuFocus] = useState(0);
  // Slow-connection hint: set after ~25s of CONTINUOUS native buffering.
  const [slowConn, setSlowConn] = useState(false);
  const [tracksTick, setTracksTick] = useState(0);
  const barHideTimerRef = useRef<number | null>(null);
  const pokeBar = useCallback(() => {
    setBarVisible(true);
    if (barHideTimerRef.current) window.clearTimeout(barHideTimerRef.current);
    barHideTimerRef.current = window.setTimeout(() => {
      setBarVisible(false);
      setSubMenuOpen(false);
      setAudioMenuOpen(false);
      setVolMenuOpen(false);
    }, 5000) as unknown as number;
  }, []);
  const hideBarNow = useCallback(() => {
    if (barHideTimerRef.current) { window.clearTimeout(barHideTimerRef.current); barHideTimerRef.current = null; }
    setBarVisible(false);
    setSubMenuOpen(false);
    setAudioMenuOpen(false);
    setVolMenuOpen(false);
  }, []);
  // Reset bar state when entering fullscreen or switching channel.
  useEffect(() => {
    if (!fullscreen) return;
    setBarFocus('play');
    setSubMenuOpen(false);
    setAudioMenuOpen(false);
    setVolMenuOpen(false);
    pokeBar();
    return () => {
      if (barHideTimerRef.current) { window.clearTimeout(barHideTimerRef.current); barHideTimerRef.current = null; }
    };
  }, [fullscreen, playingChannelId, pokeBar]);

  // EPG, keyed by line AND stream: two services can reuse a stream id.
  const epgCacheRef = useRef<Map<string, EpgNowNext>>(new Map());
  const epgPendingRef = useRef<Set<string>>(new Set());
  const epgQueueRef = useRef<{ key: string; line: XtreamCreds; id: number }[]>([]);
  const epgInFlightRef = useRef(0);
  const [, forceEpgTick] = useState(0);

  // Refresh tick — bumped on the global 'xtream:refresh' event so we refetch
  // categories AND invalidate the per-category channel cache. We do NOT
  // eagerly fetch every category (that's the ~12K freeze bug) — the per-cat
  // useEffect below naturally refetches the currently visible category once
  // its entry is gone from streamsByCat.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const onRefresh = () => {
      setStreamsByCat(new Map());
      setAllByLine(new Map());
      allOptedInRef.current = false;
      // The line-ups may have grown or shrunk: measure them again.
      setCountsByLine(new Map(lines.map((l) => [lineKey(l), expireCounts(l, 'live')])));
      countedRef.current = false;
      setRefreshTick(t => t + 1);
    };
    window.addEventListener(XTREAM_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(XTREAM_REFRESH_EVENT, onRefresh);
  }, [lines]);

  // 1) Load every line's categories on mount + on every refresh tick.
  useEffect(() => {
    let cancelled = false;
    setCatsLoading(new Set(lines.map((l) => lineKey(l))));
    for (const line of lines) {
      const k = lineKey(line);
      fetchLiveCategories(line).catch(() => [] as XtreamCategory[]).then((cats) => {
        if (cancelled) return;
        setCategoriesByLine((prev) => new Map(prev).set(k, cats));
        setCatsLoading((prev) => { const n = new Set(prev); n.delete(k); return n; });
      });
    }
    return () => { cancelled = true; };
  }, [lines, refreshTick]);

  // Build the pane: per line, [service header when there is more than one
  // line], Favorites, All channels, then that line's categories minus the
  // hidden ones. A folded group shows only its header.
  const visibleCategories = useMemo<CatEntry[]>(() => {
    const out: CatEntry[] = [];
    for (const line of lines) {
      const k = lineKey(line);
      if (grouped) out.push({ id: `${k}|__hdr__`, name: lineLabel(line), isHeader: true, collapsedHeader: collapsed.has(k), line, lineKey: k });
      if (grouped && collapsed.has(k)) continue;
      out.push({ id: `${k}|${FAV_ID}`, name: 'Favorites', count: favsByLine.get(k)?.size ?? 0, isFav: true, line, lineKey: k });
      // The whole service, so the viewer can see how many channels they have
      // without opening anything. Measured, not promised: no number shows
      // until a list has actually been counted.
      const cnt = countsByLine.get(k);
      const allId = `${k}|${ALL_ID}`;
      out.push({ id: allId, name: 'All channels', isAll: true, count: streamsByCat.get(allId)?.length ?? cnt?.total ?? undefined, line, lineKey: k });
      const hid = hidden.get(k);
      for (const c of categoriesByLine.get(k) ?? []) {
        const catId = String(c.category_id);
        if (hid?.has(catId)) continue;
        const id = `${k}|${catId}`;
        const cached = streamsByCat.get(id);
        out.push({ id, name: c.category_name, count: cached ? cached.length : cnt?.byCat[catId], line, lineKey: k, catId });
      }
    }
    return out;
  }, [lines, grouped, collapsed, favsByLine, countsByLine, streamsByCat, hidden, categoriesByLine]);

  // Clamp focus when the list shrinks. Once real categories have arrived,
  // land on the first real category of the first group iff the user hasn't
  // moved focus yet.
  const firstRealIdx = useMemo(
    () => visibleCategories.findIndex((c) => !c.isHeader && !c.isFav && !c.isAll),
    [visibleCategories],
  );
  useEffect(() => {
    if (visibleCategories.length === 0) return;
    if (categoryIdx >= visibleCategories.length) {
      setCategoryIdx(visibleCategories.length - 1);
      return;
    }
    if (categories.length > 0 && !userMovedRef.current && firstRealIdx > 0 && categoryIdx < firstRealIdx) {
      setCategoryIdx(firstRealIdx);
    }
  }, [visibleCategories.length, categoryIdx, categories.length, firstRealIdx]);

  const currentCat: CatEntry | undefined = visibleCategories[categoryIdx];

  // 2) Lazy-load the focused category's channels, from its own line.
  //    - Skip headers and Favorites (rendered from metadata cache).
  //    - "All channels" is STRICTLY opt-in: never auto-fetch on focus.
  //    - Only once focus settles (250 ms) — or at once when the viewer opens
  //      it. Holding ▼ through the categories used to download and parse the
  //      list of every category passed, all at the same time.
  //    Keyed on the category's id rather than the entry object, which is
  //    rebuilt whenever any list, count or favourite changes.
  const currentCatRef = useRef(currentCat);
  currentCatRef.current = currentCat;
  const catFetchKey = currentCat && !currentCat.isHeader && !currentCat.isFav
    && (!currentCat.isAll || allOptedInRef.current) && !streamsByCat.has(currentCat.id)
    ? currentCat.id : null;
  const openedNow = pane === 'channels';
  useEffect(() => {
    const cat = currentCatRef.current;
    if (!catFetchKey || !cat || cat.id !== catFetchKey) return;
    let cancelled = false;
    const key = cat.id;
    const line = cat.line;
    const catId = cat.catId;
    const isAll = !!cat.isAll;
    setLoadingCat(key);
    const start = () => {
      const fetchPromise = isAll
        ? fetchLiveStreams(line)
        : fetchLiveStreams(line, catId);
      fetchPromise
        .then((list) => {
          if (cancelled) return;
          tagLine(list, line);
          setStreamsByCat(prev => {
            const n = new Map(prev);
            n.set(key, list);
            return n;
          });
          // A list in hand is a free measurement, and a chance to re-link
          // favourites the provider moved.
          if (isAll) noteCountsFor(line, { total: list.length, byCat: tallyByCategory(list) });
          else if (catId) noteCountsFor(line, { byCat: { [catId]: list.length } });
          healFavorites(line, list, isAll ? null : (catId ?? null));
        })
        .catch(() => {
          if (cancelled) return;
          setStreamsByCat(prev => {
            const n = new Map(prev);
            n.set(key, []);
            return n;
          });
        })
        .finally(() => {
          if (cancelled) return;
          setLoadingCat(prev => (prev === key ? null : prev));
        });
    };
    const t = window.setTimeout(start, openedNow ? 0 : 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      // Passed over: no spinner left behind on it.
      setLoadingCat(prev => (prev === key ? null : prev));
    };
    // refreshTick: "Update Channels" while this category is loading must drop
    // the old answer and ask again under the new nonce.
  }, [catFetchKey, openedNow, refreshTick, noteCountsFor, tagLine, healFavorites]);

  // Full-catalog channel lists, one per line, fetched lazily ONLY when search
  // is opened. Search runs across every line.
  const [allByLine, setAllByLine] = useState<Map<string, XtreamLiveStream[]>>(new Map());
  const [allChannelsLoading, setAllChannelsLoading] = useState(false);
  // Lines whose full list is on its way, kept in a ref: gating on the state
  // re-ran this effect, whose cleanup then cancelled the very fetch it had
  // just started, so search never got its results.
  const allLoadingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!searchOpen) return;
    const missing = lines.filter((l) => !allByLine.has(lineKey(l)) && !allLoadingRef.current.has(lineKey(l)));
    if (!missing.length) return;
    for (const l of missing) allLoadingRef.current.add(lineKey(l));
    setAllChannelsLoading(true);
    void Promise.all(missing.map((line) =>
      fetchLiveStreams(line)
        .then((list) => {
          tagLine(list, line);
          noteCountsFor(line, { total: list.length, byCat: tallyByCategory(list) });
          healFavorites(line, list, null);
          return [lineKey(line), list] as const;
        })
        .catch(() => [lineKey(line), [] as XtreamLiveStream[]] as const)))
      .then((pairs) => {
        setAllByLine((prev) => { const n = new Map(prev); for (const [k, list] of pairs) n.set(k, list); return n; });
      })
      .finally(() => {
        for (const l of missing) allLoadingRef.current.delete(lineKey(l));
        if (allLoadingRef.current.size === 0) setAllChannelsLoading(false);
      });
  }, [searchOpen, lines, allByLine, noteCountsFor, tagLine, healFavorites]);

  // The number next to "All channels" is the size of the whole service, and
  // the panel has no count call — so the line-up is measured once a week, on
  // an idle frame, and only the numbers are kept (countLiveStreams drops the
  // list instead of caching it). Never while something is playing, and never
  // on a box already short of memory: there the badges still fill in from
  // whatever the viewer opens.
  const countedRef = useRef(false);
  // Only leaving Live TV throws a finished count away. It used to be dropped
  // whenever `counts` changed — and the first category list to arrive always
  // changes it — so the full line-up was downloaded and then discarded.
  const countMountedRef = useRef(true);
  useEffect(() => () => { countMountedRef.current = false; }, []);
  const countsFresh = countsAreFresh(counts);
  useEffect(() => {
    if (!isActive || countedRef.current) return;
    if (categoriesLoading || categories.length === 0) return;
    if (countsFresh) return;
    if (playingChannelId || fullscreen || isPlaybackQuiet()) return;
    if (isLowMemoryBox()) return;
    // A real 8 s wait (runWhenIdle's number is only an upper bound).
    return runAfter(8000, () => {
      // Playback or a preview may have started during the wait — quiet mode
      // is on for any player, ours or Multi-Screen — in which case the count
      // can wait for another visit.
      if (isPlaybackQuiet() || (NATIVE_PLAYBACK && previewChannelRef.current)) return;
      countedRef.current = true;
      countLiveStreams(creds)
        .then(({ total, byCat }) => { if (countMountedRef.current) noteCounts({ total, byCat }); })
        .catch(() => { countedRef.current = false; });
    });
  }, [isActive, categoriesLoading, categories.length, countsFresh, playingChannelId, fullscreen, creds, noteCounts]);

  // Resolve channel list for the focused category / favorites / search.
  const visibleChannels: XtreamLiveStream[] = useMemo(() => {
    if (searchOpen) {
      const q = searchQ.trim().toLowerCase();
      if (!q) return [];
      const out: XtreamLiveStream[] = [];
      for (const line of lines) {
        const src = allByLine.get(lineKey(line)) || [];
        for (const s of src) {
          if (out.length >= 500) break;
          if (s.name.toLowerCase().includes(q)) out.push(s);
        }
        if (out.length >= 500) break;
      }
      return out;
    }
    if (!currentCat || currentCat.isHeader) return [];
    if (currentCat.isFav) {
      const favs = favsByLine.get(currentCat.lineKey) ?? EMPTY_FAVS;
      return [...favs.values()].map((f) => {
        const st = favToStream(f);
        streamLineRef.current.set(st, currentCat.line);
        return st;
      });
    }
    return streamsByCat.get(currentCat.id) || [];
  }, [searchOpen, searchQ, lines, allByLine, currentCat, streamsByCat, favsByLine]);

  const channelsLoading = searchOpen
    ? allChannelsLoading
    : !!(currentCat && !currentCat.isHeader && !currentCat.isFav
        && (!currentCat.isAll || allOptedInRef.current)
        && (loadingCat === currentCat.id || !streamsByCat.has(currentCat.id)));

  // Reset channel focus whenever the visible list changes context.
  useEffect(() => { setChannelIdx(0); }, [categoryIdx, searchOpen, searchQ]);

  // The assistant's "report ESPN, it's buffering": search every line for the
  // channel, then open Report with the reason already picked. The viewer
  // presses OK to send. If nothing matches within a few seconds the search
  // stays open with the name typed, and the viewer picks from there.
  const [pendingReport, setPendingReport] = useState<ReportIntent | null>(() => peekIntent<ReportIntent>('smc-live-report', true));
  useEffect(() => { clearIntent('smc-live-report'); }, []);
  const [reportPreset, setReportPreset] = useState<{ choice?: 'Channel down' | 'Channel buffering' | 'No audio' | 'Other'; note?: string } | null>(null);
  useEffect(() => {
    if (!pendingReport || lines.length === 0) return;
    setSearchOpen(true);
    setSearchQuery(pendingReport.search);
    const giveUp = setTimeout(() => setPendingReport(null), 12000);
    return () => clearTimeout(giveUp);
  }, [pendingReport, lines.length]);
  useEffect(() => {
    if (!pendingReport || !searchOpen || searchQ !== pendingReport.search || visibleChannels.length === 0) return;
    const q = pendingReport.search.trim().toLowerCase();
    const hit = visibleChannels.find((s) => s.name.toLowerCase() === q) ?? visibleChannels[0];
    const issue = (pendingReport.issue || '').toLowerCase();
    const choice = issue.includes('buffer') ? 'Channel buffering' : issue.includes('audio') || issue.includes('sound') ? 'No audio'
      : issue.includes('down') || issue.includes('not work') || issue.includes('black') || issue.includes('load') ? 'Channel down' : 'Other';
    setPendingReport(null);
    setReportPreset({ choice, note: pendingReport.details || (choice === 'Other' ? pendingReport.issue : undefined) });
    setReportFor(hit);
  }, [pendingReport, searchOpen, searchQ, visibleChannels]);
  useEffect(() => { if (!reportFor) setReportPreset(null); }, [reportFor]);

  // Asked while Live TV is already open (the assistant, a voice command).
  useEffect(() => {
    const onReport = (e: Event) => { clearIntent('smc-live-report'); setPendingReport((e as CustomEvent<ReportIntent>).detail); };
    const onPlay = (e: Event) => { clearIntent('smc-live-play'); setPendingPlay(String((e as CustomEvent<string>).detail || '')); };
    window.addEventListener('smc:live-report', onReport);
    window.addEventListener('smc:live-play', onPlay);
    return () => { window.removeEventListener('smc:live-report', onReport); window.removeEventListener('smc:live-play', onPlay); };
  }, []);

  // "Put on ESPN": search every line for the name and play the best match
  // (favourites win a tie). Nothing close within a few seconds: the search
  // stays open with the name typed, for the viewer to pick from.
  const [pendingPlay, setPendingPlay] = useState<string | null>(() => peekIntent<string>('smc-live-play', true));
  useEffect(() => { clearIntent('smc-live-play'); }, []);
  const pendingPlaySearchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingPlay || lines.length === 0) return;
    setFullscreen(false);
    setSearchOpen(true);
    // Providers name channels "US| ESPN FHD": search on the spoken name's
    // first word, then rank the list by the whole name.
    const first = pendingPlay.trim().split(/\s+/)[0] || pendingPlay;
    pendingPlaySearchRef.current = first;
    setSearchQuery(first);
    const giveUp = setTimeout(() => {
      setPendingPlay(null);
      setSearchQuery(pendingPlay);
    }, 12000);
    return () => clearTimeout(giveUp);
  }, [pendingPlay, lines.length]);
  useEffect(() => {
    if (!pendingPlay || !searchOpen || searchQ !== pendingPlaySearchRef.current || visibleChannels.length === 0) return;
    const favIds = new Set<number>();
    for (const m of favsByLine.values()) for (const id of m.keys()) favIds.add(id);
    const hit = bestChannel(pendingPlay, visibleChannels, favIds);
    const said = pendingPlay;
    setPendingPlay(null);
    if (hit) {
      setSearchOpen(false);
      setSearchQuery('');
      playChannelRef.current(hit);
    } else {
      setSearchQuery(said);
    }
  }, [pendingPlay, searchOpen, searchQ, visibleChannels, favsByLine]);
  // Safety clamp: never let channelIdx point past the current list.
  useEffect(() => {
    if (channelIdx >= visibleChannels.length) setChannelIdx(0);
  }, [visibleChannels.length, channelIdx]);

  // Derive focused channel from a CLAMPED index so it's never out of range
  // for even a single frame between renders.
  const safeChannelIdx = visibleChannels.length
    ? Math.min(channelIdx, visibleChannels.length - 1)
    : 0;
  const focusedChannel = visibleChannels[safeChannelIdx];

  // Virtualizer
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const categoriesScrollRef = useRef<HTMLDivElement | null>(null);
  // Wrapper around the virtualized rows — sits BELOW the Search button inside
  // the same scroll container, so we must measure its offset to scroll correctly.
  const categoriesListRef = useRef<HTMLDivElement | null>(null);
  // Same reason: the channel scroll container has its own p-3 padding above
  // the virtualized rows, so scrollTop math needs the wrapper's real offset.
  const channelListRef = useRef<HTMLDivElement | null>(null);
  const layout = useLiveLayout();
  // First time in Live TV on this box: pick a look before anything else.
  const [choosingLayout, setChoosingLayout] = useState(() => !DEMO && !hasLiveLayoutChoice());
  const choosingLayoutRef = useRef(choosingLayout);
  choosingLayoutRef.current = choosingLayout;
  const cols = layout === 'grid' ? GRID_COLS : 1;
  const rowHeight = rowHeightFor(layout);
  const colsRef = useRef(cols); useEffect(() => { colsRef.current = cols; }, [cols]);
  // One virtual row per list row, or per GRID_COLS tiles in the grid.
  const rowCount = Math.ceil(visibleChannels.length / cols);
  // Stable key functions: an inline one made the virtualizer re-measure the
  // whole list on every render. Fewer spare rows on weak boxes — each one is
  // a logo decoded at full size (Chromium 66 ignores loading="lazy").
  const rowItemKey = useCallback(
    (i: number) => (cols === 1 ? (visibleChannels[i]?.stream_id ?? i) : i),
    [cols, visibleChannels],
  );
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => rowHeight,
    overscan: isFireTV() || isLowMemoryBox() ? (cols > 1 ? 1 : 2) : 8,
    getItemKey: rowItemKey,
  });
  // Switching layout changes every slot's height: drop the measurements.
  useEffect(() => { rowVirtualizer.measure(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rowHeight, cols]);

  // Virtualize the category pane too — Vibez can expose 100+ categories and
  // rendering them all caused layout thrash that interfered with D-pad
  // focus scrolling on TV/STB devices.
  const catItemKey = useCallback((i: number) => visibleCategories[i]?.id ?? i, [visibleCategories]);
  const categoryVirtualizer = useVirtualizer({
    count: visibleCategories.length,
    getScrollElement: () => categoriesScrollRef.current,
    estimateSize: () => CAT_ROW_HEIGHT,
    overscan: isFireTV() ? 4 : 10,
    getItemKey: catItemKey,
  });

  useEffect(() => {
    rowVirtualizer.scrollToOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryIdx, searchOpen, searchQ]);

  // Vertical-only "scroll focused row into view" helper.
  //
  // Why not Element.scrollIntoView({ block: 'nearest' })?
  //   Its default `inline: 'nearest'` walks UP the ancestor chain looking for
  //   ANY scrollable axis. The focused channel/category row carries the
  //   global gold focus ring (box-shadow: 0 0 0 4px gold, 0 0 22px gold/0.6).
  //   That shadow extends a few px past the pane's right edge → the browser
  //   decides the element is "not fully in view" horizontally and scrolls
  //   the next scrollable ancestor (the app's [data-app-scroll-root]) on
  //   the X axis. Visually: every other pane (including Categories) "scoots
  //   to the LEFT" each time you move focus in the channels list.
  //
  //   overflow-x: hidden on the local panes clips the *paint* but does NOT
  //   stop scrollIntoView from picking the next ancestor up. The only safe
  //   fix is to never call scrollIntoView for focus tracking — adjust the
  //   local scroll parent's scrollTop manually, vertical axis only.

  // Keep the focused channel visible in the VIRTUALIZED row list.
  //
  // Why we don't fall back to a querySelector('[data-focused="true"]') here:
  //   when the user moves to an OFFSCREEN row, that row is not yet in the
  //   DOM (it's virtualized) → querySelector returns null → no scroll
  //   happens on the same tick. Trust the virtualizer's scrollToIndex,
  //   which knows the row's offset whether or not it's mounted, and
  //   re-call it inside a rAF after measurements settle.
  useEffect(() => {
    if (!visibleChannels.length) return;
    const apply = () => {
      const node = scrollParentRef.current;
      if (!node) return;
      if (channelIdx === 0) { node.scrollTop = 0; return; }
      // The scroll container's own p-3 padding sits above the virtualized
      // rows (same issue the categories pane had — see the comment on its
      // scroll effect below). Raw `idx * rowHeight` ignores that padding, so
      // scrollTop always lands short and the newly-focused row's bottom
      // edge is left clipped below the visible pane instead of flush with
      // it. Measure the list wrapper's real offset instead.
      const listEl = channelListRef.current;
      const listOffset = listEl
        ? listEl.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop
        : 0;
      const rowTop = listOffset + Math.floor(channelIdx / cols) * rowHeight;
      const rowBottom = rowTop + rowHeight;
      if (rowTop < node.scrollTop) node.scrollTop = rowTop;
      else if (rowBottom > node.scrollTop + node.clientHeight) node.scrollTop = rowBottom - node.clientHeight;
    };

    apply();
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
    // `fullscreen`: leaving it rebuilds the list at the top; put the channel
    // you zapped to back in view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIdx, visibleChannels.length, cols, rowHeight, fullscreen]);

  // Keep the focused category visible.
  //
  // The categories scroll container also holds the Search button (+ optional
  // input) and its own `p-3` padding ABOVE the virtualizer. TanStack Virtual
  // reports every row's `start` relative to the LIST, not to the scroll
  // container, and it is not told about that header — so `scrollToIndex` and
  // raw `idx * CAT_ROW_HEIGHT` are both short by the header's height (~56px).
  // Moving down, the focused row therefore parked ~56px lower than intended
  // and slid under the bottom edge of the pane: the user could not see which
  // category was highlighted without clicking it.
  //
  // Fix: measure the list wrapper's real offset inside the scroll parent and
  // do the same vertical-only scrollTop math the channel list uses. Same
  // reason as the block above — never scrollIntoView for focus tracking.
  useEffect(() => {
    if (!visibleCategories.length || searchOpen) return;
    const apply = () => {
      const node = categoriesScrollRef.current;
      if (!node) return;
      if (categoryIdx === 0) { node.scrollTop = 0; return; }
      const listEl = categoriesListRef.current;
      // Header height = distance from the scroll container's content origin
      // down to the first virtualized row.
      const listOffset = listEl
        ? listEl.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop
        : 0;
      const rowTop = listOffset + categoryIdx * CAT_ROW_HEIGHT;
      const rowBottom = rowTop + CAT_ROW_HEIGHT;
      // Keep a little air so the gold focus ring never sits flush against the
      // pane edge — on a TV that reads as "cut off".
      if (rowTop - CAT_FOCUS_PAD < node.scrollTop) {
        node.scrollTop = Math.max(0, rowTop - CAT_FOCUS_PAD);
      } else if (rowBottom + CAT_FOCUS_PAD > node.scrollTop + node.clientHeight) {
        node.scrollTop = rowBottom + CAT_FOCUS_PAD - node.clientHeight;
      }
    };
    // Then check against what is really on screen, once the row is drawn.
    const settle = () => {
      const node = categoriesScrollRef.current;
      const el = node?.querySelector<HTMLElement>(`[data-cat-idx="${categoryIdx}"]`);
      if (node && el) keepInView(node, el, CAT_FOCUS_PAD);
    };
    apply();
    let raf2 = 0;
    const raf = requestAnimationFrame(() => { apply(); raf2 = requestAnimationFrame(settle); });
    return () => { cancelAnimationFrame(raf); cancelAnimationFrame(raf2); };
  }, [categoryIdx, visibleCategories.length, searchOpen]);

  // EPG lazy fetch with concurrency cap
  const epgKey = useCallback((st: XtreamLiveStream) => `${lineKey(lineFor(st))}:${st.stream_id}`, [lineFor]);
  const epgFor = useCallback((st: XtreamLiveStream | null | undefined) => (st ? epgCacheRef.current.get(epgKey(st)) : undefined), [epgKey]);
  // The queue only ever holds rows on screen (plus the focused channel). It
  // used to keep every row ever scrolled past and drained it to the end —
  // through fullscreen playback and after Live TV had closed — with the rows
  // actually on screen waiting behind the stale ones.
  // An answer is good until its current programme ends (15 min at most, so
  // a finished show does not sit there with a full bar); the oldest go first.
  const epgExpRef = useRef<Map<string, number>>(new Map());
  const epgAliveRef = useRef(true);
  const epgTickTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    epgAliveRef.current = false;
    epgQueueRef.current = [];
    if (epgTickTimerRef.current) window.clearTimeout(epgTickTimerRef.current);
  }, []);
  const enqueueEpg = useCallback((st: XtreamLiveStream) => {
    const key = epgKey(st);
    if (epgPendingRef.current.has(key)) return;
    if (epgCacheRef.current.has(key) && (epgExpRef.current.get(key) ?? 0) > Date.now()) return;
    epgPendingRef.current.add(key);
    epgQueueRef.current.push({ key, line: lineFor(st), id: st.stream_id });
    pumpEpg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epgKey, lineFor]);

  const pumpEpg = useCallback(() => {
    // Replies arrive in bursts; one re-render per burst, not per reply.
    const tick = () => {
      if (epgTickTimerRef.current) return;
      epgTickTimerRef.current = window.setTimeout(() => {
        epgTickTimerRef.current = null;
        if (epgAliveRef.current) forceEpgTick(t => t + 1);
      }, 150);
    };
    const put = (key: string, v: EpgNowNext) => {
      const cache = epgCacheRef.current;
      const exp = epgExpRef.current;
      cache.delete(key);
      cache.set(key, v);
      const now = Date.now();
      exp.set(key, Math.min(v.now?.end && v.now.end > now ? v.now.end : now + EPG_TTL_MS, now + EPG_TTL_MS));
      while (cache.size > EPG_CACHE_MAX) {
        const oldest = cache.keys().next().value as string;
        cache.delete(oldest);
        exp.delete(oldest);
      }
    };
    while (epgAliveRef.current && epgInFlightRef.current < EPG_MAX_CONCURRENT && epgQueueRef.current.length) {
      const { key, line, id } = epgQueueRef.current.shift()!;
      epgInFlightRef.current++;
      fetchShortEpg(line, id, 4)
        .then(res => { if (epgAliveRef.current) put(key, pickNowNext(res.epg_listings || [])); })
        .catch(() => { if (epgAliveRef.current) put(key, {}); })
        .finally(() => {
          epgInFlightRef.current--;
          epgPendingRef.current.delete(key);
          if (!epgAliveRef.current) return;
          tick();
          if (epgQueueRef.current.length) pumpEpg();
        });
    }
  }, []);

  const virtualItems = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    // In fullscreen only the channel being watched matters.
    const want: XtreamLiveStream[] = [];
    if (focusedChannel) want.push(focusedChannel);
    if (!fullscreen) {
      for (const v of virtualItems) {
        for (let c = 0; c < cols; c++) {
          const s = visibleChannels[v.index * cols + c];
          if (s) want.push(s);
        }
      }
    }
    const keys = new Set(want.map(epgKey));
    epgQueueRef.current = epgQueueRef.current.filter((q) => {
      if (keys.has(q.key)) return true;
      epgPendingRef.current.delete(q.key);
      return false;
    });
    for (const s of want) enqueueEpg(s);
  }, [virtualItems, visibleChannels, focusedChannel, enqueueEpg, epgKey, cols, fullscreen]);

  const focusedNowNext = epgFor(focusedChannel);

  // The preview box: the highlighted channel plays there on its own after a
  // short dwell, and OK on it goes full screen.
  //
  // On the APK the preview is the native ExoPlayer, drawn behind the WebView
  // and sized to the box (the way Multi-Screen tiles work) — a <video> inside
  // the WebView is black on Fire TV, which is exactly what the box showed.
  // On the web it is a muted <video>, and on boxes where even that is too
  // much for the WebView there is no preview at all.
  const [previewChannel, setPreviewChannel] = useState<XtreamLiveStream | null>(null);
  // Freeze fix: the muted always-on preview <video> saturates the WebView main
  // thread on non-Fire-TV low-RAM boxes (T95/X96/legacy WebView). Fire TV is
  // already excluded because it spawns a hardware decoder slot per <video>.
  const [previewDisabled] = useState(() =>
    NATIVE_PLAYBACK ? DEMO : (
      isFireTV()
      || DEMO // demo: no <video> may ever mount — the stream URLs are fake
      || document.documentElement.classList.contains('native-low-memory')
      || document.documentElement.classList.contains('legacy-webview')
    ),
  );
  // The Vibez (grid) layout has no preview box, so it never starts a preview
  // stream: OK plays full screen. It used to open one behind the logo wall.
  const noPreview = previewDisabled || layout === 'grid';
  useEffect(() => {
    if (noPreview || !focusedChannel) { setPreviewChannel(null); return; }
    const t = window.setTimeout(() => setPreviewChannel(focusedChannel), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [focusedChannel, noPreview]);

  const previewUrl = useMemo(
    // Demo: no stream URL may ever be constructed — the host is a sentinel.
    () => (!DEMO && !NATIVE_PLAYBACK && previewChannel ? buildLiveStreamUrl(lineFor(previewChannel), previewChannel.stream_id) : null),
    [previewChannel, lineFor],
  );

  // Where the preview box is on screen, for the native player. Measured
  // whenever the box mounts or moves; null while there is no box (Grid, or
  // fullscreen, where the box is not rendered).
  const [previewRect, setPreviewRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const previewBoxRef = useCallback((el: HTMLDivElement | null) => {
    if (!NATIVE_PLAYBACK) return;
    if (previewObserverRef.current) { previewObserverRef.current.disconnect(); previewObserverRef.current = null; }
    if (!el) { setPreviewRect(null); return; }
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { x: r.left, y: r.top, width: r.width, height: r.height };
      setPreviewRect((prev) =>
        prev && Math.abs(prev.x - next.x) < 1 && Math.abs(prev.y - next.y) < 1
          && Math.abs(prev.width - next.width) < 1 && Math.abs(prev.height - next.height) < 1
          ? prev : next);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      previewObserverRef.current = ro;
    }
  }, []);
  const previewObserverRef = useRef<ResizeObserver | null>(null);

  // The line the playing channel belongs to. Set with the channel, never
  // derived later: the list it came from may have been dropped by then.
  const [playingLine, setPlayingLine] = useState<XtreamCreds>(creds);
  const streamUrl = useMemo(() => {
    if (DEMO || !playingChannelId) return null;
    return buildLiveStreamUrl(playingLine, playingChannelId);
  }, [playingChannelId, playingLine]);

  const previewChannelRef = useRef(previewChannel);
  useEffect(() => { previewChannelRef.current = previewChannel; }, [previewChannel]);

  const lastPlayRef = useRef<{ id: number; ts: number } | null>(null);
  const watchRecordTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (watchRecordTimerRef.current) window.clearTimeout(watchRecordTimerRef.current); }, []);
  // What is on screen right now, for the watch timer below.
  const watchingRef = useRef<{ channel: string; category: string } | null>(null);
  const playChannel = useCallback((stream: XtreamLiveStream) => {
    const line = lineFor(stream);
    setPlayingLine(line);
    setPlayingChannelId(stream.stream_id);
    setFullscreen(true);
    // Fire-and-forget analytics — dedupe rapid replays of same channel (<10s).
    // Demo visitors must never appear in real stats.
    if (DEMO) return;
    try {
      const now = Date.now();
      const last = lastPlayRef.current;
      if (!last || last.id !== stream.stream_id || now - last.ts > 10_000) {
        lastPlayRef.current = { id: stream.stream_id, ts: now };
        const catName = visibleCategories.find(c => c.id === (currentCat?.id ?? ''))?.name
          ?? currentCat?.name ?? '';
        watchingRef.current = { channel: stream.name, category: catName };
        // Into history only once it has stayed on screen: zapping through
        // twenty channels was twenty storage rewrites and cloud upserts,
        // each landing while the next stream was starting.
        if (watchRecordTimerRef.current) window.clearTimeout(watchRecordTimerRef.current);
        watchRecordTimerRef.current = window.setTimeout(() => {
          watchRecordTimerRef.current = null;
          try { recordChannelWatch(stream, line, catName); } catch { /* ignore */ }
        }, WATCH_RECORD_DWELL_MS);
        trackEvent('channel_play', 'player', {
          channel: stream.name,
          category: catName,
          server: line.serverLabel,
        });
      }
    } catch { /* ignore */ }
  }, [visibleCategories, currentCat, lineFor]);

  // OK on a channel goes full screen; the preview box already shows it.
  const activateChannel = useCallback((stream: XtreamLiveStream) => {
    playChannel(stream);
  }, [playChannel]);
  const activateChannelRef = useRef(activateChannel);
  useEffect(() => { activateChannelRef.current = activateChannel; }, [activateChannel]);

  // A channel chosen on the content bar (or Game Day, or a kickoff
  // reminder): play it as soon as its line is known. The payload is consumed
  // once; a line no longer signed in here is simply ignored and the section
  // opens as usual. 'smc:live-deeplink' asks again while Live TV is open.
  // Game Day can also hand over a category ({openCategory}): it opens once
  // the line's categories are listed. A Kids profile plays only a channel
  // its own line-up has, whoever set the reminder that asked.
  const playChannelRef = useRef(playChannel);
  useEffect(() => { playChannelRef.current = playChannel; }, [playChannel]);
  const [deeplinkTick, setDeeplinkTick] = useState(0);
  useEffect(() => {
    const on = () => setDeeplinkTick((t) => t + 1);
    window.addEventListener('smc:live-deeplink', on);
    return () => window.removeEventListener('smc:live-deeplink', on);
  }, []);
  useEffect(() => {
    if (DEMO) return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem('smc-live-deeplink'); } catch { return; }
    if (!raw) return;
    let target: { host?: string; username?: string; streamId?: number; name?: string; icon?: string; categoryId?: string; num?: number; openCategory?: boolean } | null = null;
    try { target = JSON.parse(raw); } catch { target = null; }
    const drop = () => { try { sessionStorage.removeItem('smc-live-deeplink'); } catch { /* ignore */ } };
    if (!target?.host || !target.username || !(target.streamId || (target.openCategory && target.categoryId))) { drop(); return; }
    const line = lines.find((l) => lineKey(l) === lineKey({ host: target!.host!, username: target!.username! }));
    if (!line) {
      // The saved accounts may not have loaded yet; try again when they do.
      if (lines.length > 1 || linesSettledRef.current) drop();
      return;
    }
    if (target.openCategory) {
      const k = lineKey(line);
      const idx = visibleCategories.findIndex((c) => c.lineKey === k && c.catId === String(target!.categoryId));
      if (idx < 0) {
        // Not listed (yet): wait for this line's categories, then give up.
        if (categoriesByLine.has(k)) drop();
        return;
      }
      drop();
      userMovedRef.current = true;
      setCategoryIdx(idx);
      setChannelIdx(0);
      setPane('channels');
      return;
    }
    drop();
    const stream: XtreamLiveStream = { stream_id: target.streamId!, name: target.name ?? 'Channel', stream_icon: target.icon, category_id: target.categoryId, num: target.num };
    streamLineRef.current.set(stream, line);
    if (!kidsLevel()) { playChannelRef.current(stream); return; }
    void getLiveCategories(line)
      .then((cats) => { if (kidsAllowsChannel(stream, new Set(cats.map((c) => String(c.category_id))))) playChannelRef.current(stream); })
      .catch(() => undefined);
  }, [lines, deeplinkTick, visibleCategories, categoriesByLine]);

  // How long one channel is actually watched, and on which service. Starts
  // when a channel goes live and closes when it stops, changes or the viewer
  // leaves; a box switched off mid-stream still reports on the next launch.
  useEffect(() => {
    if (DEMO || !playingChannelId) return;
    try {
      startTimer('watch', 'channel_watch', 'player', {
        channel: watchingRef.current?.channel ?? null,
        category: watchingRef.current?.category ?? null,
        service: playingLine.serverLabel ?? null,
      });
    } catch { /* ignore */ }
    return () => { try { stopTimer('watch'); } catch { /* ignore */ } };
  }, [playingChannelId, playingLine.serverLabel]);


  // Channels other boxes see as down right now (⚠️ on the row), for the
  // lines on screen, kept fresh while Live TV has the remote. Not while a
  // channel plays full screen: no row is on screen, and the auto-'ok' below
  // works from the last list.
  const downSet = useDownChannels(lines, isActive && !fullscreen);
  const playingStreamName = (id: number): string =>
    visibleChannels.find((s) => s.stream_id === id)?.name ?? favoritesOf(playingLine).get(id)?.name ?? '';

  // Native ExoPlayer wiring — fullscreen, or the preview box while browsing.
  const nativeActive = NATIVE_PLAYBACK && fullscreen && !!playingChannelId;
  // The preview: the dwelt-on channel, in the box, while this section has
  // the remote and the box is on screen. Same player, same stream URL as
  // fullscreen, so OK on the previewing channel only moves the picture.
  const nativePreviewActive = NATIVE_PLAYBACK && !DEMO && isActive && !fullscreen && !!previewChannel;
  // Vibez (strmz.xyz) is only reliable via the raw .ts container on Fire TV —
  // the shared buildNativeLiveUrl helper always swaps .m3u8→.ts. Dreamstreams
  // works on both.
  const nativeUrl = !DEMO && nativeActive && playingChannelId
    ? buildNativeLiveUrl(playingLine, playingChannelId)
    : nativePreviewActive && previewChannel
      ? buildNativeLiveUrl(lineFor(previewChannel), previewChannel.stream_id)
      : null;
  const native = useNativePlayer({
    active: nativeActive || nativePreviewActive,
    url: nativeUrl,
    volume,
    rect: nativeActive ? undefined : previewRect,
    background: nativeActive,
    onTracksChanged: () => setTracksTick((t) => t + 1),
    onPlayStateChange: (p) => setIsPaused(p),
  });

  // Slow-connection hint — arms a 25s timer while the native player is
  // CONTINUOUSLY buffering; "ready"/playing clears buffering and the hint.
  useEffect(() => {
    if (!native.buffering) { setSlowConn(false); return; }
    const t = window.setTimeout(() => setSlowConn(true), 25000);
    return () => window.clearTimeout(t);
  }, [native.buffering]);

  // While native fullscreen owns the screen, expose its controller through
  // the existing videoControllerRef so PlayerControlBar's audio/subtitle
  // menus keep working unchanged.
  useEffect(() => {
    if (!nativeActive) return;
    if (!native.controller) return;
    videoControllerRef.current = native.controller;
    return () => { videoControllerRef.current = null; };
  }, [nativeActive, native.controller]);

  // Transparency scope — while native fullscreen is active, add a class to
  // <html> that neutralizes every painted background layer above the native
  // video surface (which renders on a TextureView BEHIND the WebView).
  useEffect(() => {
    if (!nativeActive) return;
    document.documentElement.classList.add('snowplayer-fullscreen');
    return () => { document.documentElement.classList.remove('snowplayer-fullscreen'); };
  }, [nativeActive]);
  // The preview needs the same thing for the box alone: every painted layer
  // between the page background and the box goes transparent (see
  // index.css, snowplayer-preview), and the box itself paints nothing.
  useEffect(() => {
    if (!nativePreviewActive) return;
    document.documentElement.classList.add('snowplayer-preview');
    return () => { document.documentElement.classList.remove('snowplayer-preview'); };
  }, [nativePreviewActive]);

  const changeChannelInFullscreen = useCallback((delta: 1 | -1) => {
    if (!visibleChannels.length) return;
    let i = visibleChannels.findIndex(s => s.stream_id === playingChannelId);
    if (i < 0) i = channelIdx;
    const next = (i + delta + visibleChannels.length) % visibleChannels.length;
    setChannelIdx(next);
    playChannel(visibleChannels[next]);
  }, [visibleChannels, playingChannelId, channelIdx, playChannel]);

  // Remote media buttons while a channel is full screen. A live channel can't
  // be skipped, so Fast-forward / Next go up a channel and Rewind / Previous
  // go down one; Play/Pause is handled by the player itself.
  const changeChannelRef = useRef(changeChannelInFullscreen);
  useEffect(() => { changeChannelRef.current = changeChannelInFullscreen; }, [changeChannelInFullscreen]);
  useEffect(() => {
    if (!isActive || !fullscreen) return;
    return onMediaKey((k) => {
      if (k === 'ff' || k === 'next') { changeChannelRef.current(+1); pokeBar(); }
      else if (k === 'rw' || k === 'prev') { changeChannelRef.current(-1); pokeBar(); }
      else if (k === 'playpause' || k === 'play' || k === 'pause') pokeBar();
    });
  }, [isActive, fullscreen, pokeBar]);

  // What the native player is showing: the full-screen channel, or the one
  // in the preview box.
  const nativeStream = nativeActive && playingChannelId
    ? { host: playingLine.host, id: playingChannelId, name: playingStreamName(playingChannelId) }
    : nativePreviewActive && previewChannel
      ? { host: lineFor(previewChannel).host, id: previewChannel.stream_id, name: previewChannel.name }
      : null;
  const nativeStreamRef = useRef(nativeStream); nativeStreamRef.current = nativeStream;

  // Down channels (⚠️): a channel that won't start here tells the other
  // boxes (not when only this box's own player failed, see
  // isChannelFailure); one shown as down that plays fine for a while clears it.
  useEffect(() => {
    const st = nativeStreamRef.current;
    if (!st || !isChannelFailure(native.error)) return;
    signalChannel(st.host, st.id, st.name, 'fail');
  }, [native.error]);
  const nativeKey = nativeStream ? `${nativeStream.host}|${nativeStream.id}` : '';
  const shownDown = !!nativeStream && isChannelDown(downSet, nativeStream.host, nativeStream.id);
  useEffect(() => {
    if (!shownDown || native.buffering || native.error) return;
    const t = window.setTimeout(() => {
      const st = nativeStreamRef.current;
      if (st) signalChannel(st.host, st.id, st.name, 'ok');
    }, 12_000);
    return () => window.clearTimeout(t);
  }, [shownDown, nativeKey, native.buffering, native.error]);

  // player_error — track native player fatal error transitions.
  const lastNativeErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const msg = native.error?.message ?? null;
    if (msg && msg !== lastNativeErrorRef.current) {
      lastNativeErrorRef.current = msg;
      try {
        const ch = visibleChannels.find(s => s.stream_id === playingChannelId);
        trackEvent('player_error', 'player', {
          kind: 'live_native',
          channel_or_title: ch?.name ?? '',
          server: playingLine.serverLabel,
        });
      } catch { /* ignore */ }
    } else if (!msg) {
      lastNativeErrorRef.current = null;
    }
  }, [native.error, visibleChannels, playingChannelId, playingLine.serverLabel]);

  // Report undecodable audio per channel so the codec shows up in telemetry
  // instead of only arriving as a customer phone call.
  const lastAudioWarnRef = useRef<string | null>(null);
  useEffect(() => {
    const w = native.audioWarning;
    if (!w) { lastAudioWarnRef.current = null; return; }
    const key = `${playingChannelId}:${w.codecs}`;
    if (key === lastAudioWarnRef.current) return;
    lastAudioWarnRef.current = key;
    try {
      const ch = visibleChannels.find(s => s.stream_id === playingChannelId);
      trackEvent('audio_unsupported', 'player', {
        kind: 'live_native',
        channel_or_title: ch?.name ?? '',
        server: playingLine.serverLabel,
        codecs: w.codecs,
        ffmpeg_available: w.ffmpegAvailable,
      });
    } catch { /* ignore */ }
  }, [native.audioWarning, visibleChannels, playingChannelId, playingLine.serverLabel]);

  // (player_search intentionally NOT fired for Live TV — spec scopes it to movies/series/plex.)



  // Refs for keyboard handler
  const paneRef = useRef(pane);
  const categoryIdxRef = useRef(categoryIdx);
  const channelIdxRef = useRef(channelIdx);
  const fullscreenRef = useRef(fullscreen);
  const visibleCategoriesRef = useRef(visibleCategories);
  const visibleChannelsRef = useRef(visibleChannels);
  const searchOpenRef = useRef(searchOpen);
  const nativeErrorRef = useRef<{ code?: string; message: string } | null>(null);
  const nativeRetryRef = useRef<() => void>(() => {});
  useEffect(() => { nativeErrorRef.current = native.error; }, [native.error]);
  useEffect(() => { nativeRetryRef.current = native.retry; }, [native.retry]);
  // Bar refs so the (stable) keydown listener can read live state without rebinding.
  const barVisibleRef = useRef(barVisible);
  const barFocusRef = useRef(barFocus);
  const subMenuOpenRef = useRef(subMenuOpen);
  const audioMenuOpenRef = useRef(audioMenuOpen);
  const volMenuOpenRef = useRef(volMenuOpen);
  const subMenuFocusRef = useRef(subMenuFocus);
  const audioMenuFocusRef = useRef(audioMenuFocus);

  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { categoryIdxRef.current = categoryIdx; }, [categoryIdx]);
  useEffect(() => { channelIdxRef.current = channelIdx; }, [channelIdx]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);
  useEffect(() => { visibleCategoriesRef.current = visibleCategories; }, [visibleCategories]);
  useEffect(() => { visibleChannelsRef.current = visibleChannels; }, [visibleChannels]);
  // Stable row handlers, so ChannelRow's memo holds: inline arrows re-rendered
  // every mounted row (≈95 tiles in the grid) on every key press and EPG reply.
  const onRowSelect = useCallback((i: number) => { setChannelIdx(i); }, []);
  const onRowActivate = useCallback((i: number) => {
    setPane('channels');
    setChannelIdx(i);
    const ch = visibleChannelsRef.current[i];
    if (ch) activateChannelRef.current(ch);
  }, []);
  const onRowLongPress = useCallback((i: number) => {
    setChannelIdx(i);
    setReportFor(visibleChannelsRef.current[i] ?? null);
  }, []);
  useEffect(() => { searchOpenRef.current = searchOpen; }, [searchOpen]);
  useEffect(() => { barVisibleRef.current = barVisible; }, [barVisible]);
  useEffect(() => { barFocusRef.current = barFocus; }, [barFocus]);
  useEffect(() => { subMenuOpenRef.current = subMenuOpen; }, [subMenuOpen]);
  useEffect(() => { audioMenuOpenRef.current = audioMenuOpen; }, [audioMenuOpen]);
  useEffect(() => { volMenuOpenRef.current = volMenuOpen; }, [volMenuOpen]);
  useEffect(() => { subMenuFocusRef.current = subMenuFocus; }, [subMenuFocus]);
  useEffect(() => { audioMenuFocusRef.current = audioMenuFocus; }, [audioMenuFocus]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
     try {
      // Report dialog owns the keyboard while open.
      if (reportForRef.current) return;
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;


      // Remote "Menu" / context key — open report for the focused channel.
      // Only when on the channels pane and not fullscreen/typing.
      if (
        !fullscreenRef.current &&
        !typing &&
        paneRef.current === 'channels' &&
        (e.key === 'ContextMenu' || e.keyCode === 82)
      ) {
        const ch = visibleChannelsRef.current[channelIdxRef.current];
        if (ch) {
          e.preventDefault(); e.stopPropagation();
          cancelEnterTimer();
          enterFiredRef.current = true;
          setReportFor(ch);
          return;
        }
      }


      if (fullscreenRef.current) {
        const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
        const ctrl = videoControllerRef.current;

        // --- Sub/Audio/Volume menus take priority ---
        if (subMenuOpenRef.current || audioMenuOpenRef.current || volMenuOpenRef.current) {
          e.preventDefault(); e.stopPropagation();
          pokeBar();
          // Volume popup: ◀/▶ live-adjust in 10% steps, OK/Back closes.
          if (volMenuOpenRef.current) {
            if (isBack || e.key === 'Enter' || e.key === ' ') {
              setVolMenuOpen(false);
              return;
            }
            if (e.key === 'ArrowLeft') {
              setVolume(v => Math.max(0, +(v - 0.1).toFixed(2)));
              return;
            }
            if (e.key === 'ArrowRight') {
              setVolume(v => Math.min(1, +(v + 0.1).toFixed(2)));
              return;
            }
            return;
          }
          const isSub = subMenuOpenRef.current;
          if (isBack || e.key === 'ArrowLeft') {
            setSubMenuOpen(false); setAudioMenuOpen(false);
            return;
          }
          if (isSub) {
            const subs = ctrl?.getSubtitleTracks() ?? [];
            const min = -1; const max = subs.length - 1;
            if (e.key === 'ArrowDown') setSubMenuFocus(f => Math.min(max, f + 1));
            else if (e.key === 'ArrowUp') setSubMenuFocus(f => Math.max(min, f - 1));
            else if (e.key === 'Enter' || e.key === ' ') {
              ctrl?.setSubtitleTrack(subMenuFocusRef.current);
              setTracksTick(t => t + 1);
              setSubMenuOpen(false);
            }
          } else {
            const auds = ctrl?.getAudioTracks() ?? [];
            const max = auds.length - 1;
            if (e.key === 'ArrowDown') setAudioMenuFocus(f => Math.min(max, f + 1));
            else if (e.key === 'ArrowUp') setAudioMenuFocus(f => Math.max(0, f - 1));
            else if (e.key === 'Enter' || e.key === ' ') {
              ctrl?.setAudioTrack(audioMenuFocusRef.current);
              setTracksTick(t => t + 1);
              setAudioMenuOpen(false);
            }
          }
          return;
        }

        // --- Back ---
        if (isBack) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          if (barVisibleRef.current) { hideBarNow(); return; }
          setFullscreen(false);
          return;
        }

        // --- Native fatal-error overlay: Enter triggers retry ---
        if (nativeErrorRef.current && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault(); e.stopPropagation();
          nativeRetryRef.current();
          return;
        }

        // --- Bar is HIDDEN: preserve channel zap + volume, Enter shows bar ---
        if (!barVisibleRef.current) {
          if (e.key === 'ArrowUp')    { e.preventDefault(); changeChannelInFullscreen(-1); pokeBar(); setBarFocus('play'); return; }
          if (e.key === 'ArrowDown')  { e.preventDefault(); changeChannelInFullscreen(+1); pokeBar(); setBarFocus('play'); return; }
          if (e.key === 'ArrowLeft')  { e.preventDefault(); setVolume(v => Math.max(0, +(v - 0.05).toFixed(2))); pokeBar(); return; }
          if (e.key === 'ArrowRight') { e.preventDefault(); setVolume(v => Math.min(1, +(v + 0.05).toFixed(2))); pokeBar(); return; }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setBarFocus('play');
            pokeBar();
            return;
          }
          // Any other key — pop the bar but don't act.
          pokeBar();
          return;
        }

        // --- Bar VISIBLE: navigate the control row ---
        e.preventDefault();
        pokeBar();
        const subs = ctrl?.getSubtitleTracks() ?? [];
        const auds = ctrl?.getAudioTracks() ?? [];
        const seekable = !!ctrl?.isSeekable();
        const order: BarControlId[] = ['prev', 'rew', 'play', 'fwd', 'next', 'cc', 'audio', 'vol'];
        const isDisabled = (id: BarControlId): boolean => {
          if (id === 'rew' || id === 'fwd') return !seekable;
          if (id === 'cc') return subs.length === 0;
          if (id === 'audio') return auds.length <= 1;
          return false;
        };
        const moveFocus = (dir: 1 | -1) => {
          const cur = order.indexOf(barFocusRef.current);
          for (let step = 1; step <= order.length; step++) {
            const next = cur + dir * step;
            if (next < 0 || next >= order.length) return;
            const cand = order[next];
            if (!isDisabled(cand)) { setBarFocus(cand); return; }
          }
        };

        if (e.key === 'ArrowLeft')  { moveFocus(-1); return; }
        if (e.key === 'ArrowRight') { moveFocus(+1); return; }
        if (e.key === 'ArrowUp')    { changeChannelInFullscreen(-1); setBarFocus('play'); pokeBar(); return; }
        if (e.key === 'ArrowDown')  { changeChannelInFullscreen(+1); setBarFocus('play'); pokeBar(); return; }
        if (e.key === 'Enter' || e.key === ' ') {
          const id = barFocusRef.current;
          if (id === 'prev')  changeChannelInFullscreen(-1);
          else if (id === 'next') changeChannelInFullscreen(+1);
          else if (id === 'rew')  { ctrl?.seek(-10); }
          else if (id === 'fwd')  { ctrl?.seek(+10); }
          else if (id === 'play') {
            ctrl?.togglePlay();
            // optimistic — onPlayStateChange will reconcile
            setIsPaused(p => !p);
          }
          else if (id === 'cc') {
            const cur = subs.findIndex(s => s.active);
            setSubMenuFocus(cur >= 0 ? cur : -1);
            setSubMenuOpen(true);
            setAudioMenuOpen(false);
            setVolMenuOpen(false);
          }
          else if (id === 'audio') {
            const cur = auds.findIndex(a => a.active);
            setAudioMenuFocus(cur >= 0 ? cur : 0);
            setAudioMenuOpen(true);
            setSubMenuOpen(false);
            setVolMenuOpen(false);
          }
          else if (id === 'vol') {
            setVolMenuOpen(true);
            setSubMenuOpen(false);
            setAudioMenuOpen(false);
          }
          return;
        }
        return;
      }

      if (typing) return;

      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        // Mark that an overlay handled Back so the Capacitor hardware-back
        // listener (useNavigation) doesn't ALSO pop the navigation stack and
        // exit the Player on Android/Fire TV.
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        if (paneRef.current === 'channels') {
          setPane('categories');
        } else {
          onExitLeft(); // categories → sections (parent); from sections, parent Back exits.
        }
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        const ch = visibleChannelsRef.current[channelIdxRef.current];
        if (ch) { e.preventDefault(); toggleFavorite(ch); }
        return;
      }

      const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!arrows.includes(e.key)) return;
      // Same guard as the Escape/Backspace branch above and the header's own
      // handler in LiveTV.tsx: without it, Fire TV's WebView still runs its
      // own native spatial-navigation on this keydown after we've moved
      // React's focus state (e.g. out to the header for Settings) — it can
      // leave the real DOM focus, and whatever native ring it draws, sitting
      // on the last category row while our own UI shows focus somewhere
      // else entirely.
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();

      const cats = visibleCategoriesRef.current;
      const chans = visibleChannelsRef.current;

      if (paneRef.current === 'categories') {
        if (searchFocusedRef.current) {
          if (e.key === 'ArrowUp')   { setSearchFocused(false); onExitUp?.(); return; }
          if (e.key === 'ArrowDown') {
            if (searchOpenRef.current && searchInputRef.current) { searchInputRef.current.focus(); return; }
            setSearchFocused(false); return;
          }
          if (e.key === 'ArrowLeft') { onExitLeft(); return; }
          if (e.key === 'Enter' || e.key === ' ') {
            const willOpen = !searchOpenRef.current;
            setSearchOpen(willOpen);
            if (willOpen) requestAnimationFrame(() => searchInputRef.current?.focus());
            else setSearchQuery('');
            return;
          }
          return;
        }
        if (e.key === 'ArrowDown') {
          userMovedRef.current = true;
          setCategoryIdx(i => (i + 1) % Math.max(1, cats.length));
        }
        else if (e.key === 'ArrowUp') {
          if (categoryIdxRef.current === 0) { setSearchFocused(true); return; }
          userMovedRef.current = true;
          setCategoryIdx(i => (i - 1 + cats.length) % Math.max(1, cats.length));
        }
        else if (e.key === 'ArrowLeft') {
          onExitLeft();
        }
        else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
          userMovedRef.current = true;
          const c = cats[categoryIdxRef.current];
          // A service header folds and unfolds its group; it opens nothing.
          if (c?.isHeader) { toggleCollapsed(c.lineKey); return; }
          if (c?.isAll) allOptedInRef.current = true;
          setPane('channels');
        }
        return;
      }

      // pane === 'channels'
      const nCols = colsRef.current;
      if (nCols > 1) {
        // The grid: Up/Down move a whole row, Left/Right a tile, Left off the
        // first column opens the categories. Ends clamp rather than wrap.
        const n = chans.length;
        if (e.key === 'ArrowDown') setChannelIdx(i => (i + nCols < n ? i + nCols : (Math.floor(i / nCols) < Math.floor((n - 1) / nCols) ? n - 1 : i)));
        else if (e.key === 'ArrowUp') setChannelIdx(i => (i - nCols >= 0 ? i - nCols : i));
        else if (e.key === 'ArrowLeft') { if (channelIdxRef.current % nCols === 0) setPane('categories'); else setChannelIdx(i => i - 1); }
        else if (e.key === 'ArrowRight') setChannelIdx(i => (i % nCols < nCols - 1 && i + 1 < n ? i + 1 : i));
      }
      if (nCols === 1 && e.key === 'ArrowDown') setChannelIdx(i => chans.length ? (i + 1) % chans.length : 0);
      else if (nCols === 1 && e.key === 'ArrowUp') {
        // Wrap to the LAST channel when at the top — one press to reach the
        // bottom of a long list. Was previously exiting up to sections.
        setChannelIdx(i => chans.length ? (i - 1 + chans.length) % chans.length : 0);
      }
      else if (nCols === 1 && e.key === 'ArrowLeft') {
        setPane('categories');
      }
      else if (e.key === 'Enter' || e.key === ' ') {
        // D-pad long-press detection. Short press = play; long press (~600ms) = report.
        // Ignore key repeats so holding doesn't restart the timer or re-fire play.
        if (e.repeat) return;
        if (enterTimerRef.current || enterFiredRef.current) return;
        enterFiredRef.current = false;
        enterTimerRef.current = window.setTimeout(() => {
          enterTimerRef.current = null;
          enterFiredRef.current = true;
          const c = visibleChannelsRef.current[channelIdxRef.current];
          if (c) setReportFor(c);
        }, 600) as unknown as number;
      }
     } catch { /* ignore */ }
    };
    const keyupHandler = (e: KeyboardEvent) => {
      if (reportForRef.current) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (paneRef.current !== 'channels' || fullscreenRef.current) {
        cancelEnterTimer();
        enterFiredRef.current = false;
        return;
      }
      if (enterTimerRef.current) {
        // Released before long-press threshold → treat as short press (play).
        cancelEnterTimer();
        const ch = visibleChannelsRef.current[channelIdxRef.current];
        if (ch) activateChannelRef.current(ch);
      }
      // If long-press already fired, just consume the keyup.
      enterFiredRef.current = false;
    };
    // While the first-open layout chooser is up it owns the remote.
    const guardedDown = (e: KeyboardEvent) => { if (!choosingLayoutRef.current) handler(e); };
    const guardedUp = (e: KeyboardEvent) => { if (!choosingLayoutRef.current) keyupHandler(e); };
    window.addEventListener('keydown', guardedDown, true);
    window.addEventListener('keyup', guardedUp, true);
    return () => {
      window.removeEventListener('keydown', guardedDown, true);
      window.removeEventListener('keyup', guardedUp, true);
      cancelEnterTimer();
    };
  }, [isActive, onExitLeft, onExitUp, toggleFavorite, changeChannelInFullscreen, playChannel, pokeBar, hideBarNow, cancelEnterTimer, toggleCollapsed]);

  useEffect(() => {
    if (!isActive) return;
    let handle: { remove?: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const h = await CapApp.addListener('backButton', () => {
          // The Player shell owns hardware Back: it turns the press into an
          // Escape keydown that the handler above deals with. Acting here as
          // well meant ONE press was handled twice — the Escape opened the
          // categories, then this listener saw them open and left the section.
          if ((window as unknown as { __playerOwnsBack?: boolean }).__playerOwnsBack) return;
          if (choosingLayoutRef.current) return; // the chooser answers Back itself
          (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
          if (reportForRef.current) return;
          if (subMenuOpenRef.current || audioMenuOpenRef.current || volMenuOpenRef.current) { setSubMenuOpen(false); setAudioMenuOpen(false); setVolMenuOpen(false); return; }
          if (fullscreenRef.current) {
            if (barVisibleRef.current) hideBarNow();
            else { setFullscreen(false); }
            return;
          }
          if (paneRef.current === 'channels') { setPane('categories'); return; }
          onExitLeft();
        });
        if (cancelled) h?.remove?.(); else handle = h;
      } catch { /* web: keydown Escape already covers it */ }
    })();
    return () => { cancelled = true; handle?.remove?.(); };
  }, [isActive, onExitLeft, hideBarNow]);


  // Resolve playing stream from visible list OR favorites (we may not have loaded the original category)
  const playingStream = (() => {
    if (!playingChannelId) return focusedChannel;
    const inList = visibleChannels.find(s => s.stream_id === playingChannelId && lineFor(s) === playingLine);
    if (inList) return inList;
    const fav = favoritesOf(playingLine).get(playingChannelId);
    if (fav) { const st = favToStream(fav); streamLineRef.current.set(st, playingLine); return st; }
    return focusedChannel;
  })();
  const playingNowNext = epgFor(playingStream);
  const progress = (() => {
    if (!playingNowNext?.now) return 0;
    const { start, end } = playingNowNext.now;
    return Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100));
  })();

  if (fullscreen) {
    // Native path: chrome renders over a transparent layer so the ExoPlayer
    // TextureView behind the WebView shows through. Web/fallback path keeps
    // the original <VideoPlayer> element rendering into the WebView.
    return (
      <div className={`fixed inset-0 z-[60] text-white ${NATIVE_PLAYBACK ? 'bg-transparent' : 'bg-black'}`}>
        {!NATIVE_PLAYBACK && !DEMO && (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><div className="w-full max-w-md"><SnowLoader size="lg" label="Loading…" /></div></div>}>
            <VideoPlayer
              src={streamUrl}
              volume={volume}
              muted={false}
              className="w-full h-full"
              onReady={(c) => { videoControllerRef.current = c; setIsPaused(c.isPaused()); }}
              onPlayStateChange={(paused) => setIsPaused(paused)}
              onTracksChanged={() => setTracksTick(t => t + 1)}
              onError={(msg) => {
                if (playingChannelId) signalChannel(playingLine.host, playingChannelId, playingStreamName(playingChannelId), 'fail');
                try {
                  const ch = visibleChannels.find(s => s.stream_id === playingChannelId);
                  trackEvent('player_error', 'player', {
                    kind: 'live_web',
                    channel_or_title: ch?.name ?? '',
                    server: playingLine.serverLabel,
                    message: msg.slice(0, 200),
                  });
                } catch { /* ignore */ }
              }}
            />
          </Suspense>
        )}
        {DEMO && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8 pointer-events-none">
            {playingStream?.stream_icon
              ? <img src={playingStream.stream_icon} alt="" className="w-20 h-20 rounded-2xl object-contain bg-black/40 border border-white/10 mb-4" />
              : <Tv className="w-16 h-16 text-brand-gold mb-4" />}
            <p className="font-quicksand font-bold text-2xl text-white drop-shadow-lg">
              {playingStream?.num ? `${playingStream.num} · ` : ''}{playingStream?.name ?? ''}
            </p>
            {playingNowNext?.now && (
              <p className="mt-2 text-brand-ice/80 font-nunito text-base drop-shadow">
                Now: {playingNowNext.now.title}{playingNowNext.next ? ` · Next: ${playingNowNext.next.title}` : ''}
              </p>
            )}
            <p className="mt-6 px-3 py-1 rounded-full bg-brand-gold/20 border border-brand-gold/40 text-brand-gold text-xs font-nunito font-semibold tracking-widest uppercase">
              Demo mode — playback is disabled
            </p>
            <p className="mt-2 text-brand-ice/70 font-nunito text-xs max-w-md">{DEMO_DIALOG_MSG}</p>
          </div>
        )}
        {NATIVE_PLAYBACK && native.buffering && !native.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
            <div className="w-full max-w-md"><SnowLoader size="lg" label="Buffering…" /></div>
            {slowConn && (
              <p className="max-w-md px-4 text-center text-sm font-nunito text-brand-ice/80">
                Still loading — your connection looks slow. If channels keep buffering, a VPN often helps.
              </p>
            )}
          </div>
        )}
        {NATIVE_PLAYBACK && !native.error && (
          <BufferingDiagnostics buffering={native.buffering} className="mt-12" />
        )}
        {/* Audio present but undecodable on this device: video is fine, so don't
            block it — just say why there's no sound, and name the codec so
            support can act on it instead of guessing. */}
        {NATIVE_PLAYBACK && native.audioWarning && !native.error && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 max-w-lg rounded-2xl bg-black/85 px-5 py-3 text-center">
            <p className="font-quicksand font-semibold text-brand-gold text-sm">
              No sound on this channel
            </p>
            <p className="mt-1 font-nunito text-xs text-brand-ice/80">
              This channel's audio ({native.audioWarning.codecs}) can't be decoded on this device.
              Report the channel in Support and we'll re-encode it.
            </p>
            <p className="mt-1 font-nunito text-xs text-brand-ice/70">
              audio-decode: {native.audioWarning.codecs} · ffmpeg:{' '}
              {native.audioWarning.ffmpegAvailable ? 'yes' : 'no'}
            </p>
          </div>
        )}
        {NATIVE_PLAYBACK && native.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-white p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-brand-gold mb-3" />
            <p className="text-xl font-quicksand font-semibold mb-1">Playback Error</p>
            <p className="text-sm text-brand-ice/80 font-nunito max-w-md mb-4">{native.error.message}</p>
            <button
              onClick={() => native.retry()}
              autoFocus
              data-focused="true"
              className="tv-ring tv-ring-contrast flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold scale-105 z-10"
            >
              <RotateCw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}
        <PlayerControlBar
          visible={barVisible}
          focus={barFocus}
          isPaused={isPaused}
          controller={videoControllerRef.current}
          tracksTick={tracksTick}
          categoryName={currentCat?.name}
          channelLogo={playingStream?.stream_icon}
          channelNum={playingStream?.num}
          channelName={playingStream?.name}
          nowTitle={playingNowNext?.now?.title}
          nowStart={playingNowNext?.now?.start}
          nowEnd={playingNowNext?.now?.end}
          nextTitle={playingNowNext?.next?.title}
          subMenuOpen={subMenuOpen}
          audioMenuOpen={audioMenuOpen}
          subMenuFocus={subMenuFocus}
          audioMenuFocus={audioMenuFocus}
          volMenuOpen={volMenuOpen}
          volume={volume}
        />
        {/* Volume hint while bar is hidden */}
        {!barVisible && volPillShown && (
          <div className="absolute bottom-4 right-6 px-3 py-2 rounded-full bg-black/60 text-brand-ice/80 font-nunito text-xs pointer-events-none">
            Vol {Math.round(volume * 100)}%
          </div>
        )}
      </div>
    );
  }


  const totalSize = rowVirtualizer.getTotalSize();

  const catCount = currentCat?.count ?? (visibleChannels.length || undefined);
  const nowLeftMins = focusedNowNext?.now ? Math.max(0, Math.round((focusedNowNext.now.end - Date.now()) / 60000)) : null;
  const paneW = 'w-[38%] min-w-[340px] max-w-[480px]';

  // ── the categories pane: a static column (classic, grid) or a drawer over
  //    the channel list (compact). Same DOM either way, so its virtualizer
  //    keeps a measured scroll parent and the manual scroll math holds.
  const drawer = layout === 'compact';
  const categoriesPane = (
    <div
      ref={categoriesScrollRef}
      aria-hidden={drawer && pane !== 'categories'}
      style={drawer ? { transform: pane === 'categories' ? 'translateX(0)' : 'translateX(-110%)' } : undefined}
      className={drawer
        ? `absolute left-0 top-0 bottom-0 z-20 ${paneW} border-r border-white/10 p-3 overflow-y-auto overflow-x-hidden bg-[#0b1220] ${pane === 'categories' ? '' : 'pointer-events-none'}`
        : `w-64 max-w-[16rem] flex-shrink-0 border-r border-white/10 p-3 overflow-y-auto overflow-x-hidden bg-black/40 ${pane === 'categories' && isActive ? 'bg-white/5' : ''}`}
    >
        <button
          onClick={() => setSearchOpen(o => !o)}
          data-focused={searchFocused ? 'true' : 'false'}
          className={`tv-ring w-full flex items-center gap-2 px-3 py-3 mb-2 rounded-xl border border-white/10 text-brand-ice font-nunito text-base ${searchFocused ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-black/40'}`}
        >
          <Search className="w-4 h-4" />
          {searchOpen ? 'Close search' : 'Search channels'}
        </button>
        {searchOpen && (
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.blur(); setPane('channels'); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); e.currentTarget.blur(); setSearchFocused(true); }
              else if (e.key === 'Escape')  { e.preventDefault(); e.currentTarget.blur(); setSearchFocused(true); }
            }}
            placeholder="Type to search…"
            className="w-full mb-3 rounded-xl bg-black/40 text-white border border-white/20 px-3 py-3 font-nunito text-base focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
        )}
        {!searchOpen && (
          <>
            {categoriesLoading && categories.length === 0 && (
              <div className="px-3 py-2 text-brand-ice/70 font-nunito text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> Loading categories…
              </div>
            )}
            {visibleCategories.length > 0 && (
              <div
                ref={categoriesListRef}
                style={{
                  height: categoryVirtualizer.getTotalSize(),
                  position: 'relative',
                  width: '100%',
                }}
              >
                {categoryVirtualizer.getVirtualItems().map((vRow) => {
                  const i = vRow.index;
                  const c = visibleCategories[i];
                  if (!c) return null;
                  const isFocused = isActive && pane === 'categories' && !searchFocused && categoryIdx === i;
                  // The category whose channels are listed. Marked only while
                  // the viewer is over in that list — a thin gold bar, not a
                  // filled box — so there is never a second highlight on
                  // screen: with the highlight on the left rail or the header
                  // nothing in this pane lights up at all.
                  const isMarked = !isFocused && isActive && pane === 'channels' && categoryIdx === i && !c.isHeader;
                  const isLoadingThis = loadingCat === c.id;
                  return (
                    <div
                      key={c.id}
                      data-cat-idx={i}
                      data-focused={isFocused ? 'true' : 'false'}
                      onClick={() => {
                        userMovedRef.current = true;
                        setCategoryIdx(i);
                        if (c.isHeader) { toggleCollapsed(c.lineKey); return; }
                        if (c.isAll) allOptedInRef.current = true;
                        setPane('channels');
                      }}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vRow.start}px)`,
                        height: CAT_ROW_HEIGHT,
                        paddingBottom: 4, // matches space-y-1 gap so heights are stable
                      }}
                      className={`
                        tv-ring flex items-center gap-2 py-2 rounded-xl cursor-pointer
                        ${c.isHeader ? 'px-3 mt-1' : grouped ? 'pl-6 pr-3' : 'px-3'}
                        ${isFocused ? 'bg-brand-gold/25 z-10' : ''}
                        ${!isFocused && c.isHeader ? 'bg-white/10 border border-white/15' : ''}
                        ${!isFocused && !c.isHeader ? 'border border-transparent hover:bg-white/5' : ''}
                      `}
                    >
                      {isMarked && <span className="absolute left-1 top-2 bottom-2 w-[3px] rounded-full bg-brand-gold" aria-hidden="true" />}
                      {c.isHeader && (c.collapsedHeader
                        ? <ChevronRight className="w-4 h-4 text-brand-gold flex-shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-brand-gold flex-shrink-0" />)}
                      {c.isFav && <Star className="w-4 h-4 text-brand-gold flex-shrink-0" />}
                      <span className={c.isHeader
                        ? `font-quicksand font-bold uppercase tracking-wide text-sm truncate flex-1 ${isFocused ? 'text-white' : 'text-brand-gold'}`
                        : `font-nunito truncate flex-1 ${isFocused ? 'text-white font-semibold' : isMarked ? 'text-brand-gold font-semibold' : 'text-brand-ice'}`}>
                        {c.name}
                      </span>
                      {isLoadingThis && <Loader2 className="w-3 h-3 animate-spin text-brand-gold flex-shrink-0" />}
                      {!isLoadingThis && !c.isHeader && c.count != null && c.count > 0 && (
                        <span className={`text-xs font-nunito tabular-nums px-2 py-1 rounded-lg ${isFocused ? 'bg-brand-navy/40 text-brand-gold' : 'bg-white/10 text-brand-ice/70'}`}>
                          {formatCount(c.count)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
    </div>
  );

  // ── the channel list / grid, virtualized by row ────────────────────────
  const rowVariant: 'classic' | 'compact' | 'tile' = layout === 'grid' ? 'tile' : layout;
  const channelList = (
    <div ref={scrollParentRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3">
      {channelsLoading && visibleChannels.length === 0 ? (
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`sk-${i}`} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-white/5 animate-pulse">
              <div className="w-8 h-4 rounded-full bg-white/10" />
              <div className="w-14 h-14 rounded-lg bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/2 rounded-full bg-white/10" />
                <div className="h-3 w-2/3 rounded-full bg-white/5" />
              </div>
            </div>
          ))}
        </div>
          ) : visibleChannels.length === 0 ? (
            <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito text-center px-6">
              {searchOpen
                ? (searchQuery
                    ? (allChannelsLoading ? 'Loading channel catalog…' : 'No channels match your search.')
                    : (allChannelsLoading ? 'Loading channel catalog…' : 'Type above to search all channels.'))
                : currentCat?.isFav
                  ? 'No favorites yet. Press F on a channel to add it.'
                  : 'No channels in this category.'}
            </div>
      ) : (
        <div ref={channelListRef} style={{ height: totalSize, position: 'relative', width: '100%' }}>
          {virtualItems.map(v => {
            const first = v.index * cols;
            const slot = visibleChannels.slice(first, first + cols);
            if (slot.length === 0) return null;
            return (
              <div
                key={v.key}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: rowHeight, transform: `translateY(${v.start}px)`, padding: cols > 1 ? '4px 0' : '2px 0' }}
                className={cols > 1 ? 'grid gap-3' : undefined}
                // Inline, not a Tailwind class: the column count is a constant
                // and gap + grid must paint on the Chromium 66 WebView.
                {...(cols > 1 ? { style: { position: 'absolute', top: 0, left: 0, width: '100%', height: rowHeight, transform: `translateY(${v.start}px)`, padding: '4px 0', display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 12 } } : {})}
              >
                {slot.map((s, c) => {
                  const idx = first + c;
                  return (
                    <ChannelRow
                      key={s.stream_id}
                      variant={rowVariant}
                      channel={s}
                      index={idx}
                      isFocused={isActive && pane === 'channels' && idx === safeChannelIdx}
                      isPlaying={playingChannelId === s.stream_id}
                      isFavorite={isFav(s)}
                      isDown={isChannelDown(downSet, lineFor(s).host, s.stream_id)}
                      nowNext={epgFor(s)}
                      onSelect={onRowSelect}
                      onActivate={onRowActivate}
                      onLongPress={onRowLongPress}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── the preview box, shared by the classic header and the compact stage ─
  const previewBox = (
    <>
      {nativePreviewActive ? (
        // The native player draws through this box from behind the WebView:
        // nothing may paint here. Only a loader while the stream primes.
        (native.buffering || native.error) && (
          <div className="w-full h-full flex items-center justify-center">
            {native.error
              ? <span className="text-brand-ice/70 font-nunito text-sm text-center px-4">Can't preview this channel</span>
              : <div className="w-full max-w-[200px]"><SnowLoader size="sm" /></div>}
          </div>
        )
      ) : previewUrl ? (
        // One muted <video> at most — each one spawns a WebMediaPlayer that
        // saturates the compositor thread.
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><div className="w-full max-w-[200px]"><SnowLoader size="sm" /></div></div>}>
          <VideoPlayer src={previewUrl} volume={0} muted className="w-full h-full" chrome="minimal" />
        </Suspense>
      ) : previewDisabled || !focusedChannel ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-brand-ice/70 font-nunito text-sm text-center px-4">
          {focusedChannel?.stream_icon ? (
            <img src={focusedChannel.stream_icon} alt="" className="w-20 h-20 object-contain opacity-90" />
          ) : (
            <Tv className="w-10 h-10 text-brand-ice/40" />
          )}
          {focusedChannel ? 'Press OK to watch' : 'No channel selected'}
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm text-center px-4">
          {focusedChannel ? 'Preview loading…' : 'No channel selected'}
        </div>
      )}
    </>
  );

  // First time in Live TV on this box: the chooser sits over whichever
  // layout is drawn underneath until a look is picked.
  const layoutChooser = choosingLayout ? <LiveLayoutChooser onDone={() => setChoosingLayout(false)} /> : null;

  if (layout === 'compact') {
    return (
      <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden relative">
        {layoutChooser}
        {categoriesPane}

        {/* Channel list: the current category as a switcher row, then slim rows */}
        <div className={`${paneW} flex-shrink-0 flex flex-col border-r border-white/10 bg-black/30`}>
          <div
            onClick={() => setPane('categories')}
            className="flex-shrink-0 h-12 flex items-center gap-3 px-4 border-b border-white/10 cursor-pointer"
          >
            <span className="text-brand-ice/50 text-sm" aria-hidden="true">◀</span>
            <div className="flex-1 min-w-0 text-center">
              {grouped && currentCat?.line && (
                <div className="text-xs font-quicksand font-semibold tracking-[0.12em] uppercase text-brand-gold truncate">{lineLabel(currentCat.line)}</div>
              )}
              <div className="text-sm font-quicksand font-semibold text-white truncate">
                {searchOpen ? 'Search' : (currentCat?.name ?? 'Channels')}
                {!searchOpen && catCount ? <span className="text-brand-ice/60 font-nunito font-normal"> · {formatCount(catCount)}</span> : null}
              </div>
            </div>
            <span className="text-xs font-nunito text-brand-ice/50 flex-shrink-0">categories</span>
          </div>
          {channelList}
        </div>

        {/* Stage: the preview, then what is on now and next */}
        <div className="flex-1 min-w-0 flex flex-col p-5 gap-3 overflow-hidden">
          <div ref={previewBoxRef} className={`relative w-full aspect-video max-h-[56%] rounded-2xl overflow-hidden border border-white/10 flex-shrink-0 ${nativePreviewActive ? '' : 'bg-black'}`}>
            {previewBox}
          </div>

        {/* The highlighted channel, under the preview rather than over it so
            it never fights the preview's own controls. */}
        {focusedChannel && (
          <div className="flex-shrink-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-quicksand font-bold text-white truncate">{focusedChannel.name}</h3>
              {isFav(focusedChannel) && <Star className="w-4 h-4 text-brand-gold fill-brand-gold flex-shrink-0" />}
              {channelsLoading && <Loader2 className="w-4 h-4 animate-spin text-brand-gold ml-auto" />}
            </div>
            {focusedNowNext?.now ? (
              <>
                <p className="text-sm text-brand-ice/85 font-nunito truncate mt-0.5">
                  {focusedNowNext.now.title} · {formatTime(focusedNowNext.now.start)} – {formatTime(focusedNowNext.now.end)}
                  {nowLeftMins != null ? ` · ${nowLeftMins} min left` : ''}
                </p>
                <div className="mt-2 h-[3px] rounded-full bg-white/15 overflow-hidden">
                  <div className="h-full bg-brand-gold" style={{ width: `${Math.min(100, Math.max(0, ((Date.now() - focusedNowNext.now.start) / (focusedNowNext.now.end - focusedNowNext.now.start)) * 100))}%` }} />
                </div>
              </>
            ) : (
              <p className="text-sm text-brand-ice/70 font-nunito mt-0.5">No program info available</p>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          {focusedChannel ? (
            <>
              <div className="flex gap-6">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-quicksand font-semibold tracking-[0.14em] uppercase text-brand-gold">Now</p>
                  <p className="text-sm font-nunito font-semibold text-white truncate mt-1">{focusedNowNext?.now?.title ?? '—'}</p>
                  {focusedNowNext?.now && (
                    <p className="text-xs font-nunito text-brand-ice/70 mt-0.5">{formatTime(focusedNowNext.now.start)} – {formatTime(focusedNowNext.now.end)}</p>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-quicksand font-semibold tracking-[0.14em] uppercase text-brand-ice/55">Next</p>
                  <p className="text-sm font-nunito font-semibold text-white/85 truncate mt-1">{focusedNowNext?.next?.title ?? '—'}</p>
                  {focusedNowNext?.next && (
                    <p className="text-xs font-nunito text-brand-ice/70 mt-0.5">{formatTime(focusedNowNext.next.start)} – {formatTime(focusedNowNext.next.end)}</p>
                  )}
                </div>
              </div>
              {focusedNowNext?.now?.description ? (
                <p className="mt-3 text-xs font-nunito text-white/70 leading-relaxed line-clamp-3">{focusedNowNext.now.description}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-brand-ice/70 font-nunito">
              {channelsLoading ? 'Loading channels…' : 'No channel focused'}
            </p>
          )}
        </div>

          <p className="flex-shrink-0 text-xs font-nunito text-brand-ice/55">OK full screen · Hold OK options · ◀ categories</p>
        </div>
      {reportFor && (
        <Suspense fallback={null}>
          <ReportChannelDialog
            channelName={reportFor.name}
            channelId={reportFor.stream_id}
            categoryName={searchOpen ? 'Search' : (currentCat?.isFav ? 'Favorites' : (currentCat?.name || ''))}
            isFavorite={isFav(reportFor)}
            onToggleFavorite={() => toggleFavorite(reportFor)}
            onRefreshFavorite={() => refreshFavorite(reportFor)}
            initialChoice={reportPreset?.choice}
            initialNote={reportPreset?.note}
            onReportedDown={() => signalChannel(lineFor(reportFor).host, reportFor.stream_id, reportFor.name, 'down')}
            isDown={isChannelDown(downSet, lineFor(reportFor).host, reportFor.stream_id)}
            onClearDown={() => signalChannel(lineFor(reportFor).host, reportFor.stream_id, reportFor.name, 'clear')}
            onOpenBufferingGuide={() => {
              setReportFor(null);
              enterFiredRef.current = false;
              onNavigate?.('support');
              setTimeout(() => { window.dispatchEvent(new CustomEvent('support:open-buffering-guide')); }, 80);
            }}
            onClose={() => { setReportFor(null); enterFiredRef.current = false; }}
          />

        </Suspense>
      )}
      </div>
    );
  }

  if (layout === 'grid') {
    return (
      <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden">
        {layoutChooser}
        {categoriesPane}
        <div className="flex-1 min-w-0 flex flex-col bg-black/30 overflow-x-hidden">
          <div className="flex-shrink-0 h-12 flex items-center gap-3 px-5 border-b border-white/10">
            <div className="flex-1 min-w-0 flex items-baseline gap-2">
              {grouped && currentCat?.line && (
                <span className="text-xs font-quicksand font-semibold tracking-[0.12em] uppercase text-brand-gold">{lineLabel(currentCat.line)}</span>
              )}
              <span className="text-base font-quicksand font-semibold text-white truncate">{searchOpen ? 'Search' : (currentCat?.name ?? 'Channels')}</span>
              {!searchOpen && catCount ? <span className="text-sm text-brand-ice/60 font-nunito">{formatCount(catCount)}</span> : null}
            </div>
            <span className="text-xs font-nunito text-brand-ice/50">OK play · Hold OK options · ◀ categories</span>
          </div>
          {channelList}
        </div>
      {reportFor && (
        <Suspense fallback={null}>
          <ReportChannelDialog
            channelName={reportFor.name}
            channelId={reportFor.stream_id}
            categoryName={searchOpen ? 'Search' : (currentCat?.isFav ? 'Favorites' : (currentCat?.name || ''))}
            isFavorite={isFav(reportFor)}
            onToggleFavorite={() => toggleFavorite(reportFor)}
            onRefreshFavorite={() => refreshFavorite(reportFor)}
            initialChoice={reportPreset?.choice}
            initialNote={reportPreset?.note}
            onReportedDown={() => signalChannel(lineFor(reportFor).host, reportFor.stream_id, reportFor.name, 'down')}
            isDown={isChannelDown(downSet, lineFor(reportFor).host, reportFor.stream_id)}
            onClearDown={() => signalChannel(lineFor(reportFor).host, reportFor.stream_id, reportFor.name, 'clear')}
            onOpenBufferingGuide={() => {
              setReportFor(null);
              enterFiredRef.current = false;
              onNavigate?.('support');
              setTimeout(() => { window.dispatchEvent(new CustomEvent('support:open-buffering-guide')); }, 80);
            }}
            onClose={() => { setReportFor(null); enterFiredRef.current = false; }}
          />

        </Suspense>
      )}
      </div>
    );
  }

  // classic
  return (
    <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden">
      {layoutChooser}
      {categoriesPane}
      <div data-native-clear className="flex-1 min-w-0 flex flex-col bg-black/30 overflow-x-hidden">
        <div data-native-clear className="flex gap-4 p-4 border-b border-white/10 bg-black/40">
          <div ref={previewBoxRef} className={`w-64 aspect-video rounded-xl overflow-hidden border border-white/10 flex-shrink-0 ${nativePreviewActive ? '' : 'bg-black'}`}>
            {previewBox}
          </div>
          <div className="flex-1 min-w-0">
            {focusedChannel ? (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-quicksand font-bold text-white truncate">{focusedChannel.name}</h3>
                  {isFav(focusedChannel) && <Star className="w-5 h-5 text-brand-gold fill-brand-gold" />}
                  {channelsLoading && <Loader2 className="w-4 h-4 animate-spin text-brand-gold ml-auto" />}
                </div>
                {focusedNowNext?.now ? (
                  <>
                    <p className="text-brand-ice/90 font-nunito truncate mt-1">Now: {focusedNowNext.now.title}</p>
                    <p className="text-xs text-brand-ice/70 font-nunito mt-1">
                      {formatTime(focusedNowNext.now.start)} – {formatTime(focusedNowNext.now.end)}
                      {nowLeftMins != null ? ` · ${nowLeftMins} min left` : ''}
                    </p>
                  </>
                ) : (
                  <p className="text-brand-ice/70 font-nunito mt-1 text-sm">No program info available</p>
                )}
                {focusedNowNext?.next && (
                  <p className="text-sm text-brand-ice/70 font-nunito mt-2 truncate">
                    Next: {focusedNowNext.next.title} · {formatTime(focusedNowNext.next.start)}
                  </p>
                )}
                <p className="text-xs text-brand-ice/60 font-nunito mt-4">OK full screen · Hold OK options · F favorite</p>
              </>
            ) : (
              <p className="text-brand-ice/70 font-nunito">
                {channelsLoading ? 'Loading channels…' : 'No channel focused'}
              </p>
            )}
          </div>
        </div>
        {channelList}
      </div>
      {reportFor && (
        <Suspense fallback={null}>
          <ReportChannelDialog
            channelName={reportFor.name}
            channelId={reportFor.stream_id}
            categoryName={searchOpen ? 'Search' : (currentCat?.isFav ? 'Favorites' : (currentCat?.name || ''))}
            isFavorite={isFav(reportFor)}
            onToggleFavorite={() => toggleFavorite(reportFor)}
            onRefreshFavorite={() => refreshFavorite(reportFor)}
            initialChoice={reportPreset?.choice}
            initialNote={reportPreset?.note}
            onReportedDown={() => signalChannel(lineFor(reportFor).host, reportFor.stream_id, reportFor.name, 'down')}
            isDown={isChannelDown(downSet, lineFor(reportFor).host, reportFor.stream_id)}
            onClearDown={() => signalChannel(lineFor(reportFor).host, reportFor.stream_id, reportFor.name, 'clear')}
            onOpenBufferingGuide={() => {
              setReportFor(null);
              enterFiredRef.current = false;
              onNavigate?.('support');
              setTimeout(() => { window.dispatchEvent(new CustomEvent('support:open-buffering-guide')); }, 80);
            }}
            onClose={() => { setReportFor(null); enterFiredRef.current = false; }}
          />

        </Suspense>
      )}
    </div>
  );

});

LiveSection.displayName = 'LiveSection';
export default LiveSection;
