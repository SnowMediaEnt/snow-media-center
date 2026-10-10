import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { formatTime } from '@/i18n/format';
import { ChevronDown, ChevronRight, Film, Loader2, Search, Star, Tv } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  loadFavoritesData,
  loadSavedAccounts,
  SAVED_ACCOUNTS_REFRESH_EVENT,
  getLiveCategories,
  getLiveStreams,
  forgetLiveStreams,
  hasLiveStreams,
  getShortEpg,
  buildLiveStreamUrl,
  buildNativeLiveUrl,
  countLiveStreams,
  pickNowNext,
  listsViaSnowMedia,
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
import { CATEGORY_DWELL_MS, KEPT_CATEGORY_SETTLE_MS } from '@/lib/categoryDwell';
import { runAfter } from '@/utils/idle';
import { keepInView } from '@/utils/keepInView';
import { isPlaybackQuiet } from '@/utils/quietMode';
import { loadPlayerVolume, savePlayerVolume, stepVolume } from '@/utils/volume';
import { isFireTV, isLowMemoryBox } from '@/utils/platform';
import { trackEvent, startTimer, stopTimer } from '@/lib/analytics';
import ChannelRow from './ChannelRow';
import { channelRowLabels } from './channelRowLabels';
import PlayerControlBar from './PlayerControlBar';
import { liveBarDisabled, liveBarOrder, moveBarFocus, type BarControlId } from './liveBar';
import BufferingDiagnostics from './BufferingDiagnostics';
import SnowLoader from '@/components/SnowLoader';
import { useTransientVisible } from '@/hooks/useTransientVisible';
import type { VideoController } from './VideoPlayer';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { hasNativePlayer, SnowPlayer } from '@/capacitor/SnowPlayer';
import { SnowRecorder, RECORDINGS_CHANGED_EVENT, hasRecorder, notifyRecordingsChanged, type RecordingJob } from '@/capacitor/SnowRecorder';
import { programmeTimeUtcMs } from '@/lib/recordSchedule';
import { useNativePlayer } from '@/hooks/useNativePlayer';
import { useLiveRewind, rewindOffMessage, panelOffset, type RewindOffReason } from '@/hooks/useLiveRewind';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { usePlayerEngine } from '@/hooks/usePlayerEngine';
import { recordEngineSample, sampleFromStats, shouldSampleEngines } from '@/lib/engineCompare';
import PlayerStatsPanel from './PlayerStatsPanel';
import { isDemo, isHowtoCapture, demoDialogMsg } from '@/lib/demoMode';
import { useLiveLayout, hasLiveLayoutChoice, type LiveLayout } from '@/lib/liveLayout';
import { peekIntent, clearIntent, type ReportIntent } from '@/lib/appActions';
import { channelForName } from '@/lib/voiceCommands';
import { leftOutOfSearch, searchLiveChannels } from '@/lib/liveSearch';
import { adultCategoryIds } from '@/lib/adultSearch';
import { toast } from '@/hooks/use-toast';
import { channelReport, isCategoryDown, isChannelFailure, signalCategory, signalChannel, useDownChannels, type ChannelReport } from '@/lib/channelStatus';
import ChannelWarningDialog from './ChannelWarningDialog';
import FullscreenChannelOverlay, { OVERLAY_CHANNEL_ROWS, type OverlayCategory } from './FullscreenChannelOverlay';
import RecentChannelsPanel from './RecentChannelsPanel';
import { useRecentPanel } from './useRecentPanel';
import { recentChannelId, type RecentChannel } from '@/lib/recentChannels';
// Not lazy: it must be up before the held OK that opens it is let go (that
// release arms it), or the viewer's next OK would be swallowed.
import ReportCategoryDialog from './ReportCategoryDialog';
import { warnedRecently, noteWatchAnyway } from './channelWarning';
import LiveLayoutChooser from '@/components/livetv/LiveLayoutChooser';
import RecordDialog, { type RecordChoice } from './RecordDialog';
import { recordChannelWatch } from '@/lib/watchHistory';
import { kidsAllowsChannel, kidsLevel } from '@/lib/kidsFilter';
import { noteLivePlay } from '@/lib/gameDayAi';
import { onMediaKey } from '@/lib/mediaKeys';
import { createSkipQueue, MEDIA_SKIP_SEC } from '@/lib/skipQueue';
import { MAX_SIMULTANEOUS_RECORDINGS, REWIND_PAUSED_NOTE, endsAtLabel, extraStreamNote, pauseRewindForRecording, recordingFileName } from '@/lib/recording';
import {
  demoGetLiveCategories,
  demoGetLiveStreams,
  demoGetShortEpg,
} from '@/lib/xtreamDemo';

const VideoPlayer = lazy(() => import('./VideoPlayer'));
const ReportChannelDialog = lazy(() => import('./ReportChannelDialog'));

const RecordingsScreen = lazy(() => import('./RecordingsScreen'));

const NATIVE_PLAYBACK = hasNativePlayer();
// Demo latch (?demo=1) — canned lineup, no provider contact, no <video> mount.
const DEMO = isDemo();
// The How-to pictures (developer build only): a second service, the layout
// chooser and the Recordings entry, as a real box shows them.
const HOWTO = isHowtoCapture();
// Record live channels (TRACKER 25): the native app with the recorder plugin
// (an older build has none), never the demo. A Kids profile hides it too (see
// recordOn in the component: the profile is only known at render).
const RECORD_CAPABLE = NATIVE_PLAYBACK && !DEMO && hasRecorder();
/** Hold OK this long on a channel for its short menu (Favorite, Report, Record…). */
const HOLD_MS = 600;
// Demo call-site swap (Plex pattern): fixtures answer every read in demo.
const fetchLiveCategories = DEMO ? demoGetLiveCategories : getLiveCategories;
const fetchLiveStreams = DEMO ? demoGetLiveStreams : getLiveStreams;
const fetchShortEpg = DEMO ? demoGetShortEpg : getShortEpg;

/** A channel asked for by voice that no channel clearly is (or, `loading`,
 *  whose lists had not come in yet). */
const sayChannelNotFound = (said: string, loading = false) => {
  try {
    toast(loading
      ? { title: i18n.t('live.toast.stillLoadingTitle'), description: i18n.t('live.toast.stillLoadingDesc', { said }) }
      : { title: i18n.t('live.toast.notFoundTitle', { said }), description: i18n.t('live.toast.notFoundDesc') });
  } catch { /* ignore */ }
};


interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
  onBack: () => void;
  onNavigate?: (view: string) => void;
  /** Back from where another screen sent the viewer (Game Day's Watch):
   *  true when it took them back there, so Live TV does nothing more. */
  onBackToCaller?: () => boolean;
  /** A channel picked inside Live TV (the list over the picture, Recently
   *  watched): Back from it is Live TV's own, no longer the Guide's. */
  onForgetGuideReturn?: () => void;
}


type Pane = 'categories' | 'channels';
const FAV_ID = '__favorites__';
const ALL_ID = '__all__';
/** The Favorites of every signed-in line together, above the line groups. */
const ALL_FAVS_ID = '__allfavs__';
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
/** The channel list over the picture closes itself after this long without a key. */
const CHANNEL_OVERLAY_IDLE_MS = 15_000;

/** One row of the category pane: a service header, Favorites, All, or a category — always with the line it belongs to.
 *  `name` of Favorites and All stays English: it goes to analytics and watch history. Screens show catLabel(). */
interface CatEntry {
  id: string;
  name: string;
  count?: number;
  isFav?: boolean;
  /** Every line's Favorites in one list (only with more than one line). */
  isAllFavs?: boolean;
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

const LiveSection = memo(({ creds, isActive, onExitLeft, onExitUp, onBack: _onBack, onNavigate, onBackToCaller, onForgetGuideReturn }: Props) => {
  const { t } = useTranslation();
  // The channel rows' words, translated once here (one t() per row would be one per visible row).
  const rowLabels = useMemo(() => channelRowLabels(t), [t]);
  // What a category row shows: Favorites and All are ours to translate, the rest is the provider's name.
  const catLabel = (c: { name: string; isFav?: boolean; isAllFavs?: boolean; isAll?: boolean }): string =>
    c.isAllFavs ? t('live.categories.allFavorites') : c.isFav ? t('live.categories.favorites') : c.isAll ? t('live.categories.all') : c.name;
  // One screen back at a time: from a channel Game Day started, Back returns
  // to that game's list, not to Live TV's categories.
  const backToCallerRef = useRef(onBackToCaller);
  backToCallerRef.current = onBackToCaller;
  const clearCallerRef = useRef(onForgetGuideReturn);
  clearCallerRef.current = onForgetGuideReturn;
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
      const saved = DEMO && !HOWTO ? [] : await loadSavedAccounts().catch(() => []);
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
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
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
        if (!next) return;
        // Left Live TV before the account answered (into the Guide, say): the
        // account's list is still kept on the box. The pull has already marked
        // the box in step with the account, so dropping it here lost it for
        // good, and the next change would overwrite the other box's.
        if (cancelled) { saveFavoritesForLine(line, next); return; }
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
  // The line the playing channel belongs to. Set with the channel, never
  // derived later: the list it came from may have been dropped by then.
  const [playingLine, setPlayingLine] = useState<XtreamCreds>(creds);
  // The stream last handed to playChannel: keeps what the list said about it
  // (its name, number, logo, catch-up days) after the list itself has moved
  // on, and for a channel handed over from outside the list (Game Day, a
  // kickoff reminder, the content bar) that the list never held.
  const playedStreamRef = useRef<XtreamLiveStream | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // "Report a problem" dialog — owns the keyboard while open.
  const [reportFor, setReportFor] = useState<XtreamLiveStream | null>(null);
  const reportForRef = useRef<XtreamLiveStream | null>(null);
  useEffect(() => { reportForRef.current = reportFor; }, [reportFor]);
  // Hold OK (or Menu) on a category: report the whole category down. Owns
  // the keyboard while open, like the channel menu.
  const [reportCatFor, setReportCatFor] = useState<{ line: XtreamCreds; catId: string; name: string } | null>(null);
  const reportCatForRef = useRef(reportCatFor);
  reportCatForRef.current = reportCatFor;
  // A channel the others reported down or buffering: asked before it plays.
  const [warnFor, setWarnFor] = useState<{ stream: XtreamLiveStream; report: Exclude<ChannelReport, null> } | null>(null);
  const warnForRef = useRef(warnFor);
  warnForRef.current = warnFor;
  // The reports list (useDownChannels, further down), for callbacks made before it.
  const downSetRef = useRef<Set<string>>(new Set());
  // Record now (TRACKER 25): the dialog (hold OK on a channel, or Record in
  // the player bar) owns the keyboard while open, like the report dialog. Not
  // in Kids profiles, the demo, or a build without the recorder plugin.
  const recordOn = RECORD_CAPABLE && !kidsLevel();
  const recordOnRef = useRef(recordOn);
  recordOnRef.current = recordOn;
  const [recordFor, setRecordFor] = useState<{ st: XtreamLiveStream; line: XtreamCreds } | null>(null);
  const recordForRef = useRef(recordFor);
  recordForRef.current = recordFor;
  // Live TV › Recordings: an entry under Search once there is something to
  // list; the screen takes the section over (and the remote) while open.
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const recordingsOpenRef = useRef(recordingsOpen);
  recordingsOpenRef.current = recordingsOpen;
  const [recFocused, setRecFocused] = useState(false);
  const recFocusedRef = useRef(recFocused);
  recFocusedRef.current = recFocused;
  const [hasRecordings, setHasRecordings] = useState(false);
  // Schedules (set for later, or missed) give the Recordings entry a reason to show before any file exists.
  const [hasSchedules, setHasSchedules] = useState(false);
  const [recJobs, setRecJobs] = useState<RecordingJob[]>([]);
  // Re-reads what is recorded and what is recording. The one place a
  // "recordings changed" event lands: the screens fire it after a start, stop,
  // rename or delete (notifyRecordingsChanged), and the native side's own
  // 'recordingsChanged' event (a scheduled start, a recording that ended)
  // fires the same event (SnowRecorder.ts).
  const refreshRecordings = useCallback(() => {
    if (!recordOnRef.current) return;
    SnowRecorder.list().then((r) => setHasRecordings(r.recordings.length > 0)).catch(() => { /* older app */ });
    SnowRecorder.listSchedules().then((r) => setHasSchedules(r.schedules.length > 0)).catch(() => { /* older app */ });
    SnowRecorder.active().then((r) => setRecJobs(r.jobs)).catch(() => { /* older app */ });
  }, []);
  useEffect(() => {
    if (!recordOn || !isActive) return;
    refreshRecordings();
    window.addEventListener(RECORDINGS_CHANGED_EVENT, refreshRecordings);
    return () => window.removeEventListener(RECORDINGS_CHANGED_EVENT, refreshRecordings);
  }, [recordOn, isActive, refreshRecordings]);
  // D-pad long-press (hold OK ~600ms) on a focused channel → its options: the
  // Record dialog (with the report menu under "More options…"), or the report
  // menu straight away where recording isn't offered.
  const enterTimerRef = useRef<number | null>(null);
  const enterFiredRef = useRef(false);
  const cancelEnterTimer = useCallback(() => {
    if (enterTimerRef.current) { window.clearTimeout(enterTimerRef.current); enterTimerRef.current = null; }
  }, []);
  // The same on a category: let go soon = open it, held = its menu (Report
  // category down). Only a provider's own category: not a service header,
  // Favorites or All channels.
  const catHoldRef = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });
  const cancelCatHold = useCallback(() => {
    const h = catHoldRef.current;
    if (h.timer) { window.clearTimeout(h.timer); h.timer = null; }
  }, []);



  // --- Fullscreen control bar ---
  const videoControllerRef = useRef<VideoController | null>(null);
  const [barVisible, setBarVisible] = useState(true);
  const [barFocus, setBarFocus] = useState<BarControlId>('play');
  const [isPaused, setIsPaused] = useState(false);
  const [subMenuOpen, setSubMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [volMenuOpen, setVolMenuOpen] = useState(false);
  const [subMenuFocus, setSubMenuFocus] = useState(-1); // -1 = Off
  const [audioMenuFocus, setAudioMenuFocus] = useState(0);
  // Stats toggle (PlayerStatsPanel) — a plain on/off, no menu of its own.
  const [statsShown, setStatsShown] = useState(false);
  // Slow-connection hint: set after ~25s of CONTINUOUS native buffering.
  const [slowConn, setSlowConn] = useState(false);
  const [tracksTick, setTracksTick] = useState(0);
  const barHideTimerRef = useRef<number | null>(null);
  // Paused on purpose: the bar stays up (set in render, see barPaused below).
  const barPausedRef = useRef(false);
  const pokeBar = useCallback(() => {
    setBarVisible(true);
    if (barHideTimerRef.current) window.clearTimeout(barHideTimerRef.current);
    barHideTimerRef.current = null;
    if (barPausedRef.current) return;
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
  // A fresh state next time fullscreen opens — the stats panel itself never
  // renders once !fullscreen (below), so this only affects the toggle's
  // remembered value.
  useEffect(() => { if (!fullscreen) setStatsShown(false); }, [fullscreen]);

  // --- The channel list over the picture (◀ with the bar hidden) ---
  // It reuses the section's own pane / category / channel focus, so a
  // category opened here loads exactly as in the list. What the list showed
  // before is put back when the viewer closes it without picking a channel.
  const [chOverlayOpen, setChOverlayOpen] = useState(false);
  const chOverlayOpenRef = useRef(false);
  chOverlayOpenRef.current = chOverlayOpen;
  const overlayTimerRef = useRef<number | null>(null);
  // The category by its entry id (line + category), not its place: a service
  // folded in the overlay, or another service's categories arriving, moves
  // every place after it.
  const overlaySavedRef = useRef<{ entryId: string | null; lineKey: string | null; pane: Pane } | null>(null);
  // A category to put back once its folded service is open again.
  const restoreCatIdRef = useRef<string | null>(null);
  // After a restore, point the list back at the playing channel once the
  // restored category's channels are in (see the effect by the list refs).
  const refocusPlayingRef = useRef(false);
  // OK on a channel in it: watched when let go, its options when held.
  const ovHoldRef = useRef<{ ch: XtreamLiveStream; timer: number } | null>(null);
  const clearOverlayTimer = useCallback(() => {
    if (overlayTimerRef.current) { window.clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
  }, []);
  // Set below, once the list's state exists; the timer and the key handler
  // go through it.
  const closeChannelOverlayRef = useRef<(restore: boolean) => void>(() => {});
  const pokeOverlay = useCallback(() => {
    clearOverlayTimer();
    overlayTimerRef.current = window.setTimeout(() => closeChannelOverlayRef.current(true), CHANNEL_OVERLAY_IDLE_MS) as unknown as number;
  }, [clearOverlayTimer]);
  useEffect(() => () => {
    clearOverlayTimer();
    if (ovHoldRef.current) { window.clearTimeout(ovHoldRef.current.timer); ovHoldRef.current = null; }
  }, [clearOverlayTimer]);
  // Closed when full screen ends, and when Live TV loses the remote (the
  // voice overlay, a dialog over the Player), as Recently watched is.
  useEffect(() => {
    if (fullscreen && isActive) return;
    // Over the picture still: closed as Back closes it (the list put back).
    if (fullscreen && chOverlayOpenRef.current) { closeChannelOverlayRef.current(true); return; }
    clearOverlayTimer();
    if (ovHoldRef.current) { window.clearTimeout(ovHoldRef.current.timer); ovHoldRef.current = null; }
    setChOverlayOpen(false);
  }, [fullscreen, isActive, clearOverlayTimer]);

  // Reset bar state when entering fullscreen or switching channel (the
  // line too: another service's channel can have the same id).
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
  }, [fullscreen, playingChannelId, playingLine, pokeBar]);

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
    // With two or more services, their Favorites together come first.
    if (grouped && lines[0]) {
      let n = 0;
      for (const line of lines) n += favsByLine.get(lineKey(line))?.size ?? 0;
      out.push({ id: ALL_FAVS_ID, name: 'Favorites', count: n, isFav: true, isAllFavs: true, line: lines[0], lineKey: ALL_FAVS_ID });
    }
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

  // 2) Load the channels of the category the highlight rests on, from its
  //    own line: by themselves once the highlight has rested on it for
  //    CATEGORY_DWELL_MS (1 s); a fast pass over a category downloads nothing.
  //    - Skip headers and Favorites (rendered from metadata cache).
  //    - "All channels" is STRICTLY opt-in: never fetched by resting on it,
  //      only once the viewer opens it (OK / ▶ / a click).
  //    - At once, with no rest: the viewer opens the category (OK, ▶ or a
  //      click: the channel list takes the remote, `openedNow`); the list the
  //      section opens on, before the viewer has moved; and Update Channels
  //      asking again for the list on screen.
  //    - A list xtream keeps already (no download) shows after a short
  //      settle (KEPT_CATEGORY_SETTLE_MS), never the full rest, and without
  //      a spinner. The settle only keeps a held ▼ from drawing each one.
  //    - The category row's spinner shows only while its list downloads,
  //      never during the rest, and never stays on a category passed over.
  //    The wait is keyed ONLY on which category rests (`catFetchKey`, its
  //    id: the entry object is rebuilt whenever any list, count or favourite
  //    changes) and on Update Channels. Everything else it reads (the pane,
  //    the callbacks) goes through refs, so no re-render (a preview or a
  //    channel playing, the player's events, programme info coming in) can
  //    restart or cancel it.
  const currentCatRef = useRef(currentCat);
  currentCatRef.current = currentCat;
  const catFetchKey = currentCat && !currentCat.isHeader && !currentCat.isFav
    && (!currentCat.isAll || allOptedInRef.current) && !streamsByCat.has(currentCat.id)
    ? currentCat.id : null;
  const openedNow = pane === 'channels';
  const catLoadRef = useRef({ openedNow, tagLine, noteCountsFor, healFavorites });
  catLoadRef.current = { openedNow, tagLine, noteCountsFor, healFavorites };
  // Starts the waiting category's download now (the viewer opened it).
  const catLoadNowRef = useRef<(() => void) | null>(null);
  // A category the list moved to for the channel playing (one handed over,
  // a Recently watched pick): no rest, the viewer did not pass over it.
  const catAtOnceRef = useRef<string | null>(null);
  const seenRefreshRef = useRef(refreshTick);
  useEffect(() => {
    const refreshed = seenRefreshRef.current !== refreshTick;
    seenRefreshRef.current = refreshTick;
    const cat = currentCatRef.current;
    if (!catFetchKey || !cat || cat.id !== catFetchKey) return;
    let cancelled = false;
    let started = false;
    let t = 0;
    const key = cat.id;
    const line = cat.line;
    const catId = cat.catId;
    const isAll = !!cat.isAll;
    // Kept already (xtream's live catalogue): no download, so no spinner.
    const kept = !DEMO && hasLiveStreams(line, isAll ? undefined : catId);
    const start = () => {
      if (started || cancelled) return;
      started = true;
      window.clearTimeout(t);
      if (catLoadNowRef.current === start) catLoadNowRef.current = null;
      if (!kept) setLoadingCat(key);
      const fetchPromise = isAll
        ? fetchLiveStreams(line)
        : fetchLiveStreams(line, catId);
      fetchPromise
        .then((list) => {
          if (cancelled) return;
          const { tagLine: tag, noteCountsFor: noteFor, healFavorites: heal } = catLoadRef.current;
          tag(list, line);
          setStreamsByCat(prev => {
            const n = new Map(prev);
            n.set(key, list);
            return n;
          });
          // A list in hand is a free measurement, and a chance to re-link
          // favourites the provider moved.
          if (isAll) noteFor(line, { total: list.length, byCat: tallyByCategory(list) });
          else if (catId) noteFor(line, { byCat: { [catId]: list.length } });
          heal(line, list, isAll ? null : (catId ?? null));
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
    const moved = catAtOnceRef.current === key;
    if (moved) catAtOnceRef.current = null;
    const atOnce = catLoadRef.current.openedNow || refreshed || !userMovedRef.current || moved;
    t = window.setTimeout(start, atOnce ? 0 : kept ? KEPT_CATEGORY_SETTLE_MS : CATEGORY_DWELL_MS);
    catLoadNowRef.current = start;
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      if (catLoadNowRef.current === start) catLoadNowRef.current = null;
      // Passed over: no spinner left behind on it.
      setLoadingCat(prev => (prev === key ? null : prev));
    };
    // refreshTick: "Update Channels" while this category is loading must drop
    // the old answer and ask again under the new nonce.
  }, [catFetchKey, refreshTick]);
  // OK / ▶ / a click while the highlighted category waits: no more waiting.
  useEffect(() => { if (openedNow) catLoadNowRef.current?.(); }, [openedNow]);

  // A channel asked for by name (a voice command, the assistant): see below.
  const [pendingPlay, setPendingPlay] = useState<string | null>(() => peekIntent<string>('smc-live-play', true));
  useEffect(() => { clearIntent('smc-live-play'); }, []);

  // Full-catalog channel lists, one per line, fetched lazily ONLY when search
  // is opened (or a channel is asked for by name). Search runs across every line.
  const [allByLine, setAllByLine] = useState<Map<string, XtreamLiveStream[]>>(new Map());
  const [allChannelsLoading, setAllChannelsLoading] = useState(false);
  // Lines whose full list is on its way, kept in a ref: gating on the state
  // re-ran this effect, whose cleanup then cancelled the very fetch it had
  // just started, so search never got its results.
  const allLoadingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!searchOpen && !pendingPlay) return;
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
  }, [searchOpen, pendingPlay, lines, allByLine, noteCountsFor, tagLine, healFavorites]);

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

  // Each line's adult categories: search never shows their channels (lib/liveSearch).
  const adultCatsByLine = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [k, cats] of categoriesByLine) m.set(k, adultCategoryIds(cats));
    return m;
  }, [categoriesByLine]);

  // Resolve channel list for the focused category / favorites / search.
  const visibleChannels: XtreamLiveStream[] = useMemo(() => {
    // Search: every line's line-up, best matches first, never an adult
    // channel or a hidden category's, whatever is typed.
    if (searchOpen) {
      return searchLiveChannels(searchQ, lines.map((line) => {
        const k = lineKey(line);
        return { list: allByLine.get(k) || [], hidden: hidden.get(k), adultCats: adultCatsByLine.get(k) };
      }));
    }
    if (!currentCat || currentCat.isHeader) return [];
    if (currentCat.isAllFavs) {
      const out: XtreamLiveStream[] = [];
      for (const line of lines) {
        for (const f of (favsByLine.get(lineKey(line)) ?? EMPTY_FAVS).values()) {
          const st = favToStream(f);
          streamLineRef.current.set(st, line);
          out.push(st);
        }
      }
      return out;
    }
    if (currentCat.isFav) {
      const favs = favsByLine.get(currentCat.lineKey) ?? EMPTY_FAVS;
      return [...favs.values()].map((f) => {
        const st = favToStream(f);
        streamLineRef.current.set(st, currentCat.line);
        return st;
      });
    }
    return streamsByCat.get(currentCat.id) || [];
  }, [searchOpen, searchQ, lines, allByLine, hidden, adultCatsByLine, currentCat, streamsByCat, favsByLine]);

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

  // "Put on ESPN": look the name up in every line's full list and play the
  // channel it clearly means (channelForName; a favourite settles a tie). The
  // screen is left alone until then. If none does, or the lists have not
  // come in within a few seconds, nothing plays — the first name in a list
  // is only a guess — and the viewer is told which.
  useEffect(() => {
    if (!pendingPlay) return;
    const giveUp = setTimeout(() => {
      setPendingPlay(null);
      sayChannelNotFound(pendingPlay, allLoadingRef.current.size > 0);
    }, 12000);
    return () => clearTimeout(giveUp);
  }, [pendingPlay]);
  useEffect(() => {
    if (!pendingPlay || lines.length === 0 || !lines.every((l) => allByLine.has(lineKey(l)))) return;
    const favIds = new Set<number>();
    for (const m of favsByLine.values()) for (const id of m.keys()) favIds.add(id);
    // A search by voice: never a channel search leaves out (adult, hidden).
    const skip = (st: XtreamLiveStream) => {
      const k = lineKey(lineFor(st));
      return leftOutOfSearch(st, { hidden: hidden.get(k), adultCats: adultCatsByLine.get(k) });
    };
    const hit = channelForName(pendingPlay, lines.map((l) => allByLine.get(lineKey(l)) || []), favIds, skip);
    const said = pendingPlay;
    setPendingPlay(null);
    if (hit) playChannelRef.current(hit);
    else sayChannelNotFound(said);
  }, [pendingPlay, lines, allByLine, favsByLine, hidden, adultCatsByLine, lineFor]);
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

  // The channel actually playing, on its own line: the bar's number, name,
  // logo and guide, the record and report buttons all read it. The list's
  // own row when the list on screen holds it (its current name), else the
  // stream it was started from. Never the row the list happens to be on: a
  // channel Game Day started is often in no list on screen, and the bar
  // showed the first channel of the open category ("1 · A&E") and its guide.
  const playingKey = playingChannelId ? lineKey(playingLine) : '';
  const playingInList = useMemo(
    () => (playingChannelId
      ? visibleChannels.find((s) => s.stream_id === playingChannelId && lineKey(lineFor(s)) === playingKey) ?? null
      : null),
    [visibleChannels, playingChannelId, playingKey, lineFor],
  );
  const playingStream = useMemo<XtreamLiveStream | undefined>(() => {
    if (!playingChannelId) return focusedChannel;
    if (playingInList) return playingInList;
    const played = playedStreamRef.current;
    if (played && played.stream_id === playingChannelId && lineKey(lineFor(played)) === playingKey) return played;
    const stub: XtreamLiveStream = { stream_id: playingChannelId, name: '' };
    streamLineRef.current.set(stub, playingLine);
    return stub;
  }, [playingChannelId, playingInList, focusedChannel, playingKey, playingLine, lineFor]);
  // The category the playing channel is in: the open one when the list
  // holds it, else its own on its line when that is listed.
  const playingCat: CatEntry | undefined = !playingChannelId || playingInList
    ? currentCat
    : playingStream?.category_id != null
      ? visibleCategories.find((c) => c.lineKey === playingKey && c.catId === String(playingStream.category_id))
      : undefined;

  // A channel handed over from outside the list (Game Day, a reminder, the
  // content bar): once its line's categories are listed, the list moves to
  // the channel's own category and lands on it, so CH+ / CH- walk its
  // neighbours and leaving full screen finds it in place. Dropped when
  // another channel plays, the viewer moves, or the category is not listed.
  const followRef = useRef<{ key: string; catId: string; streamId: number; moved: boolean } | null>(null);
  // Bumped when a follow is set without a channel change (the list over the
  // picture opening on the playing channel's category), so the effect runs.
  const [followTick, setFollowTick] = useState(0);
  useEffect(() => {
    const f = followRef.current;
    if (!f) return;
    if (playingChannelId !== f.streamId || playingKey !== f.key) { followRef.current = null; return; }
    const entryId = `${f.key}|${f.catId}`;
    if (!f.moved) {
      const idx = visibleCategories.findIndex((c) => c.id === entryId);
      if (idx < 0) { if (categoriesByLine.has(f.key)) followRef.current = null; return; }
      f.moved = true;
      userMovedRef.current = true;
      if (idx !== categoryIdx) {
        // Only a list still to download: one in hand never reaches the load
        // effect, and the mark left behind skipped a later pass-over's rest.
        if (!streamsByCat.has(entryId)) catAtOnceRef.current = entryId;
        setCategoryIdx(idx);
        return;
      }
      // The list is on it already, maybe still resting: no rest.
      catLoadNowRef.current?.();
    }
    if (currentCat?.id !== entryId || searchOpen) { followRef.current = null; return; }
    if (playingInList) {
      followRef.current = null;
      const i = visibleChannels.indexOf(playingInList);
      if (i >= 0) setChannelIdx(i);
      return;
    }
    // Loaded, and not in it: the list stays where it is.
    if (!channelsLoading) followRef.current = null;
  }, [playingChannelId, playingKey, visibleCategories, categoriesByLine, categoryIdx, currentCat, searchOpen, playingInList, visibleChannels, channelsLoading, followTick]);

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
  // Player engine (owner test builds only — PlaybackScreen). mpv only ever
  // actually plays here: the main slot, live=true (EngineChoice); a preview
  // box and fullscreen share the one useNativePlayer call below, so passing
  // it through once covers both.
  const { engine: playerEngine } = usePlayerEngine();
  // First time in Live TV on this box: pick a look before anything else.
  const [choosingLayout, setChoosingLayout] = useState(() => (!DEMO || HOWTO) && !hasLiveLayoutChoice());
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
  // The programme on now, with its true end (the panel's clock is not always the box's), for the
  // "This programme (until …)" chip. It may arrive after the dialog opens.
  const [recordProgramme, setRecordProgramme] = useState<{ title: string; endMs: number } | null>(null);
  useEffect(() => {
    const nn = recordFor ? epgFor(recordFor.st)?.now : undefined;
    if (!recordFor || !nn) { setRecordProgramme(null); return; }
    let alive = true;
    void panelOffset(recordFor.line)
      .then((off) => {
        if (alive) setRecordProgramme({ title: nn.title, endMs: programmeTimeUtcMs(nn.endRaw, off) ?? nn.end });
      })
      .catch(() => { if (alive) setRecordProgramme({ title: nn.title, endMs: nn.end }); });
    return () => { alive = false; };
  }, [recordFor, epgFor]);
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
    // In fullscreen only the channel being watched matters: that one, not
    // the row the list is on (a channel Game Day started is in no list).
    const want: XtreamLiveStream[] = [];
    if (fullscreen && playingStream) want.push(playingStream);
    else if (focusedChannel) want.push(focusedChannel);
    // The channel list over the picture: the rows it draws.
    if (fullscreen && chOverlayOpen && pane === 'channels') {
      const half = Math.floor(OVERLAY_CHANNEL_ROWS / 2);
      const from = Math.max(0, Math.min(visibleChannels.length - OVERLAY_CHANNEL_ROWS, channelIdx - half));
      for (let i = from; i < Math.min(visibleChannels.length, from + OVERLAY_CHANNEL_ROWS); i++) want.push(visibleChannels[i]);
    }
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
  }, [virtualItems, visibleChannels, focusedChannel, playingStream, enqueueEpg, epgKey, cols, fullscreen, chOverlayOpen, pane, channelIdx]);

  // undefined: the highlighted channel's programme info is not in yet (the
  // info panel says "Loading…"); {} or no programme on now: it came back
  // empty, and only then "No program info available".
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
  const followOnPlayRef = useRef<{ st: XtreamLiveStream; run: () => void } | null>(null);
  // `catName`: the category to file the play under when it is not the one
  // the list shows (a Recently watched pick).
  const playChannel = useCallback((stream: XtreamLiveStream, catNameIn?: string) => {
    // What waits for this very stream to play (a Recently watched pick's
    // list follow); any other play drops it.
    const onPlay = followOnPlayRef.current;
    followOnPlayRef.current = null;
    if (onPlay && onPlay.st === stream) onPlay.run();
    const line = lineFor(stream);
    playedStreamRef.current = stream;
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
        // The channel's own category on its own line (a Guide hand-over, a
        // search pick or a zap is not filed under the list on screen); the
        // list's only when the line's categories don't name it.
        const ownCat = stream.category_id != null
          ? (categoriesByLine.get(lineKey(line)) ?? []).find((c) => String(c.category_id) === String(stream.category_id))?.category_name
          : undefined;
        const catName = catNameIn ?? ownCat ?? visibleCategories.find(c => c.id === (currentCat?.id ?? ''))?.name
          ?? currentCat?.name ?? '';
        watchingRef.current = { channel: stream.name, category: catName };
        // Into history only once it has stayed on screen: zapping through
        // twenty channels was twenty storage rewrites and cloud upserts,
        // each landing while the next stream was starting.
        if (watchRecordTimerRef.current) window.clearTimeout(watchRecordTimerRef.current);
        watchRecordTimerRef.current = window.setTimeout(() => {
          watchRecordTimerRef.current = null;
          try { recordChannelWatch(stream, line, catName); } catch { /* ignore */ }
          // A game whose Game Day list came up empty, and this channel names
          // its teams: tell Game Day's search where it was (never for Kids).
          if (!kidsLevel()) { try { noteLivePlay(line, stream, catName); } catch { /* ignore */ } }
        }, WATCH_RECORD_DWELL_MS);
        trackEvent('channel_play', 'player', {
          channel: stream.name,
          category: catName,
          server: line.serverLabel,
        });
      }
    } catch { /* ignore */ }
  }, [visibleCategories, currentCat, lineFor, categoriesByLine]);

  // OK on a channel goes full screen; the preview box already shows it.
  // One the others reported down (itself or its whole category) or
  // buffering asks first: Watch anyway / Pick another. Not for the channel
  // already playing, nor one this viewer chose to watch anyway a moment ago.
  const playingKeyRef = useRef('');
  playingKeyRef.current = playingChannelId ? `${lineKey(playingLine)}|${playingChannelId}` : '';
  const activateChannel = useCallback((stream: XtreamLiveStream, catName?: string) => {
    const line = lineFor(stream);
    const report = channelReport(downSetRef.current, line.host, stream.stream_id, stream.category_id);
    if (report && playingKeyRef.current !== `${lineKey(line)}|${stream.stream_id}` && !warnedRecently(line.host, stream.stream_id)) {
      setWarnFor({ stream, report });
      return;
    }
    playChannel(stream, catName);
  }, [playChannel, lineFor]);
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
    const stream: XtreamLiveStream = { stream_id: target.streamId!, name: target.name ?? i18n.t('live.list.channelFallback'), stream_icon: target.icon, category_id: target.categoryId, num: target.num };
    streamLineRef.current.set(stream, line);
    // Played as it was handed over (the bar names it from this, see
    // playingStream); the list then follows it to its own category.
    const start = () => {
      playChannelRef.current(stream);
      followRef.current = target!.categoryId
        ? { key: lineKey(line), catId: String(target!.categoryId), streamId: stream.stream_id, moved: false }
        : null;
    };
    if (!kidsLevel()) { start(); return; }
    void getLiveCategories(line)
      .then((cats) => { if (kidsAllowsChannel(stream, new Set(cats.map((c) => String(c.category_id))))) start(); })
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
  downSetRef.current = downSet;
  const playingName = playingChannelId ? playingStream?.name ?? '' : '';

  // Native ExoPlayer wiring — fullscreen, or the preview box while browsing.
  const nativeActive = NATIVE_PLAYBACK && fullscreen && !!playingChannelId;
  // The preview: the dwelt-on channel, in the box, while this section has
  // the remote and the box is on screen. Same player, same stream URL as
  // fullscreen, so OK on the previewing channel only moves the picture.
  const nativePreviewActive = NATIVE_PLAYBACK && !DEMO && isActive && !fullscreen && !!previewChannel && !recordingsOpen;
  // Vibez (strmz.xyz) is only reliable via the raw .ts container on Fire TV —
  // the shared buildNativeLiveUrl helper always swaps .m3u8→.ts. Dreamstreams
  // works on both.
  const directLiveUrl = !DEMO && nativeActive && playingChannelId
    ? buildNativeLiveUrl(playingLine, playingChannelId)
    : null;

  // Rewind live TV (TRACKER 25) for the full-screen channel. A catch-up
  // channel plays the panel's archive address in place of the channel's (the
  // address carries the line's login: it goes to SnowPlayer.load only); the
  // on-box buffer is switched to inside the native player and changes nothing
  // here. The buffer is a second stream on the line: the plan's stream count
  // (known for the main line) and the running recordings decide if it runs.
  const rewindStream = nativeActive && playingChannelId ? playingStream ?? null : null;
  const { account: playerAccount } = usePlayerAccount();
  const playingPlan = playerAccount && lineKey({ host: playerAccount.host, username: playerAccount.username }) === lineKey(playingLine)
    ? playerAccount.maxConnections
    : null;
  const rewind = useLiveRewind({
    active: nativeActive && !DEMO,
    directUrl: directLiveUrl,
    line: nativeActive ? playingLine : null,
    stream: rewindStream,
    watching: nativeActive && barVisible,
    engine: playerEngine,
    maxConnections: playingPlan,
    activeRecordings: recJobs.length,
  });
  const rewindRef = useRef(rewind);
  rewindRef.current = rewind;
  const catchupUrl = nativeActive ? rewind.playUrl : null;
  const nativeUrl = directLiveUrl
    ? (catchupUrl ?? directLiveUrl)
    : nativePreviewActive && previewChannel
      ? buildNativeLiveUrl(lineFor(previewChannel), previewChannel.stream_id)
      : null;
  const native = useNativePlayer({
    active: nativeActive || nativePreviewActive,
    url: nativeUrl,
    volume,
    engine: playerEngine,
    // A catch-up programme plays as a recording: it ends (back to live)
    // instead of reconnecting.
    live: !catchupUrl,
    rect: nativeActive ? undefined : previewRect,
    background: nativeActive,
    onTracksChanged: () => setTracksTick((t) => t + 1),
    onPlayStateChange: (p) => setIsPaused(p),
    onEnded: rewind.onEnded,
    // Rewind / Fast-forward go through the channel's rewind (below), not a
    // plain seek of the catch-up stream.
    skipKeys: false,
  });
  const rewindPausedChange = rewind.onPausedChange;
  useEffect(() => { rewindPausedChange(native.paused); }, [native.paused, rewindPausedChange]);

  // A recording took the streams the buffer needs: say why the rewind row went.
  const lastOffReasonRef = useRef<RewindOffReason | null>(null);
  useEffect(() => {
    const r = rewind.offReason;
    if (r === 'recording' && lastOffReasonRef.current !== 'recording') {
      try { toast({ title: rewindOffMessage('recording') }); } catch { /* ignore */ }
    }
    lastOffReasonRef.current = r;
  }, [rewind.offReason]);

  // mpv couldn't start on this box: told once per fallback, not on every
  // render (useNativePlayer clears engineNotice on the next load).
  const lastEngineNoticeRef = useRef<string | null>(null);
  useEffect(() => {
    const notice = native.engineNotice;
    if (!notice || notice === lastEngineNoticeRef.current) return;
    lastEngineNoticeRef.current = notice;
    toast({ title: t('live.toast.mpvFallbackTitle') });
  }, [native.engineNotice, t]);

  // Engine comparison (PlaybackScreen's Compare table): one getStats() read
  // 60 s into a Live channel on the main player, and again when it stops.
  // Only when mpv is in this build or the Stats panel is open: the read takes
  // the PSS on the UI thread, which a customer box does not need to pay for.
  const mpvInBuildRef = useRef(false);
  useEffect(() => {
    let alive = true;
    void SnowPlayer.getEngines().then((r) => { if (alive) mpvInBuildRef.current = !!r?.mpv?.available; }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!nativeActive) return;
    const startedAt = Date.now();
    const sample = (minutes: number) => {
      if (!shouldSampleEngines(mpvInBuildRef.current, statsShownRef.current)) return;
      void SnowPlayer.getStats({ memory: true }).then((st) => recordEngineSample(sampleFromStats(st, minutes))).catch(() => undefined);
    };
    const t = window.setTimeout(() => sample(1), 60_000);
    return () => {
      window.clearTimeout(t);
      const minutes = (Date.now() - startedAt) / 60_000;
      if (minutes > 0) sample(minutes);
    };
  }, [nativeActive, playingChannelId]);

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

  // CH+ / CH-: the next / previous channel of the list on screen. A channel
  // that list does not hold (Game Day started it and its own category is not
  // listed) counts as sitting just above the focused row: CH+ plays that
  // row, CH- the one before it — never one row past it.
  const changeChannelInFullscreen = useCallback((delta: 1 | -1) => {
    const n = visibleChannels.length;
    if (!n) return;
    const i = playingInList ? visibleChannels.indexOf(playingInList) : -1;
    const at = Math.min(channelIdx, n - 1);
    const next = i >= 0
      ? (i + delta + n) % n
      : delta > 0 ? at : (at - 1 + n) % n;
    setChannelIdx(next);
    playChannel(visibleChannels[next]);
  }, [visibleChannels, playingInList, channelIdx, playChannel]);

  // Remote media buttons while a channel is full screen. Rewind / Fast-forward
  // move 10 s back / forward through the channel's rewind (the panel's
  // catch-up or the on-box buffer), the same as the bar's Back 10s / Forward
  // 10s; held, they keep going (the steps are added up, one at a time). A
  // stream that seeks on its own is sought; else it says why there is no
  // rewind. Changing channel is ▲▼, CH+ / CH- and Next / Previous.
  // Play/Pause is handled by the player itself.
  const changeChannelRef = useRef(changeChannelInFullscreen);
  useEffect(() => { changeChannelRef.current = changeChannelInFullscreen; }, [changeChannelInFullscreen]);
  const skipToastAtRef = useRef(0);
  const liveSkip = useMemo(() => createSkipQueue(async (delta) => {
    const say = (msg: string | null) => {
      if (!msg || Date.now() - skipToastAtRef.current < 3000) return;
      skipToastAtRef.current = Date.now();
      try { toast({ title: msg }); } catch { /* ignore */ }
    };
    const rw = rewindRef.current;
    if (rw.kind !== 'off') {
      say(delta < 0 ? await rw.rewind(-delta) : await rw.forward(delta));
      return;
    }
    const ctrl = videoControllerRef.current;
    if (ctrl?.isSeekable()) { ctrl.seek(delta); return; }
    say(rewindOffMessage(rw.offReason));
  }), []);
  useEffect(() => {
    if (!isActive || !fullscreen) return;
    const off = onMediaKey((k) => {
      if (k === 'ff') { liveSkip.push(+MEDIA_SKIP_SEC); pokeBar(); }
      else if (k === 'rw') { liveSkip.push(-MEDIA_SKIP_SEC); pokeBar(); }
      else if (k === 'next' || k === 'chup') { liveSkip.clear(); changeChannelRef.current(+1); pokeBar(); }
      else if (k === 'prev' || k === 'chdown') { liveSkip.clear(); changeChannelRef.current(-1); pokeBar(); }
      else if (k === 'playpause' || k === 'play' || k === 'pause') pokeBar();
    });
    return () => { off(); liveSkip.clear(); };
  }, [isActive, fullscreen, pokeBar, liveSkip]);

  // What the native player is showing: the full-screen channel, or the one
  // in the preview box.
  const nativeStream = nativeActive && playingChannelId
    ? { host: playingLine.host, id: playingChannelId, name: playingName, catId: playingStream?.category_id }
    : nativePreviewActive && previewChannel
      ? { host: lineFor(previewChannel).host, id: previewChannel.stream_id, name: previewChannel.name, catId: previewChannel.category_id }
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
  // Down by its own report, or by its whole category's: playing fine ends
  // that one (a category with a channel that plays is not all down).
  // Buffering is not ended this way (lib/channelStatus).
  const shownReport = nativeStream ? channelReport(downSet, nativeStream.host, nativeStream.id, nativeStream.catId) : null;
  const shownDown = shownReport === 'down' || shownReport === 'category';
  useEffect(() => {
    if (!shownDown || native.buffering || native.error) return;
    const t = window.setTimeout(() => {
      const st = nativeStreamRef.current;
      if (!st) return;
      if (shownReport === 'down') signalChannel(st.host, st.id, st.name, 'ok');
      else if (st.catId != null) signalCategory(st.host, st.catId, '', 'ok');
    }, 12_000);
    return () => window.clearTimeout(t);
  }, [shownDown, shownReport, nativeKey, native.buffering, native.error]);

  // player_error — track native player fatal error transitions.
  const lastNativeErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const msg = native.error?.message ?? null;
    if (msg && msg !== lastNativeErrorRef.current) {
      lastNativeErrorRef.current = msg;
      try {
        trackEvent('player_error', 'player', {
          kind: 'live_native',
          channel_or_title: playingName,
          server: playingLine.serverLabel,
        });
      } catch { /* ignore */ }
    } else if (!msg) {
      lastNativeErrorRef.current = null;
    }
  }, [native.error, playingName, playingLine.serverLabel]);

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
      trackEvent('audio_unsupported', 'player', {
        kind: 'live_native',
        channel_or_title: playingName,
        server: playingLine.serverLabel,
        codecs: w.codecs,
        ffmpeg_available: w.ffmpegAvailable,
      });
    } catch { /* ignore */ }
  }, [native.audioWarning, playingName, playingChannelId, playingLine.serverLabel]);

  // (player_search intentionally NOT fired for Live TV — spec scopes it to movies/series/plex.)



  // Refs for keyboard handler
  const playingLineRef = useRef(playingLine);
  playingLineRef.current = playingLine;
  const playingStreamRef = useRef<XtreamLiveStream | null>(null);
  // The Recordings entry under Search is on screen (once something is recorded).
  const showRecEntry = ((recordOn && (hasRecordings || hasSchedules)) || HOWTO) && !searchOpen;
  const recEntryRef = useRef(showRecEntry);
  recEntryRef.current = showRecEntry;
  // It went away (the last recording deleted) while highlighted: hand the highlight back.
  useEffect(() => { if (!showRecEntry && recFocused) setRecFocused(false); }, [showRecEntry, recFocused]);
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
  const statsShownRef = useRef(statsShown);
  useEffect(() => { statsShownRef.current = statsShown; }, [statsShown]);

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
  // A held OK opens the channel's short menu (Favorite, Report, and Record…
  // where recording is offered); Record… leads on to the recording options.
  const openChannelOptions = useCallback((c: XtreamLiveStream) => { setReportFor(c); }, []);
  const openCategoryOptions = useCallback((c: { line: XtreamCreds; catId?: string; name: string } | undefined) => {
    if (c?.catId) setReportCatFor({ line: c.line, catId: c.catId, name: c.name });
  }, []);
  const openChannelOptionsRef = useRef(openChannelOptions);
  openChannelOptionsRef.current = openChannelOptions;
  const onRowLongPress = useCallback((i: number) => {
    setChannelIdx(i);
    const c = visibleChannelsRef.current[i];
    if (c) openChannelOptionsRef.current(c);
    else setReportFor(null);
  }, []);

  const playingIdRef = useRef(playingChannelId);
  playingIdRef.current = playingChannelId;
  /** Where the playing channel is in the list on screen (its line too: two
   *  services can share a stream id); -1 when the list does not hold it. */
  const playingIndexIn = useCallback((list: XtreamLiveStream[]): number => {
    const k = lineKey(playingLineRef.current);
    return list.findIndex((st) => st.stream_id === playingIdRef.current && lineKey(lineFor(st)) === k);
  }, [lineFor]);
  // The list behind goes to a channel's own category on its line (a search
  // open closes) and lands on the channel once its channels are in
  // (followRef, as for a channel handed over). False when that category is
  // not listed here.
  const followToCategory = useCallback((line: XtreamCreds, st: XtreamLiveStream): boolean => {
    if (st.category_id == null || !String(st.category_id)) return false;
    const k = lineKey(line);
    const catId = String(st.category_id);
    if (!visibleCategoriesRef.current.some((c) => c.lineKey === k && c.catId === catId)) return false;
    if (searchOpenRef.current) { setSearchOpen(false); setSearchQuery(''); }
    followRef.current = { key: k, catId, streamId: st.stream_id, moved: false };
    setFollowTick((n) => n + 1);
    return true;
  }, []);

  // Back from the picture (the bar already hidden): back where the channel
  // was opened from. The screen that sent the viewer here when there is one
  // (Game Day), else Live TV's list on the channel playing, in its category
  // (one handed over, or picked over the picture, has had the list follow
  // it there). Never out of Live TV.
  const leavePicture = useCallback(() => {
    setFullscreen(false);
    if (backToCallerRef.current?.()) return;
    const i = playingIndexIn(visibleChannelsRef.current);
    if (i >= 0) { setChannelIdx(i); setPane('channels'); }
  }, [playingIndexIn]);

  // Open the channel list over the picture: on the playing channel when the
  // list holds it; else on the playing channel's own category, the channel
  // highlighted once that category's channels are in; else where the list is.
  const openChannelOverlay = useCallback(() => {
    hideBarNow();
    const was = visibleCategoriesRef.current[categoryIdxRef.current];
    overlaySavedRef.current = { entryId: was?.id ?? null, lineKey: was?.lineKey ?? null, pane: paneRef.current };
    const chans = visibleChannelsRef.current;
    const i = playingIndexIn(chans);
    const st = playingStreamRef.current;
    if (i >= 0) { setChannelIdx(i); setPane('channels'); }
    else if (st && st.stream_id === playingIdRef.current && followToCategory(playingLineRef.current, st)) {
      setPane('channels');
      // Closed without a pick, the list stays on that category (▲▼ zap there).
      const k = lineKey(playingLineRef.current);
      const own = visibleCategoriesRef.current.find((c) => c.lineKey === k && c.catId === String(st.category_id));
      overlaySavedRef.current = { entryId: own?.id ?? null, lineKey: own?.lineKey ?? null, pane: 'channels' };
    }
    else setPane(chans.length ? 'channels' : 'categories');
    setChOverlayOpen(true);
    pokeOverlay();
  }, [hideBarNow, pokeOverlay, playingIndexIn, followToCategory]);
  // Close it. `restore`: nothing was picked, so the list goes back to what it
  // showed (the playing channel's category), and ▲▼ zap from there.
  const closeChannelOverlay = useCallback((restore: boolean) => {
    clearOverlayTimer();
    if (ovHoldRef.current) { window.clearTimeout(ovHoldRef.current.timer); ovHoldRef.current = null; }
    setChOverlayOpen(false);
    const saved = overlaySavedRef.current;
    overlaySavedRef.current = null;
    if (!restore || !saved) return;
    // Where that category is now. Its service folded in the overlay: opened
    // again, and the category found once it is listed (the effect below).
    const at = saved.entryId != null ? visibleCategoriesRef.current.findIndex((c) => c.id === saved.entryId) : -1;
    if (at < 0 && saved.entryId && saved.lineKey && collapsedRef.current.has(saved.lineKey)) {
      restoreCatIdRef.current = saved.entryId;
      refocusPlayingRef.current = true;
      toggleCollapsed(saved.lineKey);
    } else if (at >= 0 && at !== categoryIdxRef.current) {
      setCategoryIdx(at);
      refocusPlayingRef.current = true;
    } else {
      const i = playingIndexIn(visibleChannelsRef.current);
      if (i >= 0) setChannelIdx(i);
    }
    setPane(saved.pane);
  }, [clearOverlayTimer, playingIndexIn, toggleCollapsed]);
  closeChannelOverlayRef.current = closeChannelOverlay;
  useEffect(() => {
    const id = restoreCatIdRef.current;
    if (!id) return;
    const at = visibleCategories.findIndex((c) => c.id === id);
    if (at < 0) return;
    restoreCatIdRef.current = null;
    setCategoryIdx(at);
  }, [visibleCategories]);
  // Declared after the "reset channel focus on a new category" effect, so it
  // runs after it in the same commit.
  useEffect(() => {
    if (!refocusPlayingRef.current || chOverlayOpen || !visibleChannels.length) return;
    refocusPlayingRef.current = false;
    const i = playingIndexIn(visibleChannels);
    if (i >= 0) setChannelIdx(i);
  }, [visibleChannels, chOverlayOpen, playingChannelId, playingIndexIn]);
  // A channel picked in the list over the picture: watched (asked first when
  // the others reported it down, as in the list); the list stays on it.
  const pickFromOverlay = useCallback((ch: XtreamLiveStream) => {
    closeChannelOverlay(false);
    // Back from it goes to this channel's list, not to where the last one
    // was opened from (the Guide, Game Day).
    clearCallerRef.current?.();
    activateChannelRef.current(ch);
  }, [closeChannelOverlay]);
  const pickFromOverlayRef = useRef(pickFromOverlay);
  pickFromOverlayRef.current = pickFromOverlay;

  // ── Recently watched (▶) ───────────────────────────────────────────────
  // The panel (useRecentPanel / RecentChannelsPanel) over the picture or the
  // list. OK on a channel there is a channel change like any other: the list
  // behind goes to that channel's category with it highlighted (followRef),
  // so ▲▼ zap from there and Back from the picture lands on it. Channels of
  // every signed-in service, each played on its own line.
  const playRecentRef = useRef<(c: RecentChannel) => void>(() => {});
  const recent = useRecentPanel({
    lines,
    hidden,
    // A Kids profile's categories are already only the ones it may open.
    kidsCats: () => new Map(lines.map((l) => [lineKey(l), new Set((categoriesByLine.get(lineKey(l)) ?? []).map((c) => String(c.category_id)))])),
    adultCats: () => adultCatsByLine,
    playingId: () => (playingIdRef.current ? recentChannelId(playingLineRef.current, playingIdRef.current) : null),
    onPick: (c) => playRecentRef.current(c),
  });
  const recentRef = useRef(recent);
  recentRef.current = recent;
  playRecentRef.current = (c: RecentChannel) => {
    const k = lineKey(c.line);
    // The list's own copy when it is on screen (its EPG id), else history's.
    const chans = visibleChannelsRef.current;
    const at = chans.findIndex((st) => st.stream_id === c.stream.stream_id && lineKey(lineFor(st)) === k);
    const st = at >= 0 ? chans[at] : { ...c.stream };
    if (at < 0) streamLineRef.current.set(st, c.line);
    // The list follows only once it plays: the reported-down warning's "Pick
    // another" leaves the list (and the search) as they were.
    followOnPlayRef.current = {
      st,
      run: () => {
        // Back from it goes to this channel's list, not the Guide.
        clearCallerRef.current?.();
        if (at >= 0) setChannelIdx(at);
        else followToCategory(c.line, st);
        setPane('channels');
      },
    };
    const own = st.category_id != null
      ? categoriesByLine.get(k)?.find((x) => String(x.category_id) === String(st.category_id))?.category_name
      : undefined;
    activateChannelRef.current(st, c.category ?? own);
  };
  // Not left open behind a change of screen (full screen in or out, another section).
  useEffect(() => { recentRef.current.close(); }, [fullscreen, isActive]);
  const openRecent = useCallback(() => {
    hideBarNow();
    if (chOverlayOpenRef.current) closeChannelOverlayRef.current(true);
    recentRef.current.openPanel();
  }, [hideBarNow]);
  // The categories as the list over the picture draws them (only while open).
  const overlayCategories = useMemo<OverlayCategory[]>(() => (chOverlayOpen
    ? visibleCategories.map((c) => ({
      id: c.id,
      label: c.isAllFavs ? t('live.categories.allFavorites') : c.isFav ? t('live.categories.favorites') : c.isAll ? t('live.categories.all') : c.name,
      count: c.count,
      isHeader: c.isHeader,
      collapsedHeader: c.collapsedHeader,
      isFav: c.isFav,
    }))
    : []), [chOverlayOpen, visibleCategories, t]);
  useEffect(() => { searchOpenRef.current = searchOpen; }, [searchOpen]);
  useEffect(() => { barVisibleRef.current = barVisible; }, [barVisible]);
  // A pause — the remote's Play/Pause, OK on ▶❚❚, the phone remote — brings
  // the bar up on Play and holds it (pokeBar arms no hide while paused);
  // playing again hides it after the usual 5 s. Native: the player's own
  // paused flag, since isPaused also turns true on every stall there.
  const barPaused = fullscreen && (NATIVE_PLAYBACK ? native.paused : isPaused);
  barPausedRef.current = barPaused;
  const barPausedPrevRef = useRef(barPaused);
  useEffect(() => {
    if (barPausedPrevRef.current === barPaused) return;
    barPausedPrevRef.current = barPaused;
    if (barPaused) { if (!barVisibleRef.current) setBarFocus('play'); pokeBar(); }
    else if (barVisibleRef.current) pokeBar();
  }, [barPaused, pokeBar]);
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
      // The Report / Record dialogs and the Recordings screen own the keyboard while open.
      if (reportForRef.current || reportCatForRef.current || warnForRef.current || recordForRef.current || recordingsOpenRef.current) return;
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;


      // Remote "Menu" / context key on a category: its menu (Report category down).
      if (
        !fullscreenRef.current && !typing && paneRef.current === 'categories'
        && !searchFocusedRef.current && !recFocusedRef.current && !recentRef.current.isOpen()
        && (e.key === 'ContextMenu' || e.keyCode === 82)
      ) {
        const c = visibleCategoriesRef.current[categoryIdxRef.current];
        if (c?.catId) {
          e.preventDefault(); e.stopPropagation();
          cancelCatHold();
          openCategoryOptions(c);
          return;
        }
      }

      // Remote "Menu" / context key — open report for the focused channel.
      // Only when on the channels pane and not fullscreen/typing.
      if (
        !fullscreenRef.current &&
        !typing &&
        paneRef.current === 'channels' &&
        !recentRef.current.isOpen() &&
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
              setVolume(v => stepVolume(v, 0.1));
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

        // --- Recently watched over the picture (▶ with the bar hidden) ---
        // Its keys (useRecentPanel); Back or ◀ closes it, one step, and
        // nothing else.
        if (recentRef.current.isOpen()) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          if (isBack) (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
          recentRef.current.key(e);
          return;
        }

        // --- The channel list over the picture (◀ with the bar hidden) ---
        // ▲▼ move, ◀ categories (and from there closes), ▶ / OK open a
        // category, OK on a channel watches it (held: its options). Back
        // closes the list, one step, and nothing else.
        if (chOverlayOpenRef.current) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          if (isBack) {
            (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
            closeChannelOverlay(true);
            return;
          }
          pokeOverlay();
          const isOk = e.key === 'Enter' || e.key === ' ';
          if (isOk && e.repeat) return;
          const cats = visibleCategoriesRef.current;
          const chans = visibleChannelsRef.current;
          if (paneRef.current === 'categories') {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              // Search results give way to the categories the viewer moves through.
              if (searchOpenRef.current) { setSearchOpen(false); setSearchQuery(''); }
              userMovedRef.current = true;
              const n = Math.max(1, cats.length);
              const d = e.key === 'ArrowDown' ? 1 : -1;
              setCategoryIdx(i => (i + d + n) % n);
            } else if (e.key === 'ArrowLeft') {
              closeChannelOverlay(true);
            } else if (e.key === 'ArrowRight' || isOk) {
              const c = cats[categoryIdxRef.current];
              if (c?.isHeader) { toggleCollapsed(c.lineKey); return; }
              if (searchOpenRef.current) { setSearchOpen(false); setSearchQuery(''); }
              userMovedRef.current = true;
              if (c?.isAll) allOptedInRef.current = true;
              setPane('channels');
            }
            return;
          }
          if (e.key === 'ArrowDown') setChannelIdx(i => (chans.length ? (i + 1) % chans.length : 0));
          else if (e.key === 'ArrowUp') setChannelIdx(i => (chans.length ? (i - 1 + chans.length) % chans.length : 0));
          else if (e.key === 'ArrowLeft') setPane('categories');
          else if (isOk) {
            const ch = chans[channelIdxRef.current];
            if (!ch || ovHoldRef.current) return;
            // Let go: watch it (keyup below). Held: its options.
            ovHoldRef.current = {
              ch,
              timer: window.setTimeout(() => {
                ovHoldRef.current = null;
                closeChannelOverlay(true);
                openChannelOptionsRef.current(ch);
              }, HOLD_MS) as unknown as number,
            };
          }
          return;
        }

        // --- Back ---
        if (isBack) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          if (statsShownRef.current) { setStatsShown(false); return; }
          if (barVisibleRef.current) { hideBarNow(); return; }
          leavePicture();
          return;
        }

        // --- Native fatal-error overlay: Enter triggers retry ---
        if (nativeErrorRef.current && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault(); e.stopPropagation();
          nativeRetryRef.current();
          return;
        }

        // --- Bar is HIDDEN: ▲▼ zap, ◀ the channel list over the picture (on
        // the channel playing), ▶ Recently watched, OK shows the bar. The
        // volume is the bar's Volume and the remote's own keys. ---
        if (!barVisibleRef.current) {
          if (e.key === 'ArrowUp')    { e.preventDefault(); changeChannelInFullscreen(-1); pokeBar(); setBarFocus('play'); return; }
          if (e.key === 'ArrowDown')  { e.preventDefault(); changeChannelInFullscreen(+1); pokeBar(); setBarFocus('play'); return; }
          if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); openChannelOverlay(); return; }
          if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); openRecent(); return; }
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
        const rewindOn = rewindRef.current.kind !== 'off';
        // The same list and rule the bar itself draws from (liveBar.ts).
        const order = liveBarOrder({ record: recordOnRef.current });
        const isDisabled = (id: BarControlId): boolean =>
          liveBarDisabled(id, { seekable, rewind: rewindOn, subtitles: subs.length, audios: auds.length });

        if (e.key === 'ArrowLeft')  { setBarFocus(moveBarFocus(order, barFocusRef.current, -1, isDisabled)); return; }
        if (e.key === 'ArrowRight') { setBarFocus(moveBarFocus(order, barFocusRef.current, +1, isDisabled)); return; }
        if (e.key === 'ArrowUp')    { changeChannelInFullscreen(-1); setBarFocus('play'); pokeBar(); return; }
        if (e.key === 'ArrowDown')  { changeChannelInFullscreen(+1); setBarFocus('play'); pokeBar(); return; }
        if (e.key === 'Enter' || e.key === ' ') {
          const id = barFocusRef.current;
          if (id === 'prev')  changeChannelInFullscreen(-1);
          else if (id === 'next') changeChannelInFullscreen(+1);
          // Back 10s / Forward 10s: through the channel's rewind when it has
          // one, else a seek; held, the steps are added up (liveSkip).
          else if (id === 'rew')  { liveSkip.push(-MEDIA_SKIP_SEC); }
          else if (id === 'fwd')  { liveSkip.push(+MEDIA_SKIP_SEC); }
          // Greyed out (its slot is kept) until the channel has rewind.
          else if (id === 'golive') { if (rewindOn) void rewindRef.current.goLive(); }
          else if (id === 'rec') {
            const st = playingStreamRef.current;
            if (st && !e.repeat && recordOnRef.current) setRecordFor({ st, line: playingLineRef.current });
          }
          else if (id === 'report') {
            // The channel that is playing; the menu finds its line by the stream object.
            const st = playingStreamRef.current;
            if (st && !e.repeat) {
              streamLineRef.current.set(st, playingLineRef.current);
              setReportFor(st);
            }
          }
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
          else if (id === 'stats') {
            setStatsShown((v) => !v);
          }
          return;
        }
        return;
      }

      if (typing) return;

      // Recently watched over the list (▶ at its right edge): its keys; Back
      // or ◀ closes it, and the list's highlight comes back.
      if (recentRef.current.isOpen()) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
          (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        }
        recentRef.current.key(e);
        return;
      }

      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        // Mark that an overlay handled Back so the Capacitor hardware-back
        // listener (useNavigation) doesn't ALSO pop the navigation stack and
        // exit the Player on Android/Fire TV.
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        if (backToCallerRef.current?.()) return;
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
        // Recordings, between Search and the categories.
        if (recFocusedRef.current) {
          if (e.key === 'ArrowUp') { setRecFocused(false); setSearchFocused(true); return; }
          if (e.key === 'ArrowDown') { setRecFocused(false); return; }
          if (e.key === 'ArrowLeft') { onExitLeft(); return; }
          if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { setRecordingsOpen(true); return; }
          return;
        }
        if (searchFocusedRef.current) {
          if (e.key === 'ArrowUp')   { setSearchFocused(false); onExitUp?.(); return; }
          if (e.key === 'ArrowDown') {
            if (searchOpenRef.current && searchInputRef.current) { searchInputRef.current.focus(); return; }
            setSearchFocused(false);
            if (recEntryRef.current) setRecFocused(true);
            return;
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
          if (categoryIdxRef.current === 0) {
            if (recEntryRef.current) setRecFocused(true);
            else setSearchFocused(true);
            return;
          }
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
          // OK on a category: opened when let go; held, its menu (keyup below).
          if (e.key !== 'ArrowRight' && c?.catId) {
            const hold = catHoldRef.current;
            if (e.repeat || hold.timer || hold.fired) return;
            hold.timer = window.setTimeout(() => {
              hold.timer = null;
              hold.fired = true;
              openCategoryOptions(visibleCategoriesRef.current[categoryIdxRef.current]);
            }, HOLD_MS) as unknown as number;
            return;
          }
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
        else if (e.key === 'ArrowRight') {
          // Off the right edge (the last column, or the last tile): Recently watched.
          const i = channelIdxRef.current;
          if (i % nCols < nCols - 1 && i + 1 < n) setChannelIdx(i + 1);
          else openRecent();
        }
      }
      // One column: ▶ on a channel is the right edge.
      if (nCols === 1 && e.key === 'ArrowRight') { openRecent(); return; }
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
        // D-pad long-press detection. Short press = play; long press (~600ms) = the channel's options.
        // Ignore key repeats so holding doesn't restart the timer or re-fire play.
        if (e.repeat) return;
        if (enterTimerRef.current || enterFiredRef.current) return;
        enterFiredRef.current = false;
        enterTimerRef.current = window.setTimeout(() => {
          enterTimerRef.current = null;
          enterFiredRef.current = true;
          const c = visibleChannelsRef.current[channelIdxRef.current];
          if (c) openChannelOptionsRef.current(c);
        }, HOLD_MS) as unknown as number;
      }
     } catch { /* ignore */ }
    };
    const keyupHandler = (e: KeyboardEvent) => {
      // A short press on a channel in the list over the picture: watch it.
      if ((e.key === 'Enter' || e.key === ' ') && ovHoldRef.current) {
        const h = ovHoldRef.current;
        ovHoldRef.current = null;
        window.clearTimeout(h.timer);
        pickFromOverlayRef.current(h.ch);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        // A category's OK: let go before the hold, so open it. After the
        // hold its menu is already up: the release only arms that menu.
        const hold = catHoldRef.current;
        if (hold.timer) {
          cancelCatHold();
          if (paneRef.current === 'categories' && !fullscreenRef.current) setPane('channels');
        }
        hold.fired = false;
      }
      if (reportForRef.current || reportCatForRef.current || warnForRef.current || recordForRef.current || recordingsOpenRef.current) return;
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
      cancelCatHold();
    };
  }, [isActive, onExitLeft, onExitUp, toggleFavorite, changeChannelInFullscreen, playChannel, pokeBar, hideBarNow, cancelEnterTimer, cancelCatHold, openCategoryOptions, toggleCollapsed, liveSkip, openChannelOverlay, closeChannelOverlay, pokeOverlay, openRecent, leavePicture]);

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
          if (reportForRef.current || reportCatForRef.current || warnForRef.current || recordForRef.current || recordingsOpenRef.current) return;
          if (subMenuOpenRef.current || audioMenuOpenRef.current || volMenuOpenRef.current) { setSubMenuOpen(false); setAudioMenuOpen(false); setVolMenuOpen(false); return; }
          if (recentRef.current.isOpen()) { recentRef.current.close(); return; }
          if (fullscreenRef.current && chOverlayOpenRef.current) { closeChannelOverlayRef.current(true); return; }
          if (fullscreenRef.current) {
            if (barVisibleRef.current) hideBarNow();
            else leavePicture();
            return;
          }
          if (backToCallerRef.current?.()) return;
          if (paneRef.current === 'channels') { setPane('categories'); return; }
          onExitLeft();
        });
        if (cancelled) h?.remove?.(); else handle = h;
      } catch { /* web: keydown Escape already covers it */ }
    })();
    return () => { cancelled = true; handle?.remove?.(); };
  }, [isActive, onExitLeft, hideBarNow, leavePicture]);


  playingStreamRef.current = playingStream ?? null;
  const playingNowNext = epgFor(playingStream);
  const progress = (() => {
    if (!playingNowNext?.now) return 0;
    const { start, end } = playingNowNext.now;
    return Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100));
  })();

  // ── Record now ─────────────────────────────────────────────────────────────
  const jobFor = (name: string | undefined): RecordingJob | null =>
    (name ? recJobs.find((j) => j.channel === name) : undefined) ?? null;
  /** Streams the plan allows on a line (known for the main line only). */
  const planFor = (line: XtreamCreds): number | null =>
    playerAccount && lineKey({ host: playerAccount.host, username: playerAccount.username }) === lineKey(line)
      ? playerAccount.maxConnections
      : null;
  const startRecording = async (target: { st: XtreamLiveStream; line: XtreamCreds }, choice: RecordChoice) => {
    const { st, line } = target;
    const plan = planFor(line);
    // A recording is one more stream on the line: said on every start, in the
    // dialog, here, and in the error when the provider refuses (same words).
    const note = extraStreamNote(plan);
    try {
      // The rewind buffer gives its stream up first, so the line never sees
      // picture + buffer + recording together.
      const paused = await pauseRewindForRecording(plan);
      // Its own connection, like the player's; the address is never logged.
      const r = await SnowRecorder.start({
        url: buildNativeLiveUrl(line, st.stream_id),
        channel: st.name,
        fileName: recordingFileName(st.name),
        volumeId: choice.volumeId,
        durationMin: choice.durationMin,
        // At most two at once, fewer on a smaller plan (each is a stream).
        maxSimultaneous: Math.min(MAX_SIMULTANEOUS_RECORDINGS, plan && plan >= 1 ? plan : MAX_SIMULTANEOUS_RECORDINGS),
      });
      const endsAt = endsAtLabel(choice.durationMin);
      toast({
        title: t('live.toast.recordingTitle', { name: st.name }),
        description: t('live.toast.recordingDesc', {
          until: endsAt ? t('live.toast.recordingUntil', { time: endsAt }) : t('live.toast.recordingUntilStopped'),
          volume: r.volumeLabel,
          note: `${note}${paused ? ` ${REWIND_PAUSED_NOTE}` : ''}`,
        }),
      });
    } catch (e) {
      const err = e as Error & { code?: string };
      const why = err?.message ?? '';
      // A full drive has nothing to do with the line; every other refusal
      // (the plan's limit, the provider saying no) carries the stream note.
      toast({
        title: t('live.toast.recordingFailedTitle'),
        description: err?.code === 'NO_SPACE' ? why : `${why}${why ? ' ' : ''}${note}`,
        variant: 'destructive',
      });
    }
    notifyRecordingsChanged();
  };
  const closeRecordDialog = () => { setRecordFor(null); enterFiredRef.current = false; };
  const recordDialog = recordFor ? (
    <RecordDialog
      channelName={recordFor.st.name}
      maxConnections={planFor(recordFor.line)}
      programme={recordProgramme}
      activeJob={jobFor(recordFor.st.name)}
      onStart={(choice) => { const t = recordFor; closeRecordDialog(); void startRecording(t, choice); }}
      onStop={(id) => {
        closeRecordDialog();
        void SnowRecorder.stop({ id }).catch(() => { /* ignore */ }).then(() => {
          toast({ title: t('live.toast.recordingStoppedTitle'), description: t('live.toast.recordingStoppedDesc') });
          window.setTimeout(notifyRecordingsChanged, 1500);
        });
      }}
      onClose={closeRecordDialog}
    />
  ) : null;

  // The name of a channel's category on its line ('' when not listed).
  const categoryNameOf = (st: XtreamLiveStream): string => {
    const id = st.category_id != null ? String(st.category_id) : '';
    return id ? (categoriesByLine.get(lineKey(lineFor(st)))?.find((c) => String(c.category_id) === id)?.category_name ?? '') : '';
  };
  const channelReportDialog = reportFor ? (
    <Suspense fallback={null}>
      <ReportChannelDialog
        channelName={reportFor.name}
        channelId={reportFor.stream_id}
        categoryName={playingChannelId && !playingInList && reportFor === playingStream
          // The playing channel the list on screen does not hold: its own category.
          ? (playingCat?.name || '')
          : searchOpen ? 'Search' : (currentCat?.isFav ? 'Favorites' : (currentCat?.name || ''))}
        isFavorite={isFav(reportFor)}
        onToggleFavorite={() => toggleFavorite(reportFor)}
        onRecord={recordOn ? () => {
          const st = reportFor;
          // The recording options find the line by the stream object too.
          setReportFor(null);
          setRecordFor({ st, line: lineFor(st) });
        } : undefined}
        recording={!!jobFor(reportFor.name)}
        onRefreshFavorite={() => refreshFavorite(reportFor)}
        initialChoice={reportPreset?.choice}
        initialNote={reportPreset?.note}
        line={lineFor(reportFor)}
        onReportedDown={() => signalChannel(lineFor(reportFor).host, reportFor.stream_id, reportFor.name, 'down', lineFor(reportFor))}
        onReportedBuffering={() => signalChannel(lineFor(reportFor).host, reportFor.stream_id, reportFor.name, 'buffering', lineFor(reportFor))}
        isDown={channelReport(downSet, lineFor(reportFor).host, reportFor.stream_id, reportFor.category_id) !== null}
        onClearDown={() => {
          // "It's working now" ends what the others see on it: its own report
          // (down or buffering) and, when its category is what marks it, the
          // category's (a category with a channel that plays is not all down).
          const host = lineFor(reportFor).host;
          signalChannel(host, reportFor.stream_id, reportFor.name, 'clear');
          if (isCategoryDown(downSet, host, reportFor.category_id) && reportFor.category_id != null) {
            signalCategory(host, reportFor.category_id, categoryNameOf(reportFor), 'clear');
          }
        }}
        onOpenBufferingGuide={() => {
          setReportFor(null);
          enterFiredRef.current = false;
          onNavigate?.('support');
          setTimeout(() => { window.dispatchEvent(new CustomEvent('support:open-buffering-guide')); }, 80);
        }}
        onClose={() => { setReportFor(null); enterFiredRef.current = false; }}
      />
    </Suspense>
  ) : null;
  const categoryReportDialog = reportCatFor ? (
    <ReportCategoryDialog
      categoryName={reportCatFor.name}
      categoryId={reportCatFor.catId}
      serviceLabel={grouped ? lineLabel(reportCatFor.line) : undefined}
      line={reportCatFor.line}
      isDown={isCategoryDown(downSet, reportCatFor.line.host, reportCatFor.catId)}
      onReportedDown={() => signalCategory(reportCatFor.line.host, reportCatFor.catId, reportCatFor.name, 'down', reportCatFor.line)}
      onClearDown={() => signalCategory(reportCatFor.line.host, reportCatFor.catId, reportCatFor.name, 'clear')}
      onClose={() => { setReportCatFor(null); catHoldRef.current.fired = false; }}
    />
  ) : null;
  const warnDialog = warnFor ? (
    <ChannelWarningDialog
      channelName={warnFor.stream.name}
      report={warnFor.report}
      categoryName={categoryNameOf(warnFor.stream)}
      onWatch={() => {
        const { stream, report } = warnFor;
        const line = lineFor(stream);
        setWarnFor(null);
        noteWatchAnyway(line.host, stream.stream_id);
        try { trackEvent('report_warning', 'player', { status: report, choice: 'watch', where: 'live', channel: stream.name }); } catch { /* ignore */ }
        playChannel(stream);
      }}
      onPickAnother={() => {
        const { stream, report } = warnFor;
        setWarnFor(null);
        try { trackEvent('report_warning', 'player', { status: report, choice: 'pick_another', where: 'live', channel: stream.name }); } catch { /* ignore */ }
      }}
    />
  ) : null;
  const reportDialog = (
    <>
      {channelReportDialog}
      {categoryReportDialog}
      {warnDialog}
    </>
  );

  // The rows a channel row is "the one playing" by: its id on its own line.
  const isPlayingRow = (st: XtreamLiveStream): boolean =>
    !!playingChannelId && st.stream_id === playingChannelId && lineKey(lineFor(st)) === playingKey;

  // Recently watched (▶): over the picture or over the list.
  const recentPanel = recent.open ? (
    <RecentChannelsPanel
      items={recent.items}
      focus={recent.focus}
      onRemove={recent.onRemove}
      playingId={playingChannelId ? recentChannelId(playingLine, playingChannelId) : null}
      over={fullscreen ? 'picture' : 'list'}
      serviceOf={grouped ? (c) => lineLabel(c.line) : undefined}
    />
  ) : null;

  // Live TV › Recordings takes the section over (the remote too).
  if (recordingsOpen) {
    return (
      <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
        <RecordingsScreen active={isActive} onClose={() => { setRecordingsOpen(false); refreshRecordings(); }} />
      </Suspense>
    );
  }

  if (fullscreen) {
    // Native path: chrome renders over a transparent layer so the ExoPlayer
    // TextureView behind the WebView shows through. Web/fallback path keeps
    // the original <VideoPlayer> element rendering into the WebView.
    return (
      <div className={`fixed inset-0 z-[60] text-white ${NATIVE_PLAYBACK ? 'bg-transparent' : 'bg-black'}`}>
        {!NATIVE_PLAYBACK && !DEMO && (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><div className="w-full max-w-md"><SnowLoader size="lg" label={t('common.loading')} /></div></div>}>
            <VideoPlayer
              src={streamUrl}
              volume={volume}
              muted={false}
              className="w-full h-full"
              onReady={(c) => { videoControllerRef.current = c; setIsPaused(c.isPaused()); }}
              onPlayStateChange={(paused) => setIsPaused(paused)}
              onTracksChanged={() => setTracksTick(t => t + 1)}
              onError={(msg) => {
                if (playingChannelId) signalChannel(playingLine.host, playingChannelId, playingName, 'fail');
                try {
                  trackEvent('player_error', 'player', {
                    kind: 'live_web',
                    channel_or_title: playingName,
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
                {playingNowNext.next
                  ? t('live.list.nowNextLine', { title: playingNowNext.now.title, next: playingNowNext.next.title })
                  : t('live.list.nowLine', { title: playingNowNext.now.title })}
              </p>
            )}
            <p className="mt-6 px-3 py-1 rounded-full bg-brand-gold/20 border border-brand-gold/40 text-brand-gold text-xs font-nunito font-semibold tracking-widest uppercase">
              {t('live.player.demoMode')}
            </p>
            <p className="mt-2 text-brand-ice/70 font-nunito text-xs max-w-md">{demoDialogMsg()}</p>
          </div>
        )}
        {NATIVE_PLAYBACK && native.buffering && !native.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
            <div className="w-full max-w-md"><SnowLoader size="lg" label={t('live.player.buffering')} /></div>
            {slowConn && (
              <p className="max-w-md px-4 text-center text-sm font-nunito text-brand-ice/80">
                {t('live.player.slowConnection')}
              </p>
            )}
          </div>
        )}
        {NATIVE_PLAYBACK && !native.error && (
          <BufferingDiagnostics
            buffering={native.buffering}
            className="mt-12"
            footnote={!DEMO && listsViaSnowMedia(playingLine.host) ? t('live.player.listViaSnowMedia') : undefined}
          />
        )}
        {/* Audio present but undecodable on this device: video is fine, so don't
            block it — just say why there's no sound, and name the codec so
            support can act on it instead of guessing. */}
        {NATIVE_PLAYBACK && native.audioWarning && !native.error && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 max-w-lg rounded-2xl bg-black/85 px-5 py-3 text-center">
            <p className="font-quicksand font-semibold text-brand-gold text-sm">
              {t('live.player.noSoundTitle')}
            </p>
            <p className="mt-1 font-nunito text-xs text-brand-ice/80">
              {t('live.player.noSoundBody', { codecs: native.audioWarning.codecs })}
            </p>
            {/* i18n-ignore: a technical line for the support desk to read off the screen, so it stays English */}
            <p className="mt-1 font-nunito text-xs text-brand-ice/70">{`audio-decode: ${native.audioWarning.codecs} · ffmpeg: ${native.audioWarning.ffmpegAvailable ? 'yes' : 'no'}`}</p>
          </div>
        )}
        {NATIVE_PLAYBACK && native.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-white p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-brand-gold mb-3" />
            <p className="text-xl font-quicksand font-semibold mb-1">{t('live.player.playbackError')}</p>
            <p className="text-sm text-brand-ice/80 font-nunito max-w-md mb-4">{native.error.message}</p>
            <button
              onClick={() => native.retry()}
              autoFocus
              data-focused="true"
              className="tv-ring tv-ring-contrast flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold scale-105 z-10"
            >
              <RotateCw className="w-4 h-4" /> {t('common.retry')}
            </button>
          </div>
        )}
        {NATIVE_PLAYBACK && statsShown && !chOverlayOpen && !recent.open && <PlayerStatsPanel />}
        <PlayerControlBar
          visible={barVisible && !chOverlayOpen && !recent.open}
          order={liveBarOrder({ record: recordOn })}
          rewind={rewind.info}
          recording={!!jobFor(playingStream?.name)}
          focus={barFocus}
          isPaused={isPaused}
          statsOn={statsShown}
          controller={videoControllerRef.current}
          tracksTick={tracksTick}
          categoryName={playingCat ? catLabel(playingCat) : undefined}
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
        {chOverlayOpen && (
          <FullscreenChannelOverlay
            pane={pane}
            categories={overlayCategories}
            categoryIdx={categoryIdx}
            grouped={grouped}
            channels={visibleChannels}
            channelIdx={safeChannelIdx}
            // With two or more services, the category's service too.
            channelsTitle={searchOpen ? t('live.categories.search')
              : !currentCat ? t('live.categories.channels')
                : grouped && !currentCat.isAllFavs && !currentCat.isHeader ? `${lineLabel(currentCat.line)} · ${catLabel(currentCat)}` : catLabel(currentCat)}
            loading={channelsLoading}
            isPlaying={isPlayingRow}
            isFavorite={isFav}
            reportOf={(st) => channelReport(downSet, lineFor(st).host, st.stream_id, st.category_id)}
            nowTitle={(st) => epgFor(st)?.now?.title}
            serviceTag={currentCat?.isAllFavs && !searchOpen ? (st) => lineLabel(lineFor(st)) : undefined}
            labels={rowLabels}
          />
        )}
        {recentPanel}
        {/* Volume hint while bar is hidden */}
        {!barVisible && !chOverlayOpen && !recent.open && volPillShown && (
          <div className="absolute bottom-4 right-6 px-3 py-2 rounded-full bg-black/60 text-brand-ice/80 font-nunito text-xs pointer-events-none">
            {t('live.player.volPill', { pct: Math.round(volume * 100) })}
          </div>
        )}
        {reportDialog}
        {recordDialog}
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
          data-howto="live.searchBtn"
          className={`tv-ring w-full flex items-center gap-2 px-3 py-3 mb-2 rounded-xl border border-white/10 text-brand-ice font-nunito text-base ${searchFocused ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-black/40'}`}
        >
          <Search className="w-4 h-4" />
          <span className="min-w-0 truncate">{searchOpen ? t('live.list.closeSearchBtn') : t('live.list.searchChannelsBtn')}</span>
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
            placeholder={t('live.list.searchPlaceholder')}
            data-howto="live.searchBox"
            className="w-full mb-3 rounded-xl bg-black/40 text-white border border-white/20 px-3 py-3 font-nunito text-base focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
        )}
        {showRecEntry && (
          <button
            onClick={() => setRecordingsOpen(true)}
            data-focused={recFocused ? 'true' : 'false'}
            data-howto="live.recordingsBtn"
            className={`tv-ring w-full flex items-center gap-2 px-3 py-3 mb-2 rounded-xl border border-white/10 text-brand-ice font-nunito text-base ${recFocused ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-black/40'}`}
          >
            <Film className="w-4 h-4" />
            <span className="min-w-0 truncate">{t('live.list.recordingsBtn')}</span>
            {recJobs.length > 0 && <span className="ml-auto w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" aria-label={t('live.list.recordingNow')} />}
          </button>
        )}
        {!searchOpen && (
          <>
            {categoriesLoading && categories.length === 0 && (
              <div className="px-3 py-2 text-brand-ice/70 font-nunito text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> {t('live.list.loadingCategories')}
              </div>
            )}
            {visibleCategories.length > 0 && (
              <div
                ref={categoriesListRef}
                data-howto="live.categories"
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
                  const isFocused = isActive && pane === 'categories' && !searchFocused && !recFocused && categoryIdx === i;
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
                      data-howto={c.isHeader ? 'live.lineGroup' : c.isFav && c.lineKey === activeKey ? 'live.favorites' : undefined}
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
                        {catLabel(c)}
                      </span>
                      {c.catId && isCategoryDown(downSet, c.line.host, c.catId) && (
                        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" aria-label={t('live.categories.downLabel')} data-category-down="" />
                      )}
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
    <div ref={scrollParentRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3" data-howto="live.channels">
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
                    ? (allChannelsLoading ? t('live.list.loadingCatalog') : t('live.list.noMatch'))
                    : (allChannelsLoading ? t('live.list.loadingCatalog') : t('live.list.typeToSearch')))
                : currentCat?.isFav
                  ? t('live.list.noFavorites')
                  : t('live.list.noChannelsInCategory')}
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
                      // Recently watched over the list has the highlight while it is open.
                      isFocused={isActive && pane === 'channels' && idx === safeChannelIdx && !recent.open}
                      isPlaying={playingChannelId === s.stream_id}
                      isFavorite={isFav(s)}
                      report={channelReport(downSet, lineFor(s).host, s.stream_id, s.category_id)}
                      nowNext={epgFor(s)}
                      onSelect={onRowSelect}
                      onActivate={onRowActivate}
                      onLongPress={onRowLongPress}
                      labels={rowLabels}
                      serviceTag={currentCat?.isAllFavs && !searchOpen ? lineLabel(lineFor(s)) : undefined}
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
              ? <span className="text-brand-ice/70 font-nunito text-sm text-center px-4">{t('live.list.cantPreview')}</span>
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
          {focusedChannel ? t('live.list.pressOkWatch') : t('live.list.noChannelSelected')}
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm text-center px-4">
          {focusedChannel ? t('live.list.previewLoading') : t('live.list.noChannelSelected')}
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
              {grouped && currentCat?.line && !currentCat.isAllFavs && (
                <div className="text-xs font-quicksand font-semibold tracking-[0.12em] uppercase text-brand-gold truncate">{lineLabel(currentCat.line)}</div>
              )}
              <div className="text-sm font-quicksand font-semibold text-white truncate">
                {searchOpen ? t('live.categories.search') : (currentCat ? catLabel(currentCat) : t('live.categories.channels'))}
                {!searchOpen && catCount ? <span className="text-brand-ice/60 font-nunito font-normal"> · {formatCount(catCount)}</span> : null}
              </div>
            </div>
            <span className="text-xs font-nunito text-brand-ice/50 flex-shrink-0">{t('live.categories.tag')}</span>
          </div>
          {channelList}
        </div>

        {/* Stage: the preview, then what is on now and next */}
        <div className="flex-1 min-w-0 flex flex-col p-5 gap-3 overflow-hidden">
          <div ref={previewBoxRef} data-howto="live.preview" className={`relative w-full aspect-video max-h-[56%] rounded-2xl overflow-hidden border border-white/10 flex-shrink-0 ${nativePreviewActive ? '' : 'bg-black'}`}>
            {previewBox}
          </div>

        {/* The highlighted channel, under the preview rather than over it so
            it never fights the preview's own controls. */}
        {focusedChannel && (
          <div className="flex-shrink-0" data-howto="live.nowNext">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-quicksand font-bold text-white truncate">{focusedChannel.name}</h3>
              {isFav(focusedChannel) && <Star className="w-4 h-4 text-brand-gold fill-brand-gold flex-shrink-0" />}
              {channelsLoading && <Loader2 className="w-4 h-4 animate-spin text-brand-gold ml-auto" />}
            </div>
            {focusedNowNext?.now ? (
              <>
                <p className="text-sm text-brand-ice/85 font-nunito truncate mt-0.5">
                  {focusedNowNext.now.title} · {formatTime(focusedNowNext.now.start)} – {formatTime(focusedNowNext.now.end)}
                  {nowLeftMins != null ? ` · ${t('live.list.minLeft', { minutes: nowLeftMins })}` : ''}
                </p>
                <div className="mt-2 h-[3px] rounded-full bg-white/15 overflow-hidden">
                  <div className="h-full bg-brand-gold" style={{ width: `${Math.min(100, Math.max(0, ((Date.now() - focusedNowNext.now.start) / (focusedNowNext.now.end - focusedNowNext.now.start)) * 100))}%` }} />
                </div>
              </>
            ) : focusedNowNext ? (
              <p className="text-sm text-brand-ice/70 font-nunito mt-0.5">{t('live.list.noProgramInfo')}</p>
            ) : (
              <p data-live-info-loading className="text-sm text-brand-ice/40 font-nunito mt-0.5">{t('common.loading')}</p>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          {focusedChannel ? (
            <>
              <div className="flex gap-6">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-quicksand font-semibold tracking-[0.14em] uppercase text-brand-gold">{t('live.list.nowHeading')}</p>
                  <p className="text-sm font-nunito font-semibold text-white truncate mt-1">{focusedNowNext?.now?.title ?? '—'}</p>
                  {focusedNowNext?.now && (
                    <p className="text-xs font-nunito text-brand-ice/70 mt-0.5">{formatTime(focusedNowNext.now.start)} – {formatTime(focusedNowNext.now.end)}</p>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-quicksand font-semibold tracking-[0.14em] uppercase text-brand-ice/55">{t('live.list.nextHeading')}</p>
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
              {channelsLoading ? t('live.list.loadingChannels') : t('live.list.noChannelFocused')}
            </p>
          )}
        </div>

          <p className="flex-shrink-0 pr-24 text-xs font-nunito text-brand-ice/55">{t('live.list.hintCompact')}</p>
        </div>
      {reportDialog}
      {recordDialog}
      {recentPanel}
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
              {grouped && currentCat?.line && !currentCat.isAllFavs && (
                <span className="text-xs font-quicksand font-semibold tracking-[0.12em] uppercase text-brand-gold">{lineLabel(currentCat.line)}</span>
              )}
              <span className="text-base font-quicksand font-semibold text-white truncate">{searchOpen ? t('live.categories.search') : (currentCat ? catLabel(currentCat) : t('live.categories.channels'))}</span>
              {!searchOpen && catCount ? <span className="text-sm text-brand-ice/60 font-nunito">{formatCount(catCount)}</span> : null}
            </div>
            <span className="text-xs font-nunito text-brand-ice/50">{t('live.list.hintGrid')}</span>
          </div>
          {channelList}
        </div>
      {reportDialog}
      {recordDialog}
      {recentPanel}
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
          <div ref={previewBoxRef} data-howto="live.preview" className={`w-64 aspect-video rounded-xl overflow-hidden border border-white/10 flex-shrink-0 ${nativePreviewActive ? '' : 'bg-black'}`}>
            {previewBox}
          </div>
          <div className="flex-1 min-w-0" data-howto="live.nowNext">
            {focusedChannel ? (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-quicksand font-bold text-white truncate">{focusedChannel.name}</h3>
                  {isFav(focusedChannel) && <Star className="w-5 h-5 text-brand-gold fill-brand-gold" />}
                  {channelsLoading && <Loader2 className="w-4 h-4 animate-spin text-brand-gold ml-auto" />}
                </div>
                {focusedNowNext?.now ? (
                  <>
                    <p className="text-brand-ice/90 font-nunito truncate mt-1">{t('live.list.nowLine', { title: focusedNowNext.now.title })}</p>
                    <p className="text-xs text-brand-ice/70 font-nunito mt-1">
                      {formatTime(focusedNowNext.now.start)} – {formatTime(focusedNowNext.now.end)}
                      {nowLeftMins != null ? ` · ${t('live.list.minLeft', { minutes: nowLeftMins })}` : ''}
                    </p>
                  </>
                ) : focusedNowNext ? (
                  <p className="text-brand-ice/70 font-nunito mt-1 text-sm">{t('live.list.noProgramInfo')}</p>
                ) : (
                  <p data-live-info-loading className="text-brand-ice/40 font-nunito mt-1 text-sm">{t('common.loading')}</p>
                )}
                {focusedNowNext?.next && (
                  <p className="text-sm text-brand-ice/70 font-nunito mt-2 truncate">
                    {t('live.list.nextLine', { title: focusedNowNext.next.title, time: formatTime(focusedNowNext.next.start) })}
                  </p>
                )}
                <p className="text-xs text-brand-ice/60 font-nunito mt-4">{t('live.list.hintClassic')}</p>
              </>
            ) : (
              <p className="text-brand-ice/70 font-nunito">
                {channelsLoading ? t('live.list.loadingChannels') : t('live.list.noChannelFocused')}
              </p>
            )}
          </div>
        </div>
        {channelList}
      </div>
      {reportDialog}
      {recordDialog}
      {recentPanel}
    </div>
  );

});

LiveSection.displayName = 'LiveSection';
export default LiveSection;
