import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
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
  type FavChannel,
  type XtreamCreds,
  type XtreamCategory,
  type XtreamLiveStream,
  type EpgNowNext,
} from '@/lib/xtream';
import ChannelRow from './ChannelRow';

const VideoPlayer = lazy(() => import('./VideoPlayer'));

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onBack: () => void;
}

type Pane = 'categories' | 'channels';
const FAV_ID = '__favorites__';
const ALL_ID = '__all__';
const ROW_HEIGHT = 84;
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

const LiveSection = memo(({ creds, isActive, onExitLeft, onBack: _onBack }: Props) => {
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

  const epgCacheRef = useRef<Map<number, EpgNowNext>>(new Map());
  const epgPendingRef = useRef<Set<number>>(new Set());
  const epgQueueRef = useRef<number[]>([]);
  const epgInFlightRef = useRef(0);
  const [, forceEpgTick] = useState(0);

  // 1) Load categories only on mount
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
  }, [creds]);

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
  const rowVirtualizer = useVirtualizer({
    count: visibleChannels.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey: (i) => visibleChannels[i]?.stream_id ?? i,
  });

  useEffect(() => {
    rowVirtualizer.scrollToOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryIdx, searchOpen, searchQuery]);

  useEffect(() => {
    if (!visibleChannels.length) return;
    rowVirtualizer.scrollToIndex(channelIdx, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIdx, visibleChannels.length]);

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

  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { categoryIdxRef.current = categoryIdx; }, [categoryIdx]);
  useEffect(() => { channelIdxRef.current = channelIdx; }, [channelIdx]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);
  useEffect(() => { visibleCategoriesRef.current = visibleCategories; }, [visibleCategories]);
  useEffect(() => { visibleChannelsRef.current = visibleChannels; }, [visibleChannels]);
  useEffect(() => { searchOpenRef.current = searchOpen; }, [searchOpen]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (fullscreenRef.current) {
        if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) {
          e.preventDefault(); e.stopPropagation();
          setFullscreen(false); setShowInfoPanel(false);
          return;
        }
        if (e.key === 'ArrowUp')    { e.preventDefault(); changeChannelInFullscreen(-1); return; }
        if (e.key === 'ArrowDown')  { e.preventDefault(); changeChannelInFullscreen(+1); return; }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); setVolume(v => Math.max(0, +(v - 0.05).toFixed(2))); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); setVolume(v => Math.min(1, +(v + 0.05).toFixed(2))); return; }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setShowInfoPanel(true);
          if (infoTimerRef.current) window.clearTimeout(infoTimerRef.current);
          infoTimerRef.current = window.setTimeout(() => setShowInfoPanel(false), 5000) as unknown as number;
        }
        return;
      }

      if (typing) return;

      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        if (paneRef.current === 'channels') setPane('categories');
        else onExitLeft();
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
        if (e.key === 'ArrowDown') setCategoryIdx(i => (i + 1) % Math.max(1, cats.length));
        else if (e.key === 'ArrowUp') setCategoryIdx(i => (i - 1 + cats.length) % Math.max(1, cats.length));
        else if (e.key === 'ArrowLeft') onExitLeft();
        else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') setPane('channels');
        return;
      }

      // pane === 'channels'
      if (e.key === 'ArrowDown') setChannelIdx(i => chans.length ? (i + 1) % chans.length : 0);
      else if (e.key === 'ArrowUp') setChannelIdx(i => chans.length ? (i - 1 + chans.length) % chans.length : 0);
      else if (e.key === 'ArrowLeft') setPane('categories');
      else if (e.key === 'Enter' || e.key === ' ') {
        const ch = chans[channelIdxRef.current];
        if (ch) playChannel(ch);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, onExitLeft, toggleFavorite, changeChannelInFullscreen, playChannel]);

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
          <VideoPlayer src={streamUrl} volume={volume} className="w-full h-full" />
        </Suspense>
        {showInfoPanel && playingStream && (
          <div className="absolute left-0 right-0 bottom-0 p-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent animate-fade-in">
            <div className="flex items-start gap-4 max-w-5xl mx-auto">
              <div className="w-20 h-20 rounded-xl bg-black/60 flex items-center justify-center overflow-hidden flex-shrink-0">
                {playingStream.stream_icon ? (
                  <img src={playingStream.stream_icon} alt="" className="w-full h-full object-contain" />
                ) : (
                  <Tv className="w-10 h-10 text-brand-ice/60" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-quicksand font-bold text-white truncate">
                  {playingStream.num ? `${playingStream.num} · ` : ''}{playingStream.name}
                </h2>
                {playingNowNext?.now && (
                  <>
                    <p className="text-brand-ice/90 font-nunito truncate">{playingNowNext.now.title}</p>
                    <div className="mt-2 h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-gold" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-xs text-brand-ice/70 font-nunito mt-1">
                      {formatTime(playingNowNext.now.start)} – {formatTime(playingNowNext.now.end)}
                    </p>
                  </>
                )}
                <p className="text-xs text-brand-ice/60 font-nunito mt-2">
                  Up / Down: change channel · Left / Right: volume ({Math.round(volume * 100)}%) · Back: exit
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div className="flex-1 min-h-0 flex">
      {/* Pane 2 — Categories */}
      <div className={`w-64 flex-shrink-0 border-r border-white/10 p-3 overflow-y-auto bg-black/40 ${pane === 'categories' && isActive ? 'bg-white/5' : ''}`}>
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
          <div className="space-y-1">
            {categoriesLoading && categories.length === 0 && (
              <div className="px-3 py-2 text-brand-ice/60 font-nunito text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> Loading categories…
              </div>
            )}
            {visibleCategories.map((c, i) => {
              const isFocused = isActive && pane === 'categories' && categoryIdx === i;
              const isSelected = categoryIdx === i;
              const isLoadingThis = loadingCat === c.id;
              return (
                <div
                  key={c.id}
                  data-focused={isFocused ? 'true' : 'false'}
                  onClick={() => { setCategoryIdx(i); setPane('channels'); }}
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
      </div>

      {/* Pane 3 — Channels + preview */}
      <div className="flex-1 min-w-0 flex flex-col bg-black/30">
        <div className="flex gap-4 p-4 border-b border-white/10 bg-black/40">
          <div className="w-64 aspect-video rounded-xl overflow-hidden bg-black border border-white/10 flex-shrink-0">
            {previewUrl ? (
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
        <div ref={scrollParentRef} className="flex-1 min-h-0 overflow-y-auto p-3">
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
                ? (searchQuery ? 'No channels match your search.' : 'Type above to search channels you have already opened.')
                : currentCat?.id === FAV_ID
                  ? 'No favorites yet. Press F on a channel to add it.'
                  : 'No channels in this category.'}
            </div>
          ) : (
            <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
              {virtualItems.map(v => {
                const s = visibleChannels[v.index];
                if (!s) return null;
                const isFocused = isActive && pane === 'channels' && v.index === channelIdx;
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
                      onSelect={(idx) => { setChannelIdx(idx); setPane('channels'); }}
                      onActivate={(idx) => { setChannelIdx(idx); playChannel(visibleChannels[idx]); }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

LiveSection.displayName = 'LiveSection';
export default LiveSection;
