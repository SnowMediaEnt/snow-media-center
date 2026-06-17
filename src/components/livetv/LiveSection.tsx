import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Loader2, Search, Star, Tv } from 'lucide-react';
import {
  loadFavorites,
  saveFavorites,
  loadLastChannelId,
  saveLastChannelId,
  loadVolume,
  saveVolume,
  getLiveCategories,
  getLiveStreams,
  getShortEpg,
  buildLiveStreamUrl,
  pickNowNext,
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

const formatTime = (ms?: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const LiveSection = memo(({ creds, isActive, onExitLeft, onBack }: Props) => {
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [streams, setStreams] = useState<XtreamLiveStream[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [favorites, setFavorites] = useState<Set<number>>(() => loadFavorites());
  const toggleFavorite = useCallback((id: number) => {
    setFavorites(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      saveFavorites(n);
      return n;
    });
  }, []);

  const [volume, setVolume] = useState<number>(() => loadVolume());
  useEffect(() => { saveVolume(volume); }, [volume]);

  const [pane, setPane] = useState<Pane>('categories');
  const [categoryIdx, setCategoryIdx] = useState(1);
  const [channelIdx, setChannelIdx] = useState(0);

  const [playingChannelId, setPlayingChannelId] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const infoTimerRef = useRef<number | null>(null);

  const epgCacheRef = useRef<Map<number, EpgNowNext>>(new Map());
  const [, forceEpgTick] = useState(0);

  // Load server data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [cats, lives] = await Promise.all([
          getLiveCategories(creds).catch(() => [] as XtreamCategory[]),
          getLiveStreams(creds).catch(() => [] as XtreamLiveStream[]),
        ]);
        if (cancelled) return;
        setCategories(cats);
        setStreams(lives);
        const lastId = loadLastChannelId();
        if (lastId && lives.some(s => s.stream_id === lastId)) setPlayingChannelId(lastId);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [creds]);

  const visibleCategories = useMemo(() => {
    const base: { id: string | number; name: string; count?: number }[] = [
      { id: FAV_ID, name: 'Favorites' },
      { id: ALL_ID, name: 'All channels', count: streams.length },
    ];
    const counts = new Map<string | number, number>();
    for (const s of streams) counts.set(s.category_id, (counts.get(s.category_id) || 0) + 1);
    for (const c of categories) base.push({ id: c.category_id, name: c.category_name, count: counts.get(c.category_id) || 0 });
    if (base[0].id === FAV_ID) base[0].count = streams.filter(s => favorites.has(s.stream_id)).length;
    return base;
  }, [categories, streams, favorites]);

  const visibleChannels = useMemo(() => {
    if (searchOpen) {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return [];
      return streams.filter(s => s.name.toLowerCase().includes(q)).slice(0, 500);
    }
    const cat = visibleCategories[categoryIdx];
    if (!cat) return [];
    if (cat.id === FAV_ID) return streams.filter(s => favorites.has(s.stream_id));
    if (cat.id === ALL_ID) return streams;
    return streams.filter(s => s.category_id === cat.id);
  }, [searchOpen, searchQuery, visibleCategories, categoryIdx, streams, favorites]);

  useEffect(() => {
    if (channelIdx >= visibleChannels.length) setChannelIdx(0);
  }, [visibleChannels.length, channelIdx]);

  const focusedChannel = visibleChannels[channelIdx];

  useEffect(() => {
    if (!focusedChannel) return;
    const id = focusedChannel.stream_id;
    if (epgCacheRef.current.has(id)) return;
    if (usingMock || !creds) {
      epgCacheRef.current.set(id, mockEpgFor(focusedChannel));
      forceEpgTick(t => t + 1);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await getShortEpg(creds, id, 4);
        if (cancelled) return;
        epgCacheRef.current.set(id, pickNowNext(res.epg_listings || []));
        forceEpgTick(t => t + 1);
      } catch {
        epgCacheRef.current.set(id, {});
        forceEpgTick(t => t + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [focusedChannel, creds, usingMock]);

  const focusedNowNext = focusedChannel ? epgCacheRef.current.get(focusedChannel.stream_id) : undefined;

  const streamUrl = useMemo(() => {
    if (!playingChannelId || usingMock || !creds) return null;
    return buildLiveStreamUrl(creds, playingChannelId);
  }, [playingChannelId, usingMock, creds]);

  const playChannel = useCallback((stream: XtreamLiveStream) => {
    setPlayingChannelId(stream.stream_id);
    saveLastChannelId(stream.stream_id);
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
        if (focusedChannel) { e.preventDefault(); toggleFavorite(focusedChannel.stream_id); }
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
  }, [isActive, onExitLeft, focusedChannel, toggleFavorite, changeChannelInFullscreen, playChannel]);

  const focusedRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { focusedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [channelIdx, categoryIdx, pane]);

  // Fullscreen player
  const playingStream = streams.find(s => s.stream_id === playingChannelId) || focusedChannel;
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

  return (
    <div className="flex-1 min-h-0 flex">
      {/* Pane 2 — Categories */}
      <div className={`w-64 flex-shrink-0 border-r border-white/10 p-3 overflow-y-auto ${pane === 'categories' && isActive ? 'bg-white/5' : ''}`}>
        <button
          onClick={() => setSearchOpen(o => !o)}
          className="tv-focusable w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-black/30 border border-white/10 text-brand-ice font-nunito text-sm"
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
            className="tv-focusable w-full mb-3 rounded-xl bg-black/30 text-white border border-white/20 px-3 py-2 font-nunito text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
        )}
        {!searchOpen && (
          <div className="space-y-1">
            {visibleCategories.map((c, i) => {
              const isFocused = isActive && pane === 'categories' && categoryIdx === i;
              const isSelected = categoryIdx === i;
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
                  {c.id === FAV_ID && <Star className="w-4 h-4 text-brand-gold flex-shrink-0" />}
                  <span className={`font-nunito truncate flex-1 ${isFocused ? 'text-white font-semibold' : 'text-brand-ice'}`}>{c.name}</span>
                  {c.count != null && c.count > 0 && (
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
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex gap-4 p-4 border-b border-white/10 bg-black/20">
          <div className="w-64 aspect-video rounded-xl overflow-hidden bg-black border border-white/10 flex-shrink-0">
            {focusedChannel && !usingMock && creds ? (
              <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-gold" /></div>}>
                <VideoPlayer src={buildLiveStreamUrl(creds, focusedChannel.stream_id)} volume={0} className="w-full h-full" />
              </Suspense>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-brand-ice/60 font-nunito text-sm text-center px-4">
                {usingMock ? 'Preview available after sign in' : 'No channel selected'}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {focusedChannel ? (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-quicksand font-bold text-white truncate">{focusedChannel.name}</h3>
                  {favorites.has(focusedChannel.stream_id) && <Star className="w-5 h-5 text-brand-gold fill-brand-gold" />}
                  {loading && <Loader2 className="w-4 h-4 animate-spin text-brand-gold ml-auto" />}
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
              <p className="text-brand-ice/60 font-nunito">No channel focused</p>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
          {loading && visibleChannels.length === 0 ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={`sk-${i}`} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-white/5 animate-pulse">
                <div className="w-8 h-4 rounded bg-white/10" />
                <div className="w-14 h-14 rounded-lg bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 rounded bg-white/10" />
                  <div className="h-3 w-2/3 rounded bg-white/5" />
                </div>
              </div>
            ))
          ) : visibleChannels.length === 0 ? (
            <div className="h-full flex items-center justify-center text-brand-ice/60 font-nunito">
              {searchOpen ? (searchQuery ? 'No channels match your search.' : 'Type above to search channels.') : 'No channels in this category.'}
            </div>
          ) : (
            visibleChannels.map((s, i) => {
              const isFocused = isActive && pane === 'channels' && i === channelIdx;
              return (
                <div key={s.stream_id} ref={isFocused ? focusedRowRef : null}>
                  <ChannelRow
                    channel={s}
                    index={i}
                    isFocused={isFocused}
                    isPlaying={playingChannelId === s.stream_id}
                    isFavorite={favorites.has(s.stream_id)}
                    nowNext={epgCacheRef.current.get(s.stream_id)}
                    onSelect={(idx) => { setChannelIdx(idx); setPane('channels'); }}
                    onActivate={(idx) => { setChannelIdx(idx); playChannel(visibleChannels[idx]); }}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});

LiveSection.displayName = 'LiveSection';
export default LiveSection;
