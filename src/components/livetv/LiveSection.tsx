import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Loader2, Search, Star, Tv } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  loadFavoritesData,
  saveFavoritesData,
  loadVolume,
  saveVolume,
  getLiveCategories,
  getLiveStreams,
  getShortEpg,
  buildLiveStreamUrl,
  pickNowNext,
  XTREAM_REFRESH_EVENT,
  type FavChannel,
  type XtreamCreds,
  type XtreamCategory,
  type XtreamLiveStream,
  type EpgNowNext,
} from '@/lib/xtream';
import { isFireTV } from '@/utils/platform';
import ChannelRow from './ChannelRow';
import PlayerControlBar, { type BarControlId } from './PlayerControlBar';
import type { VideoController } from './VideoPlayer';

const VideoPlayer = lazy(() => import('./VideoPlayer'));
const ReportChannelDialog = lazy(() => import('./ReportChannelDialog'));


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
const ROW_HEIGHT = 84;
const CAT_ROW_HEIGHT = 48; // px — matches py-2.5 + text-sm + 4px vertical gap (space-y-1)
const EPG_MAX_CONCURRENT = 5;
const PREVIEW_DEBOUNCE_MS = 700;

const formatTime = (ms?: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const favToStream = (f: FavChannel): XtreamLiveStream => ({
  stream_id: f.stream_id,
  name: f.name,
  num: f.num,
  stream_icon: f.stream_icon,
  category_id: f.category_id,
  epg_channel_id: f.epg_channel_id,
});

const LiveSection = memo(({ creds, isActive, onExitLeft, onExitUp, onBack: _onBack }: Props) => {
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  // Per-category lazy cache. Key is category_id (or ALL_ID for the explicit
  // "All channels" bucket). Favorites are NOT in here — they render from
  // persisted FavChannel metadata.
  const [streamsByCat, setStreamsByCat] = useState<Map<string, XtreamLiveStream[]>>(new Map());
  const [loadingCat, setLoadingCat] = useState<string | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [favorites, setFavorites] = useState<Map<number, FavChannel>>(() => loadFavoritesData());
  const toggleFavorite = useCallback((ch: XtreamLiveStream | FavChannel) => {
    setFavorites(prev => {
      const n = new Map(prev);
      if (n.has(ch.stream_id)) n.delete(ch.stream_id);
      else n.set(ch.stream_id, {
        stream_id: ch.stream_id,
        name: ch.name,
        num: (ch as XtreamLiveStream).num,
        stream_icon: ch.stream_icon,
        category_id: ch.category_id,
        epg_channel_id: (ch as XtreamLiveStream).epg_channel_id,
      });
      saveFavoritesData(n);
      return n;
    });
  }, []);

  const [volume, setVolume] = useState<number>(() => loadVolume());
  useEffect(() => { saveVolume(volume); }, [volume]);

  const [pane, setPane] = useState<Pane>('categories');
  // Start on Favorites (0). A separate effect bumps to the first REAL category
  // (index 2) once categories arrive, but only if the user hasn't moved yet.
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [channelIdx, setChannelIdx] = useState(0);



  // Tracks whether the user has explicitly moved category focus.
  const userMovedRef = useRef(false);
  // "All channels" loads ~12K rows — never auto-load. Only fetch when the
  // user explicitly opens that bucket (Enter / click).
  const allOptedInRef = useRef(false);

  const [playingChannelId, setPlayingChannelId] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const infoTimerRef = useRef<number | null>(null);

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
  const [subMenuFocus, setSubMenuFocus] = useState(-1); // -1 = Off
  const [audioMenuFocus, setAudioMenuFocus] = useState(0);
  const [tracksTick, setTracksTick] = useState(0);
  const barHideTimerRef = useRef<number | null>(null);
  const pokeBar = useCallback(() => {
    setBarVisible(true);
    if (barHideTimerRef.current) window.clearTimeout(barHideTimerRef.current);
    barHideTimerRef.current = window.setTimeout(() => {
      setBarVisible(false);
      setSubMenuOpen(false);
      setAudioMenuOpen(false);
    }, 5000) as unknown as number;
  }, []);
  const hideBarNow = useCallback(() => {
    if (barHideTimerRef.current) { window.clearTimeout(barHideTimerRef.current); barHideTimerRef.current = null; }
    setBarVisible(false);
    setSubMenuOpen(false);
    setAudioMenuOpen(false);
  }, []);
  // Reset bar state when entering fullscreen or switching channel.
  useEffect(() => {
    if (!fullscreen) return;
    setBarFocus('play');
    setSubMenuOpen(false);
    setAudioMenuOpen(false);
    pokeBar();
    return () => {
      if (barHideTimerRef.current) { window.clearTimeout(barHideTimerRef.current); barHideTimerRef.current = null; }
    };
  }, [fullscreen, playingChannelId, pokeBar]);

  const epgCacheRef = useRef<Map<number, EpgNowNext>>(new Map());
  const epgPendingRef = useRef<Set<number>>(new Set());
  const epgQueueRef = useRef<number[]>([]);
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
      setAllChannels(null);
      allOptedInRef.current = false;
      setRefreshTick(t => t + 1);
    };
    window.addEventListener(XTREAM_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(XTREAM_REFRESH_EVENT, onRefresh);
  }, []);

  // 1) Load categories on mount + on every refresh tick.
  useEffect(() => {
    let cancelled = false;
    setCategoriesLoading(true);
    (async () => {
      try {
        const cats = await getLiveCategories(creds).catch(() => [] as XtreamCategory[]);
        if (cancelled) return;
        setCategories(cats);
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [creds, refreshTick]);

  // Build visible category list (Favorites, All channels, then server cats).
  const visibleCategories = useMemo(() => {
    const base: { id: string; name: string; count?: number; isFav?: boolean; isAll?: boolean }[] = [
      { id: FAV_ID, name: 'Favorites', count: favorites.size, isFav: true },
      { id: ALL_ID, name: 'All channels', isAll: true },
    ];
    for (const c of categories) {
      const key = String(c.category_id);
      const cached = streamsByCat.get(key);
      base.push({ id: key, name: c.category_name, count: cached ? cached.length : undefined });
    }
    return base;
  }, [categories, streamsByCat, favorites.size]);

  // Clamp focus when category list shrinks (never clamp UP to "All channels").
  // Once real categories have arrived, bump focus to the first real category
  // (index 2) iff the user hasn't moved focus yet.
  useEffect(() => {
    if (visibleCategories.length === 0) return;
    if (categoryIdx >= visibleCategories.length) {
      setCategoryIdx(visibleCategories.length - 1);
      return;
    }
    if (
      categories.length > 0 &&
      !userMovedRef.current &&
      categoryIdx < 2 &&
      visibleCategories.length > 2
    ) {
      setCategoryIdx(2);
    }
  }, [visibleCategories.length, categoryIdx, categories.length]);

  const currentCat = visibleCategories[categoryIdx];

  // 2) Lazy-load the focused category's channels.
  //    - Skip Favorites (rendered from metadata cache).
  //    - "All channels" is STRICTLY opt-in: never auto-fetch on focus.
  useEffect(() => {
    if (!currentCat) return;
    if (currentCat.id === FAV_ID) return;
    if (currentCat.id === ALL_ID && !allOptedInRef.current) return;
    if (streamsByCat.has(currentCat.id)) return;
    let cancelled = false;
    const key = currentCat.id;
    setLoadingCat(key);
    const fetchPromise = key === ALL_ID
      ? getLiveStreams(creds)
      : getLiveStreams(creds, key);
    fetchPromise
      .then((list) => {
        if (cancelled) return;
        setStreamsByCat(prev => {
          const n = new Map(prev);
          n.set(key, list);
          return n;
        });
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
    return () => { cancelled = true; };
  }, [currentCat, creds, streamsByCat]);

  // Full-catalog channel list, fetched lazily ONLY when search is opened.
  // Used to power search across every channel without bloating per-category caches.
  const [allChannels, setAllChannels] = useState<XtreamLiveStream[] | null>(null);
  const [allChannelsLoading, setAllChannelsLoading] = useState(false);
  useEffect(() => {
    if (!searchOpen) return;
    if (allChannels || allChannelsLoading) return;
    setAllChannelsLoading(true);
    let cancelled = false;
    getLiveStreams(creds)
      .then(list => { if (!cancelled) setAllChannels(list); })
      .catch(() => { if (!cancelled) setAllChannels([]); })
      .finally(() => { if (!cancelled) setAllChannelsLoading(false); });
    return () => { cancelled = true; };
  }, [searchOpen, allChannels, allChannelsLoading, creds]);

  // Resolve channel list for the focused category / favorites / search.
  const visibleChannels: XtreamLiveStream[] = useMemo(() => {
    if (searchOpen) {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return [];
      const src = allChannels || [];
      const out: XtreamLiveStream[] = [];
      for (const s of src) {
        if (out.length >= 500) break;
        if (s.name.toLowerCase().includes(q)) out.push(s);
      }
      return out;
    }
    if (!currentCat) return [];
    if (currentCat.id === FAV_ID) return [...favorites.values()].map(favToStream);
    return streamsByCat.get(currentCat.id) || [];
  }, [searchOpen, searchQuery, allChannels, currentCat, streamsByCat, favorites]);

  const channelsLoading = searchOpen
    ? allChannelsLoading
    : !!(currentCat && currentCat.id !== FAV_ID
        && (currentCat.id !== ALL_ID || allOptedInRef.current)
        && (loadingCat === currentCat.id || !streamsByCat.has(currentCat.id)));

  // Reset channel focus whenever the visible list changes context.
  useEffect(() => { setChannelIdx(0); }, [categoryIdx, searchOpen, searchQuery]);
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
  const rowVirtualizer = useVirtualizer({
    count: visibleChannels.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: isFireTV() ? 2 : 8,
    getItemKey: (i) => visibleChannels[i]?.stream_id ?? i,
  });

  // Virtualize the category pane too — Vibez can expose 100+ categories and
  // rendering them all caused layout thrash that interfered with D-pad
  // focus scrolling on TV/STB devices.
  const categoryVirtualizer = useVirtualizer({
    count: visibleCategories.length,
    getScrollElement: () => categoriesScrollRef.current,
    estimateSize: () => CAT_ROW_HEIGHT,
    overscan: isFireTV() ? 4 : 10,
    getItemKey: (i) => visibleCategories[i]?.id ?? i,
  });

  useEffect(() => {
    rowVirtualizer.scrollToOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryIdx, searchOpen, searchQuery]);

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
  const ensureVisibleY = (parent: HTMLElement | null, el: HTMLElement | null) => {
    if (!parent || !el) return;
    const pr = parent.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top < pr.top) parent.scrollTop -= (pr.top - er.top);
    else if (er.bottom > pr.bottom) parent.scrollTop += (er.bottom - pr.bottom);
  };

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
      const rowTop = channelIdx * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      if (rowTop < node.scrollTop) node.scrollTop = rowTop;
      else if (rowBottom > node.scrollTop + node.clientHeight) node.scrollTop = rowBottom - node.clientHeight;
    };
    
    apply();
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIdx, visibleChannels.length]);

  // Keep the focused category visible in the VIRTUALIZED category pane.
  useEffect(() => {
    if (!visibleCategories.length || searchOpen) return;
    const apply = () => {
      const node = categoriesScrollRef.current;
      if (!node) return;
      if (categoryIdx === 0) { node.scrollTop = 0; return; }
      const rowTop = categoryIdx * CAT_ROW_HEIGHT;
      const rowBottom = rowTop + CAT_ROW_HEIGHT;
      if (rowTop < node.scrollTop) node.scrollTop = rowTop;
      else if (rowBottom > node.scrollTop + node.clientHeight) node.scrollTop = rowBottom - node.clientHeight;
    };
    
    apply();
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryIdx, visibleCategories.length, searchOpen]);

  // EPG lazy fetch with concurrency cap
  const enqueueEpg = useCallback((id: number) => {
    if (epgCacheRef.current.has(id) || epgPendingRef.current.has(id)) return;
    epgPendingRef.current.add(id);
    epgQueueRef.current.push(id);
    pumpEpg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds]);

  const pumpEpg = useCallback(() => {
    while (epgInFlightRef.current < EPG_MAX_CONCURRENT && epgQueueRef.current.length) {
      const id = epgQueueRef.current.shift()!;
      epgInFlightRef.current++;
      getShortEpg(creds, id, 4)
        .then(res => { epgCacheRef.current.set(id, pickNowNext(res.epg_listings || [])); })
        .catch(() => { epgCacheRef.current.set(id, {}); })
        .finally(() => {
          epgInFlightRef.current--;
          epgPendingRef.current.delete(id);
          forceEpgTick(t => t + 1);
          if (epgQueueRef.current.length) pumpEpg();
        });
    }
  }, [creds]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    for (const v of virtualItems) {
      const s = visibleChannels[v.index];
      if (s) enqueueEpg(s.stream_id);
    }
    if (focusedChannel) enqueueEpg(focusedChannel.stream_id);
  }, [virtualItems, visibleChannels, focusedChannel, enqueueEpg]);

  const focusedNowNext = focusedChannel ? epgCacheRef.current.get(focusedChannel.stream_id) : undefined;

  // Debounced preview
  const [previewChannelId, setPreviewChannelId] = useState<number | null>(null);
  useEffect(() => {
    if (!focusedChannel) { setPreviewChannelId(null); return; }
    const id = focusedChannel.stream_id;
    const t = window.setTimeout(() => setPreviewChannelId(id), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [focusedChannel]);

  const previewUrl = useMemo(
    () => (previewChannelId ? buildLiveStreamUrl(creds, previewChannelId) : null),
    [previewChannelId, creds],
  );

  const streamUrl = useMemo(() => {
    if (!playingChannelId) return null;
    return buildLiveStreamUrl(creds, playingChannelId);
  }, [playingChannelId, creds]);

  const playChannel = useCallback((stream: XtreamLiveStream) => {
    setPlayingChannelId(stream.stream_id);
    setFullscreen(true);
    setShowInfoPanel(true);
    if (infoTimerRef.current) window.clearTimeout(infoTimerRef.current);
    infoTimerRef.current = window.setTimeout(() => setShowInfoPanel(false), 5000) as unknown as number;
  }, []);

  const changeChannelInFullscreen = useCallback((delta: 1 | -1) => {
    if (!visibleChannels.length) return;
    let i = visibleChannels.findIndex(s => s.stream_id === playingChannelId);
    if (i < 0) i = channelIdx;
    const next = (i + delta + visibleChannels.length) % visibleChannels.length;
    setChannelIdx(next);
    playChannel(visibleChannels[next]);
  }, [visibleChannels, playingChannelId, channelIdx, playChannel]);

  // Refs for keyboard handler
  const paneRef = useRef(pane);
  const categoryIdxRef = useRef(categoryIdx);
  const channelIdxRef = useRef(channelIdx);
  const fullscreenRef = useRef(fullscreen);
  const visibleCategoriesRef = useRef(visibleCategories);
  const visibleChannelsRef = useRef(visibleChannels);
  const searchOpenRef = useRef(searchOpen);
  // Bar refs so the (stable) keydown listener can read live state without rebinding.
  const barVisibleRef = useRef(barVisible);
  const barFocusRef = useRef(barFocus);
  const subMenuOpenRef = useRef(subMenuOpen);
  const audioMenuOpenRef = useRef(audioMenuOpen);
  const subMenuFocusRef = useRef(subMenuFocus);
  const audioMenuFocusRef = useRef(audioMenuFocus);

  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { categoryIdxRef.current = categoryIdx; }, [categoryIdx]);
  useEffect(() => { channelIdxRef.current = channelIdx; }, [channelIdx]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);
  useEffect(() => { visibleCategoriesRef.current = visibleCategories; }, [visibleCategories]);
  useEffect(() => { visibleChannelsRef.current = visibleChannels; }, [visibleChannels]);
  useEffect(() => { searchOpenRef.current = searchOpen; }, [searchOpen]);
  useEffect(() => { barVisibleRef.current = barVisible; }, [barVisible]);
  useEffect(() => { barFocusRef.current = barFocus; }, [barFocus]);
  useEffect(() => { subMenuOpenRef.current = subMenuOpen; }, [subMenuOpen]);
  useEffect(() => { audioMenuOpenRef.current = audioMenuOpen; }, [audioMenuOpen]);
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

        // --- Sub/Audio menus take priority ---
        if (subMenuOpenRef.current || audioMenuOpenRef.current) {
          e.preventDefault(); e.stopPropagation();
          pokeBar();
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
          e.preventDefault(); e.stopPropagation();
          if (barVisibleRef.current) { hideBarNow(); return; }
          setFullscreen(false); setShowInfoPanel(false);
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
        const order: BarControlId[] = ['prev', 'rew', 'play', 'fwd', 'next', 'cc', 'audio'];
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
        if (e.key === 'ArrowUp')    { hideBarNow(); return; }
        if (e.key === 'ArrowDown')  { /* bar already shown; keep focus */ return; }
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
          }
          else if (id === 'audio') {
            const cur = auds.findIndex(a => a.active);
            setAudioMenuFocus(cur >= 0 ? cur : 0);
            setAudioMenuOpen(true);
            setSubMenuOpen(false);
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
      e.preventDefault();

      const cats = visibleCategoriesRef.current;
      const chans = visibleChannelsRef.current;

      if (paneRef.current === 'categories') {
        if (e.key === 'ArrowDown') {
          userMovedRef.current = true;
          setCategoryIdx(i => (i + 1) % Math.max(1, cats.length));
        }
        else if (e.key === 'ArrowUp') {
          if (categoryIdxRef.current === 0 && onExitUp) { onExitUp(); return; }
          userMovedRef.current = true;
          setCategoryIdx(i => (i - 1 + cats.length) % Math.max(1, cats.length));
        }
        else if (e.key === 'ArrowLeft') {
          onExitLeft();
        }
        else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
          userMovedRef.current = true;
          if (cats[categoryIdxRef.current]?.id === ALL_ID) allOptedInRef.current = true;
          setPane('channels');
        }
        return;
      }

      // pane === 'channels'
      if (e.key === 'ArrowDown') setChannelIdx(i => chans.length ? (i + 1) % chans.length : 0);
      else if (e.key === 'ArrowUp') {
        if (channelIdxRef.current === 0 && onExitUp) { onExitUp(); return; }
        setChannelIdx(i => chans.length ? (i - 1 + chans.length) % chans.length : 0);
      }
      else if (e.key === 'ArrowLeft') {
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
        if (ch) playChannel(ch);
      }
      // If long-press already fired, just consume the keyup.
      enterFiredRef.current = false;
    };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('keyup', keyupHandler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keyup', keyupHandler, true);
      cancelEnterTimer();
    };
  }, [isActive, onExitLeft, onExitUp, toggleFavorite, changeChannelInFullscreen, playChannel, pokeBar, hideBarNow, cancelEnterTimer]);

  useEffect(() => {
    if (!isActive) return;
    let handle: { remove?: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const h = await CapApp.addListener('backButton', () => {
          (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
          if (subMenuOpenRef.current || audioMenuOpenRef.current) { setSubMenuOpen(false); setAudioMenuOpen(false); return; }
          if (fullscreenRef.current) {
            if (barVisibleRef.current) hideBarNow();
            else { setFullscreen(false); setShowInfoPanel(false); }
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
  const playingStream = playingChannelId
    ? (visibleChannels.find(s => s.stream_id === playingChannelId)
       || (favorites.has(playingChannelId) ? favToStream(favorites.get(playingChannelId)!) : focusedChannel))
    : focusedChannel;
  const playingNowNext = playingStream ? epgCacheRef.current.get(playingStream.stream_id) : undefined;
  const progress = (() => {
    if (!playingNowNext?.now) return 0;
    const { start, end } = playingNowNext.now;
    return Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100));
  })();

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[60] bg-black text-white">
        <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-brand-gold" /></div>}>
          <VideoPlayer
            src={streamUrl}
            volume={volume}
            className="w-full h-full"
            onReady={(c) => { videoControllerRef.current = c; setIsPaused(c.isPaused()); }}
            onPlayStateChange={(paused) => setIsPaused(paused)}
            onTracksChanged={() => setTracksTick(t => t + 1)}
          />
        </Suspense>
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
        />
        {/* Volume hint while bar is hidden */}
        {!barVisible && (
          <div className="absolute bottom-4 right-6 px-3 py-1.5 rounded-full bg-black/60 text-brand-ice/80 font-nunito text-xs pointer-events-none">
            Vol {Math.round(volume * 100)}%
          </div>
        )}
      </div>
    );
  }

  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden">
      {/* Pane 2 — Categories */}
      <div ref={categoriesScrollRef} className={`w-64 max-w-[16rem] flex-shrink-0 border-r border-white/10 p-3 overflow-y-auto overflow-x-hidden bg-black/40 ${pane === 'categories' && isActive ? 'bg-white/5' : ''}`}>
        <button
          onClick={() => setSearchOpen(o => !o)}
          className="tv-focusable w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-black/40 border border-white/10 text-brand-ice font-nunito text-sm"
        >
          <Search className="w-4 h-4" />
          {searchOpen ? 'Close search' : 'Search channels'}
        </button>
        {searchOpen && (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type to search…"
            className="tv-focusable w-full mb-3 rounded-xl bg-black/40 text-white border border-white/20 px-3 py-2 font-nunito text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
        )}
        {!searchOpen && (
          <>
            {categoriesLoading && categories.length === 0 && (
              <div className="px-3 py-2 text-brand-ice/60 font-nunito text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> Loading categories…
              </div>
            )}
            {visibleCategories.length > 0 && (
              <div
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
                  const isFocused = isActive && pane === 'categories' && categoryIdx === i;
                  const isSelected = categoryIdx === i;
                  const isLoadingThis = loadingCat === c.id;
                  return (
                    <div
                      key={c.id}
                      data-cat-idx={i}
                      data-focused={isFocused ? 'true' : 'false'}
                      onClick={() => {
                        userMovedRef.current = true;
                        if (c.isAll) allOptedInRef.current = true;
                        setCategoryIdx(i);
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
                        flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-transform duration-150
                        ${isFocused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-[1.03] shadow-[0_0_14px_rgba(245,200,80,0.35)]' : ''}
                        ${!isFocused && isSelected ? 'bg-white/10 border border-brand-gold/30' : 'border border-transparent'}
                        ${!isFocused && !isSelected ? 'hover:bg-white/5' : ''}
                      `}
                    >
                      {c.isFav && <Star className="w-4 h-4 text-brand-gold flex-shrink-0" />}
                      <span className={`font-nunito truncate flex-1 ${isFocused ? 'text-white font-semibold' : 'text-brand-ice'}`}>{c.name}</span>
                      {isLoadingThis && <Loader2 className="w-3 h-3 animate-spin text-brand-gold flex-shrink-0" />}
                      {!isLoadingThis && c.count != null && c.count > 0 && (
                        <span className={`text-[10px] font-nunito tabular-nums px-1.5 py-0.5 rounded-md ${isFocused ? 'bg-brand-navy/40 text-brand-gold' : 'bg-white/10 text-brand-ice/60'}`}>
                          {c.count}
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

      {/* Pane 3 — Channels + preview */}
      <div className="flex-1 min-w-0 flex flex-col bg-black/30 overflow-x-hidden">
        <div className="flex gap-4 p-4 border-b border-white/10 bg-black/40">
          <div className="w-64 aspect-video rounded-xl overflow-hidden bg-black border border-white/10 flex-shrink-0">
            {isFireTV() ? (
              // Fire TV: NEVER mount the always-on preview <video>. Each
              // <video> spawns a WebMediaPlayer (and a hardware decoder slot)
              // on Amazon WebView — that 2nd pipeline alongside the
              // fullscreen player is the direct cause of black-screen /
              // freeze. Only the fullscreen player gets a <video> here.
              <div className="w-full h-full flex items-center justify-center text-brand-ice/60 font-nunito text-sm text-center px-4">
                {focusedChannel ? 'Press OK to play' : 'No channel selected'}
              </div>
            ) : previewUrl ? (
              <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-gold" /></div>}>
                <VideoPlayer src={previewUrl} volume={0} className="w-full h-full" />
              </Suspense>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-brand-ice/60 font-nunito text-sm text-center px-4">
                {focusedChannel ? 'Preview loading…' : 'No channel selected'}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {focusedChannel ? (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-quicksand font-bold text-white truncate">{focusedChannel.name}</h3>
                  {favorites.has(focusedChannel.stream_id) && <Star className="w-5 h-5 text-brand-gold fill-brand-gold" />}
                  {channelsLoading && <Loader2 className="w-4 h-4 animate-spin text-brand-gold ml-auto" />}
                </div>
                {focusedNowNext?.now ? (
                  <>
                    <p className="text-brand-ice/90 font-nunito truncate mt-1">Now: {focusedNowNext.now.title}</p>
                    <p className="text-xs text-brand-ice/60 font-nunito mt-0.5">
                      {formatTime(focusedNowNext.now.start)} – {formatTime(focusedNowNext.now.end)}
                    </p>
                  </>
                ) : (
                  <p className="text-brand-ice/60 font-nunito mt-1 text-sm">No program info available</p>
                )}
                {focusedNowNext?.next && (
                  <p className="text-sm text-brand-ice/70 font-nunito mt-2 truncate">
                    Next: {focusedNowNext.next.title} · {formatTime(focusedNowNext.next.start)}
                  </p>
                )}
                <p className="text-xs text-brand-ice/50 font-nunito mt-3">Press Enter to play · F to favorite</p>
              </>
            ) : (
              <p className="text-brand-ice/60 font-nunito">
                {channelsLoading ? 'Loading channels…' : 'No channel focused'}
              </p>
            )}
          </div>
        </div>

        {/* Virtualized channel list */}
        <div ref={scrollParentRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3">
          {channelsLoading && visibleChannels.length === 0 ? (
            <div className="space-y-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={`sk-${i}`} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-white/5 animate-pulse">
                  <div className="w-8 h-4 rounded bg-white/10" />
                  <div className="w-14 h-14 rounded-lg bg-white/10" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/2 rounded bg-white/10" />
                    <div className="h-3 w-2/3 rounded bg-white/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : visibleChannels.length === 0 ? (
            <div className="h-full flex items-center justify-center text-brand-ice/60 font-nunito text-center px-6">
              {searchOpen
                ? (searchQuery
                    ? (allChannelsLoading ? 'Loading channel catalog…' : 'No channels match your search.')
                    : (allChannelsLoading ? 'Loading channel catalog…' : 'Type above to search all channels.'))
                : currentCat?.id === FAV_ID
                  ? 'No favorites yet. Press F on a channel to add it.'
                  : 'No channels in this category.'}
            </div>
          ) : (
            <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
              {virtualItems.map(v => {
                const s = visibleChannels[v.index];
                if (!s) return null;
                const isFocused = isActive && pane === 'channels' && v.index === safeChannelIdx;
                return (
                  <div
                    key={v.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: ROW_HEIGHT,
                      transform: `translateY(${v.start}px)`,
                      padding: '2px 0',
                    }}
                  >
                    <ChannelRow
                      channel={s}
                      index={v.index}
                      isFocused={isFocused}
                      isPlaying={playingChannelId === s.stream_id}
                      isFavorite={favorites.has(s.stream_id)}
                      nowNext={epgCacheRef.current.get(s.stream_id)}
                      onSelect={(idx) => { setChannelIdx(idx); }}
                      onActivate={(idx) => { setPane('channels'); setChannelIdx(idx); playChannel(visibleChannels[idx]); }}
                      onLongPress={(idx) => { setChannelIdx(idx); setReportFor(visibleChannels[idx]); }}
                    />

                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {reportFor && (
        <Suspense fallback={null}>
          <ReportChannelDialog
            channelName={reportFor.name}
            channelId={reportFor.stream_id}
            onClose={() => { setReportFor(null); enterFiredRef.current = false; }}
          />
        </Suspense>
      )}
    </div>
  );

});

LiveSection.displayName = 'LiveSection';
export default LiveSection;
