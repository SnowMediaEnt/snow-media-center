// Plex "Movies & Shows" — auth gate → tabs (Home, Search, libraries, Request,
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
import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Loader2, AlertTriangle, RotateCw, Search as SearchIcon, Home as HomeIcon, Settings as SettingsIcon, Eye, EyeOff } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useToast } from '@/hooks/use-toast';
import { isFireTV } from '@/utils/platform';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { useNativePlayer } from '@/hooks/useNativePlayer';
import { usePlexAuth } from '@/hooks/usePlexAuth';
import {
  getPlexLibraries, getPlexLibraryItems, getPlexPart, getPlexHub, searchPlex,
  plexDirectUrl, plexTranscodeUrl, loadHiddenPlexLibs, saveHiddenPlexLibs,
  getCachedLibrary, setCachedLibrary, isLibraryCacheFresh,
  getCachedHub, setCachedHub,
  resolutionLabel,
  PLEX_QUALITY_PRESETS, loadPlexQuality, savePlexQuality,
  isDirectAudioCodec,
  setPlexImageFocus, preloadImages,
  type PlexLibrary, type PlexItem, type PlexEpisode,
} from '@/lib/plex';
import PlexAuthScreen from './PlexAuthScreen';
import OverseerrRequestPanel from './OverseerrRequestPanel';
import PlexImage from './PlexImage';
import PlexDetail from './PlexDetail';
import PlexPlayerOverlay, { type SubtitleSearchContext } from './PlexPlayerOverlay';
import type { SnowSubtitle } from '@/capacitor/SnowPlayer';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import { loadPlayerVolume, savePlayerVolume } from '@/utils/volume';
import { trackEvent } from '@/lib/analytics';

const VideoPlayer = lazy(() => import('./VideoPlayer'));
const NATIVE_PLAYBACK = hasNativePlayer();

const COLS = 6;
const ROW_H_ESTIMATE = 250;   // pre-measure fallback for the virtualizer
const PAGE_FIRST = 60;
const PAGE_MORE = 200;

type TabType = 'home' | 'search' | 'movie' | 'show' | 'request' | 'manage';
interface Tab { key: string; title: string; type: TabType; libKey?: string; }

interface Props {
  isActive: boolean;
  onExitLeft?: () => void;
  onExitUp?: () => void;
  /** Tear down Plex playback and route to Support → Buffering Guide. */
  onOpenBufferingGuide?: () => void;
  /** Tear down Plex playback and route to Support (no auto-guide). */
  onOpenSupport?: () => void;
}

// ─── RES BADGE (grid / rails) ──────────────────────────────────────────────
const ResChip = memo(({ label }: { label: string }) => {
  if (!label) return null;
  const gold = label === '4K';
  return (
    <span className={`absolute top-1 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/70 ${gold ? 'text-brand-gold' : 'text-white/80'}`}>
      {label}
    </span>
  );
});
ResChip.displayName = 'ResChip';

// ─── HOME PANEL ────────────────────────────────────────────────────────────
interface HomePanelProps {
  isActive: boolean;
  base: string;
  token: string;
  onPlay: (it: PlexItem) => void;
  onExitToTabs: () => void;
}
const HomePanel = memo(({ isActive, base, token, onPlay, onExitToTabs }: HomePanelProps) => {
  const onDeckPath = '/library/onDeck?X-Plex-Container-Start=0&X-Plex-Container-Size=30';
  const recentPath = '/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=30';
  const [onDeck, setOnDeck] = useState<PlexItem[]>(() => getCachedHub(base, onDeckPath) ?? []);
  const [recent, setRecent] = useState<PlexItem[]>(() => getCachedHub(base, recentPath) ?? []);
  const [loading, setLoading] = useState(!(getCachedHub(base, onDeckPath) || getCachedHub(base, recentPath)));
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cachedOd = getCachedHub(base, onDeckPath);
    const cachedRa = getCachedHub(base, recentPath);
    if (cachedOd && cachedRa) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      cachedOd ? Promise.resolve(cachedOd) : getPlexHub(base, token, onDeckPath).catch(() => [] as PlexItem[]),
      cachedRa ? Promise.resolve(cachedRa) : getPlexHub(base, token, recentPath).catch(() => [] as PlexItem[]),
    ]).then(([od, ra]) => {
      if (cancelled) return;
      setOnDeck(od); setCachedHub(base, onDeckPath, od);
      setRecent(ra); setCachedHub(base, recentPath, ra);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [base, token]);

  const rows = useMemo(() => {
    const r: Array<{ title: string; items: PlexItem[] }> = [];
    if (onDeck.length > 0) r.push({ title: 'Continue Watching', items: onDeck.slice(0, 40) });
    r.push({ title: 'Recently Added', items: recent.slice(0, 40) });
    return r;
  }, [onDeck, recent]);

  useEffect(() => { if (row >= rows.length) setRow(Math.max(0, rows.length - 1)); }, [rows.length, row]);

  const rowRef = useRef(row); useEffect(() => { rowRef.current = row; }, [row]);
  const colRef = useRef(col); useEffect(() => { colRef.current = col; }, [col]);
  const rowsRef = useRef(rows); useEffect(() => { rowsRef.current = rows; }, [rows]);
  const onPlayRef = useRef(onPlay); useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  const onExitRef = useRef(onExitToTabs); useEffect(() => { onExitRef.current = onExitToTabs; }, [onExitToTabs]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const keys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const r = rowRef.current, c = colRef.current;
      const currentRow = rowsRef.current[r];
      if (!currentRow) return;
      if (e.key === 'ArrowUp') { if (r === 0) onExitRef.current(); else { setRow(r - 1); setCol(0); } }
      else if (e.key === 'ArrowDown') { if (r < rowsRef.current.length - 1) { setRow(r + 1); setCol(0); } }
      else if (e.key === 'ArrowLeft') { if (c > 0) setCol(c - 1); }
      else if (e.key === 'ArrowRight') { if (c < currentRow.items.length - 1) setCol(c + 1); }
      else if (e.key === 'Enter' || e.key === ' ') { const it = currentRow.items[c]; if (it) onPlayRef.current(it); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive]);

  if (loading) return <div className="h-full flex items-center justify-center text-brand-ice/60"><Loader2 className="w-5 h-5 animate-spin text-brand-gold mr-2" /> Loading…</div>;
  if (rows.length === 0) return <div className="h-full flex items-center justify-center text-brand-ice/60 font-nunito text-sm">Nothing here yet.</div>;

  return (
    <div className="flex flex-col gap-6">
      {rows.map((r, ri) => (
        <div key={r.title}>
          <div className="text-sm font-quicksand font-semibold text-white/90 mb-2">{r.title}</div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {r.items.map((it, ci) => {
              const focused = isActive && ri === row && ci === col;
              const label = resolutionLabel(it.videoResolution);
              return (
                <div key={it.ratingKey}
                  ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
                  onClick={() => { setRow(ri); setCol(ci); onPlay(it); }}
                  className={`relative flex-shrink-0 w-[140px] cursor-pointer rounded-lg overflow-hidden transition-transform duration-150 ${focused ? 'z-10 ring-2 ring-brand-gold scale-105 shadow-[0_0_16px_rgba(245,200,80,0.4)]' : 'ring-1 ring-white/10'}`}>
                  <div className="relative aspect-[2/3]">
                    <PlexImage base={base} path={it.thumb} token={token} w={180} h={270} className="w-full h-full object-cover" />
                    <ResChip label={label} />
                  </div>
                  <div className={`px-1.5 py-1 text-[11px] font-nunito truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>{it.title}</div>
                  {focused && <div className="absolute inset-0 border-[3px] border-brand-gold rounded-lg pointer-events-none" />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});
HomePanel.displayName = 'HomePanel';

// ─── SEARCH PANEL ──────────────────────────────────────────────────────────
interface SearchPanelProps extends HomePanelProps {}
const SearchPanel = memo(({ isActive, base, token, onPlay, onExitToTabs }: SearchPanelProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlexItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [zone, setZone] = useState<'input' | 'grid'>('input');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);

  // Debounced search: 400ms + stale-seq guard so only the latest keystroke wins.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return; }
    const mySeq = ++seqRef.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      try { trackEvent('player_search', 'player', { scope: 'plex', query: q.slice(0, 64) }); } catch { /* ignore */ }
      searchPlex(base, token, q)
        .then((r) => { if (mySeq === seqRef.current) { setResults(r); setCursor(0); } })
        .catch(() => { if (mySeq === seqRef.current) setResults([]); })
        .finally(() => { if (mySeq === seqRef.current) setLoading(false); });
    }, 400);
    return () => { window.clearTimeout(t); };
  }, [query, base, token]);


  useEffect(() => { if (isActive && zone === 'input') inputRef.current?.focus(); }, [isActive, zone]);

  const zoneRef = useRef(zone); useEffect(() => { zoneRef.current = zone; }, [zone]);
  const cursorRef = useRef(cursor); useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const resultsRef = useRef(results); useEffect(() => { resultsRef.current = results; }, [results]);
  const onPlayRef = useRef(onPlay); useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  const onExitRef = useRef(onExitToTabs); useEffect(() => { onExitRef.current = onExitToTabs; }, [onExitToTabs]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (zoneRef.current === 'input') {
        if (inInput && e.key === 'ArrowDown') {
          if (resultsRef.current.length > 0) { e.preventDefault(); e.stopPropagation(); inputRef.current?.blur(); setZone('grid'); setCursor(0); }
        } else if (inInput && e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); inputRef.current?.blur(); onExitRef.current();
        }
        return;
      }
      if (inInput) return;
      const keys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const total = resultsRef.current.length;
      const cur = cursorRef.current;
      if (e.key === 'ArrowUp') { if (cur < COLS) { setZone('input'); setTimeout(() => inputRef.current?.focus(), 0); } else setCursor(cur - COLS); }
      else if (e.key === 'ArrowDown') { if (cur + COLS < total) setCursor(cur + COLS); }
      else if (e.key === 'ArrowLeft') { if (cur % COLS !== 0) setCursor(cur - 1); }
      else if (e.key === 'ArrowRight') { if ((cur % COLS) < COLS - 1 && cur + 1 < total) setCursor(cur + 1); }
      else if (e.key === 'Enter' || e.key === ' ') { const it = resultsRef.current[cur]; if (it) onPlayRef.current(it); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive]);

  const rows = Math.ceil(results.length / COLS);
  return (
    <div className="flex flex-col gap-4">
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 border ${isActive && zone === 'input' ? 'border-brand-gold' : 'border-white/10'}`}>
        <SearchIcon className="w-4 h-4 text-brand-ice/60" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setZone('input')}
          placeholder="Search movies & shows…"
          className="flex-1 bg-transparent outline-none text-white font-nunito text-sm placeholder:text-brand-ice/40"
        />
        {loading && <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />}
      </div>
      {results.length === 0 ? (
        <div className="text-brand-ice/50 font-nunito text-sm text-center py-6">{query.trim() ? (loading ? 'Searching…' : 'No results.') : 'Type to search Plex.'}</div>
      ) : (
        <div className="grid grid-cols-6 gap-3">
          {Array.from({ length: rows * COLS }).map((_, idx) => {
            const it = results[idx];
            if (!it) return <div key={idx} />;
            const focused = isActive && zone === 'grid' && cursor === idx;
            const label = resolutionLabel(it.videoResolution);
            return (
              <div key={it.ratingKey}
                ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
                onClick={() => { setZone('grid'); setCursor(idx); onPlay(it); }}
                className={`relative cursor-pointer rounded-lg overflow-hidden transition-transform duration-150 ${focused ? 'z-10 ring-2 ring-brand-gold scale-105 shadow-[0_0_16px_rgba(245,200,80,0.4)]' : 'ring-1 ring-white/10'}`}>
                <div className="relative aspect-[2/3]">
                  <PlexImage base={base} path={it.thumb} token={token} w={180} h={270} className="w-full h-full object-cover" />
                  <ResChip label={label} />
                </div>
                <div className={`px-1.5 py-1 text-[11px] font-nunito truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>{it.title}</div>
                {focused && <div className="absolute inset-0 border-[3px] border-brand-gold rounded-lg pointer-events-none" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
SearchPanel.displayName = 'SearchPanel';

// ─── MANAGE PANEL ──────────────────────────────────────────────────────────
interface ManagePanelProps {
  isActive: boolean;
  libraries: PlexLibrary[];
  hidden: string[];
  onToggle: (key: string) => void;
  onExitToTabs: () => void;
}
const ManagePanel = memo(({ isActive, libraries, hidden, onToggle, onExitToTabs }: ManagePanelProps) => {
  const [cursor, setCursor] = useState(0);
  const cursorRef = useRef(cursor); useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const libsRef = useRef(libraries); useEffect(() => { libsRef.current = libraries; }, [libraries]);
  const onToggleRef = useRef(onToggle); useEffect(() => { onToggleRef.current = onToggle; }, [onToggle]);
  const onExitRef = useRef(onExitToTabs); useEffect(() => { onExitRef.current = onExitToTabs; }, [onExitToTabs]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const keys = ['ArrowUp','ArrowDown','Enter',' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const c = cursorRef.current;
      if (e.key === 'ArrowUp') { if (c === 0) onExitRef.current(); else setCursor(c - 1); }
      else if (e.key === 'ArrowDown') { if (c < libsRef.current.length - 1) setCursor(c + 1); }
      else if (e.key === 'Enter' || e.key === ' ') { const lib = libsRef.current[c]; if (lib) onToggleRef.current(lib.key); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive]);

  if (libraries.length === 0) return <div className="text-brand-ice/60 font-nunito text-sm">No libraries found.</div>;
  return (
    <div className="max-w-xl mx-auto flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wide text-brand-ice/50 mb-1">Show / hide libraries</div>
      {libraries.map((lib, i) => {
        const focused = isActive && cursor === i;
        const isHidden = hidden.indexOf(lib.key) >= 0;
        return (
          <div key={lib.key}
            ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest' }); }}
            onClick={() => { setCursor(i); onToggle(lib.key); }}
            className={`flex items-center justify-between px-4 py-3 rounded-lg cursor-pointer transition-transform duration-150 ${focused ? 'bg-brand-gold/20 ring-2 ring-brand-gold scale-[1.02]' : 'bg-black/40 ring-1 ring-white/10'}`}>
            <div>
              <div className="font-quicksand text-white">{lib.title}</div>
              <div className="text-[11px] font-nunito text-brand-ice/50 uppercase">{lib.type}</div>
            </div>
            {isHidden
              ? <span className="flex items-center gap-1.5 text-xs text-brand-ice/60"><EyeOff className="w-4 h-4" /> Hidden</span>
              : <span className="flex items-center gap-1.5 text-xs text-brand-gold"><Eye className="w-4 h-4" /> Visible</span>}
          </div>
        );
      })}
    </div>
  );
});
ManagePanel.displayName = 'ManagePanel';

// ─── MAIN ──────────────────────────────────────────────────────────────────
const PlexSection = memo(({ isActive, onExitLeft, onExitUp, onOpenBufferingGuide, onOpenSupport }: Props) => {
  const { toast } = useToast();
  const { status, conn, pinCode, error, startLink, cancelLink, signOut, retryConnect } = usePlexAuth();

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

  const [libraries, setLibraries] = useState<PlexLibrary[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [libIdx, setLibIdx] = useState(0);
  const [items, setItems] = useState<PlexItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [zone, setZone] = useState<'tabs' | 'grid'>('tabs');
  const [cursor, setCursor] = useState(0);

  const [volume, setVolume] = useState<number>(() => loadPlayerVolume());
  const changeVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolume(clamped);
    savePlayerVolume(clamped);
    // Live-apply to the native player when playback is active.
    try { void SnowPlayer.setVolume({ volume: clamped }).catch(() => { /* ignore */ }); } catch { /* ignore */ }
  }, []);
  const [detailItem, setDetailItem] = useState<PlexItem | null>(null);
  const [playing, setPlaying] = useState<PlexItem | null>(null);
  const [playingTitle, setPlayingTitle] = useState('');
  const [playingResLabel, setPlayingResLabel] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [useTranscode, setUseTranscode] = useState(false);
  const [startPos, setStartPos] = useState<number | undefined>(undefined);
  const [tracksTick, setTracksTick] = useState(0);
  const [subCtx, setSubCtx] = useState<SubtitleSearchContext | undefined>(undefined);
  const [extraSubs, setExtraSubs] = useState<SnowSubtitle[] | undefined>(undefined);
  const [qualityKey, setQualityKey] = useState<string>('original');
  useEffect(() => { void loadPlexQuality().then(setQualityKey); }, []);

  // Image focus mode: while a detail page is open, non-priority images (grid,
  // rails, search results) park their loads so the detail poster/backdrop/
  // cast/filmography own image bandwidth.
  useEffect(() => {
    setPlexImageFocus(!!detailItem);
    return () => { setPlexImageFocus(false); };
  }, [detailItem]);

  // Post-connect warm-up: preload the first screen (Home rails + first ~12
  // poster URLs + library list) before revealing the tabs+grid UI. Runs ONCE
  // per connect. Deep-links skip warm-up (they route straight to detail).
  const [warmedUp, setWarmedUp] = useState(false);
  const warmedRef = useRef(false);
  useEffect(() => {
    if (status !== 'ready' || !conn) return;
    if (warmedRef.current) return;
    warmedRef.current = true;
    if (deeplinkRef.current) { setWarmedUp(true); return; }
    let cancelled = false;
    const base = conn.base;
    const token = conn.token;
    const onDeckPath = '/library/onDeck?X-Plex-Container-Start=0&X-Plex-Container-Size=30';
    const recentPath = '/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=30';
    (async () => {
      try {
        const [libs, od, ra] = await Promise.all([
          getPlexLibraries(base, token).catch(() => [] as PlexLibrary[]),
          (getCachedHub(base, onDeckPath) ? Promise.resolve(getCachedHub(base, onDeckPath) as PlexItem[]) : getPlexHub(base, token, onDeckPath).catch(() => [] as PlexItem[])),
          (getCachedHub(base, recentPath) ? Promise.resolve(getCachedHub(base, recentPath) as PlexItem[]) : getPlexHub(base, token, recentPath).catch(() => [] as PlexItem[])),
        ]);
        if (cancelled) return;
        setCachedHub(base, onDeckPath, od);
        setCachedHub(base, recentPath, ra);
        setLibraries(libs);
        // First ~12 rail poster URLs — https only; http URLs go through the
        // data-URI path and shouldn't block warm-up.
        const posters: string[] = [];
        const httpsBase = /^https:\/\//i.test(base);
        if (httpsBase) {
          const feed: PlexItem[] = [];
          for (const it of od) feed.push(it);
          for (const it of ra) feed.push(it);
          for (const it of feed) {
            if (posters.length >= 12) break;
            if (it.thumb) posters.push(`${base}${it.thumb}?X-Plex-Token=${encodeURIComponent(token)}`);
          }
        }
        await preloadImages(posters, 8000);
      } finally {
        if (!cancelled) setWarmedUp(true);
      }
    })();
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


  // Load libraries when connected.
  useEffect(() => {
    if (status !== 'ready' || !conn) return;
    let cancelled = false;
    getPlexLibraries(conn.base, conn.token)
      .then((libs) => { if (!cancelled) setLibraries(libs); })
      .catch(() => { if (!cancelled) setLibraries([]); });
    return () => { cancelled = true; };
  }, [status, conn]);

  const visibleLibraries = useMemo(
    () => libraries.filter((l) => hidden.indexOf(l.key) < 0),
    [libraries, hidden],
  );

  const tabs = useMemo<Tab[]>(() => {
    const t: Tab[] = [
      { key: '__home', title: 'Home', type: 'home' },
      { key: '__search', title: 'Search', type: 'search' },
    ];
    for (const l of visibleLibraries) {
      t.push({ key: l.key, title: l.title, type: (l.type === 'show' ? 'show' : 'movie'), libKey: l.key });
    }
    t.push({ key: '__request', title: 'Request', type: 'request' });
    t.push({ key: '__manage', title: 'Manage', type: 'manage' });
    return t;
  }, [visibleLibraries]);

  const currentTab = tabs[libIdx];
  const homeIdx = 0;

  useEffect(() => { if (libIdx >= tabs.length) setLibIdx(tabs.length - 1); }, [tabs.length, libIdx]);

  // ── Deep-link: ONE effect that opens the detail overlay directly. Works
  //    even when the target library is hidden/reordered or hasn't loaded.
  useEffect(() => {
    const dl = deeplinkRef.current;
    if (!dl || status !== 'ready' || !conn) return;
    deeplinkRef.current = null;

    const kind = dl.kind;
    const type = kind === 'episode' || kind === 'show' ? kind : 'movie';

    const openDetail = (payload: PlexItem) => setDetailItem(payload);

    if (dl.machineIdentifier && conn.clientIdentifier && dl.machineIdentifier !== conn.clientIdentifier) {
      const title = dl.title || '';
      if (!title) { toast({ title: 'This title lives on a different Plex server' }); return; }
      searchPlex(conn.base, conn.token, title)
        .then((results) => {
          const norm = (s: string) => s.trim().toLowerCase();
          const match = results.find((r) => norm(r.title) === norm(title)) || results[0];
          if (match) openDetail(match);
          else toast({ title: 'This title lives on a different Plex server' });
        })
        .catch(() => toast({ title: 'This title lives on a different Plex server' }));
      return;
    }

    openDetail({ ratingKey: String(dl.ratingKey), title: dl.title ?? '', type });
  }, [status, conn, toast]);

  // ── Library items loader — paged, cached, sequence-guarded, and only
  //    fires when the user enters the grid or dwells 400ms on the tab.
  const seqRef = useRef(0);
  useEffect(() => {
    if (!conn || !currentTab || (currentTab.type !== 'movie' && currentTab.type !== 'show') || !currentTab.libKey) {
      setItems([]); setItemsLoading(false); setCursor(0);
      return;
    }
    const libKey = currentTab.libKey;
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
  //    focus rings can't get occluded by an under-estimated row height.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [rowH, setRowH] = useState<number>(ROW_H_ESTIMATE);
  const rowHRef = useRef(rowH); useEffect(() => { rowHRef.current = rowH; }, [rowH]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const calc = () => {
      const cs = getComputedStyle(el);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const gap = 12; // gap-3
      const inner = Math.max(0, el.clientWidth - padL - padR);
      const colW = (inner - gap * (COLS - 1)) / COLS;
      const posterH = colW * 1.5; // aspect 2/3
      const titleArea = 34;       // px 1.5 py 1 * text-[11px]
      const rowGap = 12;
      const next = Math.max(200, Math.ceil(posterH + titleArea + rowGap));
      setRowH((prev) => (prev !== next ? next : prev));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = Math.ceil(items.length / COLS);
  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHRef.current,
    overscan: isFireTV() ? 1 : 3,
  });
  useEffect(() => { rowVirtualizer.measure(); /* eslint-disable-next-line */ }, [rowH]);

  useEffect(() => {
    if (zone !== 'grid') return;
    const row = Math.floor(cursor / COLS);
    rowVirtualizer.scrollToIndex(row, { align: 'auto' });
  }, [cursor, zone, rowVirtualizer]);

  // ── Playback ────────────────────────────────────────────────────────
  // Hoisted so openDetail can write to it synchronously (see comment below).
  const detailRef = useRef(detailItem);
  const openDetail = useCallback((item: PlexItem) => {
    // Set the ref SYNCHRONOUSLY (before the React state update) so the main
    // keydown effect below can short-circuit on the very next event — otherwise
    // a fast D-pad press right after OK would race the post-render effect that
    // syncs detailRef and get handled by the grid twice.
    detailRef.current = item;
    setDetailItem(item);
  }, []);

  const playRatingKey = useCallback(async (ratingKey: string, title: string, resumeSec?: number, ctx?: SubtitleSearchContext, resLabel?: string) => {
    if (!conn) return;
    const preset = PLEX_QUALITY_PRESETS.find((p) => p.key === qualityKey);
    const wantTranscode = !!(preset && preset.key !== 'original' && (preset.maxVideoBitrateKbps || preset.videoResolution));
    // Flip fullscreen ON *before* any await so the loading UI paints
    // immediately — otherwise the user stares at the grid for the ~1-3s
    // getPlexPart round-trip and mashes OK, queueing up phantom presses.
    setUseTranscode(wantTranscode);
    setPlaying({ ratingKey, title, type: 'movie', thumb: '' });
    setPlayingTitle(title);
    setPlayingResLabel(resLabel ?? '');
    setStartPos(resumeSec && resumeSec > 0 ? resumeSec : undefined);
    setSubCtx(ctx ?? { title });
    setExtraSubs(undefined);
    setStreamUrl(null);
    setFullscreen(true);
    if (wantTranscode && preset) {
      setStreamUrl(plexTranscodeUrl(conn.base, ratingKey, conn.token, {
        maxVideoBitrateKbps: preset.maxVideoBitrateKbps,
        videoResolution: preset.videoResolution,
      }));
      return;
    }
    try {
      const { partKey, audioCodec } = await getPlexPart(conn.base, conn.token, ratingKey);
      // Pre-emptive transcode: ExoPlayer silently deselects unsupported audio
      // codecs (ac3/eac3/dts/truehd/…) and plays the file with zero audio and
      // no error. When we see one, ask Plex to transcode audio→AAC while still
      // direct-streaming video (no bitrate/resolution clamp).
      if (!isDirectAudioCodec(audioCodec)) {
        setUseTranscode(true);
        setStreamUrl(plexTranscodeUrl(conn.base, ratingKey, conn.token));
        return;
      }
      const url = partKey ? plexDirectUrl(conn.base, partKey, conn.token) : plexTranscodeUrl(conn.base, ratingKey, conn.token);
      setStreamUrl(url);
    } catch {
      setStreamUrl(plexTranscodeUrl(conn.base, ratingKey, conn.token));
      setUseTranscode(true);
    }
  }, [conn, qualityKey]);


  const playFromDetail = useCallback((it: PlexItem, resumeSec?: number, ctx?: SubtitleSearchContext) => {
    try { trackEvent('plex_play', 'player', { title: it.title, type: it.type ?? 'movie' }); } catch { /* ignore */ }
    void playRatingKey(it.ratingKey, it.title, resumeSec, ctx, resolutionLabel(it.videoResolution));
  }, [playRatingKey]);
  const playEpisode = useCallback((ep: PlexEpisode, ctx?: SubtitleSearchContext) => {
    try { trackEvent('plex_play', 'player', { title: ep.title, type: 'episode' }); } catch { /* ignore */ }
    void playRatingKey(ep.ratingKey, ep.title, undefined, ctx, '');
  }, [playRatingKey]);

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
        const { partKey, audioCodec } = await getPlexPart(conn.base, conn.token, playing.ratingKey);
        if (!isDirectAudioCodec(audioCodec)) {
          url = plexTranscodeUrl(conn.base, playing.ratingKey, conn.token);
          setUseTranscode(true);
        } else {
          url = partKey
            ? plexDirectUrl(conn.base, partKey, conn.token)
            : plexTranscodeUrl(conn.base, playing.ratingKey, conn.token);
        }
      } catch {
        url = plexTranscodeUrl(conn.base, playing.ratingKey, conn.token);
        setUseTranscode(true);
      }
      setStreamUrl(() => { window.setTimeout(() => setStreamUrl(url), 60); return null; });
    })();
  }, [conn, playing]);


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
  const native = useNativePlayer({
    active: nativeActive,
    url: nativeActive ? streamUrl : null,
    volume,
    live: false,
    startPosition: startPos,
    subtitles: extraSubs,
    onTracksChanged,
    onPlayStateChange: onPlayStateChangeCb,
    onEnded: () => { setFullscreen(false); setStreamUrl(null); setUseTranscode(false); },
  });
  // Reset the safety-net guard whenever the underlying title changes.
  useEffect(() => { audioSafetyRef.current = null; }, [playing?.ratingKey]);

  useEffect(() => {
    if (!nativeActive) return;
    document.documentElement.classList.add('snowplayer-fullscreen');
    return () => { document.documentElement.classList.remove('snowplayer-fullscreen'); };
  }, [nativeActive]);

  // Auto-fallback to Plex-side transcode when native playback errors — most
  // notably AUDIO_DECODE from the Media3 plugin (Fire TV rejected the direct
  // codec / offload path). Preserves the current playhead so switching feels
  // like a hiccup, not a restart.
  useEffect(() => {
    if (!(nativeActive && native.error && !useTranscode && playing && conn)) return;
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

  // Slow-load watchdog: if the native player hasn't emitted 'ready' within
  // 8s of the fullscreen flipping on, expose a Retry button so the user can
  // kick the pipeline instead of staring at a stalled spinner.
  const [slowLoad, setSlowLoad] = useState(false);
  setSlowLoadRef.current = setSlowLoad;
  useEffect(() => {
    clearSlowLoadTimer();
    if (!fullscreen) { stillLoadingRef.current = false; setSlowLoad(false); return; }
    stillLoadingRef.current = true;
    setSlowLoad(false);
    slowLoadTimerRef.current = window.setTimeout(() => {
      if (stillLoadingRef.current) setSlowLoad(true);
      slowLoadTimerRef.current = null;
    }, 8000) as unknown as number;
    return () => { clearSlowLoadTimer(); };
  }, [fullscreen, streamUrl, clearSlowLoadTimer]);
  useEffect(() => {
    if (nativeActive && !native.buffering && !native.error) {
      stillLoadingRef.current = false;
      clearSlowLoadTimer();
      setSlowLoad(false);
    }
  }, [nativeActive, native.buffering, native.error, clearSlowLoadTimer]);

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

  const exitFullscreen = useCallback(() => { setFullscreen(false); setStreamUrl(null); setUseTranscode(false); }, []);

  const toggleHidden = useCallback((key: string) => {
    setHidden((prev) => {
      const has = prev.indexOf(key) >= 0;
      const next = has ? prev.filter((k) => k !== key) : [...prev, key];
      void saveHiddenPlexLibs(next);
      return next;
    });
  }, []);

  // ── refs for keyboard ───────────────────────────────────────────────
  const cursorRef = useRef(cursor);
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

  const goHome = useCallback(() => { setLibIdx(homeIdx); setZone('tabs'); }, []);

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
    if (fullscreen && !streamUrl) {
      const backOnly = (e: KeyboardEvent) => {
        const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
        if (!isBack) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        setFullscreen(false); setStreamUrl(null); setUseTranscode(false);
      };
      window.addEventListener('keydown', backOnly, true);
      return () => window.removeEventListener('keydown', backOnly, true);
    }
    if (detailItem || fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;

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
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (libIdxRef.current !== homeIdx) goHome();
        else onExitLeft?.();
        return;
      }

      const t = tabsRef.current[libIdxRef.current];
      if (zoneRef.current === 'grid' && t && (t.type === 'home' || t.type === 'search' || t.type === 'request' || t.type === 'manage')) return;

      if (inInput) return;

      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();

      if (zoneRef.current === 'tabs') {
        const n = tabsRef.current.length;
        if (e.key === 'ArrowLeft') { if (libIdxRef.current > 0) setLibIdx((i) => Math.max(0, i - 1)); }
        else if (e.key === 'ArrowRight') setLibIdx((i) => Math.min(n - 1, i + 1));
        else if (e.key === 'ArrowUp') { /* never leave Plex via arrows */ }
        else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') setZone('grid');
        return;
      }

      // grid zone (movie/show libraries)
      const total = itemsRef.current.length;
      const cur = cursorRef.current;
      if (e.key === 'ArrowUp') { if (cur < COLS) setZone('tabs'); else setCursor(cur - COLS); }
      else if (e.key === 'ArrowDown') { if (cur + COLS < total) setCursor(cur + COLS); }
      else if (e.key === 'ArrowLeft') { if (cur % COLS !== 0) setCursor(cur - 1); }
      else if (e.key === 'ArrowRight') { if ((cur % COLS) < COLS - 1 && cur + 1 < total) setCursor(cur + 1); }
      else if (e.key === 'Enter' || e.key === ' ') { const it = itemsRef.current[cur]; if (it) openDetail(it); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // NOTE: PlexSection intentionally does NOT register its own
    // CapApp.backButton listener. The Player (LiveTV.tsx) already converts
    // hardware Back into a synthetic Escape KeyboardEvent, which flows through
    // this exact capture chain. Registering our own listener caused double-
    // fires (each listener popped one level, exiting Plex on the first press).
  }, [isActive, status, onExitLeft, onExitUp, openDetail, goHome, cancelLink, detailItem, fullscreen, streamUrl]);

  // ── render: auth gate ───────────────────────────────────────────────
  if (status === 'loading' || status === 'connecting') {
    return <div className="min-h-screen flex items-center justify-center text-white"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>;
  }
  if (status !== 'ready') {
    return <PlexAuthScreen status={status} pinCode={pinCode} error={error} onStartLink={startLink} onRetry={() => { void retryConnect(); }} onSignOut={() => { void signOut(); }} onCancel={() => { cancelLink(); onExitLeft?.(); }} />;
  }

  // ── render: warm-up ─────────────────────────────────────────────────
  // Delay revealing the tabs+grid until Home rails + first ~12 posters have
  // loaded (or 8s cap). Back during warm-up still exits Plex via the keydown
  // effect above (status==='ready', no detail/fullscreen).
  if (!warmedUp && !fullscreen && !detailItem) {
    return (
      <div className="min-h-screen flex-1 flex flex-col items-center justify-center gap-4 bg-black/40 text-white">
        <Loader2 className="w-12 h-12 animate-spin text-brand-gold" />
        <p className="font-quicksand font-semibold text-brand-ice">Loading your library…</p>
        <p className="text-xs font-nunito text-brand-ice/50">Plex · {conn?.name}</p>
      </div>
    );
  }

  // ── render: fullscreen ──────────────────────────────────────────────
  if (fullscreen) {
    return (
      <div className={`fixed inset-0 z-[60] text-white ${NATIVE_PLAYBACK ? 'bg-transparent' : 'bg-black'}`}>
        {!NATIVE_PLAYBACK && streamUrl && (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-brand-gold" /></div>}>
            <VideoPlayer src={streamUrl} volume={volume} className="w-full h-full" />
          </Suspense>
        )}
        {NATIVE_PLAYBACK && !native.error && !slowLoad && (!streamUrl || !nativeActive || native.buffering) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Loader2 className="w-12 h-12 text-brand-gold animate-spin drop-shadow-lg" /></div>
        )}
        {NATIVE_PLAYBACK && !native.error && slowLoad && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center">
            <Loader2 className="w-10 h-10 text-brand-gold animate-spin mb-3" />
            <p className="font-quicksand font-semibold mb-1">Still preparing…</p>
            <p className="text-sm text-brand-ice/70 font-nunito mb-4">Your Plex server is slow to respond.</p>
            <button onClick={() => {
              setSlowLoad(false);
              stillLoadingRef.current = true;
              if (!streamUrl && playing) {
                // No stream URL resolved yet — native.retry() would be a no-op.
                // Re-invoke the current item's play path from scratch.
                void playRatingKey(playing.ratingKey, playing.title, startPos, subCtx, playingResLabel);
              } else {
                native.retry();
              }
            }} autoFocus className="tv-focusable home-focus-surface flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold focus:outline-none focus:ring-4 focus:ring-brand-gold/60">
              <RotateCw className="w-4 h-4" /> Retry
            </button>
          </div>
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
          <p className="font-quicksand font-bold text-white truncate">
            {playingTitle}{useTranscode ? ' · transcoding' : ''}
            {playingResLabel && (
              <span className={`ml-2 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/70 ${playingResLabel === '4K' ? 'text-brand-gold' : 'text-white/80'}`}>{playingResLabel}</span>
            )}
          </p>
        </div>
        {NATIVE_PLAYBACK && !native.error && (
          <PlexPlayerOverlay
            active={nativeActive}
            title={playingTitle}
            resolutionLabel={playingResLabel}
            controller={native.controller}
            tracksTick={tracksTick}
            getPosition={native.getPosition}
            seekTo={native.seekTo}
            onBackWhileHidden={exitFullscreen}
            subtitleContext={subCtx}
            onLoadExternalSubtitle={handleLoadExternalSubtitle}
            qualityKey={qualityKey}
            onChangeQuality={changeQuality}
            onOpenBufferingGuide={onOpenBufferingGuide ? () => {
              // Stash movie context so Support can hand it back to Plex on close.
              try {
                const p = playing;
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
              exitFullscreen();
              onOpenBufferingGuide();
            } : undefined}
            onOpenSupport={onOpenSupport ? () => {
              // Same deep-link stash as the buffering-guide path so Support can
              // hand the user back to their movie when they're done.
              try {
                const p = playing;
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
              exitFullscreen();
              onOpenSupport();
            } : undefined}
            volume={volume}
            onChangeVolume={changeVolume}
          />
        )}

      </div>
    );
  }


  // ── render: browse ─────────────────────────────────────────────────
  const totalH = rowVirtualizer.getTotalSize();
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-black/30 text-white">
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-black/40 overflow-x-auto whitespace-nowrap">
        <span className="text-xs uppercase tracking-wide text-brand-ice/50 mr-2">Plex · {conn?.name}</span>
        {tabs.map((tab, i) => {
          const focused = isActive && zone === 'tabs' && libIdx === i;
          const selected = libIdx === i;
          const Icon = tab.type === 'home' ? HomeIcon : tab.type === 'search' ? SearchIcon : tab.type === 'manage' ? SettingsIcon : null;
          return (
            <button key={tab.key}
              ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
              data-focused={focused ? 'true' : 'false'}
              onClick={() => { setLibIdx(i); setZone('grid'); }}
              className={`tv-focusable flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-nunito transition-transform duration-150 ${focused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-105 text-white' : selected ? 'bg-white/10 border border-brand-gold/30 text-white' : 'border border-transparent text-brand-ice'}`}>
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {tab.title}
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4">
        {currentTab?.type === 'home' && conn ? (
          <HomePanel isActive={isActive && zone === 'grid'} base={conn.base} token={conn.token} onPlay={openDetail} onExitToTabs={() => setZone('tabs')} />
        ) : currentTab?.type === 'search' && conn ? (
          <SearchPanel isActive={isActive && zone === 'grid'} base={conn.base} token={conn.token} onPlay={openDetail} onExitToTabs={() => setZone('tabs')} />

        ) : currentTab?.type === 'request' ? (
          <OverseerrRequestPanel isActive={isActive && zone === 'grid'} onExitToTabs={() => setZone('tabs')} />
        ) : currentTab?.type === 'manage' ? (
          <ManagePanel isActive={isActive && zone === 'grid'} libraries={libraries} hidden={hidden} onToggle={toggleHidden} onExitToTabs={() => setZone('tabs')} />
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
                <div key={vr.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: rowH, transform: `translateY(${vr.start}px)` }} className="grid gap-3">
                  <div className="grid grid-cols-6 gap-3">
                    {rowItems.map((it, ci) => {
                      const idx = start + ci;
                      const focused = isActive && zone === 'grid' && cursor === idx;
                      const label = resolutionLabel(it.videoResolution);
                      return (
                        <div key={it.ratingKey} data-focused={focused ? 'true' : 'false'}
                          onClick={() => { setCursor(idx); openDetail(it); }}
                          className={`relative cursor-pointer rounded-lg overflow-hidden transition-transform duration-150 ${focused ? 'z-10 ring-2 ring-brand-gold scale-105 shadow-[0_0_16px_rgba(245,200,80,0.4)]' : 'ring-1 ring-white/10'}`}>
                          <div className="relative aspect-[2/3]">
                            {conn && <PlexImage base={conn.base} path={it.thumb} token={conn.token} w={180} h={270} className="w-full h-full object-cover" />}
                            <ResChip label={label} />
                          </div>
                          <div className={`px-1.5 py-1 text-[11px] font-nunito truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>{it.title}</div>
                          {focused && <div className="absolute inset-0 border-[3px] border-brand-gold rounded-lg pointer-events-none" />}
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
        ◀ ▶ ▲ ▼ browse · OK for details · Back for Home / exit
      </div>

      {detailItem && conn && (
        <PlexDetail
          isActive={isActive}
          base={conn.base}
          token={conn.token}
          item={detailItem}
          onPlay={playFromDetail}
          onPlayEpisode={playEpisode}
          onBack={() => setDetailItem(null)}
        />
      )}
    </div>
  );
});


PlexSection.displayName = 'PlexSection';
export default PlexSection;
