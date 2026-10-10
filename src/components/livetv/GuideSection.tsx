// Classic cable-style EPG grid. Windowed & virtualized:
//   • categories → getLiveCategories (like LiveSection)
//   • Favorites → the line's saved favourites (favoritesSync), first in the
//     bar as in LiveSection's list; read from the box, no provider call
//   • channels for selected category → getLiveStreams(categoryId)
//   • EPG → getShortEpg per-channel, concurrency-capped, only for the
//     currently-rendered virtual rows (never all channels at once).
// Xtream has no bulk XMLTV endpoint that's safe on Fire TV — do NOT fetch
// xmltv.php (freezes the WebView).
//
// Hold OK (600 ms, as in Live TV's list) on a channel, or press the Menu key:
// its menu, Live TV's own (Report Channel, Add to / Remove from Favorites,
// Record…); a finger held on a row or a right click does the same. OK pressed
// briefly still plays: it acts when it is let go, so a hold can be told apart.
//
// Scheduled recordings (TRACKER 25.12): the menu's Record… opens the Record
// dialog in programme mode, built from the listings already loaded here (a
// Kids profile, the demo and a build without the recorder get no Record…).
// Programmes that are scheduled carry a small red dot.
//
// Two sizes (lib/viewSize, Live TV › Settings › Appearance › Size; ported
// from Tronix build 43, where the Guide showed 3 channels where 8 fit).
// Large is the older Guide exactly: the category chips, the Player's header
// above, 72 px rows. Compact (the default) is drawn by renderCompact below:
// no header and no chips; the preview and what is on across the top, a slim
// time bar, rows with no gaps (36 px on a TV, 44 px on a touch screen), the
// current category at the left of the time bar, the categories in a drawer
// over the left edge (with the service, Settings and Update Channels at its
// top), and a slim bottom bar with the hints and the Player's buttons. See
// the D-pad comment in the key handler for the ◀ rule.
import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Loader2, Tv, AlertTriangle, RotateCw, Star, ChevronLeft, ChevronRight, ArrowLeft, RefreshCw, Settings as SettingsIcon, LayoutList } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  getLiveCategories,
  getLiveStreams,
  getShortEpg,
  hasLiveStreams,
  buildLiveStreamUrl,
  decodeEpgText,
  parseEpgTime,
  loadVolume,
  saveVolume,
  loadPlayerAccount,
  buildNativeLiveUrl,
  XTREAM_REFRESH_EVENT,
  type FavChannel,
  type XtreamCreds,
  type XtreamCategory,
  type XtreamLiveStream,
  type XtreamEpgEntry,
} from '@/lib/xtream';
import { commitFavoritesForLine, loadFavoritesForLine, lineKey, toggledFavorites } from '@/lib/favoritesSync';
import { handLiveDeeplink } from '@/lib/appActions';
import { signalChannel } from '@/lib/channelStatus';
import { nameClasses } from '@/lib/channelName';
import { useViewSize } from '@/lib/viewSize';
import { usePhoneLayout, useTouchUI } from '@/lib/phoneMode';
import { keepInView } from '@/utils/keepInView';
import { CATEGORY_DWELL_MS, KEPT_CATEGORY_SETTLE_MS } from '@/lib/categoryDwell';
import { useWhenSettled } from '@/hooks/useWhenSettled';
import { kidsAllowsChannel, kidsLevel } from '@/lib/kidsFilter';
import { isFireTV, isLowMemoryBox } from '@/utils/platform';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import {
  SnowRecorder, RECORDINGS_CHANGED_EVENT, hasRecorder, notifyRecordingsChanged, type RecordSchedule,
} from '@/capacitor/SnowRecorder';
import { panelOffset } from '@/hooks/useLiveRewind';
import {
  busyFromJobs, conflictMessage, loadPadding, minutesUntil, paddedLabel, paddedWindow, programmeChoices, programmeMode,
  programmeTimeUtcMs, recordingCap, type ProgrammeChoice, type SchedLike,
} from '@/lib/recordSchedule';
import { REWIND_PAUSED_NOTE, endsAtLabel, extraStreamNote, pauseRewindForRecording, recordingFileName } from '@/lib/recording';
import RecordDialog, { type RecordChoice } from './RecordDialog';
import { useNativePlayer } from '@/hooks/useNativePlayer';
import { usePlayerEngine } from '@/hooks/usePlayerEngine';
import { toast } from '@/hooks/use-toast';
import BufferingDiagnostics from './BufferingDiagnostics';
import SnowLoader from '@/components/SnowLoader';
import { isDemo, demoDialogMsg } from '@/lib/demoMode';
import { voiceOwnsBack } from '@/lib/voiceUi';
import i18n from '@/i18n';
import { formatTime } from '@/i18n/format';
import { useTranslation } from 'react-i18next';
import {
  demoGetLiveCategories,
  demoGetLiveStreams,
  demoGetShortEpg,
} from '@/lib/xtreamDemo';
import { stepVolume } from '@/utils/volume';

const VideoPlayer = lazy(() => import('./VideoPlayer'));
const ReportChannelDialog = lazy(() => import('./ReportChannelDialog'));
const NATIVE_PLAYBACK = hasNativePlayer();
// Demo latch (?demo=1) — canned guide data, no provider contact, no <video>.
const DEMO = isDemo();
// Recording a programme needs the recorder plugin (owner's newer builds), the
// native player and a real line; a Kids profile is checked when OK is held.
const SCHEDULE_CAPABLE = NATIVE_PLAYBACK && !DEMO && hasRecorder();
// Demo call-site swap (Plex pattern): fixtures answer every read in demo.
const fetchLiveCategories = DEMO ? demoGetLiveCategories : getLiveCategories;
const fetchLiveStreams = DEMO ? demoGetLiveStreams : getLiveStreams;
const fetchShortEpg = DEMO ? demoGetShortEpg : getShortEpg;

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
  onNavigate?: (view: string) => void;
  /** A channel picked here plays in Live TV's own player (handLiveDeeplink):
   *  the same bar and options, its name and hints that go away. LiveTV shows
   *  Live TV and keeps `place`; Back from the picture opens the Guide again
   *  with it (resumeAt). Without it (or in the demo) the Guide plays the
   *  channel itself. */
  onWatch?: (place: GuidePlace) => void;
  /** Where the Guide was when it handed a channel over (read once, at mount):
   *  the same category, channel and time. Only Back from that picture hands
   *  it back (LiveTV); any other way into the Guide opens it at its start. */
  resumeAt?: GuidePlace | null;
  /** Told once resumeAt has been taken. */
  onResumeTaken?: () => void;
  /** Compact: the Player's header is not drawn over the Guide, so its
   *  buttons are here (the drawer's top, the bottom bar). Update Channels;
   *  `refreshing` while it runs. */
  onUpdateChannels?: () => void;
  refreshing?: boolean;
  /** The Player's Settings (left out: none here, as in the header: the demo
   *  and a Kids profile). */
  onOpenSettings?: () => void;
  /** Compact on a touch screen: the header's Back, in the bottom bar. */
  onBackButton?: () => void;
  /** The service's name (the header's chip), at the drawer's top. */
  serviceName?: string | null;
}

/** Where the Guide was: its line, category ('fav' for Favorites), the
 *  channel and the time shown. `scroll`: the grid's offset, so Back puts the
 *  channels back where they were (not the played row on the bottom edge). */
export interface GuidePlace { line: string; cat: string; channel: number; window: number; scroll?: number }

interface DecodedProgram {
  title: string;
  start: number;
  end: number;
  /**
   * The listing's own start / end: true UTC seconds, or the panel's clock as
   * text. `start` / `end` above read the text as the box's local time; a
   * recording needs the real moment (programmeTimeUtcMs, with the panel's offset).
   */
  rs: string;
  re: string;
}

const ROW_HEIGHT = 72;
const CHANNEL_COL_WIDTH = 220;
const TIME_HEADER_HEIGHT = 36;
const WINDOW_MINUTES = 150; // 2.5 hours
const SLOT_MINUTES = 30;
const EPG_MAX_CONCURRENT = 4;
/** Hold OK (or a finger) this long on a channel to save it to Favorites, or
 *  take it out (the same hold as Live TV's list). */
const HOLD_MS = 600;
/** The click a touch hold's lift may still bring comes at once. */
const LIFT_CLICK_MS = 700;

// ── Compact (lib/viewSize) ─────────────────────────────────────────────
// Row heights: on a TV 36 px (8 full rows under the preview at 960x540), on
// a touch screen 44 px (a finger's). The time bar and the bottom bar are
// slim on a TV; on a touch screen they hold finger-sized buttons.
const COMPACT_ROW_TV = 36;
const COMPACT_ROW_TOUCH = 44;
const COMPACT_TIMES_TV = 24;
const COMPACT_TIMES_TOUCH = 40;
const COMPACT_BOTTOM_TV = 26;
const COMPACT_BOTTOM_TOUCH = 48;
/** The preview strip's height (the video and what is on), vh. */
const COMPACT_PREVIEW_VH = 36;
const COMPACT_PREVIEW_VH_TOUCH = 30;
/** The channel column: a TV or a phone held sideways, a phone upright. */
const COMPACT_COL_W = 232;
const COMPACT_COL_W_UPRIGHT = 148;
/** The category drawer's width (at most 85% of a narrow screen). */
const DRAWER_W = 320;

const halfHourFloor = (t: number) => {
  const d = new Date(t);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 30));
  return d.getTime();
};

// formatTime keeps one cached formatter per language (toLocaleTimeString with
// options builds a new ICU formatter on every call: dozens per render on Chromium 66).
const formatSlot = (ms: number) => formatTime(ms);
// Programme guides kept for this visit; the oldest go first past this.
const EPG_CACHE_MAX = 300;

// The Favorites chip, always first in the bar — where LiveSection's list puts
// Favorites. Its rows come from the saved list, not from a category download.
// The name here is only an id-like placeholder; the bar draws the translated word.
const FAV_CHIP: XtreamCategory = { category_id: '__favorites__', category_name: 'Favorites' };

// A saved favourite as a grid row: every field the rows, playback and the
// EPG read (the same mapping as LiveSection's favToStream).
const favToStream = (f: FavChannel): XtreamLiveStream => ({
  stream_id: f.stream_id,
  name: f.name,
  num: f.num,
  stream_icon: f.stream_icon,
  category_id: f.category_id,
  epg_channel_id: f.epg_channel_id,
});
// Re-reading an unchanged list must not hand the grid new rows.
const sameFavs = (a: Map<number, FavChannel>, b: Map<number, FavChannel>) =>
  a.size === b.size && JSON.stringify([...a.values()]) === JSON.stringify([...b.values()]);

const decodePrograms = (entries: XtreamEpgEntry[]): DecodedProgram[] =>
  entries
    .map(e => ({
      title: decodeEpgText(e.title) || i18n.t('guide.untitled'),
      start: parseEpgTime(e.start_timestamp || e.start),
      end: parseEpgTime(e.stop_timestamp || e.end),
      rs: e.start_timestamp || e.start || '',
      re: e.stop_timestamp || e.end || '',
    }))
    .filter(e => e.start > 0 && e.end > e.start)
    .sort((a, b) => a.start - b.start);

const GuideSection = memo(({ creds, isActive, onExitLeft, onExitUp, onNavigate: _onNavigate, onWatch, resumeAt, onResumeTaken, onUpdateChannels, refreshing = false, onOpenSettings, onBackButton, serviceName }: Props) => {
  const { t } = useTranslation();
  // Compact or Large (lib/viewSize). Compact on phones too: upright with a
  // narrower channel column (no number: the preview has it), sideways as on
  // a TV; a touch screen gets finger-sized rows and buttons.
  const compact = useViewSize() === 'compact';
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const touch = useTouchUI();
  const upright = usePhoneLayout() === 'portrait';
  const rowH = compact ? (touch ? COMPACT_ROW_TOUCH : COMPACT_ROW_TV) : ROW_HEIGHT;
  // Upright on a phone, Compact shows 90 minutes across (the TV's 2.5 hours
  // left the programmes a few letters each beside the channel column).
  const windowMin = compact && upright ? 90 : WINDOW_MINUTES;
  const slots = windowMin / SLOT_MINUTES;
  const rowHRef = useRef(rowH);
  rowHRef.current = rowH;
  const onWatchRef = useRef(onWatch);
  onWatchRef.current = onWatch;
  // Back from a channel this Guide handed to Live TV: the same category,
  // channel and time as it was left (this line's only).
  const [resume] = useState(() => (!DEMO && resumeAt && resumeAt.line === lineKey(creds) ? resumeAt : null));
  const onResumeTakenRef = useRef(onResumeTaken);
  onResumeTakenRef.current = onResumeTaken;
  useEffect(() => { if (resumeAt) onResumeTakenRef.current?.(); }, [resumeAt]);
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  // Index into the bar: 0 is Favorites, then the categories.
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [streams, setStreams] = useState<XtreamLiveStream[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [rowIdx, setRowIdx] = useState(0);
  // 'category': Large's chips bar. 'drawer': Compact's category drawer (open
  // while the zone is this one).
  const [focusZone, setFocusZone] = useState<'category' | 'grid' | 'drawer'>('grid');
  // In the drawer the highlight is on a category (the bar's own index,
  // categoryIdx: the grid behind follows it) or on one of the two buttons at
  // the drawer's top.
  const [drawerOn, setDrawerOn] = useState<'cats' | 'settings' | 'update'>('cats');

  // Time window (start ms). Initial = current half-hour (or the one shown
  // when a channel was handed to Live TV, while it is not past).
  const [windowStart, setWindowStart] = useState<number>(() => {
    const now = halfHourFloor(Date.now());
    return resume && resume.window >= now ? resume.window : now;
  });
  const nowInitialRef = useRef(halfHourFloor(Date.now()));

  // Volume + playback
  const [volume, setVolume] = useState<number>(() => loadVolume());
  useEffect(() => { saveVolume(volume); }, [volume]);
  const [playingChannelId, setPlayingChannelId] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Bump every 30s so the NOW line keeps pace — not behind fullscreen
  // playback, where a full-grid re-render helps nobody.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (fullscreen) return;
    setNowTick(Date.now());
    const t = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [fullscreen]);

  // Refresh event → wipe caches
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const onRefresh = () => {
      epgCacheRef.current.clear();
      epgPendingRef.current.clear();
      epgQueueRef.current = [];
      setRefreshTick(t => t + 1);
    };
    window.addEventListener(XTREAM_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(XTREAM_REFRESH_EVENT, onRefresh);
  }, []);

  // Load categories. The Guide opens where Live TV's list opens: Favorites is
  // first in the bar, but the first real category is the one shown once the
  // categories are in (Favorites only when there are none), unless the viewer
  // has already moved along the bar.
  const userMovedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setCategoriesLoading(true);
    (async () => {
      try {
        const cats = await fetchLiveCategories(creds).catch(() => [] as XtreamCategory[]);
        if (cancelled) return;
        setCategories(cats);
        if (!userMovedRef.current) {
          // Back from Live TV's player: the category it was on.
          const back = resume ? (resume.cat === 'fav' ? 0 : cats.findIndex((c) => String(c.category_id) === resume.cat) + 1) : -1;
          setCategoryIdx(back > 0 || resume?.cat === 'fav' ? Math.max(0, back) : cats.length ? 1 : 0);
        }
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [creds, refreshTick]);
  // Nothing is listed under Favorites before the categories are in: the
  // Guide is about to move to the first of them, and a Kids profile's
  // favourites are checked against them.
  const catsReady = !categoriesLoading || categories.length > 0;

  // Favorites: the line's saved list (this profile's own on any profile but
  // the main one), in its saved order, as Live TV's list shows it. Read from
  // the box: no provider call, and Live TV's list keeps it in step with the
  // cloud. Nothing announces a change, so it is read again when the Guide
  // gets the remote back and on "Update Channels".
  const [favs, setFavs] = useState<Map<number, FavChannel>>(() => loadFavoritesForLine(creds));
  useEffect(() => {
    const next = loadFavoritesForLine(creds);
    setFavs((prev) => (sameFavs(prev, next) ? prev : next));
  }, [creds, isActive, refreshTick]);
  // A Kids profile keeps only favourites in the categories it may open (the
  // list above is already the profile's), the same check Multi-Screen makes.
  const favRows = useMemo<XtreamLiveStream[]>(() => {
    if (!catsReady || favs.size === 0) return [];
    const allowed = kidsLevel() ? new Set(categories.map((c) => String(c.category_id))) : null;
    const out: XtreamLiveStream[] = [];
    for (const f of favs.values()) if (!allowed || kidsAllowsChannel(f, allowed)) out.push(favToStream(f));
    return out;
  }, [favs, categories, catsReady]);

  const chips = useMemo(() => [FAV_CHIP, ...categories], [categories]);
  const currentChip = catsReady ? chips[categoryIdx] : undefined;
  const onFavorites = currentChip === FAV_CHIP;
  const currentCategory = onFavorites ? undefined : currentChip;

  // Load the channels of the category the highlight rests on in the bar
  // (owner, 2026-10-09: "they should auto load after 1 sec (so they don't
  // bother to load on a fast click past)"): once it has rested there
  // CATEGORY_DWELL_MS (1 s); moving ◀▶ through the bar faster downloads
  // nothing. At once when the viewer opens it (OK or ▼ into the grid, a click
  // on the chip: the grid has the remote), when the Guide opens on it, and on
  // Update Channels; a list xtream keeps already after a short settle
  // (KEPT_CATEGORY_SETTLE_MS). The last category's rows are not left under
  // the new chip while it waits.
  // Keyed ONLY on which category it is (and its line); the line, the chip
  // and the grid's focus are read through refs, so no re-render (the
  // preview, the clock, the player's events) restarts or cancels the wait,
  // and the grid's row goes back to the top only when the category changes.
  const catLoadKey = currentCategory ? `${lineKey(creds)}|${currentCategory.category_id}` : null;
  const catOpenedNow = focusZone === 'grid';
  const catLoadRef = useRef({ creds, category: currentCategory, openedNow: catOpenedNow });
  catLoadRef.current = { creds, category: currentCategory, openedNow: catOpenedNow };
  const catLoadNowRef = useRef<(() => void) | null>(null);
  // Which category the rows in `streams` are (Update Channels keeps them on
  // screen while the same category loads again).
  const streamsForRef = useRef<string | null>(null);
  const catSeenRef = useRef<{ key: string | null | undefined; refresh: number }>({ key: undefined, refresh: refreshTick });
  useEffect(() => {
    const changed = catSeenRef.current.key !== catLoadKey;
    const refreshed = catSeenRef.current.refresh !== refreshTick;
    catSeenRef.current = { key: catLoadKey, refresh: refreshTick };
    if (changed) setRowIdx(0);
    const { creds: line, category, openedNow } = catLoadRef.current;
    if (!catLoadKey || !category) {
      // Favorites (or nothing yet): nothing to download, and the last
      // category's list is not kept behind it.
      setStreams([]);
      streamsForRef.current = null;
      setChannelsLoading(false);
      return;
    }
    let cancelled = false;
    let started = false;
    let t = 0;
    const catId = String(category.category_id);
    const kept = !DEMO && hasLiveStreams(line, catId);
    if (changed) { setStreams([]); streamsForRef.current = null; }
    setChannelsLoading(true);
    const start = () => {
      if (started || cancelled) return;
      started = true;
      window.clearTimeout(t);
      if (catLoadNowRef.current === start) catLoadNowRef.current = null;
      fetchLiveStreams(line, catId)
        .then(list => { if (!cancelled) { setStreams(list || []); streamsForRef.current = catLoadKey; } })
        .catch(() => { if (!cancelled) { setStreams([]); streamsForRef.current = catLoadKey; } })
        .finally(() => { if (!cancelled) setChannelsLoading(false); });
    };
    t = window.setTimeout(start, openedNow || refreshed ? 0 : kept ? KEPT_CATEGORY_SETTLE_MS : CATEGORY_DWELL_MS);
    catLoadNowRef.current = start;
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      if (catLoadNowRef.current === start) catLoadNowRef.current = null;
    };
  }, [catLoadKey, refreshTick]);
  // OK / ▼ into the grid / a click while the chip's category waits: no more waiting.
  // Not when Compact's drawer closed on the way out (closeDrawer(false)):
  // the 1 s rest still decides then.
  const drawerLeftRef = useRef(false);
  useEffect(() => {
    if (!catOpenedNow) return;
    if (drawerLeftRef.current) { drawerLeftRef.current = false; return; }
    catLoadNowRef.current?.();
  }, [catOpenedNow]);

  // The rows in the grid: the favourites, or the category's channels.
  const channels = onFavorites ? favRows : streams;
  const listLoading = !onFavorites && channelsLoading;

  // Clamp row: the last one when the list got shorter under it (the last
  // favourite held out of Favorites), not the top.
  useEffect(() => {
    if (rowIdx >= channels.length) setRowIdx(Math.max(0, channels.length - 1));
  }, [channels.length, rowIdx]);
  // Back from Live TV's player: the highlight on the channel it played, once
  // the restored category's list is in (gone from it: where it opens). The
  // viewer's first key or tap ends the wait: it never takes the remote later.
  const rowResumedRef = useRef(!resume);
  const restoreScrollRef = useRef<{ row: number; scroll: number } | null>(null);
  useEffect(() => {
    if (rowResumedRef.current || !resume || listLoading || !catsReady) return;
    const want = resume.cat === 'fav' ? onFavorites : String(currentCategory?.category_id ?? '') === resume.cat;
    if (!want) { if (userMovedRef.current) rowResumedRef.current = true; return; }
    if (!onFavorites && !channels.length) return;
    rowResumedRef.current = true;
    const i = channels.findIndex((c) => c.stream_id === resume.channel);
    if (i < 0) return;
    // The grid's own offset with it (the keep-in-view effect below).
    if (i > 0 && typeof resume.scroll === 'number') restoreScrollRef.current = { row: i, scroll: resume.scroll };
    setRowIdx(i);
    setFocusZone('grid');
  }, [channels, listLoading, resume, catsReady, onFavorites, currentCategory]);

  // Virtualizer for channel rows. A stable key function: an inline one made
  // the virtualizer re-measure every channel on every render.
  const getItemKey = useCallback((i: number) => channels[i]?.stream_id ?? i, [channels]);
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => rowHRef.current,
    overscan: isFireTV() || isLowMemoryBox() ? 2 : 6,
    getItemKey,
  });

  // Compact ↔ Large changes every row's height: drop the measurements.
  useEffect(() => { rowVirtualizer.measure(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rowH]);

  // EPG lazy fetch (concurrency-capped)
  const epgCacheRef = useRef<Map<number, DecodedProgram[]>>(new Map());
  const epgPendingRef = useRef<Set<number>>(new Set());
  const epgQueueRef = useRef<number[]>([]);
  const epgInFlightRef = useRef(0);
  const [, forceEpgTick] = useState(0);
  // The queue used to outlive everything: rows scrolled past, a new category,
  // fullscreen playback, even leaving the Guide — it drained every id ever
  // seen. Now it only ever holds rows on screen, and stops when the Guide goes.
  const epgAliveRef = useRef(true);
  useEffect(() => () => { epgAliveRef.current = false; epgQueueRef.current = []; }, []);

  const pumpEpg = useCallback(() => {
    while (epgAliveRef.current && epgInFlightRef.current < EPG_MAX_CONCURRENT && epgQueueRef.current.length) {
      const id = epgQueueRef.current.shift()!;
      epgInFlightRef.current++;
      const put = (programs: DecodedProgram[]) => {
        const cache = epgCacheRef.current;
        cache.set(id, programs);
        while (cache.size > EPG_CACHE_MAX) cache.delete(cache.keys().next().value as number);
      };
      fetchShortEpg(creds, id, 16)
        .then(res => { if (epgAliveRef.current) put(decodePrograms(res.epg_listings || [])); })
        .catch(() => { if (epgAliveRef.current) put([]); })
        .finally(() => {
          epgInFlightRef.current--;
          epgPendingRef.current.delete(id);
          if (!epgAliveRef.current) return;
          forceEpgTick(t => t + 1);
          if (epgQueueRef.current.length) pumpEpg();
        });
    }
  }, [creds]);

  const enqueueEpg = useCallback((id: number) => {
    if (epgCacheRef.current.has(id) || epgPendingRef.current.has(id)) return;
    epgPendingRef.current.add(id);
    epgQueueRef.current.push(id);
    pumpEpg();
  }, [pumpEpg]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const epgRowIds: number[] = [];
  if (!fullscreen) {
    // The rows in view, not the overscan drawn around them.
    const off = rowVirtualizer.scrollOffset;
    const viewH = rowVirtualizer.scrollRect?.height;
    for (const v of virtualItems) {
      if (typeof off === 'number' && viewH && (v.start + v.size <= off || v.start >= off + viewH)) continue;
      const s = channels[v.index];
      if (s) epgRowIds.push(s.stream_id);
    }
  }
  const epgRowsKey = `${refreshTick}:${epgRowIds.join(',')}`;
  useEffect(() => {
    // Drop queued rows that are no longer on screen (in-flight ones finish).
    const visible = new Set(epgRowIds);
    const keep: number[] = [];
    for (const id of epgQueueRef.current) {
      if (visible.has(id)) keep.push(id);
      else epgPendingRef.current.delete(id);
    }
    epgQueueRef.current = keep;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- epgRowIds is what epgRowsKey spells
  }, [epgRowsKey]);
  // The rows on screen ask once the grid rests on them: a held ▼ or a fling
  // used to ask for every channel it passed (src/hooks/useWhenSettled.ts).
  useWhenSettled(epgRowsKey, () => epgRowIds.forEach(enqueueEpg));

  // Keep the focused category in view — once per move, and only this bar's
  // own scroll. The old inline ref ran scrollIntoView on every render (each
  // EPG reply included) and could nudge the page's scroll too.
  const catBarRef = useRef<HTMLDivElement | null>(null);
  // Also once when the Guide opens again on a category further along the bar
  // (back from Live TV's player): the open one is in view.
  const chipShownRef = useRef(!resume);
  useEffect(() => {
    const restoring = !chipShownRef.current && catsReady && categoryIdx > 0;
    if (restoring) chipShownRef.current = true;
    if (!restoring && (!isActive || focusZone !== 'category')) return;
    const bar = catBarRef.current;
    const el = bar?.querySelector<HTMLElement>(`[data-cat-i="${categoryIdx}"]`);
    if (!bar || !el) return;
    const left = el.offsetLeft - bar.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < bar.scrollLeft) bar.scrollLeft = left - 8;
    else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth + 8;
  }, [categoryIdx, focusZone, isActive, categories.length, catsReady]);

  // Keep focused row visible.
  // Back from the channel (Live TV's player: the Guide opens again with its
  // place; its own full-screen player: the grid is rebuilt): the grid goes
  // back to where the viewer left it, not to wherever puts the watched row on
  // its bottom edge. `categoryIdx`: another category opens at its first
  // channel (scrolled by a finger, the row was 0 already, so with the same
  // number of channels nothing re-ran and it opened at the old offset).
  const gridScrollTopRef = useRef(0);
  const wasFullscreenRef = useRef(fullscreen);
  useEffect(() => {
    const backFromFullscreen = wasFullscreenRef.current && !fullscreen;
    wasFullscreenRef.current = fullscreen;
    if (!channels.length) return;
    const node = scrollParentRef.current;
    if (!node) return;
    const restore = restoreScrollRef.current;
    if (restore && restore.row === rowIdx) { restoreScrollRef.current = null; node.scrollTop = restore.scroll; }
    else if (backFromFullscreen) node.scrollTop = gridScrollTopRef.current;
    else if (rowIdx === 0) { node.scrollTop = 0; return; }
    const top = rowIdx * rowH;
    const bot = top + rowH;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (bot > node.scrollTop + node.clientHeight) node.scrollTop = bot - node.clientHeight;
  }, [rowIdx, channels.length, fullscreen, categoryIdx, rowH]);

  const windowEnd = windowStart + windowMin * 60_000;
  const slotStarts = useMemo(
    () => Array.from({ length: slots }, (_, i) => windowStart + i * SLOT_MINUTES * 60_000),
    [windowStart, slots],
  );

  // Playback wiring — mirror LiveSection's native path exactly
  const streamUrl = useMemo(
    // Demo: no stream URL may ever be constructed — the host is a sentinel.
    () => (!DEMO && playingChannelId ? buildLiveStreamUrl(creds, playingChannelId) : null),
    [playingChannelId, creds],
  );
  const nativeActive = NATIVE_PLAYBACK && fullscreen && !!playingChannelId;

  // Preview: the highlighted channel plays in the box above the grid once
  // the highlight rests on it, the same way Live TV's preview works. Same
  // player and stream as full screen, so OK on it only moves the picture.
  const [previewChannelId, setPreviewChannelId] = useState<number | null>(null);
  const focusedGuideChannel = focusZone === 'grid' ? channels[rowIdx] ?? null : null;
  useEffect(() => {
    if (!NATIVE_PLAYBACK || DEMO || fullscreen || !focusedGuideChannel) { setPreviewChannelId(null); return; }
    const t = window.setTimeout(() => setPreviewChannelId(focusedGuideChannel.stream_id), 700);
    return () => window.clearTimeout(t);
  }, [focusedGuideChannel, fullscreen]);
  const nativePreviewActive = NATIVE_PLAYBACK && !DEMO && isActive && !fullscreen && previewChannelId != null;
  const [previewRect, setPreviewRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const previewObserverRef = useRef<ResizeObserver | null>(null);
  const previewMeasureRef = useRef<() => void>(() => {});
  const previewBoxRef = useCallback((el: HTMLDivElement | null) => {
    if (!NATIVE_PLAYBACK) return;
    if (previewObserverRef.current) { previewObserverRef.current.disconnect(); previewObserverRef.current = null; }
    if (!el) { setPreviewRect(null); previewMeasureRef.current = () => {}; return; }
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { x: r.left, y: r.top, width: r.width, height: r.height };
      setPreviewRect((prev) =>
        prev && Math.abs(prev.x - next.x) < 1 && Math.abs(prev.y - next.y) < 1
          && Math.abs(prev.width - next.width) < 1 && Math.abs(prev.height - next.height) < 1
          ? prev : next);
    };
    previewMeasureRef.current = measure;
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      previewObserverRef.current = ro;
    }
  }, []);
  // The box can move without changing size (the category row above it grows
  // from "Loading categories…" to the chips): measure again when a preview
  // starts and when that row settles, after layout.
  useEffect(() => {
    const raf = requestAnimationFrame(() => previewMeasureRef.current());
    return () => cancelAnimationFrame(raf);
  }, [nativePreviewActive, previewChannelId, categoriesLoading, categories.length, compact]);
  // The page has to be see-through where the preview box is (index.css).
  useEffect(() => {
    if (!nativePreviewActive) return;
    document.documentElement.classList.add('snowplayer-preview');
    return () => { document.documentElement.classList.remove('snowplayer-preview'); };
  }, [nativePreviewActive]);

  const toTs = (u: string | null) => (u ? u.replace(/\.m3u8(\?|$)/i, '.ts$1') : null);
  const nativeUrl = nativeActive
    ? toTs(streamUrl)
    : nativePreviewActive && previewChannelId != null
      ? toTs(buildLiveStreamUrl(creds, previewChannelId))
      : null;
  // Player engine (owner test builds only — PlaybackScreen). Same call
  // covers fullscreen and the preview box above the grid.
  const { engine: playerEngine } = usePlayerEngine();
  const native = useNativePlayer({
    active: nativeActive || nativePreviewActive,
    url: nativeUrl,
    volume,
    engine: playerEngine,
    rect: nativeActive ? undefined : previewRect,
    background: nativeActive,
  });

  // mpv couldn't start on this box: told once per fallback (see LiveSection).
  const lastEngineNoticeRef = useRef<string | null>(null);
  useEffect(() => {
    const notice = native.engineNotice;
    if (!notice || notice === lastEngineNoticeRef.current) return;
    lastEngineNoticeRef.current = notice;
    toast({ title: t('guide.toast.mpvFallback') });
  }, [native.engineNotice, t]);
  useEffect(() => {
    if (!nativeActive) return;
    document.documentElement.classList.add('snowplayer-fullscreen');
    return () => { document.documentElement.classList.remove('snowplayer-fullscreen'); };
  }, [nativeActive]);

  const playRow = useCallback((idx: number) => {
    const ch = channels[idx];
    if (!ch) return;
    // Live TV's own player: its bar, menus, rewind and record, and a name and
    // volume that go away (this one's stayed on screen, with none of Live
    // TV's options). Back from the picture comes back here.
    if (onWatchRef.current && !DEMO) {
      // The list on screen is still the last category's (the next one loads):
      // nothing to pick yet, and it says so. The same category loading again
      // (Update Channels): its rows play.
      if (listLoading && streamsForRef.current !== catLoadKey) {
        toast({ title: t('guide.loadingChannels') });
        return;
      }
      const place: GuidePlace = {
        line: lineKey(creds),
        cat: onFavorites ? 'fav' : String(currentCategory?.category_id ?? ''),
        channel: ch.stream_id,
        window: windowStart,
        scroll: scrollParentRef.current?.scrollTop ?? 0,
      };
      handLiveDeeplink({
        host: creds.host, username: creds.username, streamId: ch.stream_id,
        name: ch.name, icon: ch.stream_icon || undefined,
        categoryId: ch.category_id != null ? String(ch.category_id) : undefined, num: ch.num ?? undefined,
      });
      onWatchRef.current(place);
      return;
    }
    setPlayingChannelId(ch.stream_id);
    setFullscreen(true);
  }, [channels, creds, onFavorites, currentCategory, windowStart, listLoading, catLoadKey, t]);
  // For the key listeners: a new copy of playRow (a list landing, the time
  // moved) must not re-subscribe them, which cancelled a hold under way.
  const playRowRef = useRef(playRow);
  playRowRef.current = playRow;

  // ── Held OK ───────────────────────────────────────────────────────────
  // A timer started by the key going down; the key coming up before it fires
  // is a press (play). enterFiredRef marks a hold that saved the favourite, so
  // the release that follows is not also a press.
  const enterTimerRef = useRef<number | null>(null);
  const enterFiredRef = useRef(false);
  const cancelEnterTimer = useCallback(() => {
    if (enterTimerRef.current) { window.clearTimeout(enterTimerRef.current); enterTimerRef.current = null; }
  }, []);
  // The schedules set so far (red dots) and the panel's clock offset (a
  // listing's text time is the panel's, and the dots and the dialog need real
  // moments). Both are only looked at where recording is possible.
  const [schedules, setSchedules] = useState<RecordSchedule[]>([]);
  const [panelOff, setPanelOff] = useState<number | null>(null);
  const panelOffRef = useRef<number | null>(null);
  panelOffRef.current = panelOff;
  useEffect(() => {
    if (!SCHEDULE_CAPABLE || kidsLevel()) return;
    let alive = true;
    const read = () => {
      SnowRecorder.listSchedules().then((r) => { if (alive) setSchedules(r.schedules); }).catch(() => { /* older app */ });
    };
    read();
    window.addEventListener(RECORDINGS_CHANGED_EVENT, read);
    panelOffset(creds).then((o) => { if (alive) setPanelOff(o); }).catch(() => { /* the box's own clock */ });
    return () => { alive = false; window.removeEventListener(RECORDINGS_CHANGED_EVENT, read); };
  }, [creds]);
  // Start times (UTC ms) of the programmes still to be recorded, by channel.
  const scheduledStarts = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const sc of schedules) {
      if (sc.status !== 'scheduled' && sc.status !== 'recording') continue;
      const list = m.get(sc.streamId);
      if (list) list.push(sc.startUtcMs); else m.set(sc.streamId, [sc.startUtcMs]);
    }
    return m;
  }, [schedules]);

  // The Record dialog in programme mode for one channel.
  const [recordFor, setRecordFor] = useState<{
    ch: XtreamLiveStream; programmes: ProgrammeChoice[]; existing: SchedLike[]; plan: number | null;
  } | null>(null);
  const recordForRef = useRef(recordFor);
  recordForRef.current = recordFor;
  const openingRef = useRef(false);
  const openRecord = useCallback(async (ch: XtreamLiveStream) => {
    if (!SCHEDULE_CAPABLE || kidsLevel() || openingRef.current) return;
    openingRef.current = true;
    try {
      const [acc, sch, jobs] = await Promise.all([
        loadPlayerAccount().catch(() => null),
        SnowRecorder.listSchedules().then((r) => r.schedules).catch(() => [] as RecordSchedule[]),
        SnowRecorder.active().then((r) => r.jobs).catch(() => []),
      ]);
      const off = panelOffRef.current ?? await panelOffset(creds).catch(() => null);
      const starts = new Set(sch.filter((x) => x.streamId === ch.stream_id && (x.status === 'scheduled' || x.status === 'recording')).map((x) => x.startUtcMs));
      const listed: ProgrammeChoice[] = [];
      for (const p of epgCacheRef.current.get(ch.stream_id) ?? []) {
        const startMs = programmeTimeUtcMs(p.rs, off);
        const endMs = programmeTimeUtcMs(p.re, off);
        if (startMs == null || endMs == null || endMs <= startMs) continue;
        listed.push({ title: p.title, startMs, endMs, scheduled: [...starts].some((t) => Math.abs(t - startMs) < 60_000) });
      }
      const now = Date.now();
      const existing: SchedLike[] = [
        ...sch.filter((x) => x.status === 'scheduled' || x.status === 'recording'),
        ...busyFromJobs(jobs, now),
      ];
      const plan = acc && lineKey(acc) === lineKey(creds) ? acc.maxConnections : null;
      setRecordFor({ ch, programmes: programmeChoices(listed, windowStartRef.current, now), existing, plan });
    } finally {
      openingRef.current = false;
    }
  }, [creds]);
  const openRecordRef = useRef(openRecord);
  openRecordRef.current = openRecord;
  const closeRecord = useCallback(() => { setRecordFor(null); }, []);

  // A programme chosen in the dialog: the one on now records at once (until its
  // end plus the "End late" padding); a later one is set with the native scheduler.
  // The stream address is never sent for a schedule: it is rebuilt when it starts.
  const startProgramme = useCallback(async (target: NonNullable<typeof recordFor>, choice: RecordChoice) => {
    const p = choice.programme;
    if (!p) return;
    const pad = loadPadding();
    const now = Date.now();
    const mode = programmeMode(p, pad, now);
    const note = extraStreamNote(target.plan);
    const win = paddedWindow({ startUtcMs: p.startMs, endUtcMs: p.endMs, padBeforeMin: pad.beforeMin, padAfterMin: pad.afterMin });
    try {
      if (mode === 'over') {
        toast({ title: t('guide.toast.finished'), variant: 'destructive' });
      } else if (mode === 'now') {
        const minutes = minutesUntil(win.endMs, now);
        const paused = await pauseRewindForRecording(target.plan);
        const r = await SnowRecorder.start({
          url: buildNativeLiveUrl(creds, target.ch.stream_id),
          channel: target.ch.name,
          fileName: recordingFileName(target.ch.name),
          volumeId: choice.volumeId,
          durationMin: minutes,
          maxSimultaneous: recordingCap(target.plan),
        });
        toast({ title: t('guide.toast.recordingTitle', { name: target.ch.name }), description: t('guide.toast.recordingDesc', { time: endsAtLabel(minutes) ?? '', volume: r.volumeLabel, note, paused: paused ? ` ${REWIND_PAUSED_NOTE}` : '' }) });
      } else {
        const r = await SnowRecorder.schedule({
          streamId: target.ch.stream_id,
          host: creds.host,
          channel: target.ch.name,
          title: p.title,
          startUtcMs: p.startMs,
          endUtcMs: p.endMs,
          padBeforeMin: pad.beforeMin,
          padAfterMin: pad.afterMin,
          volumeId: choice.volumeId,
          maxConnections: target.plan,
        });
        toast({
          title: t('guide.toast.scheduledTitle', { title: p.title }),
          description: t(r.exact ? 'guide.toast.scheduledDesc' : 'guide.toast.scheduledDescLate', { channel: target.ch.name, times: paddedLabel(win.startMs, win.endMs), note }),
        });
      }
    } catch (e) {
      const err = e as Error & { code?: string; data?: { atMs?: number; count?: number } };
      const why = err?.code === 'CONFLICT' && err.data?.atMs != null
        ? conflictMessage({ atMs: err.data.atMs, count: err.data.count ?? 1 })
        : (err?.message ?? '');
      toast({
        title: mode === 'now' ? t('guide.toast.recordFailed') : t('guide.toast.scheduleFailed'),
        description: mode === 'now' && err?.code !== 'NO_SPACE' ? `${why}${why ? ' ' : ''}${note}` : why,
        variant: 'destructive',
      });
    }
    notifyRecordingsChanged();
  }, [creds, t]);

  // ── D-pad ─────────────────────────────────────────────────────────────
  const focusZoneRef = useRef(focusZone);
  const categoryIdxRef = useRef(categoryIdx);
  const rowIdxRef = useRef(rowIdx);
  const fullscreenRef = useRef(fullscreen);
  const windowStartRef = useRef(windowStart);
  const channelsRef = useRef(channels);
  const chipsRef = useRef(chips);
  const nativeErrorRef = useRef<{ code?: string; message: string } | null>(null);
  const nativeRetryRef = useRef<() => void>(() => {});
  useEffect(() => { focusZoneRef.current = focusZone; }, [focusZone]);
  useEffect(() => { categoryIdxRef.current = categoryIdx; }, [categoryIdx]);
  useEffect(() => { rowIdxRef.current = rowIdx; }, [rowIdx]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);
  useEffect(() => { windowStartRef.current = windowStart; }, [windowStart]);
  useEffect(() => { channelsRef.current = channels; }, [channels]);
  useEffect(() => { chipsRef.current = chips; }, [chips]);
  useEffect(() => { nativeErrorRef.current = native.error; }, [native.error]);
  useEffect(() => { nativeRetryRef.current = native.retry; }, [native.retry]);

  // One press of the remote's Back arrives twice: this section's hardware
  // back listener and the Player shell's synthetic Escape. The first closed
  // full screen and the second then left the Guide for the side menu. A
  // second Back this soon is the same press.
  const lastBackAtRef = useRef(0);
  const freshBack = () => {
    const now = Date.now();
    if (now - lastBackAtRef.current < 350) return false;
    lastBackAtRef.current = now;
    return true;
  };

  // ── Compact's drawer ────────────────────────────────────────────────────
  // The categories, over the grid's left edge, with the service, Settings
  // and Update Channels at its top (the Player's header is not drawn over a
  // Compact Guide). The highlight on a category IS the Guide's category: the
  // grid behind follows it once it rests there CATEGORY_DWELL_MS (the load
  // effect above: the drawer is not 'grid', so it waits as the chips do).
  const drawerOnRef = useRef(drawerOn);
  drawerOnRef.current = drawerOn;
  const updateRef = useRef(onUpdateChannels);
  updateRef.current = onUpdateChannels;
  const settingsRef = useRef(onOpenSettings);
  settingsRef.current = onOpenSettings;
  const openDrawer = useCallback(() => {
    // The viewer has the Guide: a place still being restored is not.
    rowResumedRef.current = true;
    focusZoneRef.current = 'drawer';
    drawerOnRef.current = 'cats';
    setDrawerOn('cats');
    setFocusZone('drawer');
  }, []);
  /** Closed: the grid has the remote, on the category the drawer rests on,
   *  loaded at once if it was still waiting (OK, ▶, Back, a tap). Closed on
   *  the way out (◀ to the side menu, the remote taken away: `now` false),
   *  the 1 s rest still decides. */
  const closeDrawer = useCallback((now = true) => {
    if (!now && focusZoneRef.current === 'drawer') drawerLeftRef.current = true;
    focusZoneRef.current = 'grid';
    setFocusZone('grid');
  }, []);
  // The side menu (or anything else) took the remote: the drawer closes.
  useEffect(() => { if (!isActive && focusZoneRef.current === 'drawer') closeDrawer(false); }, [isActive, closeDrawer]);
  // Large has no drawer, Compact no chips: switched with either open, the grid.
  useEffect(() => {
    if (focusZoneRef.current === (compact ? 'category' : 'drawer')) closeDrawer(false);
  }, [compact, closeDrawer]);
  // The drawer's list follows its highlight (its own scroll only).
  const drawerListRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusZone !== 'drawer' || drawerOn !== 'cats') return;
    const list = drawerListRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-drawer-i="${categoryIdx}"]`);
    if (list && el) keepInView(list, el, 8);
  }, [focusZone, drawerOn, categoryIdx]);
  // A category tapped (or clicked) in the drawer: open it, close the drawer.
  const pickDrawer = useCallback((i: number) => {
    userMovedRef.current = true; rowResumedRef.current = true;
    categoryIdxRef.current = i;
    setCategoryIdx(i);
    closeDrawer();
  }, [closeDrawer]);
  // A touch screen's earlier / later buttons (the remote's ◀ ▶).
  const earlier = useCallback(() => {
    setWindowStart((s) => Math.max(nowInitialRef.current, s - SLOT_MINUTES * 60_000));
  }, []);
  const later = useCallback(() => { setWindowStart((s) => s + SLOT_MINUTES * 60_000); }, []);

  // Add to / Remove from Favorites (the channel menu): into Favorites, or
  // out again if it was in, with a toast saying which. The line's own list
  // (this service's, this profile's), the one Live TV's Favorites reads, so
  // it is there too; here the row's star and the Favorites chip at once, with
  // no line-up downloaded. Nothing else moves: the same row, focus and time,
  // and nothing plays.
  const favsRef = useRef(favs);
  favsRef.current = favs;
  const credsRef = useRef(creds);
  credsRef.current = creds;
  const toggleFavorite = useCallback((ch: XtreamLiveStream) => {
    const was = favsRef.current.has(ch.stream_id);
    const next = toggledFavorites(favsRef.current, ch);
    favsRef.current = next;
    setFavs(next);
    // A list the account settled on instead (another box wrote first).
    commitFavoritesForLine(credsRef.current, next, (m) => {
      favsRef.current = m;
      setFavs((prev) => (sameFavs(prev, m) ? prev : m));
    });
    toast({ title: i18n.t(was ? 'guide.toast.favRemovedTitle' : 'guide.toast.favAddedTitle'), description: ch.name });
  }, []);
  // Hold OK on a channel (a finger held on it, a right click, the Menu key):
  // its menu, as Live TV's list has it (ReportChannelDialog): Report Channel,
  // Add to / Remove from Favorites, and Record… where recording is offered.
  // Owner: "holding ok should always bring up the menu to choose to record,
  // add to favorites, report".
  const [menuFor, setMenuFor] = useState<XtreamLiveStream | null>(null);
  const menuForRef = useRef(menuFor);
  menuForRef.current = menuFor;
  const openMenuAt = useCallback((idx: number) => {
    rowResumedRef.current = true;
    const ch = channelsRef.current[idx];
    if (ch) setMenuFor(ch);
  }, []);
  const closeMenu = useCallback(() => { setMenuFor(null); enterFiredRef.current = false; }, []);
  // A finger held still on a row (lifted or not), or a right click: the held
  // OK. A finger that moves is scrolling the grid; the lift after a hold is
  // not also a tap (which would watch the channel).
  const touchHoldRef = useRef<number | null>(null);
  const heldRef = useRef({ at: 0, idx: -1 });
  const cancelTouchHold = useCallback(() => {
    if (touchHoldRef.current) { window.clearTimeout(touchHoldRef.current); touchHoldRef.current = null; }
  }, []);
  const touchHoldFired = (idx: number) => {
    heldRef.current = { at: Date.now(), idx };
    openMenuAt(idx);
  };
  const startTouchHold = (idx: number) => {
    cancelTouchHold();
    touchHoldRef.current = window.setTimeout(() => { touchHoldRef.current = null; touchHoldFired(idx); }, HOLD_MS) as unknown as number;
  };
  const rowMenu = (idx: number) => {
    // The system's own long press of the finger that just opened it: once.
    if (Date.now() - heldRef.current.at < LIFT_CLICK_MS && heldRef.current.idx === idx) return;
    const touching = touchHoldRef.current != null;
    cancelTouchHold();
    if (touching) touchHoldFired(idx); else openMenuAt(idx);
  };
  const wasTouchHold = () => Date.now() - heldRef.current.at < LIFT_CLICK_MS;
  useEffect(() => cancelTouchHold, [cancelTouchHold]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      // The viewer has the Guide now: a place still being restored is not.
      rowResumedRef.current = true;
      try {
        const target = e.target as HTMLElement;
        const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        if (typing) return;
        // The Record dialog owns the remote while it is open (it answers Back itself).
        if (recordForRef.current || menuForRef.current) return;
        if ((e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) && !freshBack()) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          return;
        }

        if (fullscreenRef.current) {
          const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
          if (isBack) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            setFullscreen(false);
            return;
          }
          if (nativeErrorRef.current && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault(); e.stopPropagation();
            nativeRetryRef.current();
            return;
          }
          if (e.key === 'ArrowLeft')  { e.preventDefault(); setVolume(v => Math.max(0, +(v - 0.05).toFixed(2))); return; }
          if (e.key === 'ArrowRight') { e.preventDefault(); setVolume(v => stepVolume(v, 0.05)); return; }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const chans = channelsRef.current;
            if (!chans.length) return;
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            const next = (rowIdxRef.current + delta + chans.length) % chans.length;
            setRowIdx(next);
            const ch = chans[next];
            if (ch) { setPlayingChannelId(ch.stream_id); }
            return;
          }
          return;
        }

        const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
        if (isBack) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
          // Compact's drawer: Back closes it, one step (the grid has the
          // remote, on the category the drawer rests on).
          if (focusZoneRef.current === 'drawer') { closeDrawer(); return; }
          onExitLeft();
          return;
        }

        // The remote's Menu key on a channel: its menu, as a held OK.
        if ((e.key === 'ContextMenu' || e.keyCode === 82) && focusZoneRef.current === 'grid') {
          e.preventDefault(); e.stopPropagation();
          cancelEnterTimer();
          openMenuAt(rowIdxRef.current);
          return;
        }

        const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
        if (!arrows.includes(e.key)) return;
        e.preventDefault();
        const ae = document.activeElement as HTMLElement | null;
        if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();

        // Compact's drawer (D-pad):
        //   ▲ ▼  the categories (the grid behind follows after 1 s of rest);
        //        ▲ from Favorites, the first, goes up to the buttons at the
        //        top (Settings, Update Channels); ▼ from them, Favorites.
        //   OK / ▶ on a category: open it now and close the drawer.
        //   OK on a button: Settings opens / the channels update (the drawer
        //        stays). ◀ ▶ between the two buttons.
        //   ◀    (on a category, or the first button) on to the Player's side
        //        menu, as ◀ from the Guide always went; the drawer closes.
        //   Back closes it (above), one step.
        if (focusZoneRef.current === 'drawer') {
          const cats = chipsRef.current;
          const on = drawerOnRef.current;
          const buttons: Array<'settings' | 'update'> = [
            ...(settingsRef.current ? ['settings' as const] : []),
            ...(updateRef.current ? ['update' as const] : []),
          ];
          const moveTo = (to: 'cats' | 'settings' | 'update') => { drawerOnRef.current = to; setDrawerOn(to); };
          if (on !== 'cats') {
            const b = buttons.indexOf(on);
            if (e.key === 'ArrowDown') moveTo('cats');
            else if (e.key === 'ArrowLeft') {
              if (b > 0) moveTo(buttons[b - 1]);
              else if (!e.repeat) { closeDrawer(false); onExitLeft(); }
            } else if (e.key === 'ArrowRight') {
              if (b >= 0 && b < buttons.length - 1) moveTo(buttons[b + 1]);
            } else if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
              if (on === 'settings') settingsRef.current?.();
              else updateRef.current?.();
            }
            return;
          }
          if (e.key === 'ArrowUp') {
            if (categoryIdxRef.current === 0) { if (buttons.length) moveTo(buttons[0]); return; }
            userMovedRef.current = true;
            categoryIdxRef.current = Math.max(0, categoryIdxRef.current - 1);
            setCategoryIdx(categoryIdxRef.current);
          } else if (e.key === 'ArrowDown') {
            if (categoryIdxRef.current >= cats.length - 1) return;
            userMovedRef.current = true;
            categoryIdxRef.current = Math.min(cats.length - 1, categoryIdxRef.current + 1);
            setCategoryIdx(categoryIdxRef.current);
          } else if (e.key === 'ArrowLeft') {
            // A held ◀ (its repeats) stops at the drawer.
            if (e.repeat) return;
            closeDrawer(false);
            onExitLeft();
          } else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
            if (e.repeat) return;
            userMovedRef.current = true;
            closeDrawer();
          }
          return;
        }

        if (focusZoneRef.current === 'category') {
          const cats = chipsRef.current;
          if (e.key === 'ArrowLeft') {
            if (categoryIdxRef.current === 0) { onExitLeft(); return; }
            userMovedRef.current = true;
            setCategoryIdx(i => Math.max(0, i - 1));
          } else if (e.key === 'ArrowRight') {
            if (categoryIdxRef.current >= cats.length - 1) return;
            userMovedRef.current = true;
            setCategoryIdx(i => Math.min(cats.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            onExitUp?.();
          } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            setFocusZone('grid');
          }
          return;
        }

        // grid zone
        if (e.key === 'ArrowUp') {
          // Large: the first row's ▲ goes up to the chips. Compact has none
          // above (the categories are in the drawer): the first row stays.
          if (rowIdxRef.current === 0) { if (!compactRef.current) setFocusZone('category'); return; }
          setRowIdx(i => Math.max(0, i - 1));
        } else if (e.key === 'ArrowDown') {
          const n = channelsRef.current.length;
          setRowIdx(i => (n ? Math.min(n - 1, i + 1) : 0));
        } else if (e.key === 'ArrowLeft') {
          // THE ◀ RULE (both sizes): ◀ moves time back while the grid shows
          // a later time; only at its start (now) does it leave the grid.
          // There, Large hands the remote to the Player's side menu (as it
          // always did) and Compact opens the category drawer (a second ◀
          // goes on to the side menu). ▶ always moves time on.
          if (windowStartRef.current <= nowInitialRef.current) {
            if (compactRef.current) { if (!e.repeat) openDrawer(); return; }
            onExitLeft();
            return;
          }
          setWindowStart(s => s - SLOT_MINUTES * 60_000);
        } else if (e.key === 'ArrowRight') {
          setWindowStart(s => s + SLOT_MINUTES * 60_000);
        } else if (e.key === 'Enter' || e.key === ' ') {
          // Watch it on release (below), so a hold can be told from a press;
          // held, the channel's menu. A held key's repeats neither restart
          // the hold nor play.
          if (e.repeat || enterTimerRef.current || enterFiredRef.current) return;
          enterTimerRef.current = window.setTimeout(() => {
            enterTimerRef.current = null;
            enterFiredRef.current = true;
            openMenuAt(rowIdxRef.current);
          }, HOLD_MS) as unknown as number;
        }
      } catch { /* ignore */ }
    };
    // OK let go before the hold time: a press, so play. After a hold that opened
    // the menu the release is just consumed (the menu arms itself on it).
    const keyupHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (enterTimerRef.current) {
        cancelEnterTimer();
        if (!fullscreenRef.current && !recordForRef.current && !menuForRef.current && focusZoneRef.current === 'grid') playRowRef.current(rowIdxRef.current);
      }
      enterFiredRef.current = false;
    };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('keyup', keyupHandler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keyup', keyupHandler, true);
      cancelEnterTimer();
    };
  }, [isActive, onExitLeft, onExitUp, cancelEnterTimer, openMenuAt, openDrawer, closeDrawer]);
  // The side menu (or a dialog over the Player) has the remote: a hold that
  // was under way is not finished by it.
  useEffect(() => {
    if (isActive) return;
    cancelEnterTimer();
    enterFiredRef.current = false;
  }, [isActive, cancelEnterTimer]);

  // Hardware Back (Capacitor)
  useEffect(() => {
    if (!isActive) return;
    let handle: { remove?: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const h = await CapApp.addListener('backButton', () => {
          // The voice overlay's Back (it is up, or this press closed it).
          if (voiceOwnsBack()) return;
          (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
          if (recordForRef.current || menuForRef.current) return; // the dialogs answer Back themselves
          if (!freshBack()) return;
          if (fullscreenRef.current) { setFullscreen(false); return; }
          if (focusZoneRef.current === 'drawer') { closeDrawer(); return; }
          onExitLeft();
        });
        if (cancelled) h?.remove?.(); else handle = h;
      } catch { /* web */ }
    })();
    return () => { cancelled = true; handle?.remove?.(); };
  }, [isActive, onExitLeft, closeDrawer]);

  // ── Render fullscreen ────────────────────────────────────────────────
  const playingChannel = playingChannelId
    ? channels.find(c => c.stream_id === playingChannelId) || null
    : null;
  const nowProgramFor = (id: number): DecodedProgram | undefined => {
    const list = epgCacheRef.current.get(id);
    if (!list) return undefined;
    const n = Date.now();
    return list.find(p => p.start <= n && n < p.end);
  };

  if (fullscreen) {
    const playingNow = playingChannel ? nowProgramFor(playingChannel.stream_id) : undefined;
    return (
      <div className={`fixed inset-0 z-[60] text-white ${NATIVE_PLAYBACK ? 'bg-transparent' : 'bg-black'}`}>
        {!NATIVE_PLAYBACK && !DEMO && (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><div className="w-full max-w-md"><SnowLoader size="lg" label={t('common.loading')} /></div></div>}>
            <VideoPlayer src={streamUrl} volume={volume} muted={false} className="w-full h-full" />
          </Suspense>
        )}
        {DEMO && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8 pointer-events-none">
            <p className="px-3 py-1 rounded-full bg-brand-gold/20 border border-brand-gold/40 text-brand-gold text-xs font-nunito font-semibold tracking-widest uppercase">
              {t('guide.demoNotice')}
            </p>
            <p className="mt-2 text-brand-ice/70 font-nunito text-sm max-w-md">{demoDialogMsg()}</p>
          </div>
        )}
        {NATIVE_PLAYBACK && native.buffering && !native.error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-full max-w-md"><SnowLoader size="lg" label={t('guide.buffering')} /></div>
          </div>
        )}
        {NATIVE_PLAYBACK && !native.error && (
          <BufferingDiagnostics buffering={native.buffering} />
        )}
        {NATIVE_PLAYBACK && native.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-white p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-brand-gold mb-3" />
            <p className="font-quicksand font-semibold text-xl mb-1">{t('guide.playbackError')}</p>
            <p className="text-sm text-brand-ice/80 font-nunito max-w-md mb-4">{native.error.message}</p>
            <button
              onClick={() => native.retry()}
              autoFocus
              data-focused="true"
              className="tv-ring tv-ring-contrast flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold"
            >
              <RotateCw className="w-4 h-4" /> {t('common.retry')}
            </button>
          </div>
        )}
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
          <div className="flex items-center gap-3">
            {playingChannel?.stream_icon
              ? <img src={playingChannel.stream_icon} alt="" className="w-12 h-12 rounded-lg bg-black/40 object-contain" />
              : <Tv className="w-8 h-8 text-brand-gold" />}
            <div className="min-w-0">
              <p data-guide-playing-name className={`font-quicksand font-bold text-white ${nameClasses(playingChannel?.name, 40, 'text-base', 'text-sm')}`}>{playingChannel?.name || ''}</p>
              {playingNow && <p className="text-sm text-brand-ice/80 font-nunito truncate">{playingNow.title}</p>}
            </div>
          </div>
        </div>
        <div className="absolute bottom-4 right-6 px-3 py-2 rounded-full bg-black/60 text-brand-ice/80 font-nunito text-xs pointer-events-none">
          {t('guide.volumeBack', { pct: Math.round(volume * 100) })}
        </div>
      </div>
    );
  }

  // ── Render grid ──────────────────────────────────────────────────────
  const totalRowsSize = rowVirtualizer.getTotalSize();
  const slotPct = 100 / slots;
  const nowPct = ((nowTick - windowStart) / (windowMin * 60_000)) * 100;
  const nowInWindow = nowPct >= 0 && nowPct <= 100;
  const canGoEarlier = windowStart > nowInitialRef.current;

  // The channel menu and the Record dialog, over either size.
  const dialogs = (
    <>
    {menuFor && (
      <Suspense fallback={null}>
        <ReportChannelDialog
          channelName={menuFor.name}
          channelId={menuFor.stream_id}
          categoryName={onFavorites ? 'Favorites' : (currentCategory?.category_name || '')}
          isFavorite={favs.has(menuFor.stream_id)}
          onToggleFavorite={() => toggleFavorite(menuFor)}
          onRecord={SCHEDULE_CAPABLE && !kidsLevel() ? () => {
            // This menu closes; the recording options (programme mode) open.
            const ch = menuFor;
            closeMenu();
            void openRecordRef.current(ch);
          } : undefined}
          line={creds}
          onReportedDown={() => signalChannel(creds.host, menuFor.stream_id, menuFor.name, 'down', creds)}
          onReportedBuffering={() => signalChannel(creds.host, menuFor.stream_id, menuFor.name, 'buffering', creds)}
          onOpenBufferingGuide={() => {
            closeMenu();
            _onNavigate?.('support');
            setTimeout(() => { window.dispatchEvent(new CustomEvent('support:open-buffering-guide')); }, 80);
          }}
          onClose={closeMenu}
        />
      </Suspense>
    )}
    {recordFor && (
      <RecordDialog
        channelName={recordFor.ch.name}
        maxConnections={recordFor.plan}
        programmes={recordFor.programmes}
        streamId={recordFor.ch.stream_id}
        existing={recordFor.existing}
        armed
        onStart={(choice) => { const t = recordFor; closeRecord(); void startProgramme(t, choice); }}
        onClose={closeRecord}
      />
    )}
    </>
  );

  // ── Compact ──────────────────────────────────────────────────────────
  const renderCompact = (): JSX.Element => {
    const drawerOpen = focusZone === 'drawer';
    const timesH = touch ? COMPACT_TIMES_TOUCH : COMPACT_TIMES_TV;
    const bottomH = touch ? COMPACT_BOTTOM_TOUCH : COMPACT_BOTTOM_TV;
    const drawerW = Math.min(DRAWER_W, Math.round((window.innerWidth || 960) * 0.85));
    const previewVh = touch ? COMPACT_PREVIEW_VH_TOUCH : COMPACT_PREVIEW_VH;
    const colW = upright ? COMPACT_COL_W_UPRIGHT : COMPACT_COL_W;
    const catName = !catsReady ? t('guide.loadingCategories') : onFavorites ? t('guide.favorites') : (currentCategory?.category_name ?? '');
    const ch = focusedGuideChannel ?? channels[rowIdx] ?? null;
    // undefined: not fetched yet; [] or nothing on now: "No programme information".
    const list = ch ? epgCacheRef.current.get(ch.stream_id) : undefined;
    const n = Date.now();
    const now = list?.find((p) => p.start <= n && n < p.end);
    const next = list?.find((p) => p.start >= n);
    const recordable = SCHEDULE_CAPABLE && !kidsLevel();
    const hint = drawerOpen ? t('guide.hintDrawer')
      : canGoEarlier ? (recordable ? t('guide.hintRecord') : t('guide.hint'))
        : (recordable ? t('guide.hintCompactRecord') : t('guide.hintCompact'));
    const smallBtn = 'flex items-center flex-shrink-0 rounded-md bg-white/10 text-white font-nunito';
    const drawerBtn = (on: boolean) => `tv-ring flex-1 min-w-0 flex items-center justify-center px-2 py-1 ${touch ? 'min-h-[44px]' : 'min-h-[32px]'} rounded-md text-[13px] leading-tight font-quicksand font-semibold ${on ? 'bg-brand-gold/25 text-white' : 'bg-white/10 text-brand-ice'}`;
    return (
      <div data-native-clear data-guide-size="compact" className="relative flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-black/30">
        {/* The preview and what is on now and next. The highlighted channel's
            whole name is here, a step smaller on two lines when long. */}
        <div data-native-clear data-guide-preview className="flex-shrink-0 flex items-stretch px-3 py-2 border-b border-white/10" style={{ height: `${previewVh}vh` }}>
          <div
            ref={previewBoxRef}
            className={`h-full flex-shrink-0 rounded-lg overflow-hidden border border-white/10 flex items-center justify-center ${nativePreviewActive ? '' : 'bg-black'}`}
            style={{ width: `calc((${previewVh}vh - 16px) * 16 / 9)` }}
          >
            {!nativePreviewActive && (
              ch?.stream_icon
                ? <img src={ch.stream_icon} alt="" className="max-w-[60%] max-h-[60%] object-contain opacity-80" />
                : <Tv className="w-10 h-10 text-brand-ice/30" />
            )}
          </div>
          <div className="flex-1 min-w-0 pl-4 flex flex-col justify-center">
            {ch ? (
              <>
                {(ch.num != null || favs.has(ch.stream_id)) && (
                  <div className="flex items-center text-[13px] font-nunito text-brand-ice/70 tabular-nums">
                    {ch.num != null && <span>{ch.num}</span>}
                    {favs.has(ch.stream_id) && <Star className={`w-3.5 h-3.5 text-brand-gold fill-brand-gold ${ch.num != null ? 'ml-1.5' : ''}`} />}
                  </div>
                )}
                <h3 data-guide-head className={`font-quicksand font-bold text-white ${nameClasses(ch.name, 40, 'text-2xl', 'text-lg')}`}>{ch.name}</h3>
                {now ? (
                  <>
                    <p className="mt-1 text-base text-brand-ice/90 font-nunito truncate">{t('guide.now', { title: now.title })}</p>
                    <p className="text-[13px] text-brand-ice/60 font-nunito tabular-nums">{formatSlot(now.start)} – {formatSlot(now.end)}</p>
                  </>
                ) : list ? (
                  <p className="mt-1 text-base text-brand-ice/60 font-nunito">{t('guide.noInfo')}</p>
                ) : (
                  <p data-guide-info-loading className="mt-1 text-base text-brand-ice/40 font-nunito">{t('common.loading')}</p>
                )}
                {next && <p className="mt-1 text-sm text-brand-ice/70 font-nunito truncate">{t('guide.next', { title: next.title, time: formatSlot(next.start) })}</p>}
              </>
            ) : (
              <p className="text-base text-brand-ice/60 font-nunito">{t('guide.pickChannel')}</p>
            )}
          </div>
        </div>

        {/* The slim time bar. At its left the current category: ◀ at the
            first time opens the drawer (the D-pad's rule); a touch opens it
            here. Later in the day, "◀ earlier" says ◀ moves time back. */}
        <div data-guide-times className="flex-shrink-0 border-b border-white/10 bg-black/50 flex px-3" style={{ height: timesH }}>
          {touch ? (
            <button
              type="button"
              data-guide-cat-button
              aria-label={t('guide.categories')}
              onClick={() => (drawerOpen ? closeDrawer() : openDrawer())}
              className="flex-shrink-0 border-r border-white/10 flex items-center px-2 text-left text-white font-quicksand font-semibold text-sm overflow-hidden"
              style={{ width: colW }}
            >
              <LayoutList className="w-5 h-5 mr-2 text-brand-gold flex-shrink-0" />
              <span data-guide-cat-label className="truncate">{catName}</span>
            </button>
          ) : (
            <div className="flex-shrink-0 border-r border-white/10 flex items-center pr-2 font-nunito text-[13px] overflow-hidden" style={{ width: colW }}>
              {!canGoEarlier && <ChevronLeft className={`w-4 h-4 flex-shrink-0 ${isActive && focusZone === 'grid' ? 'text-brand-gold' : 'text-brand-ice/60'}`} />}
              <span data-guide-cat-label className={`truncate font-quicksand font-semibold text-white ${canGoEarlier ? 'pl-1' : ''}`}>{catName}</span>
              {canGoEarlier && <span className="ml-auto pl-2 flex-shrink-0 text-brand-gold">{t('guide.earlier')}</span>}
            </div>
          )}
          <div className="flex-1 relative">
            {slotStarts.map((st, i) => (
              <div
                key={st}
                data-guide-time
                className="absolute top-0 bottom-0 border-l border-white/10 flex items-center px-1.5 text-[13px] whitespace-nowrap overflow-hidden font-nunito text-brand-ice/80 tabular-nums"
                style={{ left: `${i * slotPct}%`, width: `${slotPct}%` }}
              >
                {formatSlot(st)}
              </div>
            ))}
            {nowInWindow && <div className="absolute top-0 bottom-0 w-px bg-red-500" style={{ left: `${nowPct}%` }} />}
          </div>
        </div>

        {/* The rows: no gaps, the highlighted one filled and ringed. */}
        <div
          ref={scrollParentRef}
          data-guide-grid
          onScroll={(e) => { gridScrollTopRef.current = e.currentTarget.scrollTop; }}
          className="flex-1 min-h-0 px-3 overflow-y-auto overflow-x-hidden"
        >
          {listLoading && channels.length === 0 ? (
            <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-brand-gold" /> {t('guide.loadingChannels')}
            </div>
          ) : channels.length === 0 ? (
            <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm text-center px-6">
              {onFavorites ? t('guide.noFavorites') : t('guide.noChannels')}
            </div>
          ) : (
            <div style={{ height: totalRowsSize, position: 'relative', width: '100%' }}>
              {virtualItems.map(v => {
                const c = channels[v.index];
                if (!c) return null;
                const focused = isActive && focusZone === 'grid' && v.index === rowIdx;
                const programs = epgCacheRef.current.get(c.stream_id);
                const visible = (programs || []).filter(p => p.end > windowStart && p.start < windowEnd);
                return (
                  <div
                    key={v.key}
                    data-guide-row
                    onClick={() => { if (wasTouchHold()) return; rowResumedRef.current = true; setRowIdx(v.index); playRow(v.index); }}
                    onTouchStart={() => startTouchHold(v.index)}
                    onTouchEnd={cancelTouchHold}
                    onTouchMove={cancelTouchHold}
                    onTouchCancel={cancelTouchHold}
                    onContextMenu={(e) => { e.preventDefault(); rowMenu(v.index); }}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: rowH, transform: `translateY(${v.start}px)` }}
                    className="cursor-pointer"
                  >
                    <div
                      data-focused={focused ? 'true' : 'false'}
                      className={`tv-ring h-full flex border-b border-white/[0.07] ${focused ? 'bg-brand-gold/25 z-10' : ''}`}
                    >
                      <div data-guide-cell className="flex-shrink-0 flex items-center pr-2 border-r border-white/10 overflow-hidden" style={{ width: colW }}>
                        {!upright && (
                          <span className={`w-9 flex-shrink-0 text-right pr-2 font-nunito tabular-nums text-[13px] ${focused ? 'text-brand-gold' : 'text-brand-ice/70'}`}>{c.num ?? ''}</span>
                        )}
                        {c.stream_icon
                          ? <img src={c.stream_icon} alt="" loading="lazy" className="w-6 h-6 object-contain rounded bg-black/40 flex-shrink-0" />
                          : <Tv className="w-5 h-5 text-brand-ice/60 flex-shrink-0" />}
                        {/* A long name: a step smaller, on two lines (lib/channelName). */}
                        <div data-guide-name className={`ml-2 min-w-0 flex-1 font-quicksand font-semibold text-white ${nameClasses(c.name, upright ? 10 : 18, 'text-sm', 'text-[11px]')}`}>{c.name}</div>
                        {favs.has(c.stream_id) && <Star data-guide-fav className="ml-1 w-3.5 h-3.5 text-brand-gold fill-brand-gold flex-shrink-0" />}
                      </div>
                      <div className="flex-1 relative overflow-hidden">
                        {!programs && (
                          <div className="absolute inset-0 flex items-center px-2 text-brand-ice/60 font-nunito text-xs">
                            <Loader2 className="w-3 h-3 animate-spin mr-2" /> {t('guide.epgLoading')}
                          </div>
                        )}
                        {/* No listings (event channels): the name where the eye
                            goes, a step smaller on two lines when long. */}
                        {programs && visible.length === 0 && (
                          <div data-guide-nolistings className="absolute inset-0 flex items-center px-2 overflow-hidden">
                            <div className="min-w-0">
                              <div className={`font-quicksand font-semibold text-white/90 ${nameClasses(c.name, 60, 'text-sm', 'text-[11px]')}`}>{c.name}</div>
                            </div>
                            <span className="ml-2 flex-shrink-0 font-nunito text-xs text-brand-ice/60 whitespace-nowrap">{t('guide.noListings')}</span>
                          </div>
                        )}
                        {visible.map((p, i) => {
                          const clampedStart = Math.max(p.start, windowStart);
                          const clampedEnd = Math.min(p.end, windowEnd);
                          const left = ((clampedStart - windowStart) / (windowMin * 60_000)) * 100;
                          const width = ((clampedEnd - clampedStart) / (windowMin * 60_000)) * 100;
                          const airingNow = p.start <= nowTick && nowTick < p.end;
                          const startsHere = scheduledStarts.get(c.stream_id);
                          const scheduled = !!startsHere && (() => {
                            const at = programmeTimeUtcMs(p.rs, panelOff);
                            return at != null && startsHere.some((x) => Math.abs(x - at) < 60_000);
                          })();
                          return (
                            <div
                              key={i}
                              style={{ left: `calc(${left}% + 1px)`, width: `calc(${width}% - 2px)`, top: 2, bottom: 2 }}
                              className={`absolute rounded-md px-2 flex items-center overflow-hidden border ${airingNow ? 'bg-brand-gold/20 border-brand-gold/40' : 'bg-white/[0.06] border-white/10'}`}
                            >
                              {/* The time wraps onto a hidden second line when the
                                  title leaves it no room: shown only when it fits. */}
                              <div className="w-full flex flex-wrap items-baseline overflow-hidden min-w-0" style={{ height: 18 }}>
                                <span data-guide-prog-title className="max-w-full truncate font-quicksand font-semibold text-sm leading-[18px] text-white">{p.title}</span>
                                <span className="ml-2 font-nunito text-xs leading-[18px] text-brand-ice/70 whitespace-nowrap tabular-nums">{formatSlot(p.start)}</span>
                              </div>
                              {scheduled && (
                                <span data-scheduled-dot aria-label={t('guide.scheduledDot')} className="absolute top-0.5 right-0.5 rounded-full bg-red-500" style={{ width: 6, height: 6 }} />
                              )}
                            </div>
                          );
                        })}
                        {nowInWindow && (
                          <div className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none" style={{ left: `${nowPct}%` }} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* The slim bottom bar: the remote's hints (a touch screen has Back
            and earlier / later instead), then the Player's Update Channels
            and Settings (the remote reaches them in the drawer). */}
        <div
          data-guide-bottom
          className={`flex-shrink-0 border-t border-white/10 bg-black/40 flex items-center ${touch ? 'px-2' : 'pl-3 pr-36'}`}
          style={{ height: bottomH }}
        >
          {touch ? (
            <>
              {onBackButton && (
                <button type="button" data-guide-back aria-label={t('common.back')} onClick={onBackButton} className={`${smallBtn} h-11 px-3 mr-2 text-sm`}>
                  <ArrowLeft className="w-5 h-5" />{!upright && <span className="ml-1.5">{t('common.back')}</span>}
                </button>
              )}
              <button type="button" data-guide-earlier aria-label={t('guide.earlierBtn')} disabled={!canGoEarlier} onClick={earlier} className={`w-11 h-11 mr-2 rounded-full flex items-center justify-center flex-shrink-0 ${canGoEarlier ? 'bg-white/10 text-white' : 'bg-white/5 text-white/30'}`}>
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button type="button" data-guide-later aria-label={t('guide.laterBtn')} onClick={later} className="w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center flex-shrink-0">
                <ChevronRight className="w-6 h-6" />
              </button>
              <div className="flex-1" />
            </>
          ) : (
            <p data-guide-hint className="flex-1 min-w-0 truncate text-xs font-nunito text-brand-ice/60">{hint}</p>
          )}
          {onUpdateChannels && (
            <button
              type="button"
              tabIndex={-1}
              data-guide-update
              aria-label={t('live.shell.updateChannelsBtn')}
              onClick={onUpdateChannels}
              disabled={refreshing}
              className={`${smallBtn} ml-2 ${touch ? 'h-11 px-3 text-sm' : 'h-5 px-2 text-xs'}`}
            >
              <RefreshCw className={`${touch ? 'w-4 h-4' : 'w-3 h-3'} ${refreshing ? 'animate-spin' : ''}`} />
              {!upright && <span className="ml-1.5">{refreshing ? t('live.shell.updatingBtn') : t('live.shell.updateChannelsBtn')}</span>}
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              tabIndex={-1}
              data-guide-settings
              aria-label={t('common.settings')}
              onClick={onOpenSettings}
              className={`${smallBtn} ml-2 ${touch ? 'h-11 px-3 text-sm' : 'h-5 px-2 text-xs'}`}
            >
              <SettingsIcon className={touch ? 'w-4 h-4' : 'w-3 h-3'} />
              {!upright && <span className="ml-1.5">{t('common.settings')}</span>}
            </button>
          )}
        </div>

        {/* The category drawer, over the left edge: the service, Settings and
            Update Channels, then Favorites and the categories. */}
        {drawerOpen && touch && (
          <div data-guide-drawer-scrim className="absolute top-0 bottom-0 right-0 z-30 bg-black/50" style={{ left: drawerW }} onClick={() => closeDrawer()} />
        )}
        {drawerOpen && (
          <div data-guide-drawer className="absolute top-0 bottom-0 left-0 z-30 flex flex-col bg-[#0b1220] border-r border-white/15 shadow-2xl" style={{ width: drawerW }}>
            <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-white/10">
              <div className="flex items-center min-w-0">
                <Tv className="w-7 h-7 text-brand-gold flex-shrink-0" />
                <div className="ml-2 min-w-0">
                  <div className="text-xs font-nunito text-brand-ice/60">{t('guide.service')}</div>
                  <div data-guide-service className="text-sm font-quicksand font-bold text-white truncate">{serviceName || t('live.shell.title')}</div>
                </div>
              </div>
              {(onOpenSettings || onUpdateChannels) && (
                <div className="mt-2 flex">
                  {onOpenSettings && (
                    <button
                      type="button"
                      tabIndex={-1}
                      data-guide-drawer-settings
                      data-focused={isActive && drawerOn === 'settings' ? 'true' : 'false'}
                      onClick={onOpenSettings}
                      className={`${drawerBtn(drawerOn === 'settings')} ${onUpdateChannels ? 'mr-2' : ''}`}
                    >
                      <SettingsIcon className="w-4 h-4 mr-1.5 flex-shrink-0" /><span className="text-center break-words min-w-0">{t('common.settings')}</span>
                    </button>
                  )}
                  {onUpdateChannels && (
                    <button
                      type="button"
                      tabIndex={-1}
                      data-guide-drawer-update
                      data-focused={isActive && drawerOn === 'update' ? 'true' : 'false'}
                      onClick={onUpdateChannels}
                      disabled={refreshing}
                      className={drawerBtn(drawerOn === 'update')}
                    >
                      <RefreshCw className={`w-4 h-4 mr-1.5 flex-shrink-0 ${refreshing ? 'animate-spin' : ''}`} /><span className="text-center break-words min-w-0">{refreshing ? t('live.shell.updatingBtn') : t('live.shell.updateChannelsBtn')}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex-shrink-0 px-3 pt-2 pb-1 text-xs uppercase tracking-wide font-nunito text-brand-ice/50">{t('guide.categories')}</div>
            <div ref={drawerListRef} data-guide-drawer-list className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-2">
              {!catsReady ? (
                <div className="flex items-center gap-2 text-brand-ice/70 font-nunito text-sm px-2 py-1">
                  <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> {t('guide.loadingCategories')}
                </div>
              ) : chips.map((c, i) => {
                const isFav = c === FAV_CHIP;
                const focused = !touch && isActive && drawerOn === 'cats' && categoryIdx === i;
                const selected = categoryIdx === i;
                return (
                  <button
                    key={c.category_id}
                    type="button"
                    tabIndex={-1}
                    data-drawer-i={i}
                    data-focused={focused ? 'true' : 'false'}
                    data-selected={selected ? 'true' : 'false'}
                    onClick={() => pickDrawer(i)}
                    className={`tv-ring w-full flex items-center px-3 ${touch ? 'min-h-[44px]' : 'min-h-[32px]'} py-1 rounded-md text-left font-quicksand ${
                      focused ? 'bg-brand-gold/25 text-white' : selected ? 'text-brand-gold font-semibold' : 'text-brand-ice'}`}
                  >
                    {isFav && <Star className="w-4 h-4 mr-2 text-brand-gold flex-shrink-0" />}
                    <span className={`min-w-0 ${nameClasses(isFav ? t('guide.favorites') : c.category_name, 28, 'text-sm', 'text-xs')}`}>{isFav ? t('guide.favorites') : c.category_name}</span>
                  </button>
                );
              })}
            </div>
            {!touch && <div data-guide-drawer-hint className="flex-shrink-0 px-3 py-1.5 border-t border-white/10 text-xs leading-snug font-nunito text-brand-ice/50">{t('guide.hintDrawer')}</div>}
          </div>
        )}
        {dialogs}
      </div>
    );
  };
  if (compact) return renderCompact();

  return (
    <div data-native-clear className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-black/30">
      {/* Category selector row */}
      <div data-howto="guide.categories" className={`flex-shrink-0 border-b border-white/10 bg-black/40 px-3 py-2 ${focusZone === 'category' && isActive ? 'bg-white/5' : ''}`}>
        {!catsReady ? (
          <div className="flex items-center gap-2 text-brand-ice/70 font-nunito text-sm px-2 py-1">
            <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> {t('guide.loadingCategories')}
          </div>
        ) : (
          <div ref={catBarRef} className="flex items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap py-1 px-2 -mx-2">
            {chips.map((c, i) => {
              const isFocused = isActive && focusZone === 'category' && categoryIdx === i;
              const isSelected = categoryIdx === i;
              const isFav = c === FAV_CHIP;
              return (
                <button
                  key={c.category_id}
                  data-cat-i={i}
                  data-focused={isFocused ? 'true' : 'false'}
                  onClick={() => { userMovedRef.current = true; rowResumedRef.current = true; setCategoryIdx(i); setFocusZone('grid'); }}
                  className={`
                    tv-ring flex-shrink-0 px-3 py-2 rounded-lg border text-sm font-nunito transition-transform duration-150
                    ${isFav ? 'flex items-center' : ''}
                    ${isFocused ? 'bg-brand-gold/25 border-transparent text-white scale-105 z-10' : isSelected ? 'bg-white/10 border-brand-gold/30 text-white' : 'border-transparent text-brand-ice hover:bg-white/5'}
                  `}
                >
                  {isFav && <Star className="w-4 h-4 mr-1.5 text-brand-gold flex-shrink-0" />}
                  {isFav ? t('guide.favorites') : c.category_name}
                </button>
              );
            })}
            {categories.length === 0 && (
              <span className="flex-shrink-0 text-brand-ice/70 font-nunito text-sm px-2">{t('guide.noCategories')}</span>
            )}
          </div>
        )}
      </div>

      {/* Preview: the highlighted channel, and what is on now and next */}
      {(() => {
        const ch = focusedGuideChannel ?? channels[rowIdx] ?? null;
        // undefined: not fetched yet (its row shows "EPG…"); [] or a list
        // with nothing on now: fetched, and "No programme information" is true.
        const list = ch ? epgCacheRef.current.get(ch.stream_id) : undefined;
        const n = Date.now();
        const now = list?.find((p) => p.start <= n && n < p.end);
        const next = list?.find((p) => p.start >= n);
        return (
          <div data-native-clear data-guide-preview className="flex-shrink-0 flex items-stretch px-4 py-3 border-b border-white/10" style={{ height: '27vh' }}>
            <div
              ref={previewBoxRef}
              className={`h-full flex-shrink-0 rounded-xl overflow-hidden border border-white/10 flex items-center justify-center ${nativePreviewActive ? '' : 'bg-black'}`}
              style={{ width: 'calc(27vh * 16 / 9 - 24px * 16 / 9)' }}
            >
              {!nativePreviewActive && (
                ch?.stream_icon
                  ? <img src={ch.stream_icon} alt="" className="max-w-[60%] max-h-[60%] object-contain opacity-80" />
                  : <Tv className="w-10 h-10 text-brand-ice/30" />
              )}
            </div>
            <div className="flex-1 min-w-0 pl-5 flex flex-col justify-center">
              {ch ? (
                <>
                  {/* A long name (an event and its time): two smaller lines (lib/channelName). */}
                  <h3 data-guide-head className={`font-quicksand font-bold text-white ${nameClasses(ch.name, 40, 'text-2xl', 'text-lg')}`}>{ch.name}</h3>
                  {now ? (
                    <>
                      <p className="mt-1 text-lg text-brand-ice/90 font-nunito truncate">{t('guide.now', { title: now.title })}</p>
                      <p className="text-sm text-brand-ice/60 font-nunito">{formatSlot(now.start)} – {formatSlot(now.end)}</p>
                    </>
                  ) : list ? (
                    <p className="mt-1 text-base text-brand-ice/60 font-nunito">{t('guide.noInfo')}</p>
                  ) : (
                    <p data-guide-info-loading className="mt-1 text-base text-brand-ice/40 font-nunito">{t('common.loading')}</p>
                  )}
                  {next && <p className="mt-2 text-base text-brand-ice/70 font-nunito truncate">{t('guide.next', { title: next.title, time: formatSlot(next.start) })}</p>}
                  <p className="mt-2 text-xs text-brand-ice/45 font-nunito">{t('guide.okFullScreen')}</p>
                </>
              ) : (
                <p className="text-base text-brand-ice/60 font-nunito">{t('guide.pickChannel')}</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Time header */}
      <div
        className="flex-shrink-0 border-b border-white/10 bg-black/50 flex px-3"
        style={{ height: TIME_HEADER_HEIGHT }}
      >
        <div
          className="flex-shrink-0 border-r border-white/10 flex items-center justify-between px-3 text-xs font-nunito text-brand-ice/70"
          data-guide-chan
          style={{ width: CHANNEL_COL_WIDTH }}
        >
          <span className="min-w-0 truncate">{t('guide.channelHeader')}</span>
          <span className={`min-w-0 truncate ${canGoEarlier ? 'text-brand-gold' : 'opacity-50'}`}>{t('guide.earlier')}</span>
        </div>
        <div className="flex-1 relative">
          {slotStarts.map((s, i) => (
            <div
              key={s}
              className="absolute top-0 bottom-0 border-l border-white/10 flex items-center px-2 text-xs font-nunito text-brand-ice/80"
              data-guide-slot
              style={{ left: `${i * slotPct}%`, width: `${slotPct}%` }}
            >
              {formatSlot(s)}
            </div>
          ))}
          {nowInWindow && (
            <div
              className="absolute top-0 bottom-0 w-px bg-red-500"
              style={{ left: `${nowPct}%` }}
            />
          )}
        </div>
      </div>

      {/* Grid body */}
      <div
        ref={scrollParentRef}
        data-guide-grid
        onScroll={(e) => { gridScrollTopRef.current = e.currentTarget.scrollTop; }}
        className={`flex-1 min-h-0 px-3 overflow-y-auto overflow-x-hidden ${focusZone === 'grid' && isActive ? 'bg-white/[0.02]' : ''}`}
      >
        {listLoading && channels.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-brand-gold" /> {t('guide.loadingChannels')}
          </div>
        ) : channels.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm">
            {onFavorites ? t('guide.noFavorites') : t('guide.noChannels')}
          </div>
        ) : (
          <div style={{ height: totalRowsSize, position: 'relative', width: '100%' }}>
            {virtualItems.map(v => {
              const ch = channels[v.index];
              if (!ch) return null;
              const isFocused = isActive && focusZone === 'grid' && v.index === rowIdx;
              const programs = epgCacheRef.current.get(ch.stream_id);
              const visible = (programs || []).filter(p => p.end > windowStart && p.start < windowEnd);
              return (
                <div
                  key={v.key}
                  onClick={() => { if (wasTouchHold()) return; rowResumedRef.current = true; setRowIdx(v.index); playRow(v.index); }}
                  onTouchStart={() => startTouchHold(v.index)}
                  onTouchEnd={cancelTouchHold}
                  onTouchMove={cancelTouchHold}
                  onTouchCancel={cancelTouchHold}
                  onContextMenu={(e) => { e.preventDefault(); rowMenu(v.index); }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${v.start}px)`,
                    padding: '4px 0',
                  }}
                  className="cursor-pointer"
                >
                  <div
                    data-focused={isFocused ? 'true' : 'false'}
                    className={`
                    tv-ring h-full flex rounded-xl border transition-transform duration-150
                    ${isFocused ? 'bg-brand-gold/15 border-transparent scale-[1.01] z-10' : 'bg-black/30 border-white/10'}
                  `}>
                    {/* Channel cell */}
                    <div
                      data-howto="guide.channels"
                      data-guide-chan
                      className="flex-shrink-0 flex items-center gap-2 px-3 border-r border-white/10 overflow-hidden"
                      style={{ width: CHANNEL_COL_WIDTH }}
                    >
                      {ch.stream_icon
                        ? <img src={ch.stream_icon} alt="" loading="lazy" className="w-10 h-10 object-contain rounded-lg bg-black/40 flex-shrink-0" />
                        : <Tv className="w-8 h-8 text-brand-ice/60 flex-shrink-0" />}
                      <div className="min-w-0">
                        {(ch.num != null || favs.has(ch.stream_id)) && (
                          <div className="flex items-center text-xs font-nunito text-brand-ice/70 tabular-nums leading-tight">
                            {ch.num != null && <span>#{ch.num}</span>}
                            {favs.has(ch.stream_id) && <Star data-guide-fav className={`w-3 h-3 text-brand-gold fill-brand-gold flex-shrink-0 ${ch.num != null ? 'ml-1' : ''}`} />}
                          </div>
                        )}
                        {/* Long names (an event and its time): a size smaller, two
                            lines, on every row (lib/channelName). */}
                        <div data-guide-name className={`font-quicksand font-semibold text-white ${nameClasses(ch.name, 18, 'text-sm', 'text-xs')}`}>{ch.name}</div>
                      </div>
                    </div>
                    {/* Program lane */}
                    <div className="flex-1 relative" data-howto="guide.grid">
                      {!programs && (
                        <div className="absolute inset-0 flex items-center justify-center text-brand-ice/70 font-nunito text-xs">
                          <Loader2 className="w-3 h-3 animate-spin mr-2" /> {t('guide.epgLoading')}
                        </div>
                      )}
                      {/* No listings (event channels): the channel's whole name here,
                          where the eye goes, with the event and its time in it. */}
                      {programs && visible.length === 0 && (
                        <div data-guide-nolistings className="absolute inset-0 flex flex-col justify-center px-3 overflow-hidden">
                          <div className={`font-quicksand font-semibold text-white/90 ${nameClasses(ch.name, 90, 'text-sm', 'text-[13px]')}`}>{ch.name}</div>
                          <div className="text-brand-ice/60 font-nunito text-xs leading-tight truncate">{t('guide.noListings')}</div>
                        </div>
                      )}
                      {visible.map((p, i) => {
                        const clampedStart = Math.max(p.start, windowStart);
                        const clampedEnd = Math.min(p.end, windowEnd);
                        const left = ((clampedStart - windowStart) / (windowMin * 60_000)) * 100;
                        const width = ((clampedEnd - clampedStart) / (windowMin * 60_000)) * 100;
                        const isNow = p.start <= nowTick && nowTick < p.end;
                        const startsHere = scheduledStarts.get(ch.stream_id);
                        const scheduled = !!startsHere && (() => {
                          const at = programmeTimeUtcMs(p.rs, panelOff);
                          return at != null && startsHere.some((t) => Math.abs(t - at) < 60_000);
                        })();
                        return (
                          <div
                            key={i}
                            style={{ left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)` }}
                            className={`
                              absolute top-1 bottom-1 rounded-lg px-2 flex flex-col justify-center overflow-hidden border
                              ${isNow ? 'bg-brand-gold/25 border-brand-gold/50' : 'bg-white/5 border-white/10'}
                            `}
                          >
                            <div className="text-sm font-quicksand font-semibold text-white truncate leading-tight">{p.title}</div>
                            <div className="text-xs font-nunito text-brand-ice/70 truncate leading-tight">
                              {formatSlot(p.start)}
                            </div>
                            {scheduled && (
                              <span
                                data-scheduled-dot
                                aria-label={t('guide.scheduledDot')}
                                className="absolute top-1 right-1 rounded-full bg-red-500"
                                style={{ width: 8, height: 8 }}
                              />
                            )}
                          </div>
                        );
                      })}
                      {/* NOW line */}
                      {nowInWindow && (
                        <div className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none" style={{ left: `${nowPct}%` }} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hint bar */}
      <div data-guide-hint className="flex-shrink-0 border-t border-white/10 bg-black/40 px-3 py-2 text-xs font-nunito text-brand-ice/60">
        {SCHEDULE_CAPABLE && !kidsLevel() ? t('guide.hintRecord') : t('guide.hint')}
      </div>
      {dialogs}
    </div>
  );
});

GuideSection.displayName = 'GuideSection';
export default GuideSection;
