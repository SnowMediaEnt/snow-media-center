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
import { Loader2, AlertTriangle, RotateCw, Search as SearchIcon, Home as HomeIcon, Settings as SettingsIcon, Eye, EyeOff, LogOut } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useToast } from '@/hooks/use-toast';
import { isFireTV } from '@/utils/platform';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { useNativePlayer } from '@/hooks/useNativePlayer';
import { usePlexAuth } from '@/hooks/usePlexAuth';
import {
  getPlexLibraries as _getPlexLibraries,
  getPlexLibraryItems as _getPlexLibraryItems,
  getPlexHub as _getPlexHub,
  searchPlex as _searchPlex,
  getPlexPart,
  plexDirectUrl, plexTranscodeUrl, loadHiddenPlexLibs, saveHiddenPlexLibs,
  getCachedLibrary, setCachedLibrary, isLibraryCacheFresh,
  getCachedHub, setCachedHub,
  resolutionLabel,
  PLEX_QUALITY_PRESETS, loadPlexQuality, savePlexQuality,
  getPlexAccount,
  setPlexImageFocus, preloadImages,
  type PlexLibrary, type PlexItem, type PlexEpisode, plexRouteLabel,
  setPlexPlaybackActive } from '@/lib/plex';
import { isDemo, DEMO_DIALOG_MSG } from '@/lib/demoMode';
import {
  demoGetLibraries, demoGetLibraryItems, demoGetHub, demoSearchPlex,
} from '@/lib/plexDemo';
import PlexAuthScreen from './PlexAuthScreen';
import OverseerrRequestPanel from './OverseerrRequestPanel';
import PlexImage from './PlexImage';
import PlexDetail from './PlexDetail';
import PlexPlayerOverlay, { type SubtitleSearchContext } from './PlexPlayerOverlay';
import type { SnowSubtitle } from '@/capacitor/SnowPlayer';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import { loadPlayerVolume, savePlayerVolume } from '@/utils/volume';
import { setPlexKeyOwner, isPlexKeyOwner } from './plexKeyOwner';
import SnowLoader from '@/components/SnowLoader';
import BufferingDiagnostics from './BufferingDiagnostics';
import { useTransientVisible } from '@/hooks/useTransientVisible';
import { pauseLoading, resumeLoading, waitForResume } from '@/lib/loadGate';

// ── data access indirection ────────────────────────────────────────────────
// In demo mode every Plex read is answered from the pre-built, scrubbed
// catalog served by the demo-plex-catalog edge function — no PMS is ever
// contacted. isDemo() is always false on native, so the shipped TV app keeps
// using the real network functions verbatim.
const DEMO = isDemo();
const getPlexLibraries = DEMO ? demoGetLibraries : _getPlexLibraries;
const getPlexLibraryItems = DEMO ? demoGetLibraryItems : _getPlexLibraryItems;
const getPlexHub = DEMO ? demoGetHub : _getPlexHub;
const searchPlex = DEMO ? demoSearchPlex : _searchPlex;
import { trackEvent } from '@/lib/analytics';

const VideoPlayer = lazy(() => import('./VideoPlayer'));
const NATIVE_PLAYBACK = hasNativePlayer();

const PROVIDER_SERVER_RE = /snow[\s\-_]*media/i;
const isProviderServer = (name?: string | null) => !!name && PROVIDER_SERVER_RE.test(name);

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
    <span className={`absolute top-2 right-2 text-xs font-bold px-2 py-1 rounded-lg bg-black/70 ${gold ? 'text-brand-gold' : 'text-white/80'}`}>
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

  const [hubRetry, setHubRetry] = useState(0);
  const hubRetryRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let retry: number | null = null;
    const cachedOd = getCachedHub(base, onDeckPath);
    const cachedRa = getCachedHub(base, recentPath);
    if (cachedOd && cachedRa) { setLoading(false); return; }
    setLoading(true);
    // A failure resolves to null so it is NOT written to the 5-minute cache.
    // getCachedHub returns the stored array, and [] is truthy, so a cached
    // failure reads as a cache HIT and blocks every later refetch — Home stays
    // an empty rail across remounts until the TTL runs out.
    Promise.all([
      cachedOd ? Promise.resolve(cachedOd) : getPlexHub(base, token, onDeckPath).catch(() => null),
      cachedRa ? Promise.resolve(cachedRa) : getPlexHub(base, token, recentPath).catch(() => null),
    ]).then(([od, ra]) => {
      if (cancelled) return;
      if (od) { setOnDeck(od); setCachedHub(base, onDeckPath, od); }
      if (ra) { setRecent(ra); setCachedHub(base, recentPath, ra); }
      setLoading(false);
      // Nothing landed: re-arm once so a Wi-Fi blip during the first visit does
      // not leave Home permanently empty.
      if (!od && !ra && hubRetryRef.current < 3) {
        hubRetryRef.current += 1;
        retry = window.setTimeout(() => setHubRetry((v) => v + 1), 4000);
      }
    });
    return () => { cancelled = true; if (retry) window.clearTimeout(retry); };
  }, [base, token, hubRetry]);

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
      if (!isPlexKeyOwner('browse')) return;
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

  if (loading) return <div className="h-full flex items-center justify-center text-brand-ice/70"><Loader2 className="w-5 h-5 animate-spin text-brand-gold mr-2" /> Loading…</div>;
  if (rows.length === 0) return <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm">Nothing here yet.</div>;

  return (
    <div className="flex flex-col gap-6">
      {rows.map((r, ri) => (
        <div key={r.title}>
          <div className="text-xl font-quicksand font-semibold text-white/90 mb-3">{r.title}</div>
          <div className="flex gap-4 overflow-x-auto py-3 px-2 -mx-2">
            {r.items.map((it, ci) => {
              const focused = isActive && ri === row && ci === col;
              const label = resolutionLabel(it.videoResolution);
              return (
                <div key={it.ratingKey}
                  ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
                  onClick={() => { setRow(ri); setCol(ci); onPlay(it); }}
                  className={`tv-ring relative flex-shrink-0 w-[150px] cursor-pointer rounded-2xl overflow-hidden border border-white/10 ${focused ? 'scale-[1.08] z-10' : ''}`}
                  data-focused={focused ? 'true' : 'false'}>
                  <div className="relative aspect-[2/3]">
                    <PlexImage base={base} path={it.thumb} token={token} w={180} h={270} className="w-full h-full object-cover" />
                    <ResChip label={label} />
                  </div>
                  <div className={`px-2 py-1 text-sm font-nunito font-semibold truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>{it.title}</div>
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
type SearchPanelProps = HomePanelProps;
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
      if (!isPlexKeyOwner('browse')) return;
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
      <div data-focused={isActive && zone === 'input' ? 'true' : 'false'} className="tv-ring flex items-center gap-2 px-4 py-3 rounded-xl bg-black/40 border border-white/10">
        <SearchIcon className="w-4 h-4 text-brand-ice/60" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setZone('input')}
          placeholder="Search movies & shows…"
          className="flex-1 bg-transparent outline-none text-white font-nunito text-base placeholder:text-brand-ice/50"
        />
        {loading && <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />}
      </div>
      {results.length === 0 ? (
        <div className="text-brand-ice/70 font-nunito text-sm text-center py-6">{query.trim() ? (loading ? 'Searching…' : 'No results.') : 'Type to search Plex.'}</div>
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
                className={`tv-ring relative cursor-pointer rounded-2xl overflow-hidden border border-white/10 ${focused ? 'scale-105 z-10' : ''}`}
                data-focused={focused ? 'true' : 'false'}>
                <div className="relative aspect-[2/3]">
                  <PlexImage base={base} path={it.thumb} token={token} w={180} h={270} className="w-full h-full object-cover" />
                  <ResChip label={label} />
                </div>
                <div className={`px-2 py-1 text-sm font-nunito font-semibold truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>{it.title}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
SearchPanel.displayName = 'SearchPanel';

// ─── SETTINGS PANEL (formerly Manage) ──────────────────────────────────────
interface ManagePanelProps {
  isActive: boolean;
  libraries: PlexLibrary[];
  hidden: string[];
  /** Why the last library fetch failed, or null. Shown so an empty list on
   *  the TV says what happened instead of just "none". */
  librariesError: string | null;
  onToggle: (key: string) => void;
  onExitToTabs: () => void;
  serverName?: string;
  owned?: boolean;
  accountToken?: string;
  onSignOut: () => void;
}
/** Playback failures where the bytes stopped arriving, as opposed to a codec
 *  the device cannot decode. RECONNECT_EXHAUSTED comes from our own plugin;
 *  ERROR_CODE_IO_* are ExoPlayer's own names, forwarded verbatim. */
function isNetworkPlaybackError(code?: string): boolean {
  if (!code) return false;
  return code === 'RECONNECT_EXHAUSTED' || code.indexOf('ERROR_CODE_IO') === 0;
}

const ManagePanel = memo(({ isActive, libraries, hidden, librariesError, onToggle, onExitToTabs, serverName, owned, accountToken, onSignOut }: ManagePanelProps) => {
  const hiddenCount = libraries.filter((l) => hidden.indexOf(l.key) >= 0).length;
  const [cursor, setCursor] = useState(0);
  const [account, setAccount] = useState<{ username?: string; email?: string } | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);
  const cursorRef = useRef(cursor); useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const libsRef = useRef(libraries); useEffect(() => { libsRef.current = libraries; }, [libraries]);
  // The list can shrink under a stationary cursor (a library disappears from
  // the server). Without this nothing is highlighted until the next D-pad press.
  useEffect(() => { setCursor((c) => Math.min(c, libraries.length)); }, [libraries.length]);
  const onToggleRef = useRef(onToggle); useEffect(() => { onToggleRef.current = onToggle; }, [onToggle]);
  const onExitRef = useRef(onExitToTabs); useEffect(() => { onExitRef.current = onExitToTabs; }, [onExitToTabs]);
  const onSignOutRef = useRef(onSignOut); useEffect(() => { onSignOutRef.current = onSignOut; }, [onSignOut]);
  const confirmRef = useRef(confirmSignOut); useEffect(() => { confirmRef.current = confirmSignOut; }, [confirmSignOut]);

  useEffect(() => {
    if (!accountToken) return;
    let cancelled = false;
    void getPlexAccount(accountToken).then((a) => { if (!cancelled) setAccount(a); });
    return () => { cancelled = true; };
  }, [accountToken]);

  const disarmConfirm = useCallback(() => {
    if (confirmTimerRef.current) { window.clearTimeout(confirmTimerRef.current); confirmTimerRef.current = null; }
    setConfirmSignOut(false);
  }, []);

  // Confirmed sign-out: reuse the existing usePlexAuth signOut path
  // (clearPlexToken → clears token + saved server + catalog caches) — no
  // second token-clearing path. Analytics suppressed centrally in DEMO.
  const doSignOut = useCallback(() => {
    disarmConfirm();
    try { trackEvent('plex_signout', 'player', {}); } catch { /* ignore */ }
    onSignOutRef.current();
  }, [disarmConfirm]);

  useEffect(() => () => { if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current); }, []);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (!isPlexKeyOwner('browse')) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const keys = ['ArrowUp','ArrowDown','Enter',' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const c = cursorRef.current;
      const total = libsRef.current.length + 1; // + Sign out row at end
      const signOutIdx = libsRef.current.length;
      if (e.key === 'ArrowUp') {
        if (c === 0) onExitRef.current();
        else setCursor(c - 1);
        if (confirmRef.current) disarmConfirm();
      } else if (e.key === 'ArrowDown') {
        // Clamp at the last row — house style is clamped ends, never wrap.
        setCursor(Math.min(c + 1, total - 1));
        if (confirmRef.current) disarmConfirm();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (c === signOutIdx) {
          if (confirmRef.current) {
            doSignOut();
          } else {
            setConfirmSignOut(true);
            if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
            confirmTimerRef.current = window.setTimeout(() => setConfirmSignOut(false), 5000);
          }
          return;
        }
        const lib = libsRef.current[c];
        if (lib) onToggleRef.current(lib.key);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, disarmConfirm, doSignOut]);

  const accountLine = account?.username || account?.email;
  const ownedLine = isProviderServer(serverName) ? 'Provider server' : owned === true ? 'You own this server' : owned === false ? 'Shared with you' : '';

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-2">
      {(serverName || ownedLine || accountLine) && (
        <div className="mb-3 rounded-xl bg-black/30 border border-white/10 px-4 py-3">
          {serverName && <div className="font-quicksand font-bold text-white">{serverName}</div>}
          {ownedLine && <div className="text-xs font-nunito text-brand-ice/70 mt-1">{ownedLine}</div>}
          {accountLine && <div className="text-xs font-nunito text-brand-ice/70 mt-1">{accountLine}</div>}
        </div>
      )}
      {librariesError && libraries.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 font-nunito text-xs text-amber-200">
          This list may be out of date — the last refresh failed: {librariesError}
        </div>
      )}
      {libraries.length === 0 ? (
        <div className="font-nunito text-sm space-y-1">
          <div className="text-brand-ice/70">
            {librariesError ? 'Could not load your libraries.' : 'No libraries found on this server.'}
          </div>
          {librariesError && <div className="text-amber-300 text-xs">{librariesError}</div>}
          <div className="text-brand-ice/70 text-xs">
            {librariesError
              ? 'The server answered, but this request failed. Check it is online and that this Plex account still has access.'
              : 'This account has no movie or TV libraries shared on it. Music and photo libraries are not listed here.'}
          </div>
        </div>
      ) : hiddenCount === libraries.length ? (
        <div className="font-nunito text-sm space-y-2">
          <div className="text-brand-ice/70">All {libraries.length} libraries are hidden, so no tabs appear.</div>
          <div className="text-brand-ice/70 text-xs">Pick one below to show it again.</div>
          <div className="text-xs uppercase tracking-wide text-brand-ice/70 pt-1">Show / hide libraries</div>
          {libraries.map((lib, i) => {
            const focused = isActive && cursor === i;
            return (
              <div key={lib.key}
                ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest' }); }}
                onClick={() => { setCursor(i); onToggle(lib.key); }}
                className={`tv-ring flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 cursor-pointer ${focused ? 'bg-brand-gold/20 scale-[1.02] z-10' : 'bg-black/40'}`}
                data-focused={focused ? 'true' : 'false'}>
                <div>
                  <div className="font-quicksand text-white">{lib.title}</div>
                  <div className="text-xs font-nunito text-brand-ice/70 uppercase">{lib.type}</div>
                </div>
                <span className="flex items-center gap-2 text-xs text-brand-ice/70"><EyeOff className="w-4 h-4" /> Hidden</span>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="text-xs uppercase tracking-wide text-brand-ice/70 mb-1">Show / hide libraries</div>
          {libraries.map((lib, i) => {
            const focused = isActive && cursor === i;
            const isHidden = hidden.indexOf(lib.key) >= 0;
            return (
              <div key={lib.key}
                ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest' }); }}
                onClick={() => { setCursor(i); onToggle(lib.key); }}
                className={`tv-ring flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 cursor-pointer ${focused ? 'bg-brand-gold/20 scale-[1.02] z-10' : 'bg-black/40'}`}
                data-focused={focused ? 'true' : 'false'}>
                <div>
                  <div className="font-quicksand text-white">{lib.title}</div>
                  <div className="text-xs font-nunito text-brand-ice/70 uppercase">{lib.type}</div>
                </div>
                {isHidden
                  ? <span className="flex items-center gap-2 text-xs text-brand-ice/70"><EyeOff className="w-4 h-4" /> Hidden</span>
                  : <span className="flex items-center gap-2 text-xs text-brand-gold"><Eye className="w-4 h-4" /> Visible</span>}
              </div>
            );
          })}
        </>
      )}
      {(() => {
        const signOutIdx = libraries.length;
        const focused = isActive && cursor === signOutIdx;
        return (
          <div key="__signout"
            ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest' }); }}
            onClick={() => {
              setCursor(signOutIdx);
              if (confirmSignOut) { doSignOut(); }
              else {
                setConfirmSignOut(true);
                if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
                confirmTimerRef.current = window.setTimeout(() => setConfirmSignOut(false), 5000);
              }
            }}
            className={`tv-ring mt-3 flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer ${confirmSignOut ? 'tv-ring-danger border-red-500/40' : 'border-white/10'} ${focused ? (confirmSignOut ? 'bg-red-500/25 scale-[1.02] z-10' : 'bg-brand-gold/20 scale-[1.02] z-10') : (confirmSignOut ? 'bg-red-500/15' : 'bg-black/40')}`}
            data-focused={focused ? 'true' : 'false'}>
            <LogOut className={`w-4 h-4 ${confirmSignOut ? 'text-red-300' : 'text-brand-ice/70'}`} />
            <div className={`font-quicksand ${confirmSignOut ? 'text-red-200' : 'text-white'}`}>
              {confirmSignOut ? "Press OK again to sign out — you'll need a new code to sign back in" : 'Sign out of Plex'}
            </div>
          </div>
        );
      })()}
    </div>
  );
});
ManagePanel.displayName = 'ManagePanel';

// ─── POST-LINK CONFIRMATION CARD ───────────────────────────────────────────
interface JustLinkedCardProps {
  conn: { base: string; token: string; name: string; owned?: boolean } | null;
  accountToken?: string | null;
  onContinue: () => void;
  onSignOut: () => void;
}
const JustLinkedCard = memo(({ conn, accountToken, onContinue, onSignOut }: JustLinkedCardProps) => {
  const [account, setAccount] = useState<{ username?: string; email?: string } | null>(null);
  const [focusIdx, setFocusIdx] = useState(0); // 0=Continue, 1=Sign out
  const focusRef = useRef(focusIdx); useEffect(() => { focusRef.current = focusIdx; }, [focusIdx]);
  const onContinueRef = useRef(onContinue); useEffect(() => { onContinueRef.current = onContinue; }, [onContinue]);
  const onSignOutRef = useRef(onSignOut); useEffect(() => { onSignOutRef.current = onSignOut; }, [onSignOut]);

  useEffect(() => {
    const token = accountToken ?? conn?.token;
    if (!token) return;
    let cancelled = false;
    void getPlexAccount(token).then((a) => { if (!cancelled) setAccount(a); });
    return () => { cancelled = true; };
  }, [accountToken, conn?.token]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isPlexKeyOwner('browse')) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      if (isBack) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        onContinueRef.current();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        setFocusIdx((i) => (i === 0 ? 1 : 0));
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (focusRef.current === 0) onContinueRef.current();
        else onSignOutRef.current();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  const accountLine = account?.username || account?.email;
  const showOwnedWarning = conn?.owned === true && !isProviderServer(conn?.name);
  const showProviderReassure = conn?.owned === true && isProviderServer(conn?.name);

  return (
    <div className="min-h-screen flex items-center justify-center p-8 text-white">
      <div className="w-full max-w-lg rounded-3xl bg-slate-900/90 border border-white/10 p-8 text-center shadow-2xl">
        <h2 className="text-2xl font-quicksand font-bold mb-2">Connected to {conn?.name || 'Plex'}</h2>
        {accountLine && <p className="text-brand-ice/70 font-nunito text-sm mb-4">as {accountLine}</p>}
        {showOwnedWarning && (
          <div className="mb-6 rounded-xl bg-red-500/15 border border-red-500/40 px-4 py-3 text-left">
            <p className="text-red-200 font-quicksand font-semibold text-sm mb-1">Heads up</p>
            <p className="text-red-100/90 font-nunito text-sm">
              This looks like <span className="font-bold">YOUR OWN</span> Plex server. If you meant to use your provider's service, sign out and send them the code instead.
            </p>
          </div>
        )}
        {showProviderReassure && (
          <p className="text-brand-ice/70 font-nunito text-sm mb-4">You're all set — this is your provider's server.</p>
        )}
        <div className="mt-4 flex items-center justify-center gap-3">
          <button type="button"
            data-focused={focusIdx === 0 ? 'true' : 'false'}
            onClick={onContinue}
            className={`tv-ring tv-ring-contrast px-6 py-3 rounded-xl font-quicksand font-bold ${focusIdx === 0 ? 'bg-brand-gold text-black scale-105 z-10' : 'bg-white/10 text-white'}`}>
            Continue
          </button>
          <button type="button"
            data-focused={focusIdx === 1 ? 'true' : 'false'}
            onClick={onSignOut}
            className={`tv-ring tv-ring-contrast px-6 py-3 rounded-xl font-quicksand font-semibold ${focusIdx === 1 ? 'bg-brand-gold text-black scale-105 z-10' : 'bg-white/10 text-white'}`}>
            Sign out
          </button>
        </div>
        <p className="text-center text-xs text-brand-ice/60 font-nunito mt-4">◀ ▶ select · OK activate · Back continues</p>
      </div>
    </div>
  );
});
JustLinkedCard.displayName = 'JustLinkedCard';

// ─── MAIN ──────────────────────────────────────────────────────────────────
const PlexSection = memo(({ isActive, onExitLeft, onExitUp, onOpenBufferingGuide, onOpenSupport }: Props) => {
  const { toast } = useToast();
  const { status, conn, pinCode, error, justLinked, accountToken, clearJustLinked, startLink, cancelLink, signOut, retryConnect } = usePlexAuth();

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
  // Error from the last library fetch, or null. Rendered in Settings so a
  // failure is readable on the TV instead of looking identical to a server
  // that genuinely has no libraries.
  const [librariesError, setLibrariesError] = useState<string | null>(null);
  const [libRetry, setLibRetry] = useState(0);
  const libRetryRef = useRef(0);
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

  // Image focus mode: while a detail page is open, the browse grid, rails and
  // search results park their loads so the detail page's own images own the
  // image bandwidth — its poster/backdrop load with priority, and its cast,
  // seasons, episodes and filmography load focus-exempt but viewport-gated.
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
    // Fail-safe, NOT just an early return: if warm-up already ran we must still
    // OPEN the gate. This effect keys on the `conn` object, so any reconnect —
    // even one that resolves to the identical base — runs this cleanup
    // (cancelled = true) on the in-flight warm-up and then re-enters here. A
    // bare `return` left `warmedUp` false forever and parked Plex on
    // "Loading your library…" with no libraries and no way out. The separate
    // library effect below re-fetches on its own, so revealing early is safe.
    if (warmedRef.current) { setWarmedUp(true); return; }
    warmedRef.current = true;
    if (deeplinkRef.current) { setWarmedUp(true); return; }
    let cancelled = false;
    const base = conn.base;
    const token = conn.token;
    const onDeckPath = '/library/onDeck?X-Plex-Container-Start=0&X-Plex-Container-Size=30';
    const recentPath = '/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=30';
    (async () => {
      try {
        // A failure resolves to null, NOT []. An empty array is a legitimate
        // answer ("this hub is empty") and gets cached for 5 minutes; caching a
        // Wi-Fi blip that way left Home showing a bare heading over an empty
        // rail, surviving even a full remount, until the TTL expired.
        const [libs, od, ra] = await Promise.all([
          getPlexLibraries(base, token).catch(() => [] as PlexLibrary[]),
          (getCachedHub(base, onDeckPath) ? Promise.resolve(getCachedHub(base, onDeckPath) as PlexItem[]) : getPlexHub(base, token, onDeckPath).catch(() => null)),
          (getCachedHub(base, recentPath) ? Promise.resolve(getCachedHub(base, recentPath) as PlexItem[]) : getPlexHub(base, token, recentPath).catch(() => null)),
        ]);
        if (cancelled) return;
        if (od) setCachedHub(base, onDeckPath, od);
        if (ra) setCachedHub(base, recentPath, ra);
        // ONLY overwrite with a non-empty result. This fetch duplicates the
        // library effect below, runs in parallel against the same PMS, and
        // swallows its own failure into []. It also resolves LAST (it awaits
        // three calls in a Promise.all), so on a Fire TV — small socket pool,
        // cold start — a timeout here clobbered a list the other effect had
        // already loaded successfully. That is an empty tab strip on a
        // perfectly healthy server, and nothing ever corrected it.
        if (libs.length) setLibraries(libs);
        // First ~12 rail poster URLs — https only; http URLs go through the
        // data-URI path and shouldn't block warm-up.
        const posters: string[] = [];
        const httpsBase = /^https:\/\//i.test(base);
        if (httpsBase) {
          const feed: PlexItem[] = [];
          for (const it of od || []) feed.push(it);
          for (const it of ra || []) feed.push(it);
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


  // Switching to a DIFFERENT Plex server invalidates the section keys we are
  // holding. Drop them so the tab strip cannot show the previous server's
  // libraries while the new list loads. Keyed on clientIdentifier, not base, so
  // a relay escape (same server, new address) leaves the strip alone.
  const libServerRef = useRef<string | null>(null);
  useEffect(() => {
    const id = conn?.clientIdentifier ?? null;
    if (id && libServerRef.current && libServerRef.current !== id) {
      setLibraries([]); setLibrariesError(null); libRetryRef.current = 0;
    }
    if (id) libServerRef.current = id;
  }, [conn]);

  // Load libraries when connected. `libRetry` re-arms this on failure — see
  // the catch below.
  useEffect(() => {
    if (status !== 'ready' || !conn) return;
    let cancelled = false;
    let timer: number | null = null;
    getPlexLibraries(conn.base, conn.token)
      .then((libs) => {
        if (cancelled) return;
        setLibraries(libs); setLibrariesError(null); libRetryRef.current = 0;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // RETRY. Without this a single throw was terminal: nothing in this
        // effect's deps ever changes again, so the tab strip stayed at
        // Home · Search · Request · Settings for the rest of the session on a
        // server that came back online seconds later.
        const n = libRetryRef.current;
        if (n < 4) {
          libRetryRef.current = n + 1;
          timer = window.setTimeout(() => setLibRetry((v) => v + 1), 3000 * 2 ** n);
        }
        // Keep whatever is already on screen — a transient hiccup on a
        // reconnect must not empty the tab strip — and record WHY, so the
        // empty state can say what happened instead of looking identical to a
        // server that genuinely has no libraries. Deliberately NO auto-repair
        // here: a throw is usually a Wi-Fi blip, and discarding the saved
        // server over one would strand a box whose PMS is on the LAN while
        // the internet is down.
        setLibrariesError((e as Error)?.message || 'Could not reach the server');
      });
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [status, conn, libRetry]);

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
    t.push({ key: '__manage', title: 'Settings', type: 'manage' });
    return t;
  }, [visibleLibraries]);

  const currentTab = tabs[libIdx];
  const homeIdx = 0;
  // Tab to stay on across a tabs-list change (see the pin effect below).
  const wantTabKeyRef = useRef<string | null>(null);

  useEffect(() => { if (libIdx >= tabs.length) setLibIdx(tabs.length - 1); }, [tabs.length, libIdx]);

  // Un-hiding a library from Settings INSERTS a tab before Request/Settings, so
  // the same libIdx now points at a different tab and the user is silently
  // dropped onto Request mid-keypress. (Hiding shrinks the strip and the clamp
  // above happens to cover it — growth had no equivalent.) Pin by key across
  // the change instead of trusting the index.
  useEffect(() => {
    const k = wantTabKeyRef.current;
    if (!k) return;
    wantTabKeyRef.current = null;
    const i = tabs.findIndex((t) => t.key === k);
    if (i >= 0 && i !== libIdx) setLibIdx(i);
  }, [tabs, libIdx]);

  // ── Deep-link: ONE effect that opens the detail overlay directly. Works
  //    even when the target library is hidden/reordered or hasn't loaded.
  useEffect(() => {
    let cancelled = false;
    const dl = deeplinkRef.current;
    if (!dl || status !== 'ready' || !conn) return;
    deeplinkRef.current = null;

    const kind = dl.kind;
    const type = kind === 'episode' || kind === 'show' ? kind : 'movie';

    // Deep links bypass the normal openDetail callback — claim the D-pad and
    // pause background paging here too, synchronously with the state update.
    const openDetail = (payload: PlexItem) => {
      setPlexKeyOwner('detail');
      pauseLoading();
      setDetailItem(payload);
    };

    if (dl.machineIdentifier && conn.clientIdentifier && dl.machineIdentifier !== conn.clientIdentifier) {
      const title = dl.title || '';
      if (!title) { toast({ title: 'This title lives on a different Plex server' }); return; }
      searchPlex(conn.base, conn.token, title)
        .then((results) => {
          // An orphaned continuation must never touch the key-owner token, the
          // load gate, or state — the unmount cleanup already ran resumeLoading
          // (a no-op), so a late pauseLoading() here would silently park every
          // library pager on the next visit.
          if (cancelled) return;
          const norm = (s: string) => s.trim().toLowerCase();
          const match = results.find((r) => norm(r.title) === norm(title)) || results[0];
          if (match) openDetail(match);
          else toast({ title: 'This title lives on a different Plex server' });
        })
        .catch(() => { if (cancelled) return; toast({ title: 'This title lives on a different Plex server' }); });
      return () => { cancelled = true; };
    }

    openDetail({ ratingKey: String(dl.ratingKey), title: dl.title ?? '', type });
    return () => { cancelled = true; };
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
          await waitForResume(); // parked while a detail page owns the screen
          if (cancelled || mySeq !== seqRef.current) return;
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
          await waitForResume(); // parked while a detail page owns the screen
          if (cancelled || mySeq !== seqRef.current) return;
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
    // Claim the D-pad SYNCHRONOUSLY (before the React state update): the
    // key-owner token is the only mechanism correct in the layout→passive-
    // effect gap, where a browse-side capture listener and PlexDetail's
    // pre-paint useLayoutEffect listener would otherwise both be live.
    setPlexKeyOwner('detail');
    pauseLoading();
    // Set the ref SYNCHRONOUSLY too, so the main keydown effect below can
    // short-circuit on the very next event (fast D-pad press right after OK).
    detailRef.current = item;
    setDetailItem(item);
  }, []);
  const closeDetail = useCallback(() => {
    setPlexKeyOwner('browse');
    resumeLoading();
    detailRef.current = null;
    setDetailItem(null);
  }, []);
  // Safety nets so the key-owner token can never get stuck on 'detail':
  // unmount resets to browse, and layer changes driven by OTHER paths
  // (fullscreen flips, programmatic detail clears) re-derive the owner —
  // repairing the load gate alongside it so token and gate can never diverge.
  useEffect(() => () => { setPlexKeyOwner('browse'); resumeLoading(); }, []);
  useEffect(() => {
    if (fullscreen) { setPlexKeyOwner('player'); return; }
    if (detailItem) { setPlexKeyOwner('detail'); return; }
    setPlexKeyOwner('browse'); resumeLoading();
  }, [fullscreen, detailItem]);

  // Demo mode: playback is the one thing the website embed can't do, so every
  // play/quality/audio action opens a short explainer instead.
  const [demoNotice, setDemoNotice] = useState(false);

  const playRatingKey = useCallback(async (ratingKey: string, title: string, resumeSec?: number, ctx?: SubtitleSearchContext, resLabel?: string) => {
    if (DEMO) { setDemoNotice(true); return; }
    if (!conn) return;
    // Reset one-shot rescue guards so replaying the same title after backing
    // out regains its silent auto-revert and zero-audio safety-net.
    autoRevertRef.current = null;
    audioSafetyRef.current = null;
    // Owner directive: playback ALWAYS starts at Original / direct play. A
    // persisted quality preset must never influence how playback STARTS —
    // picking a preset DURING playback still works via changeQuality below.
    // Reset quality state so the overlay's Quality menu reflects reality.
    setQualityKey('original');
    setUseTranscode(false);
    // Flip fullscreen ON *before* any await so the loading UI paints
    // immediately — otherwise the user stares at the grid for the ~1-3s
    // getPlexPart round-trip and mashes OK, queueing up phantom presses.
    setPlaying({ ratingKey, title, type: 'movie', thumb: '' });
    setPlayingTitle(title);
    setPlayingResLabel(resLabel ?? '');
    setStartPos(resumeSec && resumeSec > 0 ? resumeSec : undefined);
    setSubCtx(ctx ?? { title });
    setExtraSubs(undefined);
    setStreamUrl(null);
    setFullscreen(true);
    try {
      const { partKey } = await getPlexPart(conn.base, conn.token, ratingKey);
      // Always direct-play the original. If a title's audio genuinely can't be
      // decoded, the onTracksChanged zero-audio safety net reloads it as a
      // transcode automatically — no pre-emptive transcode.
      const url = partKey ? plexDirectUrl(conn.base, partKey, conn.token) : plexTranscodeUrl(conn.base, ratingKey, conn.token);
      setStreamUrl(url);
    } catch {
      setStreamUrl(plexTranscodeUrl(conn.base, ratingKey, conn.token));
      setUseTranscode(true);
    }
  }, [conn]);


  // Which path the stream takes (LAN / direct / Plex relay, http vs https).
  // Logged with every play so the Hub can tell a throttled-relay box from a
  // slow-server one, and shown in the player's Help menu + buffering card.
  const routeLabel = conn ? plexRouteLabel(conn.route, conn.base) : '';
  const playFromDetail = useCallback((it: PlexItem, resumeSec?: number, ctx?: SubtitleSearchContext) => {
    try { trackEvent('plex_play', 'player', { title: it.title, type: it.type ?? 'movie', route: conn?.route ?? 'unknown', secure: !!conn?.base.startsWith('https://') }); } catch { /* ignore */ }
    void playRatingKey(it.ratingKey, it.title, resumeSec, ctx, resolutionLabel(it.videoResolution));
  }, [playRatingKey, conn]);
  const playEpisode = useCallback((ep: PlexEpisode, ctx?: SubtitleSearchContext) => {
    try { trackEvent('plex_play', 'player', { title: ep.title, type: 'episode', route: conn?.route ?? 'unknown', secure: !!conn?.base.startsWith('https://') }); } catch { /* ignore */ }
    void playRatingKey(ep.ratingKey, ep.title, undefined, ctx, '');
  }, [playRatingKey, conn]);

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
    if (DEMO) { setDemoNotice(true); return; }
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
        const { partKey } = await getPlexPart(conn.base, conn.token, playing.ratingKey);
        url = partKey
          ? plexDirectUrl(conn.base, partKey, conn.token)
          : plexTranscodeUrl(conn.base, playing.ratingKey, conn.token);
      } catch {
        url = plexTranscodeUrl(conn.base, playing.ratingKey, conn.token);
        setUseTranscode(true);
      }
      setStreamUrl(() => { window.setTimeout(() => setStreamUrl(url), 60); return null; });
    })();
  }, [conn, playing]);

  // Manual audio rescue: user pressed "Fix audio" in the Audio menu. Reload
  // the currently-playing item as an audio-only transcode (AAC) — video
  // stays direct-streamed. No-op if already transcoding, or nothing playing.
  const fixAudioTranscode = useCallback((resumeSec: number) => {
    if (DEMO) { setDemoNotice(true); return; }
    if (!conn || !playing || useTranscode) return;
    try { trackEvent('plex_fix_audio', 'player', { ratingKey: playing.ratingKey }); } catch { /* ignore */ }
    setUseTranscode(true);
    setStartPos(resumeSec > 0 ? resumeSec : undefined);
    const url = plexTranscodeUrl(conn.base, playing.ratingKey, conn.token);
    setStreamUrl(() => { window.setTimeout(() => setStreamUrl(url), 60); return null; });
  }, [conn, playing, useTranscode]);




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
  // Forward-referenced from armSlowLoadTimer (declared below) so app-resume
  // reloads from the hook can re-arm the slow-load watchdog.
  const armSlowLoadTimerRef = useRef<() => void>(() => { /* set below */ });
  const native = useNativePlayer({
    active: nativeActive,
    url: nativeActive ? streamUrl : null,
    volume,
    live: false,
    startPosition: startPos,
    subtitles: extraSubs,
    onTracksChanged,
    onPlayStateChange: onPlayStateChangeCb,
    onEnded: () => { setPlexKeyOwner(detailRef.current ? 'detail' : 'browse'); setFullscreen(false); setStreamUrl(null); setUseTranscode(false); },
    onReload: () => { armSlowLoadTimerRef.current?.(); },
  });
  // Reset the safety-net guard whenever the underlying title changes.
  useEffect(() => { audioSafetyRef.current = null; }, [playing?.ratingKey]);

  useEffect(() => {
    if (!nativeActive) return;
    document.documentElement.classList.add('snowplayer-fullscreen');
    return () => { document.documentElement.classList.remove('snowplayer-fullscreen'); };
  }, [nativeActive]);

  // Tell background probes to stand down while a stream is on screen. The relay
  // escape fans out across every candidate connection at once, and the relay it
  // is trying to escape is already speed-capped — that probe competing with
  // playback is exactly the stutter it exists to prevent.
  useEffect(() => {
    setPlexPlaybackActive(fullscreen);
    return () => setPlexPlaybackActive(false);
  }, [fullscreen]);

  // Auto-fallback to Plex-side transcode when native playback errors — most
  // notably AUDIO_DECODE from the Media3 plugin (Fire TV rejected the direct
  // codec / offload path). Preserves the current playhead so switching feels
  // like a hiccup, not a restart.
  useEffect(() => {
    if (!(nativeActive && native.error && !useTranscode && playing && conn)) return;
    // A network drop is NOT a codec problem. RECONNECT_EXHAUSTED and every
    // ERROR_CODE_IO_* mean the bytes stopped arriving; switching to a
    // server-side transcode cannot help, and if it happens to succeed the user
    // is stuck transcoding — degraded picture, extra load on the PMS — for the
    // rest of the film because of a Wi-Fi hiccup. Leave the URL alone and let
    // the reconnect path below handle it.
    if (isNetworkPlaybackError(native.error.code)) return;
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

  // Same fallback for SILENT audio: a Dolby/DTS-only file on a device with no
  // matching decoder raises no error at all — ExoPlayer just deselects the
  // audio track and the movie plays mute. The native layer now reports that
  // as audioWarning, so treat it exactly like AUDIO_DECODE: hand decoding to
  // the Plex server (transcode outputs AAC every device can play).
  useEffect(() => {
    if (!(nativeActive && native.audioWarning && !native.error && !useTranscode && playing && conn)) return;
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
  }, [native.audioWarning, native.error, nativeActive, useTranscode, playing, conn, native]);

  // Slow-load watchdog: if the native player hasn't emitted 'ready' within
  // 8s of the fullscreen flipping on, expose a Retry button so the user can
  // kick the pipeline instead of staring at a stalled spinner.
  const [slowLoad, setSlowLoad] = useState(false);
  setSlowLoadRef.current = setSlowLoad;
  // Fullscreen title bar: visible for 4 s after mount / title change / a
  // buffering flip, then hides. watchKeys=false — any key opens
  // PlexPlayerOverlay, which already shows the title at the bottom.
  // fullscreen in deps so a same-title replay re-shows it; NOT native.buffering —
  // the diagnostics card owns the top-right corner during a stall.
  const [titleShown] = useTransientVisible(4000, { watchKeys: false, deps: [fullscreen, playingTitle] });
  const armSlowLoadTimer = useCallback(() => {
    clearSlowLoadTimer();
    stillLoadingRef.current = true;
    setSlowLoad(false);
    slowLoadTimerRef.current = window.setTimeout(() => {
      if (stillLoadingRef.current) setSlowLoad(true);
      slowLoadTimerRef.current = null;
    }, 8000) as unknown as number;
  }, [clearSlowLoadTimer]);
  useEffect(() => { armSlowLoadTimerRef.current = armSlowLoadTimer; }, [armSlowLoadTimer]);
  useEffect(() => {
    if (!fullscreen) { clearSlowLoadTimer(); stillLoadingRef.current = false; setSlowLoad(false); return; }
    armSlowLoadTimer();
    return () => { clearSlowLoadTimer(); };
  }, [fullscreen, streamUrl, clearSlowLoadTimer, armSlowLoadTimer]);
  // Only clear the slow-load watchdog when playback ACTUALLY starts — i.e.
  // the native player reports playing or the polled position advances past 0.
  // The onPlayStateChangeCb above already clears on the 'playing' event; this
  // interval is a belt-and-braces poll in case that event is missed.
  useEffect(() => {
    if (!fullscreen || !streamUrl) return;
    let lastPos: number | null = null;
    let alive = true;
    const id = window.setInterval(async () => {
      try {
        const p = await native.getPosition();
        if (!alive) return;
        const advanced = p.duration > 0 && lastPos !== null && p.position > lastPos + 0.1;
        lastPos = p.position;
        if (p.playing || advanced) {
          stillLoadingRef.current = false;
          clearSlowLoadTimer();
          setSlowLoad(false);
        }
      } catch { /* ignore */ }
    }, 1500);
    return () => { alive = false; window.clearInterval(id); };
  }, [fullscreen, streamUrl, native, clearSlowLoadTimer]);

  // Auto-rescue: if the slow-load watchdog fires while we're playing a
  // TRANSCODE stream, the server's transcoder is almost certainly stuck.
  // Silently revert to direct play instead of showing the Retry panel.
  const autoRevertRef = useRef<string | null>(null);
  useEffect(() => {
    if (!(slowLoad && useTranscode && playing && conn)) return;
    const key = playing.ratingKey;
    if (autoRevertRef.current === key) return;
    autoRevertRef.current = key;
    let cancelled = false;
    void (async () => {
      let resume: number | undefined = startPos;
      try {
        const p = await native.getPosition();
        if (p.position > 0) resume = p.position;
      } catch { /* ignore */ }
      if (cancelled) return;
      let url = '';
      let fellBack = false;
      try {
        const { partKey } = await getPlexPart(conn.base, conn.token, key);
        url = partKey ? plexDirectUrl(conn.base, partKey, conn.token) : plexTranscodeUrl(conn.base, key, conn.token);
      } catch {
        url = plexTranscodeUrl(conn.base, key, conn.token);
        fellBack = true;
      }
      if (cancelled) return;
      setUseTranscode(fellBack);
      setQualityKey('original');
      setStartPos(resume);
      setSlowLoad(false);
      stillLoadingRef.current = true;
      setStreamUrl(() => { window.setTimeout(() => setStreamUrl(url), 60); return null; });
      try { toast({ title: 'Converting failed — playing original quality' }); } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [slowLoad, useTranscode, playing, conn, native, startPos, toast]);

  // Reset the auto-revert guard when a new title starts.
  useEffect(() => { autoRevertRef.current = null; }, [playing?.ratingKey]);

  // Network-class failure while playing: retry by itself the moment the device
  // reports connectivity again, instead of parking on "Playback Error" until
  // someone finds the remote. One shot per error — a genuinely dead stream
  // still surfaces the panel.
  const netRetriesRef = useRef(0);
  useEffect(() => { netRetriesRef.current = 0; }, [playing?.ratingKey]);
  useEffect(() => {
    if (!(nativeActive && native.error && isNetworkPlaybackError(native.error.code))) return;
    if (netRetriesRef.current >= 6) return;   // ~2 min of trying, then it's the user's call
    let done = false;
    const kick = () => {
      if (done) return;
      done = true;
      netRetriesRef.current += 1;
      native.retry();
    };
    // Instant path: the OS told us the interface came back.
    window.addEventListener('online', kick);
    // Fallback path: Android reports navigator.onLine from the interface, which
    // stays true when it is the internet beyond it that dropped. Back off so a
    // genuinely dead stream is not hammered.
    const t = window.setTimeout(kick, Math.min(60_000, 4000 * 2 ** netRetriesRef.current));
    return () => { window.removeEventListener('online', kick); window.clearTimeout(t); };
  }, [nativeActive, native.error, native, playing]);

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

  const exitFullscreen = useCallback(() => {
    // Synchronous owner hand-back: the Back keydown that closes the player
    // must never also be seen by PlexDetail (episodes → seasons pop).
    setPlexKeyOwner(detailRef.current ? 'detail' : 'browse');
    setFullscreen(false); setStreamUrl(null); setUseTranscode(false);
  }, []);

  const toggleHidden = useCallback((key: string) => {
    wantTabKeyRef.current = tabsRef.current[libIdxRef.current]?.key ?? null;
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
    if (fullscreen && (!streamUrl || slowLoad || !!native.error)) {
      const backOnly = (e: KeyboardEvent) => {
        const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
        if (!isBack) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        // Hand the D-pad back synchronously so the same Back can't leak
        // into the detail page's listener.
        setPlexKeyOwner(detailRef.current ? 'detail' : 'browse');
        setFullscreen(false); setStreamUrl(null); setUseTranscode(false);
      };
      window.addEventListener('keydown', backOnly, true);
      return () => window.removeEventListener('keydown', backOnly, true);
    }
    if (detailItem || fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (!isPlexKeyOwner('browse')) return;
      if (detailRef.current || fullscreenRef.current) return;
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
  }, [isActive, status, onExitLeft, onExitUp, openDetail, goHome, cancelLink, detailItem, fullscreen, streamUrl, slowLoad, native.error]);

  // Demo notice owns the D-pad while open: swallow every key so focus can't
  // leak into the grid behind it. OK / Back / Escape dismiss.
  useEffect(() => {
    if (!demoNotice) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') {
        setDemoNotice(false);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [demoNotice]);

  const demoNoticeOverlay = demoNotice ? (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 px-6"
      role="dialog" aria-modal="true">
      <div className="max-w-md w-full rounded-xl border border-brand-gold/40 bg-[#0b1622] p-6 text-center shadow-2xl">
        <p className="font-nunito text-white/90 text-base leading-relaxed">{DEMO_DIALOG_MSG}</p>
        <button type="button" autoFocus onClick={() => setDemoNotice(false)}
          className="mt-5 px-6 py-2 rounded-lg bg-brand-gold text-black font-semibold font-nunito focus:outline-none focus:ring-2 focus:ring-white">
          OK
        </button>
      </div>
    </div>
  ) : null;

  // ── render: auth gate ───────────────────────────────────────────────
  if (status === 'loading' || status === 'connecting') {
    return <div className="min-h-screen flex items-center justify-center text-white"><div className="w-full max-w-md"><SnowLoader size="md" label="Connecting to Plex…" /></div></div>;
  }
  if (status !== 'ready') {
    return <PlexAuthScreen status={status} pinCode={pinCode} error={error} onStartLink={startLink} onRetry={() => { void retryConnect(); }} onSignOut={() => { void signOut(); }} onCancel={() => { cancelLink(); onExitLeft?.(); }} />;
  }

  // ── render: post-link confirmation ──────────────────────────────────
  // Shown ONCE after a fresh PIN link succeeds, before warm-up/browse UI.
  if (justLinked && status === 'ready' && !fullscreen && !detailItem) {
    return (
      <JustLinkedCard
        conn={conn}
        accountToken={accountToken ?? conn?.token}
        onContinue={() => clearJustLinked()}
        onSignOut={() => { void signOut(); }}
      />
    );
  }

  // ── render: warm-up ─────────────────────────────────────────────────
  // Delay revealing the tabs+grid until Home rails + first ~12 posters have
  // loaded (or 8s cap). Back during warm-up still exits Plex via the keydown
  // effect above (status==='ready', no detail/fullscreen).
  if (!warmedUp && !fullscreen && !detailItem) {
    return (
      <div className="min-h-screen flex-1 flex flex-col items-center justify-center gap-4 bg-black/40 text-white">
        <div className="w-full max-w-md">
          <SnowLoader size="md" label="Loading your library…" />
        </div>
        <p className="text-xs font-nunito text-brand-ice/70">Plex · {conn?.name}</p>
      </div>
    );
  }


  // ── render: fullscreen ──────────────────────────────────────────────
  if (fullscreen) {
    return (
      <div className={`fixed inset-0 z-[60] text-white ${NATIVE_PLAYBACK ? 'bg-transparent' : 'bg-black'}`}>
        {!NATIVE_PLAYBACK && streamUrl && (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><div className="w-full max-w-md"><SnowLoader size="lg" label="Loading…" /></div></div>}>
            <VideoPlayer src={streamUrl} volume={volume} className="w-full h-full" />
          </Suspense>
        )}
        {NATIVE_PLAYBACK && !native.error && !slowLoad && (!streamUrl || !nativeActive || native.buffering) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-full max-w-md">
              <SnowLoader size="lg" label={streamUrl && nativeActive ? 'Buffering…' : 'Loading…'} />
            </div>
          </div>
        )}
        {NATIVE_PLAYBACK && !native.error && slowLoad && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center">
            <div className="w-full max-w-md mb-3">
              <SnowLoader size="md" />
            </div>
            <p className="font-quicksand font-semibold mb-1">Still preparing…</p>
            <p className="text-sm text-brand-ice/70 font-nunito mb-4">Your Plex server is slow to respond.</p>
            <button onClick={() => {
              if (!streamUrl && playing) {
                // No stream URL resolved yet — native.retry() would be a no-op.
                // Re-invoke the current item's play path from scratch.
                armSlowLoadTimer();
                void playRatingKey(playing.ratingKey, playing.title, startPos, subCtx, playingResLabel);
              } else {
                armSlowLoadTimer();
                native.retry();
              }
            }} autoFocus data-focused="true" className="tv-ring tv-ring-contrast flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold">
              <RotateCw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}
        {NATIVE_PLAYBACK && native.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-brand-gold mb-3" />
            <p className="font-quicksand font-semibold mb-1">Playback Error</p>
            <p className="text-sm text-brand-ice/80 font-nunito max-w-md mb-4">{native.error.message}</p>
            <button onClick={() => { armSlowLoadTimer(); native.retry(); }} autoFocus data-focused="true" className="tv-ring tv-ring-contrast flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold">
              <RotateCw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}
        {titleShown && (
          <div className="absolute top-0 left-0 right-0 p-4 pr-96 bg-gradient-to-b from-black/80 to-transparent pointer-events-none animate-fade-in">
            <p className="font-quicksand font-bold text-white truncate">
              {playingTitle}{useTranscode ? ' · transcoding' : ''}
              {playingResLabel && (
                <span className={`ml-2 align-middle text-xs font-bold px-2 py-1 rounded-lg bg-black/70 ${playingResLabel === '4K' ? 'text-brand-gold' : 'text-white/80'}`}>{playingResLabel}</span>
              )}
            </p>
          </div>
        )}
        {NATIVE_PLAYBACK && !native.error && (
          <BufferingDiagnostics buffering={native.buffering} showHelpHint footnote={routeLabel ? `Route: ${routeLabel}` : undefined} />
        )}
        {NATIVE_PLAYBACK && !native.error && (
          <PlexPlayerOverlay
            active={nativeActive && !slowLoad}
            title={playingTitle}
            resolutionLabel={playingResLabel}
            controller={native.controller}
            tracksTick={tracksTick}
            getPosition={native.getPosition}
            seekTo={native.seekTo}
            onBackWhileHidden={exitFullscreen}
            routeLabel={routeLabel}
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
            onFixAudio={fixAudioTranscode}
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
        <span className="text-xs uppercase tracking-wide text-brand-ice/70 mr-2">Plex · {conn?.name}</span>
        {tabs.map((tab, i) => {
          const focused = isActive && zone === 'tabs' && libIdx === i;
          const selected = libIdx === i;
          const Icon = tab.type === 'home' ? HomeIcon : tab.type === 'search' ? SearchIcon : tab.type === 'manage' ? SettingsIcon : null;
          return (
            <button key={tab.key}
              ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
              data-focused={focused ? 'true' : 'false'}
              onClick={() => { setLibIdx(i); setZone('grid'); }}
              className={`tv-ring tv-ring-contrast flex-shrink-0 flex items-center gap-2 px-4 py-3 rounded-xl text-base font-nunito ${focused ? 'bg-brand-gold text-black font-bold scale-105 z-10' : selected ? 'bg-white/90 text-black font-semibold' : 'bg-white/10 text-white'}`}>
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {tab.title}
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4">
        {currentTab?.type === 'home' && conn ? (
          <HomePanel isActive={isActive && zone === 'grid' && !detailItem} base={conn.base} token={conn.token} onPlay={openDetail} onExitToTabs={() => setZone('tabs')} />
        ) : currentTab?.type === 'search' && conn ? (
          <SearchPanel isActive={isActive && zone === 'grid' && !detailItem} base={conn.base} token={conn.token} onPlay={openDetail} onExitToTabs={() => setZone('tabs')} />

        ) : currentTab?.type === 'request' ? (
          <OverseerrRequestPanel isActive={isActive && zone === 'grid' && !detailItem} onExitToTabs={() => setZone('tabs')} />
        ) : currentTab?.type === 'manage' ? (
          <ManagePanel isActive={isActive && zone === 'grid' && !detailItem} libraries={libraries} hidden={hidden} librariesError={librariesError} onToggle={toggleHidden} onExitToTabs={() => setZone('tabs')} serverName={conn?.name} owned={conn?.owned} accountToken={accountToken ?? conn?.token} onSignOut={() => { void signOut(); }} />
        ) : itemsLoading && items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/70 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-gold" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito text-sm">Nothing here yet.</div>
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
                          className={`tv-ring relative cursor-pointer rounded-2xl overflow-hidden border border-white/10 ${focused ? 'scale-105 z-10' : ''}`}>
                          <div className="relative aspect-[2/3]">
                            {conn && <PlexImage base={conn.base} path={it.thumb} token={conn.token} w={180} h={270} className="w-full h-full object-cover" />}
                            <ResChip label={label} />
                          </div>
                          <div className={`px-2 py-1 text-sm font-nunito font-semibold truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>{it.title}</div>
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

      <div className="flex-shrink-0 border-t border-white/10 bg-black/40 px-4 py-2 text-xs font-nunito text-brand-ice/60">
        ◀ ▶ ▲ ▼ browse · OK for details · Back for Home / exit
      </div>

      {detailItem && conn && (
        <PlexDetail
          isActive={isActive && !fullscreen}
          base={conn.base}
          token={conn.token}
          item={detailItem}
          onPlay={playFromDetail}
          onPlayEpisode={playEpisode}
          onBack={closeDetail}
        />
      )}
      {demoNoticeOverlay}
    </div>
  );
});


PlexSection.displayName = 'PlexSection';
export default PlexSection;
