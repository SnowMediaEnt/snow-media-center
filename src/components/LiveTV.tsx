import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Tv, Search, Star, Loader2, Settings as SettingsIcon, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  loadCreds,
  clearCreds,
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
import { MOCK_CATEGORIES, MOCK_STREAMS, mockEpgFor } from '@/lib/mockLiveTV';
import ChannelRow from './livetv/ChannelRow';

const VideoPlayer = lazy(() => import('./livetv/VideoPlayer'));
const CredentialsForm = lazy(() => import('./livetv/CredentialsForm'));

interface Props {
  onBack: () => void;
}

type Pane = 'sections' | 'categories' | 'channels';
type Section = 'live' | 'search';

const FAV_ID = '__favorites__';
const ALL_ID = '__all__';

const formatTime = (ms?: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const LiveTV = memo(({ onBack }: Props) => {
  const { toast } = useToast();

  // --- credentials / data state -------------------------------------------
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [showCredsForm, setShowCredsForm] = useState(false);
  const [usingMock, setUsingMock] = useState(true);
  const [loading, setLoading] = useState(false);

  const [categories, setCategories] = useState<XtreamCategory[]>(MOCK_CATEGORIES);
  const [streams, setStreams] = useState<XtreamLiveStream[]>(MOCK_STREAMS);

  // --- favorites ----------------------------------------------------------
  const [favorites, setFavorites] = useState<Set<number>>(() => loadFavorites());
  const toggleFavorite = useCallback((id: number) => {
    setFavorites(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      saveFavorites(n);
      return n;
    });
  }, []);

  // --- volume / persistence ----------------------------------------------
  const [volume, setVolume] = useState<number>(() => loadVolume());
  useEffect(() => { saveVolume(volume); }, [volume]);

  // --- search ------------------------------------------------------------
  const [section, setSection] = useState<Section>('live');
  const [searchQuery, setSearchQuery] = useState('');

  // --- focus / selection -------------------------------------------------
  const [pane, setPane] = useState<Pane>('categories');
  const [sectionIdx, setSectionIdx] = useState(0);
  const [categoryIdx, setCategoryIdx] = useState(1); // default to "All channels"
  const [channelIdx, setChannelIdx] = useState(0);

  // --- playback ----------------------------------------------------------
  const [playingChannelId, setPlayingChannelId] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const infoTimerRef = useRef<number | null>(null);

  // --- EPG cache (now/next per stream id) --------------------------------
  const epgCacheRef = useRef<Map<number, EpgNowNext>>(new Map());
  const [, forceEpgTick] = useState(0);

  // --- load creds on mount ----------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await loadCreds();
      if (cancelled) return;
      setCreds(c);
      setCredsLoaded(true);
      if (c) {
        setUsingMock(false);
        void loadServerData(c);
      } else {
        setUsingMock(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadServerData = useCallback(async (c: XtreamCreds) => {
    setLoading(true);
    try {
      const [cats, lives] = await Promise.all([
        getLiveCategories(c).catch(() => [] as XtreamCategory[]),
        getLiveStreams(c).catch(() => [] as XtreamLiveStream[]),
      ]);
      setCategories(cats);
      setStreams(lives);
      // Restore last channel if it exists
      const lastId = loadLastChannelId();
      if (lastId && lives.some(s => s.stream_id === lastId)) {
        setPlayingChannelId(lastId);
      }
    } catch (e) {
      toast({
        title: 'Failed to load channels',
        description: (e as Error).message || 'Showing demo content.',
        variant: 'destructive',
      });
      setCategories(MOCK_CATEGORIES);
      setStreams(MOCK_STREAMS);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // --- visible categories (Favorites + All + server cats) ---------------
  const visibleCategories = useMemo(() => {
    const base: { id: string; name: string }[] = [
      { id: FAV_ID, name: 'Favorites' },
      { id: ALL_ID, name: 'All channels' },
    ];
    for (const c of categories) base.push({ id: c.category_id, name: c.category_name });
    return base;
  }, [categories]);

  // --- channels in the currently focused category ------------------------
  const visibleChannels = useMemo(() => {
    if (section === 'search') {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return [];
      return streams.filter(s => s.name.toLowerCase().includes(q)).slice(0, 500);
    }
    const cat = visibleCategories[categoryIdx];
    if (!cat) return [];
    if (cat.id === FAV_ID) return streams.filter(s => favorites.has(s.stream_id));
    if (cat.id === ALL_ID) return streams;
    return streams.filter(s => s.category_id === cat.id);
  }, [section, searchQuery, visibleCategories, categoryIdx, streams, favorites]);

  // Keep channelIdx within bounds when the list changes
  useEffect(() => {
    if (channelIdx >= visibleChannels.length) setChannelIdx(0);
  }, [visibleChannels.length, channelIdx]);

  const focusedChannel = visibleChannels[channelIdx];

  // --- EPG for focused channel ------------------------------------------
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
        const nn = pickNowNext(res.epg_listings || []);
        epgCacheRef.current.set(id, nn);
        forceEpgTick(t => t + 1);
      } catch {
        epgCacheRef.current.set(id, {});
        forceEpgTick(t => t + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [focusedChannel, creds, usingMock]);

  const focusedNowNext: EpgNowNext | undefined = focusedChannel
    ? epgCacheRef.current.get(focusedChannel.stream_id)
    : undefined;

  // --- play / stop -------------------------------------------------------
  const streamUrl = useMemo(() => {
    if (!playingChannelId) return null;
    if (usingMock || !creds) return null;
    return buildLiveStreamUrl(creds, playingChannelId);
  }, [playingChannelId, usingMock, creds]);

  const playChannel = useCallback((stream: XtreamLiveStream) => {
    setPlayingChannelId(stream.stream_id);
    saveLastChannelId(stream.stream_id);
    setFullscreen(true);
    setShowInfoPanel(true);
    if (infoTimerRef.current) window.clearTimeout(infoTimerRef.current);
    infoTimerRef.current = window.setTimeout(() => setShowInfoPanel(false), 5000) as unknown as number;
    if (usingMock || !creds) {
      toast({
        title: 'Demo mode',
        description: 'Enter your Xtream credentials to play live channels.',
      });
    }
  }, [usingMock, creds, toast]);

  const changeChannelInFullscreen = useCallback((delta: 1 | -1) => {
    if (!visibleChannels.length) return;
    let i = visibleChannels.findIndex(s => s.stream_id === playingChannelId);
    if (i < 0) i = channelIdx;
    const next = (i + delta + visibleChannels.length) % visibleChannels.length;
    setChannelIdx(next);
    playChannel(visibleChannels[next]);
  }, [visibleChannels, playingChannelId, channelIdx, playChannel]);

  // --- focus refs for keyboard handler ----------------------------------
  const paneRef        = useRef(pane);
  const sectionIdxRef  = useRef(sectionIdx);
  const categoryIdxRef = useRef(categoryIdx);
  const channelIdxRef  = useRef(channelIdx);
  const fullscreenRef  = useRef(fullscreen);
  const visibleCategoriesRef = useRef(visibleCategories);
  const visibleChannelsRef   = useRef(visibleChannels);
  const showCredsFormRef = useRef(showCredsForm);

  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { sectionIdxRef.current = sectionIdx; }, [sectionIdx]);
  useEffect(() => { categoryIdxRef.current = categoryIdx; }, [categoryIdx]);
  useEffect(() => { channelIdxRef.current = channelIdx; }, [channelIdx]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);
  useEffect(() => { visibleCategoriesRef.current = visibleCategories; }, [visibleCategories]);
  useEffect(() => { visibleChannelsRef.current = visibleChannels; }, [visibleChannels]);
  useEffect(() => { showCredsFormRef.current = showCredsForm; }, [showCredsForm]);

  // --- keyboard / D-pad --------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Credentials form: let inputs handle keys, but support Back to cancel.
      if (showCredsFormRef.current) {
        if ((e.key === 'Escape' || e.keyCode === 4) && !typing) {
          e.preventDefault();
          if (creds) setShowCredsForm(false);
          else onBack();
        }
        return;
      }

      // Fullscreen player owns the keys
      if (fullscreenRef.current) {
        if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) {
          e.preventDefault();
          e.stopPropagation();
          setFullscreen(false);
          setShowInfoPanel(false);
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
          return;
        }
        return;
      }

      if (typing) return;

      // Back / Escape: go up one level
      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (paneRef.current === 'channels')      setPane('categories');
        else if (paneRef.current === 'categories') setPane('sections');
        else onBack();
        return;
      }

      // Star = toggle favorite on focused channel
      if (e.key === 'f' || e.key === 'F') {
        if (focusedChannel) { e.preventDefault(); toggleFavorite(focusedChannel.stream_id); }
        return;
      }

      const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!arrows.includes(e.key)) return;
      e.preventDefault();

      const cats = visibleCategoriesRef.current;
      const chans = visibleChannelsRef.current;

      if (paneRef.current === 'sections') {
        if (e.key === 'ArrowDown') setSectionIdx(i => Math.min(1, i + 1));
        else if (e.key === 'ArrowUp') setSectionIdx(i => Math.max(0, i - 1));
        else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
          const next: Section = sectionIdxRef.current === 0 ? 'live' : 'search';
          setSection(next);
          setPane('categories');
        }
        return;
      }

      if (paneRef.current === 'categories') {
        if (e.key === 'ArrowDown') setCategoryIdx(i => Math.min(cats.length - 1, i + 1));
        else if (e.key === 'ArrowUp') setCategoryIdx(i => Math.max(0, i - 1));
        else if (e.key === 'ArrowLeft') setPane('sections');
        else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') setPane('channels');
        return;
      }

      // pane === 'channels'
      if (e.key === 'ArrowDown') setChannelIdx(i => Math.min(chans.length - 1, i + 1));
      else if (e.key === 'ArrowUp') setChannelIdx(i => Math.max(0, i - 1));
      else if (e.key === 'ArrowLeft') setPane('categories');
      else if (e.key === 'Enter' || e.key === ' ') {
        const ch = chans[channelIdxRef.current];
        if (ch) playChannel(ch);
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onBack, creds, focusedChannel, toggleFavorite, changeChannelInFullscreen, playChannel]);

  // Auto-scroll focused row into view
  const focusedRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    focusedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [channelIdx, categoryIdx, pane]);

  // --- render: credentials form -----------------------------------------
  if (showCredsForm) {
    return (
      <div className="min-h-screen text-white">
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
          <CredentialsForm
            initial={creds}
            onSaved={async (c) => {
              setCreds(c);
              setUsingMock(false);
              setShowCredsForm(false);
              epgCacheRef.current.clear();
              await loadServerData(c);
            }}
            onCancel={creds ? () => setShowCredsForm(false) : undefined}
          />
        </Suspense>
      </div>
    );
  }

  if (!credsLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
      </div>
    );
  }

  // --- render: fullscreen player ----------------------------------------
  const playingStream = streams.find(s => s.stream_id === playingChannelId) || focusedChannel;
  const playingNowNext = playingStream ? epgCacheRef.current.get(playingStream.stream_id) : undefined;
  const progress = (() => {
    if (!playingNowNext?.now) return 0;
    const { start, end } = playingNowNext.now;
    const t = Date.now();
    return Math.min(100, Math.max(0, ((t - start) / (end - start)) * 100));
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
                {playingNowNext?.next && (
                  <p className="text-sm text-brand-ice/70 font-nunito mt-1 truncate">
                    Next: {playingNowNext.next.title} · {formatTime(playingNowNext.next.start)}
                  </p>
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

  // --- render: browse layout --------------------------------------------
  return (
    <div className="min-h-screen flex flex-col text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="white"
            size="sm"
            onClick={onBack}
            className="tv-focusable home-focus-surface"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Tv className="w-7 h-7 text-brand-gold" />
            <h1 className="text-2xl font-quicksand font-bold text-white">Live TV</h1>
            {usingMock && (
              <span className="ml-2 text-xs px-2 py-1 rounded-full bg-brand-gold/20 text-brand-gold font-nunito">
                Demo mode
              </span>
            )}
            {loading && <Loader2 className="w-5 h-5 animate-spin text-brand-gold ml-2" />}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="gold"
            size="sm"
            onClick={() => setShowCredsForm(true)}
            className="tv-focusable home-focus-surface"
          >
            <SettingsIcon className="w-4 h-4 mr-2" />
            {creds ? 'Server' : 'Connect Server'}
          </Button>
          {creds && (
            <Button
              variant="white"
              size="sm"
              onClick={async () => {
                await clearCreds();
                setCreds(null);
                setUsingMock(true);
                setCategories(MOCK_CATEGORIES);
                setStreams(MOCK_STREAMS);
                epgCacheRef.current.clear();
                toast({ title: 'Disconnected', description: 'Live TV is back in demo mode.' });
              }}
              className="tv-focusable home-focus-surface"
            >
              <X className="w-4 h-4 mr-2" />
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {/* Three-pane layout */}
      <div className="flex-1 min-h-0 flex">
        {/* Pane 1 — Sections */}
        <div className={`w-44 flex-shrink-0 border-r border-white/10 p-3 space-y-2 ${pane === 'sections' ? 'bg-white/5' : ''}`}>
          {[
            { id: 'live', label: 'Live TV', icon: Tv },
            { id: 'search', label: 'Search', icon: Search },
          ].map((s, i) => {
            const Icon = s.icon;
            const isFocused = pane === 'sections' && sectionIdx === i;
            const isActive = section === s.id;
            return (
              <div
                key={s.id}
                data-focused={isFocused ? 'true' : 'false'}
                onClick={() => { setSectionIdx(i); setSection(s.id as Section); setPane('categories'); }}
                className={`
                  flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all duration-150
                  ${isFocused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-105 shadow-lg' : ''}
                  ${!isFocused && isActive ? 'bg-white/10' : ''}
                  ${!isFocused && !isActive ? 'hover:bg-white/5' : ''}
                `}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-brand-gold' : 'text-brand-ice'}`} />
                <span className="font-quicksand font-semibold">{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Pane 2 — Categories */}
        <div className={`w-64 flex-shrink-0 border-r border-white/10 p-3 overflow-y-auto ${pane === 'categories' ? 'bg-white/5' : ''}`}>
          {section === 'search' ? (
            <div className="space-y-3">
              <p className="text-xs font-nunito uppercase tracking-wide text-brand-ice/60 px-1">Search channels</p>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Type to search…"
                className="tv-focusable w-full rounded-xl bg-black/30 text-white border border-white/20 px-3 py-2 font-nunito focus:outline-none focus:ring-2 focus:ring-brand-gold"
              />
              <p className="text-xs text-brand-ice/60 font-nunito px-1">
                {visibleChannels.length} result{visibleChannels.length === 1 ? '' : 's'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {visibleCategories.map((c, i) => {
                const isFocused = pane === 'categories' && categoryIdx === i;
                const isSelected = categoryIdx === i;
                return (
                  <div
                    key={c.id}
                    data-focused={isFocused ? 'true' : 'false'}
                    onClick={() => { setCategoryIdx(i); setPane('channels'); }}
                    className={`
                      flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150
                      ${isFocused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-[1.02] shadow-lg' : ''}
                      ${!isFocused && isSelected ? 'bg-white/10' : ''}
                      ${!isFocused && !isSelected ? 'hover:bg-white/5' : ''}
                    `}
                  >
                    {c.id === FAV_ID && <Star className="w-4 h-4 text-brand-gold flex-shrink-0" />}
                    <span className="font-nunito truncate flex-1">{c.name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pane 3 — Channels + preview */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Preview header */}
          <div className="flex gap-4 p-4 border-b border-white/10 bg-black/20">
            <div className="w-64 aspect-video rounded-xl overflow-hidden bg-black border border-white/10 flex-shrink-0">
              {focusedChannel && !usingMock && creds ? (
                <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-gold" /></div>}>
                  <VideoPlayer
                    src={buildLiveStreamUrl(creds, focusedChannel.stream_id)}
                    volume={0}
                    className="w-full h-full"
                  />
                </Suspense>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-brand-ice/60 font-nunito text-sm text-center px-4">
                  {usingMock ? 'Preview available with real credentials' : 'No channel selected'}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              {focusedChannel ? (
                <>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-quicksand font-bold text-white truncate">
                      {focusedChannel.name}
                    </h3>
                    {favorites.has(focusedChannel.stream_id) && (
                      <Star className="w-5 h-5 text-brand-gold fill-brand-gold" />
                    )}
                  </div>
                  {focusedNowNext?.now ? (
                    <>
                      <p className="text-brand-ice/90 font-nunito truncate mt-1">
                        Now: {focusedNowNext.now.title}
                      </p>
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
                  <p className="text-xs text-brand-ice/50 font-nunito mt-3">
                    Press Enter to play · F to favorite
                  </p>
                </>
              ) : (
                <p className="text-brand-ice/60 font-nunito">No channel focused</p>
              )}
            </div>
          </div>

          {/* Channel list */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
            {visibleChannels.length === 0 ? (
              <div className="h-full flex items-center justify-center text-brand-ice/60 font-nunito">
                {section === 'search'
                  ? (searchQuery ? 'No channels match your search.' : 'Type above to search channels.')
                  : 'No channels in this category.'}
              </div>
            ) : (
              visibleChannels.map((s, i) => {
                const isFocused = pane === 'channels' && i === channelIdx;
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
    </div>
  );
});

LiveTV.displayName = 'LiveTV';
export default LiveTV;
