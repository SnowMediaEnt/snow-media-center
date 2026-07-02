// Plex "Movies & Shows" — auth gate → library tabs → poster grid → native play.
// Movie libraries browse + play (direct-play with transcode fallback); show
// libraries are listed but series/episode nav is Phase 2.
import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Loader2, Tv, AlertTriangle, RotateCw, Film } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useToast } from '@/hooks/use-toast';
import { isFireTV } from '@/utils/platform';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { useNativePlayer } from '@/hooks/useNativePlayer';
import { usePlexAuth } from '@/hooks/usePlexAuth';
import {
  getPlexLibraries, getPlexLibraryItems, getPlexPart,
  plexImageUrl, plexDirectUrl, plexTranscodeUrl,
  type PlexLibrary, type PlexItem,
} from '@/lib/plex';
import PlexAuthScreen from './PlexAuthScreen';
import OverseerrRequestPanel from './OverseerrRequestPanel';

const VideoPlayer = lazy(() => import('./VideoPlayer'));
const NATIVE_PLAYBACK = hasNativePlayer();

const COLS = 6;
const ROW_H = 250;

interface Props {
  isActive: boolean;
  onExitLeft?: () => void;
  onExitUp?: () => void;
}

const PlexSection = memo(({ isActive, onExitLeft, onExitUp }: Props) => {
  const { toast } = useToast();
  const { status, conn, pinCode, error, startLink, cancelLink, signOut, retryConnect } = usePlexAuth();

  const deeplinkRef = useRef<{ ratingKey: string; title?: string; librarySectionID?: string | number | null } | null>(
    (() => {
      try {
        const raw = sessionStorage.getItem('smc-plex-deeplink');
        if (!raw) return null;
        sessionStorage.removeItem('smc-plex-deeplink');
        return JSON.parse(raw);
      } catch { return null; }
    })(),
  );

  const [libraries, setLibraries] = useState<PlexLibrary[]>([]);
  const [libIdx, setLibIdx] = useState(0);
  const [items, setItems] = useState<PlexItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [zone, setZone] = useState<'tabs' | 'grid'>('tabs');
  const [cursor, setCursor] = useState(0);

  const [volume] = useState(0.9);
  const [playing, setPlaying] = useState<PlexItem | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [useTranscode, setUseTranscode] = useState(false);

  // Load libraries when connected.
  useEffect(() => {
    if (status !== 'ready' || !conn) return;
    let cancelled = false;
    getPlexLibraries(conn.base, conn.token)
      .then((libs) => { if (!cancelled) setLibraries(libs); })
      .catch(() => { if (!cancelled) setLibraries([]); });
    return () => { cancelled = true; };
  }, [status, conn]);

  // Deep-link step 1: pick the target library tab once libraries are known.
  useEffect(() => {
    const dl = deeplinkRef.current;
    if (!dl || status !== 'ready' || !conn || libraries.length === 0) return;
    let idx = libraries.findIndex((l) => String(l.key) === String(dl.librarySectionID ?? ''));
    if (idx < 0) idx = libraries.findIndex((l) => l.type === 'movie');
    if (idx < 0) idx = 0;
    setLibIdx(idx);
  }, [status, conn, libraries]);

  const tabs = useMemo<PlexLibrary[]>(
    () => [...libraries, { key: '__request', title: 'Request', type: 'request' }],
    [libraries],
  );
  const currentLib = tabs[libIdx];

  // Load items for the selected MOVIE library.
  useEffect(() => {
    if (!conn || !currentLib || currentLib.type !== 'movie') { setItems([]); return; }
    let cancelled = false;
    setItemsLoading(true);
    setCursor(0);
    getPlexLibraryItems(conn.base, conn.token, currentLib.key)
      .then((list) => { if (!cancelled) setItems(list); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setItemsLoading(false); });
    return () => { cancelled = true; };
  }, [conn, currentLib]);

  // Deep-link step 2: focus the exact title in the grid (user presses OK to play).
  useEffect(() => {
    const dl = deeplinkRef.current;
    if (!dl || items.length === 0) return;
    deeplinkRef.current = null; // consume once
    const idx = items.findIndex((it) => String(it.ratingKey) === String(dl.ratingKey));
    if (idx >= 0) {
      setCursor(idx);
      setZone('grid');
    } else {
      toast({ title: 'Not found', description: `Couldn't find "${dl.title ?? 'that title'}" in this library.` });
    }
  }, [items, toast]);

  const rows = Math.ceil(items.length / COLS);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: isFireTV() ? 1 : 3,
  });

  // Keep cursor row visible.
  useEffect(() => {
    if (zone !== 'grid') return;
    const row = Math.floor(cursor / COLS);
    rowVirtualizer.scrollToIndex(row, { align: 'auto' });
  }, [cursor, zone, rowVirtualizer]);

  // ── Playback ──────────────────────────────────────────────────────────
  const play = useCallback(async (item: PlexItem) => {
    if (!conn) return;
    if (item.type !== 'movie') { toast({ title: 'Coming soon', description: 'Series playback from Plex arrives in the next update.' }); return; }
    setUseTranscode(false);
    setPlaying(item);
    try {
      const { partKey } = await getPlexPart(conn.base, conn.token, item.ratingKey);
      const url = partKey ? plexDirectUrl(conn.base, partKey, conn.token) : plexTranscodeUrl(conn.base, item.ratingKey, conn.token);
      setStreamUrl(url);
      setFullscreen(true);
    } catch {
      setStreamUrl(plexTranscodeUrl(conn.base, item.ratingKey, conn.token));
      setUseTranscode(true);
      setFullscreen(true);
    }
  }, [conn, toast]);

  const nativeActive = NATIVE_PLAYBACK && fullscreen && !!streamUrl;
  const native = useNativePlayer({ active: nativeActive, url: nativeActive ? streamUrl : null, volume });

  useEffect(() => {
    if (!nativeActive) return;
    document.documentElement.classList.add('snowplayer-fullscreen');
    return () => { document.documentElement.classList.remove('snowplayer-fullscreen'); };
  }, [nativeActive]);

  // Direct-play failed on native → fall back to transcode once.
  useEffect(() => {
    if (nativeActive && native.error && !useTranscode && playing && conn) {
      setUseTranscode(true);
      setStreamUrl(plexTranscodeUrl(conn.base, playing.ratingKey, conn.token));
    }
  }, [native.error, nativeActive, useTranscode, playing, conn]);

  const exitFullscreen = useCallback(() => { setFullscreen(false); setPlaying(null); setStreamUrl(null); setUseTranscode(false); }, []);

  // ── refs for keyboard ────────────────────────────────────────────────
  const zoneRef = useRef(zone); const cursorRef = useRef(cursor);
  const libIdxRef = useRef(libIdx); const itemsRef = useRef(items);
  const librariesRef = useRef(libraries); const fullscreenRef = useRef(fullscreen);
  const nativeErrRef = useRef(native.error); const nativeRetryRef = useRef(native.retry);
  useEffect(() => { zoneRef.current = zone; }, [zone]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { libIdxRef.current = libIdx; }, [libIdx]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { librariesRef.current = tabs; }, [tabs]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);
  useEffect(() => { nativeErrRef.current = native.error; }, [native.error]);
  useEffect(() => { nativeRetryRef.current = native.retry; }, [native.retry]);

  useEffect(() => {
    if (!isActive || status !== 'ready') return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if (fullscreenRef.current) {
        const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
        if (isBack) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); exitFullscreen(); return; }
        if (nativeErrRef.current && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); nativeRetryRef.current(); return; }
        return;
      }

      // Request tab: OverseerrRequestPanel owns the keyboard while in the grid zone.
      if (zoneRef.current === 'grid' && librariesRef.current[libIdxRef.current]?.type === 'request') return;

      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      if (isBack) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); onExitLeft?.(); return; }

      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();

      if (zoneRef.current === 'tabs') {
        const n = librariesRef.current.length;
        if (e.key === 'ArrowLeft') { if (libIdxRef.current === 0) onExitLeft?.(); else setLibIdx((i) => Math.max(0, i - 1)); }
        else if (e.key === 'ArrowRight') setLibIdx((i) => Math.min(n - 1, i + 1));
        else if (e.key === 'ArrowUp') onExitUp?.();
        else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') setZone('grid');
        return;
      }
      // grid zone
      const total = itemsRef.current.length;
      const cur = cursorRef.current;
      if (e.key === 'ArrowUp') { if (cur < COLS) setZone('tabs'); else setCursor(cur - COLS); }
      else if (e.key === 'ArrowDown') { if (cur + COLS < total) setCursor(cur + COLS); }
      else if (e.key === 'ArrowLeft') { if (cur % COLS === 0) onExitLeft?.(); else setCursor(cur - 1); }
      else if (e.key === 'ArrowRight') { if ((cur % COLS) < COLS - 1 && cur + 1 < total) setCursor(cur + 1); }
      else if (e.key === 'Enter' || e.key === ' ') { const it = itemsRef.current[cur]; if (it) void play(it); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, status, onExitLeft, onExitUp, play, exitFullscreen]);

  // Hardware back
  useEffect(() => {
    if (!isActive) return;
    let handle: { remove?: () => void } | undefined; let cancelled = false;
    (async () => {
      try {
        const h = await CapApp.addListener('backButton', () => {
          if (fullscreenRef.current) { exitFullscreen(); return; }
          if (zoneRef.current === 'grid' && librariesRef.current[libIdxRef.current]?.type === 'request') { setZone('tabs'); return; }
          onExitLeft?.();
        });
        if (cancelled) h?.remove?.(); else handle = h;
      } catch { /* web */ }
    })();
    return () => { cancelled = true; handle?.remove?.(); };
  }, [isActive, onExitLeft, exitFullscreen]);

  // ── render: auth gate ────────────────────────────────────────────────
  if (status === 'loading' || status === 'connecting') {
    return <div className="min-h-screen flex items-center justify-center text-white"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>;
  }
  if (status !== 'ready') {
    return <PlexAuthScreen status={status} pinCode={pinCode} error={error} onStartLink={startLink} onRetry={() => { void retryConnect(); }} onSignOut={() => { void signOut(); }} onCancel={() => { cancelLink(); onExitLeft?.(); }} />;
  }

  // ── render: fullscreen ───────────────────────────────────────────────
  if (fullscreen) {
    return (
      <div className={`fixed inset-0 z-[60] text-white ${NATIVE_PLAYBACK ? 'bg-transparent' : 'bg-black'}`}>
        {!NATIVE_PLAYBACK && streamUrl && (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-brand-gold" /></div>}>
            <VideoPlayer src={streamUrl} volume={volume} className="w-full h-full" />
          </Suspense>
        )}
        {NATIVE_PLAYBACK && native.buffering && !native.error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Loader2 className="w-12 h-12 text-brand-gold animate-spin drop-shadow-lg" /></div>
        )}
        {NATIVE_PLAYBACK && native.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-brand-gold mb-3" />
            <p className="font-quicksand font-semibold mb-1">Playback Error</p>
            <p className="text-sm text-brand-ice/80 font-nunito max-w-md mb-4">{native.error.message}</p>
            <button onClick={() => native.retry()} autoFocus className="tv-focusable home-focus-surface flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold focus:outline-none focus:ring-4 focus:ring-brand-gold/60">
              <RotateCw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
          <p className="font-quicksand font-bold text-white truncate">{playing?.title || ''}{useTranscode ? ' · transcoding' : ''}</p>
        </div>
        <div className="absolute bottom-4 right-6 px-3 py-1.5 rounded-full bg-black/60 text-brand-ice/80 font-nunito text-xs pointer-events-none">Back to exit</div>
      </div>
    );
  }

  // ── render: browse ───────────────────────────────────────────────────
  const totalH = rowVirtualizer.getTotalSize();
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-black/30 text-white">
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-black/40 overflow-x-auto whitespace-nowrap">
        <span className="text-xs uppercase tracking-wide text-brand-ice/50 mr-2">Plex · {conn?.name}</span>
        {libraries.length === 0 && <span className="text-brand-ice/60 font-nunito text-sm">No libraries found.</span>}
        {tabs.map((lib, i) => {
          const focused = isActive && zone === 'tabs' && libIdx === i;
          const selected = libIdx === i;
          return (
            <button key={lib.key} data-focused={focused ? 'true' : 'false'}
              onClick={() => { setLibIdx(i); setZone('grid'); }}
              className={`tv-focusable flex-shrink-0 px-4 py-1.5 rounded-lg text-sm font-nunito transition-transform duration-150 ${focused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-105 text-white' : selected ? 'bg-white/10 border border-brand-gold/30 text-white' : 'border border-transparent text-brand-ice'}`}>
              {lib.title}
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4">
        {currentLib?.type === 'request' ? (
          <OverseerrRequestPanel isActive={isActive && zone === 'grid'} onExitToTabs={() => setZone('tabs')} />
        ) : currentLib?.type === 'show' ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-brand-ice/70 font-nunito gap-2">
            <Film className="w-10 h-10 text-brand-gold" />
            <p>Series browsing from Plex is coming in the next update.</p>
          </div>
        ) : itemsLoading && items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/60 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-gold" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/60 font-nunito text-sm">Nothing here yet.</div>
        ) : (
          <div style={{ height: totalH, position: 'relative', width: '100%' }}>
            {rowVirtualizer.getVirtualItems().map((vr) => {
              const start = vr.index * COLS;
              const rowItems = items.slice(start, start + COLS);
              return (
                <div key={vr.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H, transform: `translateY(${vr.start}px)` }} className="grid gap-3" >
                  <div className="grid grid-cols-6 gap-3">
                    {rowItems.map((it, ci) => {
                      const idx = start + ci;
                      const focused = isActive && zone === 'grid' && cursor === idx;
                      const img = conn ? plexImageUrl(conn.base, it.thumb, conn.token) : undefined;
                      return (
                        <div key={it.ratingKey} data-focused={focused ? 'true' : 'false'}
                          onClick={() => { setCursor(idx); void play(it); }}
                          className={`cursor-pointer rounded-lg overflow-hidden transition-transform duration-150 ${focused ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_16px_rgba(245,200,80,0.4)]' : 'ring-1 ring-white/10'}`}>
                          <div className="aspect-[2/3] bg-black/40 flex items-center justify-center">
                            {img ? <img src={img} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Tv className="w-8 h-8 text-brand-ice/40" />}
                          </div>
                          <div className="px-1.5 py-1 text-[11px] font-nunito text-white/90 truncate">{it.title}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-white/10 bg-black/40 px-4 py-1.5 text-[11px] font-nunito text-brand-ice/60">
        ◀ ▶ ▲ ▼ browse · OK to play · Back to exit
      </div>
    </div>
  );
});

PlexSection.displayName = 'PlexSection';
export default PlexSection;
