// Classic cable-style EPG grid. Windowed & virtualized:
//   • categories → getLiveCategories (like LiveSection)
//   • channels for selected category → getLiveStreams(categoryId)
//   • EPG → getShortEpg per-channel, concurrency-capped, only for the
//     currently-rendered virtual rows (never all channels at once).
// Xtream has no bulk XMLTV endpoint that's safe on Fire TV — do NOT fetch
// xmltv.php (freezes the WebView).
import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Loader2, Tv, AlertTriangle, RotateCw } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  getLiveCategories,
  getLiveStreams,
  getShortEpg,
  buildLiveStreamUrl,
  decodeEpgText,
  parseEpgTime,
  loadVolume,
  saveVolume,
  XTREAM_REFRESH_EVENT,
  type XtreamCreds,
  type XtreamCategory,
  type XtreamLiveStream,
  type XtreamEpgEntry,
} from '@/lib/xtream';
import { isFireTV } from '@/utils/platform';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { useNativePlayer } from '@/hooks/useNativePlayer';

const VideoPlayer = lazy(() => import('./VideoPlayer'));
const NATIVE_PLAYBACK = hasNativePlayer();

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
  onNavigate?: (view: string) => void;
}

interface DecodedProgram {
  title: string;
  start: number;
  end: number;
}

const ROW_HEIGHT = 72;
const CHANNEL_COL_WIDTH = 220;
const TIME_HEADER_HEIGHT = 36;
const WINDOW_MINUTES = 150; // 2.5 hours
const SLOT_MINUTES = 30;
const SLOTS = WINDOW_MINUTES / SLOT_MINUTES; // 5
const EPG_MAX_CONCURRENT = 4;

const halfHourFloor = (t: number) => {
  const d = new Date(t);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 30));
  return d.getTime();
};

const formatSlot = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const decodePrograms = (entries: XtreamEpgEntry[]): DecodedProgram[] =>
  entries
    .map(e => ({
      title: decodeEpgText(e.title) || 'Program',
      start: parseEpgTime(e.start_timestamp || e.start),
      end: parseEpgTime(e.stop_timestamp || e.end),
    }))
    .filter(e => e.start > 0 && e.end > e.start)
    .sort((a, b) => a.start - b.start);

const GuideSection = memo(({ creds, isActive, onExitLeft, onExitUp, onNavigate: _onNavigate }: Props) => {
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [channels, setChannels] = useState<XtreamLiveStream[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [rowIdx, setRowIdx] = useState(0);
  const [focusZone, setFocusZone] = useState<'category' | 'grid'>('grid');

  // Time window (start ms). Initial = current half-hour.
  const [windowStart, setWindowStart] = useState<number>(() => halfHourFloor(Date.now()));
  const nowInitialRef = useRef(halfHourFloor(Date.now()));

  // Bump every 30s so the NOW line + auto-EPG refresh keep pace.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Volume + playback
  const [volume, setVolume] = useState<number>(() => loadVolume());
  useEffect(() => { saveVolume(volume); }, [volume]);
  const [playingChannelId, setPlayingChannelId] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

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

  // Load categories
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

  const currentCategory = categories[categoryIdx];

  // Load channels for selected category
  useEffect(() => {
    if (!currentCategory) { setChannels([]); return; }
    let cancelled = false;
    setChannelsLoading(true);
    setRowIdx(0);
    getLiveStreams(creds, String(currentCategory.category_id))
      .then(list => { if (!cancelled) setChannels(list || []); })
      .catch(() => { if (!cancelled) setChannels([]); })
      .finally(() => { if (!cancelled) setChannelsLoading(false); });
    return () => { cancelled = true; };
  }, [creds, currentCategory, refreshTick]);

  // Clamp row
  useEffect(() => {
    if (rowIdx >= channels.length) setRowIdx(0);
  }, [channels.length, rowIdx]);

  // Virtualizer for channel rows
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: isFireTV() ? 2 : 6,
    getItemKey: (i) => channels[i]?.stream_id ?? i,
  });

  // EPG lazy fetch (concurrency-capped)
  const epgCacheRef = useRef<Map<number, DecodedProgram[]>>(new Map());
  const epgPendingRef = useRef<Set<number>>(new Set());
  const epgQueueRef = useRef<number[]>([]);
  const epgInFlightRef = useRef(0);
  const [, forceEpgTick] = useState(0);

  const pumpEpg = useCallback(() => {
    while (epgInFlightRef.current < EPG_MAX_CONCURRENT && epgQueueRef.current.length) {
      const id = epgQueueRef.current.shift()!;
      epgInFlightRef.current++;
      getShortEpg(creds, id, 16)
        .then(res => { epgCacheRef.current.set(id, decodePrograms(res.epg_listings || [])); })
        .catch(() => { epgCacheRef.current.set(id, []); })
        .finally(() => {
          epgInFlightRef.current--;
          epgPendingRef.current.delete(id);
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
  useEffect(() => {
    for (const v of virtualItems) {
      const s = channels[v.index];
      if (s) enqueueEpg(s.stream_id);
    }
  }, [virtualItems, channels, enqueueEpg]);

  // Keep focused row visible
  useEffect(() => {
    if (!channels.length) return;
    const node = scrollParentRef.current;
    if (!node) return;
    if (rowIdx === 0) { node.scrollTop = 0; return; }
    const top = rowIdx * ROW_HEIGHT;
    const bot = top + ROW_HEIGHT;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (bot > node.scrollTop + node.clientHeight) node.scrollTop = bot - node.clientHeight;
  }, [rowIdx, channels.length]);

  const windowEnd = windowStart + WINDOW_MINUTES * 60_000;
  const slotStarts = useMemo(
    () => Array.from({ length: SLOTS }, (_, i) => windowStart + i * SLOT_MINUTES * 60_000),
    [windowStart],
  );

  // Playback wiring — mirror LiveSection's native path exactly
  const streamUrl = useMemo(
    () => (playingChannelId ? buildLiveStreamUrl(creds, playingChannelId) : null),
    [playingChannelId, creds],
  );
  const nativeActive = NATIVE_PLAYBACK && fullscreen && !!playingChannelId;
  const nativeUrl = nativeActive
    ? (streamUrl ? streamUrl.replace(/\.m3u8(\?|$)/i, '.ts$1') : null)
    : null;
  const native = useNativePlayer({
    active: nativeActive,
    url: nativeUrl,
    volume,
  });
  useEffect(() => {
    if (!nativeActive) return;
    document.documentElement.classList.add('snowplayer-fullscreen');
    return () => { document.documentElement.classList.remove('snowplayer-fullscreen'); };
  }, [nativeActive]);

  const playRow = useCallback((idx: number) => {
    const ch = channels[idx];
    if (!ch) return;
    setPlayingChannelId(ch.stream_id);
    setFullscreen(true);
  }, [channels]);

  // ── D-pad ─────────────────────────────────────────────────────────────
  const focusZoneRef = useRef(focusZone);
  const categoryIdxRef = useRef(categoryIdx);
  const rowIdxRef = useRef(rowIdx);
  const fullscreenRef = useRef(fullscreen);
  const windowStartRef = useRef(windowStart);
  const channelsRef = useRef(channels);
  const categoriesRef = useRef(categories);
  const nativeErrorRef = useRef<{ code?: string; message: string } | null>(null);
  const nativeRetryRef = useRef<() => void>(() => {});
  useEffect(() => { focusZoneRef.current = focusZone; }, [focusZone]);
  useEffect(() => { categoryIdxRef.current = categoryIdx; }, [categoryIdx]);
  useEffect(() => { rowIdxRef.current = rowIdx; }, [rowIdx]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);
  useEffect(() => { windowStartRef.current = windowStart; }, [windowStart]);
  useEffect(() => { channelsRef.current = channels; }, [channels]);
  useEffect(() => { categoriesRef.current = categories; }, [categories]);
  useEffect(() => { nativeErrorRef.current = native.error; }, [native.error]);
  useEffect(() => { nativeRetryRef.current = native.retry; }, [native.retry]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      try {
        const target = e.target as HTMLElement;
        const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        if (typing) return;

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
          if (e.key === 'ArrowRight') { e.preventDefault(); setVolume(v => Math.min(1, +(v + 0.05).toFixed(2))); return; }
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
          onExitLeft();
          return;
        }

        const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
        if (!arrows.includes(e.key)) return;
        e.preventDefault();
        const ae = document.activeElement as HTMLElement | null;
        if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();

        if (focusZoneRef.current === 'category') {
          const cats = categoriesRef.current;
          if (e.key === 'ArrowLeft') {
            if (categoryIdxRef.current === 0) { onExitLeft(); return; }
            setCategoryIdx(i => Math.max(0, i - 1));
          } else if (e.key === 'ArrowRight') {
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
          if (rowIdxRef.current === 0) { setFocusZone('category'); return; }
          setRowIdx(i => Math.max(0, i - 1));
        } else if (e.key === 'ArrowDown') {
          const n = channelsRef.current.length;
          setRowIdx(i => (n ? Math.min(n - 1, i + 1) : 0));
        } else if (e.key === 'ArrowLeft') {
          // If window is at "now" — exit to sections; otherwise shift earlier.
          if (windowStartRef.current <= nowInitialRef.current) {
            onExitLeft();
            return;
          }
          setWindowStart(s => s - SLOT_MINUTES * 60_000);
        } else if (e.key === 'ArrowRight') {
          setWindowStart(s => s + SLOT_MINUTES * 60_000);
        } else if (e.key === 'Enter' || e.key === ' ') {
          playRow(rowIdxRef.current);
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, onExitLeft, onExitUp, playRow]);

  // Hardware Back (Capacitor)
  useEffect(() => {
    if (!isActive) return;
    let handle: { remove?: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const h = await CapApp.addListener('backButton', () => {
          (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
          if (fullscreenRef.current) { setFullscreen(false); return; }
          onExitLeft();
        });
        if (cancelled) h?.remove?.(); else handle = h;
      } catch { /* web */ }
    })();
    return () => { cancelled = true; handle?.remove?.(); };
  }, [isActive, onExitLeft]);

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
        {!NATIVE_PLAYBACK && (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-brand-gold" /></div>}>
            <VideoPlayer src={streamUrl} volume={volume} muted={false} className="w-full h-full" />
          </Suspense>
        )}
        {NATIVE_PLAYBACK && native.buffering && !native.error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="w-12 h-12 text-brand-gold animate-spin drop-shadow-lg" />
          </div>
        )}
        {NATIVE_PLAYBACK && native.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-white p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-brand-gold mb-3" />
            <p className="font-quicksand font-semibold mb-1">Playback Error</p>
            <p className="text-sm text-brand-ice/80 font-nunito max-w-md mb-4">{native.error.message}</p>
            <button
              onClick={() => native.retry()}
              autoFocus
              className="tv-focusable home-focus-surface flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold focus:outline-none focus:ring-4 focus:ring-brand-gold/60"
            >
              <RotateCw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
          <div className="flex items-center gap-3">
            {playingChannel?.stream_icon
              ? <img src={playingChannel.stream_icon} alt="" className="w-12 h-12 rounded bg-black/40 object-contain" />
              : <Tv className="w-8 h-8 text-brand-gold" />}
            <div className="min-w-0">
              <p className="font-quicksand font-bold text-white truncate">{playingChannel?.name || ''}</p>
              {playingNow && <p className="text-sm text-brand-ice/80 font-nunito truncate">{playingNow.title}</p>}
            </div>
          </div>
        </div>
        <div className="absolute bottom-4 right-6 px-3 py-1.5 rounded-full bg-black/60 text-brand-ice/80 font-nunito text-xs pointer-events-none">
          Vol {Math.round(volume * 100)}% · Back to exit
        </div>
      </div>
    );
  }

  // ── Render grid ──────────────────────────────────────────────────────
  const totalRowsSize = rowVirtualizer.getTotalSize();
  const slotPct = 100 / SLOTS;
  const nowPct = ((nowTick - windowStart) / (WINDOW_MINUTES * 60_000)) * 100;
  const nowInWindow = nowPct >= 0 && nowPct <= 100;
  const canGoEarlier = windowStart > nowInitialRef.current;

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-black/30">
      {/* Category selector row */}
      <div className={`flex-shrink-0 border-b border-white/10 bg-black/40 px-3 py-2 ${focusZone === 'category' && isActive ? 'bg-white/5' : ''}`}>
        {categoriesLoading && categories.length === 0 ? (
          <div className="flex items-center gap-2 text-brand-ice/60 font-nunito text-sm px-2 py-1">
            <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> Loading categories…
          </div>
        ) : categories.length === 0 ? (
          <div className="text-brand-ice/60 font-nunito text-sm px-2 py-1">No categories.</div>
        ) : (
          <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap">
            {categories.map((c, i) => {
              const isFocused = isActive && focusZone === 'category' && categoryIdx === i;
              const isSelected = categoryIdx === i;
              return (
                <button
                  key={c.category_id}
                  ref={el => { if (isFocused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
                  data-focused={isFocused ? 'true' : 'false'}
                  onClick={() => { setCategoryIdx(i); setFocusZone('grid'); }}
                  className={`
                    tv-focusable flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-nunito transition-transform duration-150
                    ${isFocused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-105 shadow-[0_0_14px_rgba(245,200,80,0.35)] text-white' : ''}
                    ${!isFocused && isSelected ? 'bg-white/10 border border-brand-gold/30 text-white' : 'border border-transparent text-brand-ice'}
                    ${!isFocused && !isSelected ? 'hover:bg-white/5' : ''}
                  `}
                >
                  {c.category_name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Time header */}
      <div
        className="flex-shrink-0 border-b border-white/10 bg-black/50 flex"
        style={{ height: TIME_HEADER_HEIGHT }}
      >
        <div
          className="flex-shrink-0 border-r border-white/10 flex items-center justify-between px-3 text-xs font-nunito text-brand-ice/70"
          style={{ width: CHANNEL_COL_WIDTH }}
        >
          <span>Channel</span>
          <span className={canGoEarlier ? 'text-brand-gold' : 'opacity-40'}>◀ earlier</span>
        </div>
        <div className="flex-1 relative">
          {slotStarts.map((s, i) => (
            <div
              key={s}
              className="absolute top-0 bottom-0 border-l border-white/10 flex items-center px-2 text-xs font-nunito text-brand-ice/80"
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
        className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${focusZone === 'grid' && isActive ? 'bg-white/[0.02]' : ''}`}
      >
        {channelsLoading && channels.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/60 font-nunito text-sm gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-brand-gold" /> Loading channels…
          </div>
        ) : channels.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/60 font-nunito text-sm">
            No channels in this category.
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
                  data-focused={isFocused ? 'true' : 'false'}
                  onClick={() => { setRowIdx(v.index); playRow(v.index); }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${v.start}px)`,
                    padding: '3px 0',
                  }}
                  className="cursor-pointer"
                >
                  <div className={`
                    h-full flex rounded-lg transition-transform duration-150
                    ${isFocused ? 'bg-brand-gold/15 ring-2 ring-brand-gold scale-[1.01] shadow-[0_0_14px_rgba(245,200,80,0.35)]' : 'bg-black/30 border border-white/5'}
                  `}>
                    {/* Channel cell */}
                    <div
                      className="flex-shrink-0 flex items-center gap-2 px-3 border-r border-white/10 overflow-hidden"
                      style={{ width: CHANNEL_COL_WIDTH }}
                    >
                      {ch.stream_icon
                        ? <img src={ch.stream_icon} alt="" loading="lazy" className="w-10 h-10 object-contain rounded bg-black/40 flex-shrink-0" />
                        : <Tv className="w-8 h-8 text-brand-ice/60 flex-shrink-0" />}
                      <div className="min-w-0">
                        {ch.num != null && (
                          <div className="text-[10px] font-nunito text-brand-ice/60 tabular-nums leading-tight">#{ch.num}</div>
                        )}
                        <div className="text-sm font-quicksand font-semibold text-white truncate leading-tight">{ch.name}</div>
                      </div>
                    </div>
                    {/* Program lane */}
                    <div className="flex-1 relative">
                      {!programs && (
                        <div className="absolute inset-0 flex items-center justify-center text-brand-ice/40 font-nunito text-xs">
                          <Loader2 className="w-3 h-3 animate-spin mr-2" /> EPG…
                        </div>
                      )}
                      {programs && visible.length === 0 && (
                        <div className="absolute inset-0 flex items-center px-3 text-brand-ice/40 font-nunito text-xs">
                          No listings
                        </div>
                      )}
                      {visible.map((p, i) => {
                        const clampedStart = Math.max(p.start, windowStart);
                        const clampedEnd = Math.min(p.end, windowEnd);
                        const left = ((clampedStart - windowStart) / (WINDOW_MINUTES * 60_000)) * 100;
                        const width = ((clampedEnd - clampedStart) / (WINDOW_MINUTES * 60_000)) * 100;
                        const isNow = p.start <= nowTick && nowTick < p.end;
                        return (
                          <div
                            key={i}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            className={`
                              absolute top-1 bottom-1 rounded px-2 flex flex-col justify-center overflow-hidden border
                              ${isNow ? 'bg-brand-gold/25 border-brand-gold/50' : 'bg-white/5 border-white/10'}
                            `}
                          >
                            <div className="text-xs font-quicksand font-semibold text-white truncate leading-tight">{p.title}</div>
                            <div className="text-[10px] font-nunito text-brand-ice/60 truncate leading-tight">
                              {formatSlot(p.start)}
                            </div>
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
      <div className="flex-shrink-0 border-t border-white/10 bg-black/40 px-4 py-1.5 text-[11px] font-nunito text-brand-ice/60">
        ◀ ▶ shift time · ▲ ▼ channel · OK to play · Back to exit
      </div>
    </div>
  );
});

GuideSection.displayName = 'GuideSection';
export default GuideSection;
