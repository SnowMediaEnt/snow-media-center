// Plex "Movies & Shows" — auth gate → tabs (Home, Search, libraries, Request,
// Manage) → poster grid → native play. Fire-TV D-pad only.
import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
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
  type PlexLibrary, type PlexItem,
} from '@/lib/plex';
import PlexAuthScreen from './PlexAuthScreen';
import OverseerrRequestPanel from './OverseerrRequestPanel';
import PlexImage from './PlexImage';

const VideoPlayer = lazy(() => import('./VideoPlayer'));
const NATIVE_PLAYBACK = hasNativePlayer();

const COLS = 6;
const ROW_H = 250;

type TabType = 'home' | 'search' | 'movie' | 'show' | 'request' | 'manage';
interface Tab { key: string; title: string; type: TabType; libKey?: string; }

interface Props {
  isActive: boolean;
  onExitLeft?: () => void;
  onExitUp?: () => void;
}

// ─── HOME PANEL ────────────────────────────────────────────────────────────
interface HomePanelProps {
  isActive: boolean;
  base: string;
  token: string;
  onPlay: (it: PlexItem) => void;
  onExitToTabs: () => void;
}
const HomePanel = memo(({ isActive, base, token, onPlay, onExitToTabs }: HomePanelProps) => {
  const [onDeck, setOnDeck] = useState<PlexItem[]>([]);
  const [recent, setRecent] = useState<PlexItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getPlexHub(base, token, '/library/onDeck').catch(() => [] as PlexItem[]),
      getPlexHub(base, token, '/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=30').catch(() => [] as PlexItem[]),
    ]).then(([od, ra]) => {
      if (cancelled) return;
      setOnDeck(od);
      setRecent(ra);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [base, token]);

  const rows = useMemo(() => {
    const r: Array<{ title: string; items: PlexItem[] }> = [];
    if (onDeck.length > 0) r.push({ title: 'Continue Watching', items: onDeck });
    r.push({ title: 'Recently Added', items: recent });
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
              return (
                <div key={it.ratingKey}
                  ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
                  onClick={() => { setRow(ri); setCol(ci); onPlay(it); }}
                  className={`flex-shrink-0 w-[140px] cursor-pointer rounded-lg overflow-hidden transition-transform duration-150 ${focused ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_16px_rgba(245,200,80,0.4)]' : 'ring-1 ring-white/10'}`}>
                  <div className="aspect-[2/3]">
                    <PlexImage base={base} path={it.thumb} token={token} w={240} h={360} className="w-full h-full object-cover" />
                  </div>
                  <div className="px-1.5 py-1 text-[11px] font-nunito text-white/90 truncate">{it.title}</div>
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

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchPlex(base, token, query.trim())
        .then((r) => { if (!cancelled) { setResults(r); setCursor(0); } })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(t); };
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
      // In input zone, only intercept ArrowDown/ArrowUp; allow all typing.
      if (zoneRef.current === 'input') {
        if (inInput && e.key === 'ArrowDown') {
          if (resultsRef.current.length > 0) { e.preventDefault(); e.stopPropagation(); inputRef.current?.blur(); setZone('grid'); setCursor(0); }
        } else if (inInput && e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); inputRef.current?.blur(); onExitRef.current();
        }
        return;
      }
      // grid zone
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
            return (
              <div key={it.ratingKey}
                ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
                onClick={() => { setZone('grid'); setCursor(idx); onPlay(it); }}
                className={`cursor-pointer rounded-lg overflow-hidden transition-transform duration-150 ${focused ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_16px_rgba(245,200,80,0.4)]' : 'ring-1 ring-white/10'}`}>
                <div className="aspect-[2/3]">
                  <PlexImage base={base} path={it.thumb} token={token} w={240} h={360} className="w-full h-full object-cover" />
                </div>
                <div className="px-1.5 py-1 text-[11px] font-nunito text-white/90 truncate">{it.title}</div>
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
  const [hidden, setHidden] = useState<string[]>([]);
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

  useEffect(() => { void loadHiddenPlexLibs().then(setHidden); }, []);

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

  // Clamp libIdx if tabs shrink.
  useEffect(() => { if (libIdx >= tabs.length) setLibIdx(tabs.length - 1); }, [tabs.length, libIdx]);

  // Deep-link step 1: pick the target library tab once libraries are known.
  useEffect(() => {
    const dl = deeplinkRef.current;
    if (!dl || status !== 'ready' || !conn || tabs.length === 0) return;
    let idx = tabs.findIndex((t) => (t.type === 'movie' || t.type === 'show') && String(t.libKey) === String(dl.librarySectionID ?? ''));
    if (idx < 0) idx = tabs.findIndex((t) => t.type === 'movie');
    if (idx < 0) return;
    setLibIdx(idx);
  }, [status, conn, tabs]);

  // Load items for the selected library tab (movie or show).
  useEffect(() => {
    if (!conn || !currentTab || (currentTab.type !== 'movie' && currentTab.type !== 'show') || !currentTab.libKey) { setItems([]); return; }
    let cancelled = false;
    setItemsLoading(true);
    setCursor(0);
    getPlexLibraryItems(conn.base, conn.token, currentTab.libKey)
      .then((list) => { if (!cancelled) setItems(list); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setItemsLoading(false); });
    return () => { cancelled = true; };
  }, [conn, currentTab]);

  // Deep-link step 2: focus the exact title.
  useEffect(() => {
    const dl = deeplinkRef.current;
    if (!dl || items.length === 0) return;
    deeplinkRef.current = null;
    const idx = items.findIndex((it) => String(it.ratingKey) === String(dl.ratingKey));
    if (idx >= 0) { setCursor(idx); setZone('grid'); }
    else toast({ title: 'Not found', description: `Couldn't find "${dl.title ?? 'that title'}" in this library.` });
  }, [items, toast]);

  const rows = Math.ceil(items.length / COLS);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: isFireTV() ? 1 : 3,
  });

  useEffect(() => {
    if (zone !== 'grid') return;
    const row = Math.floor(cursor / COLS);
    rowVirtualizer.scrollToIndex(row, { align: 'auto' });
  }, [cursor, zone, rowVirtualizer]);

  // ── Playback ────────────────────────────────────────────────────────
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

  useEffect(() => {
    if (nativeActive && native.error && !useTranscode && playing && conn) {
      setUseTranscode(true);
      setStreamUrl(plexTranscodeUrl(conn.base, playing.ratingKey, conn.token));
    }
  }, [native.error, nativeActive, useTranscode, playing, conn]);

  const exitFullscreen = useCallback(() => { setFullscreen(false); setPlaying(null); setStreamUrl(null); setUseTranscode(false); }, []);

  const toggleHidden = useCallback((key: string) => {
    setHidden((prev) => {
      const has = prev.indexOf(key) >= 0;
      const next = has ? prev.filter((k) => k !== key) : [...prev, key];
      void saveHiddenPlexLibs(next);
      return next;
    });
  }, []);

  // ── refs for keyboard ───────────────────────────────────────────────
  const zoneRef = useRef(zone); const cursorRef = useRef(cursor);
  const libIdxRef = useRef(libIdx); const itemsRef = useRef(items);
  const tabsRef = useRef(tabs); const fullscreenRef = useRef(fullscreen);
  const nativeErrRef = useRef(native.error); const nativeRetryRef = useRef(native.retry);
  useEffect(() => { zoneRef.current = zone; }, [zone]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { libIdxRef.current = libIdx; }, [libIdx]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);
  useEffect(() => { nativeErrRef.current = native.error; }, [native.error]);
  useEffect(() => { nativeRetryRef.current = native.retry; }, [native.retry]);

  const goHome = useCallback(() => { setLibIdx(homeIdx); setZone('tabs'); }, []);

  useEffect(() => {
    if (!isActive || status !== 'ready') return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (fullscreenRef.current) {
        const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
        if (isBack) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); exitFullscreen(); return; }
        if (nativeErrRef.current && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); nativeRetryRef.current(); return; }
        return;
      }

      // BACK: 1st press → Home tabs; 2nd (already on Home) → exit Plex.
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
      if (isBack) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (libIdxRef.current !== homeIdx) goHome();
        else onExitLeft?.();
        return;
      }

      // Sub-components own arrows/Enter for these tab types when in grid zone.
      const t = tabsRef.current[libIdxRef.current];
      if (zoneRef.current === 'grid' && t && (t.type === 'home' || t.type === 'search' || t.type === 'request' || t.type === 'manage')) return;

      // Let search input typing through if input is currently focused.
      if (inInput) return;

      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();

      if (zoneRef.current === 'tabs') {
        const n = tabsRef.current.length;
        if (e.key === 'ArrowLeft') { if (libIdxRef.current > 0) setLibIdx((i) => Math.max(0, i - 1)); /* first tab: do nothing */ }
        else if (e.key === 'ArrowRight') setLibIdx((i) => Math.min(n - 1, i + 1));
        else if (e.key === 'ArrowUp') { /* do nothing — never leave Plex via arrows */ }
        else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') setZone('grid');
        return;
      }

      // grid zone (movie/show libraries)
      const total = itemsRef.current.length;
      const cur = cursorRef.current;
      if (e.key === 'ArrowUp') { if (cur < COLS) setZone('tabs'); else setCursor(cur - COLS); }
      else if (e.key === 'ArrowDown') { if (cur + COLS < total) setCursor(cur + COLS); }
      else if (e.key === 'ArrowLeft') { if (cur % COLS !== 0) setCursor(cur - 1); /* col 0: do nothing */ }
      else if (e.key === 'ArrowRight') { if ((cur % COLS) < COLS - 1 && cur + 1 < total) setCursor(cur + 1); }
      else if (e.key === 'Enter' || e.key === ' ') { const it = itemsRef.current[cur]; if (it) void play(it); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // onExitUp intentionally unused — arrows never leave Plex.
  }, [isActive, status, onExitLeft, onExitUp, play, exitFullscreen, goHome]);

  // Hardware back
  useEffect(() => {
    if (!isActive) return;
    let handle: { remove?: () => void } | undefined; let cancelled = false;
    (async () => {
      try {
        const h = await CapApp.addListener('backButton', () => {
          if (fullscreenRef.current) { exitFullscreen(); return; }
          if (libIdxRef.current !== homeIdx) { goHome(); return; }
          onExitLeft?.();
        });
        if (cancelled) h?.remove?.(); else handle = h;
      } catch { /* web */ }
    })();
    return () => { cancelled = true; handle?.remove?.(); };
  }, [isActive, onExitLeft, exitFullscreen, goHome]);

  // ── render: auth gate ───────────────────────────────────────────────
  if (status === 'loading' || status === 'connecting') {
    return <div className="min-h-screen flex items-center justify-center text-white"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>;
  }
  if (status !== 'ready') {
    return <PlexAuthScreen status={status} pinCode={pinCode} error={error} onStartLink={startLink} onRetry={() => { void retryConnect(); }} onSignOut={() => { void signOut(); }} onCancel={() => { cancelLink(); onExitLeft?.(); }} />;
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
          <HomePanel isActive={isActive && zone === 'grid'} base={conn.base} token={conn.token} onPlay={(it) => void play(it)} onExitToTabs={() => setZone('tabs')} />
        ) : currentTab?.type === 'search' && conn ? (
          <SearchPanel isActive={isActive && zone === 'grid'} base={conn.base} token={conn.token} onPlay={(it) => void play(it)} onExitToTabs={() => setZone('tabs')} />
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
                <div key={vr.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H, transform: `translateY(${vr.start}px)` }} className="grid gap-3" >
                  <div className="grid grid-cols-6 gap-3">
                    {rowItems.map((it, ci) => {
                      const idx = start + ci;
                      const focused = isActive && zone === 'grid' && cursor === idx;
                      return (
                        <div key={it.ratingKey} data-focused={focused ? 'true' : 'false'}
                          onClick={() => { setCursor(idx); void play(it); }}
                          className={`cursor-pointer rounded-lg overflow-hidden transition-transform duration-150 ${focused ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_16px_rgba(245,200,80,0.4)]' : 'ring-1 ring-white/10'}`}>
                          <div className="aspect-[2/3]">
                            {conn && <PlexImage base={conn.base} path={it.thumb} token={conn.token} w={240} h={360} className="w-full h-full object-cover" />}
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
        ◀ ▶ ▲ ▼ browse · OK to play · Back for Home / exit
      </div>
    </div>
  );
});

PlexSection.displayName = 'PlexSection';
export default PlexSection;
