import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Tv } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { isNativePlatform } from '@/utils/platform';
import { App as CapApp } from '@capacitor/app';
import { toast } from '@/hooks/use-toast';
import { setPausableInterval } from '@/utils/pausableInterval';
import { trackAppLaunch, trackEvent } from '@/lib/analytics';
import { onFirstInteraction, runWhenIdle } from '@/utils/idle';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { isDemo, DEMO_DIALOG_MSG } from '@/lib/demoMode';
import { buildViewerBar, type BarChannel } from '@/lib/contentBar';
import { WATCH_HISTORY_EVENT } from '@/lib/watchHistory';
import { isAdultTitle } from '@/lib/adultContent';
import { kidsLevel } from '@/lib/kidsFilter';

type MediaItem = {
  id: string;
  /** plex: the shared "recently added" feed · history / live / foryou: built
   *  on the device for this viewer. 'sports' is only ever seen from an old
   *  cached or not-yet-redeployed feed and is dropped on read. */
  source: 'plex' | 'tmdb' | 'sports' | 'history' | 'live' | 'foryou';
  kind: string;
  title: string;
  subtitle?: string;
  poster?: string;
  ratingKey?: string;
  key?: string;
  guid?: string;
  machineIdentifier?: string;
  librarySectionID?: string | number;
  metadataType?: number;
  duration?: number;
  viewOffset?: number;
  androidLink?: string;
  deepLink?: string;
  webLink?: string;
  channel?: BarChannel;
};

type Props = {
  active?: boolean;
  onExitDown?: () => void;
  onExitUp?: () => void;
  onOpenPlayer?: () => void;
};

// Demo mode gets its own cache bucket because it stores the sanitised
// ?public=1 feed, which is NOT interchangeable with the signed-in payload.
const DEMO = isDemo();
const STORAGE_KEY = DEMO ? 'snow-media-bar-cache-demo-v1' : 'snow-media-bar-cache-v6';
const REFRESH_MS = 5 * 60 * 1000;
const PAGE_SIZE = 8;
const AUTO_ROTATE_MS = 30 * 1000;

const SOURCE_BADGE: Record<string, { label: string; color: string } | null> = {
  plex: null, // hidden per design
  tmdb: { label: 'TRENDING', color: 'hsl(200 90% 55%)' },
  sports: null,
  history: { label: 'CONTINUE', color: 'hsl(39 31% 60%)' },
  live: { label: 'LIVE', color: 'hsl(0 80% 55%)' },
  foryou: { label: 'FOR YOU', color: 'hsl(189 37% 80%)' },
};

const notSports = (i: MediaItem) => i?.title && i.source !== 'sports';
// The builders already keep adult material out by category, library, genre
// and certificate; this is the last line, on the name alone, so a stale cache
// or a feed that has not been redeployed cannot put it on the home screen.
const notAdult = (i: MediaItem) => !isAdultTitle(i.title) && !(i.channel && isAdultTitle(i.channel.name));
const showable = (i: MediaItem) => notSports(i) && notAdult(i);

// The saved bar is kept per profile (profiles.ts swaps it with the rest of a
// profile's home screen) and stamped with the Kids level it was built for: a
// bar saved for a grown-up is never shown on a Kids profile, even one saved
// before profiles kept their own.
const readCache = (): MediaItem[] | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if ((parsed?.kids ?? null) !== kidsLevel()) return null;
    return Array.isArray(parsed?.items) ? (parsed.items as MediaItem[]).filter(showable) : null;
  } catch { return null; }
};

const writeCache = (items: MediaItem[]) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, ts: Date.now(), kids: kidsLevel() })); } catch { /* ignore unavailable localStorage */ }
};

const isHardwareBackKey = (e: KeyboardEvent) =>
  e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.which === 4;

const PLEX_ANDROID_PACKAGE = 'com.plexapp.android';
const PLEX_METADATA_TYPE: Record<string, number> = { movie: 1, show: 2, season: 3, episode: 4 };
const OFFSET_QS = 'viewOffset=0&offset=0&t=0';

const getRatingKey = (item: MediaItem): string | undefined => {
  if (item.ratingKey) return String(item.ratingKey);
  const keyMatch = item.key?.match(/\/library\/metadata\/(\d+)/);
  if (keyMatch?.[1]) return keyMatch[1];
  return item.id?.match(/^plex-(\d+)$/)?.[1];
};

const getMetadataKey = (item: MediaItem): string | undefined => {
  const ratingKey = getRatingKey(item);
  return ratingKey ? `/library/metadata/${ratingKey}` : item.key;
};

const getMachineIdentifier = (item: MediaItem): string | undefined => item.machineIdentifier;

const getMetadataType = (item: MediaItem): number =>
  item.metadataType ?? PLEX_METADATA_TYPE[String(item.kind ?? '').toLowerCase()] ?? 1;

const buildPlexPlayLink = (item: MediaItem): string | undefined => {
  const metadataKey = getMetadataKey(item);
  if (!metadataKey) return undefined;

  const machineId = item.machineIdentifier;
  const metadataType = getMetadataType(item);
  const encodedKey = encodeURIComponent(metadataKey);
  const serverParam = machineId ? `server=${encodeURIComponent(machineId)}&` : '';
  return `plex://play/?${serverParam}metadataKey=${encodedKey}&metadataType=${metadataType}&${OFFSET_QS}`;
};

/**
 * openPlexItemFromBeginning
 *
 * Keep this intentionally simple. Android TV Plex has been crashing on the
 * web/intent/playMedia routes, so clicks use only Plex's native plex://play
 * route and fall back to opening Plex Home only if Android cannot resolve it.
 */
const openPlexItemFromBeginning = async (item: MediaItem) => {
  const native = isNativePlatform();
  const ratingKey = getRatingKey(item);
  const metadataKey = getMetadataKey(item);
  const machineIdentifier = getMachineIdentifier(item);
  const metadataType = getMetadataType(item);
  const playLink = buildPlexPlayLink(item);

  const logPayload = {
    title: item.title,
    type: item.kind,
    ratingKey,
    metadataKey,
    guid: item.guid,
    librarySectionID: item.librarySectionID,
    machineIdentifier,
    metadataType,
    duration: item.duration,
    serverViewOffset: item.viewOffset, // what Plex thinks; we override to 0
    generatedPlaybackLink: playLink,
    startsAtZero: true,
    fallbackUsed: false,
    native,
  };
  console.info('[MediaBar] openPlexItemFromBeginning', logPayload);

  if (!ratingKey || !playLink) {
    console.warn('[MediaBar] Missing ratingKey or playLink — cannot deep-link', logPayload);
    toast({ title: "Can't open this item in Plex", description: 'Missing Plex item info.' });
    return;
  }

  if (!native) {
    window.open(item.webLink ?? playLink, '_blank', 'noopener,noreferrer');
    return;
  }

  toast({ title: 'Playing in Plex…', description: item.title });
  try {
    const { AppManager } = await import('@/capacitor/AppManager');
    const { installed } = await AppManager.isInstalled({ packageName: PLEX_ANDROID_PACKAGE });
    console.info('[MediaBar] Plex installed check', { installed });
    if (!installed) {
      toast({ title: 'Plex not installed', description: 'Install Plex to play this title.' });
      return;
    }

    console.info('[MediaBar] Plex native play attempt', { ...logPayload, generatedIntent: playLink });
    try { trackAppLaunch('Plex'); } catch { void 0; }
    await AppManager.openUrl({ url: playLink, packageName: PLEX_ANDROID_PACKAGE });
  } catch (err) {
    console.warn('[MediaBar] Plex native play failed — opening Plex Home', { ...logPayload, err, fallbackUsed: true });
    toast({ title: "Couldn't start playback", description: 'Opening Plex instead.' });
    try {
      const { AppManager } = await import('@/capacitor/AppManager');
      try { trackAppLaunch('Plex'); } catch { void 0; }
      await AppManager.launch({ packageName: PLEX_ANDROID_PACKAGE });
    } catch (launchErr) {
      console.warn('[MediaBar] Plex Home fallback failed:', launchErr);
    }
  }
};

// A poster from our poster-proxy comes in two steps: a tiny copy (a few KB)
// that is on screen almost at once, then the sharp one over it when it has
// loaded. Anything else (channel logos, other hosts) loads as it is.
const isProxied = (src: string) => src.includes('/poster-proxy?');
const BarPoster = memo(({ src, className }: { src: string; className: string }) => {
  const [sharp, setSharp] = useState(false);
  const hide = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.visibility = 'hidden'; };
  if (!isProxied(src)) {
    return <img src={src} alt="" decoding="async" className={className} onError={hide} />;
  }
  return (
    <>
      {!sharp && <img src={`${src}&w=60`} alt="" decoding="async" className={className} onError={hide} />}
      <img
        src={src}
        alt=""
        decoding="async"
        className={className}
        style={sharp ? undefined : { opacity: 0 }}
        onLoad={() => setSharp(true)}
        onError={hide}
      />
    </>
  );
});
BarPoster.displayName = 'BarPoster';

const MediaBar = memo(({ active = false, onExitDown, onExitUp, onOpenPlayer }: Props) => {
  const cached = useMemo(readCache, []);
  const [items, setItems] = useState<MediaItem[]>(cached ?? []);
  // True once the feed has answered at all. Until then an empty bar shows
  // placeholder posters; after it, an empty bar is simply empty. Without this
  // a feed that answers `items: []` — Plex unreachable from the edge runtime
  // and no game live — pulsed grey skeletons for the rest of the session.
  const [loaded, setLoaded] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const [focusIdx, setFocusIdx] = useState(0); // index within current page
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // The two halves of the bar. The viewer's rows come first; the shared
  // Plex feed fills in after them, minus anything already shown.
  const viewerItemsRef = useRef<MediaItem[]>([]);
  const feedItemsRef = useRef<MediaItem[]>([]);
  const composeItems = () => {
    const seen = new Set<string>();
    const out: MediaItem[] = [];
    for (const it of [...viewerItemsRef.current, ...feedItemsRef.current]) {
      const k = it.ratingKey ? `rk:${it.ratingKey}` : it.id;
      if (seen.has(k)) continue;
      if (!notAdult(it)) continue;
      seen.add(k);
      out.push(it);
    }
    if (out.length) { setItems(out); writeCache(out); }
  };

  const [demoNotice, setDemoNotice] = useState(false);

  // A channel tile plays that channel in the Player; every Plex tile opens in
  // the app's own Plex browser.
  const handleClick = (item: MediaItem) => {
    // Demo: browsing is real, but nothing may navigate or deep-link out.
    if (DEMO) { setDemoNotice(true); return; }
    // What the content bar is actually used for, against how often it is
    // merely opened.
    try {
      trackEvent('content_bar_item', 'navigation', {
        source: item.source ?? null,
        kind: item.kind ?? null,
        title: item.title ?? null,
      });
    } catch { /* ignore */ }
    if (item.channel && onOpenPlayer) {
      try {
        sessionStorage.setItem('smc-live-deeplink', JSON.stringify(item.channel));
      } catch { /* ignore */ }
      onOpenPlayer();
      return;
    }
    // ALL Plex kinds (movie / show / episode) open in the app's built-in
    // Plex browser via a deep-link. The old code fell through to the plex://
    // Android intent for shows + episodes, which surfaces "not available"
    // when the target lives in a shared library.
    if (item.ratingKey && onOpenPlayer) {
      try {
        sessionStorage.setItem('smc-plex-deeplink', JSON.stringify({
          ratingKey: String(item.ratingKey),
          title: item.title,
          librarySectionID: item.librarySectionID ?? null,
          kind: item.kind,
          machineIdentifier: item.machineIdentifier ?? null,
        }));
      } catch { /* ignore */ }
      onOpenPlayer();
      return;
    }
    // Web fallback (no in-app Plex player available).
    openPlexItemFromBeginning(item);
  };

  // Defer poster image network until after first interaction / idle so it
  // doesn't compete with home-screen boot. Skeletons still render in cards.
  const [imagesReady, setImagesReady] = useState(false);
  useEffect(() => {
    // A fresh install has nothing cached to show: no reason to wait for a
    // key press before the first posters.
    if (!cached?.length) return runWhenIdle(() => setImagesReady(true), 1200);
    const cancelInteraction = onFirstInteraction(() => {
      const cancelIdle = runWhenIdle(() => setImagesReady(true), 800);
      // Free the closure if unmounted before idle fires.
      return cancelIdle;
    });
    return cancelInteraction;
  }, []);

  // Fetch — deferred until after first interaction (or hard 5s fallback in
  // onFirstInteraction), then scheduled via requestIdleCallback so it never
  // competes with the first few seconds of boot on weak TV boxes.
  useEffect(() => {
    let cancelled = false;
    let cancelIdleFirst: (() => void) | null = null;
    const load = async () => {
      try {
        // Demo clients get the sanitised public feed (no server-identifying
        // fields, posters pre-signed through poster-proxy).
        const { data, error } = await supabase.functions.invoke(
          DEMO ? 'media-bar-feed?public=1' : 'media-bar-feed',
        );
        if (cancelled) return;
        if (error) throw error;
        // The function reports its own failures as HTTP 200 + `error`.
        if (data?.error) throw new Error(String(data.error));
        // The shared feed carries no certificates, so a Kids profile's bar is
        // built on the box alone: its own history and channels, and the
        // newest Plex titles of its rating (contentBar.ts).
        const next: MediaItem[] = kidsLevel() ? [] : (data?.items ?? []).filter(showable);
        if (next.length) { feedItemsRef.current = next; composeItems(); }
      } catch (e) {
        console.warn('[MediaBar] fetch failed:', (e as Error).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    // The viewer's own rows: built on the device from their history, their
    // lines and Plex. Demo has no viewer and no lines — the feed alone.
    const loadViewer = async () => {
      if (DEMO) return;
      try {
        const { items: mine } = await buildViewerBar();
        if (cancelled) return;
        viewerItemsRef.current = mine as MediaItem[];
        composeItems();
      } catch (e) {
        console.warn('[MediaBar] viewer rows failed:', (e as Error).message);
      }
    };
    const loadAll = () => { void loadViewer(); void load(); };
    // With a cached bar on screen the refresh can wait for the first key
    // press; a fresh install (empty bar) loads straight away.
    const cancelFirst = cached?.length
      ? onFirstInteraction(() => { cancelIdleFirst = runWhenIdle(loadAll, 3500); })
      : runWhenIdle(loadAll, 1200);
    // A new play, or a different account signing in, reshapes the rows.
    let debounce: number | null = null;
    const onHistory = () => {
      if (debounce) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => { debounce = null; void loadViewer(); }, 2500);
    };
    window.addEventListener(WATCH_HISTORY_EVENT, onHistory);
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') onHistory();
    });
    // Periodic refresh stays — non-essential but pause-aware via setPausableInterval.
    // Skip while streaming so the fetch can't compete with active playback.
    const cancelInterval = setPausableInterval(() => {
      if (document.documentElement.classList.contains('streaming-active')) return;
      loadAll();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      cancelFirst();
      cancelIdleFirst?.();
      cancelInterval();
      window.removeEventListener(WATCH_HISTORY_EVENT, onHistory);
      if (debounce) window.clearTimeout(debounce);
      authSub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  // Endless wrap: fill every page to PAGE_SIZE by looping back to the start.
  // Eliminates the empty trailing slots on the last page and makes scrolling feel infinite.
  const currentPage = useMemo(() => (
    items.length === 0
      ? []
      : Array.from({ length: Math.min(PAGE_SIZE, items.length) }, (_, i) =>
          items[(pageIdx * PAGE_SIZE + i) % items.length]
        )
  ), [items, pageIdx]);

  // Auto-rotate every 30s (paused on hover/focus/active, and while the user
  // is actively D-pad navigating elsewhere — main.tsx toggles html.nav-active).
  useEffect(() => {
    if (paused || active || totalPages <= 1 || items.length === 0) return;
    return setPausableInterval(() => {
      const html = document.documentElement;
      if (html.classList.contains('nav-active')) return;
      if (html.classList.contains('streaming-active')) return;
      setPageIdx((p) => (p + 1) % totalPages);
    }, AUTO_ROTATE_MS);
  }, [paused, active, totalPages, items.length]);

  useEffect(() => {
    if (pageIdx >= totalPages) setPageIdx(0);
  }, [pageIdx, totalPages]);

  // Reset focus when page changes
  useEffect(() => { setFocusIdx(0); }, [pageIdx]);

  const goPrev = () => setPageIdx((p) => (p - 1 + totalPages) % totalPages);
  const goNext = () => setPageIdx((p) => (p + 1) % totalPages);

  // Phase 7: register the capture keydown listener ONCE and read all volatile
  // state through refs. Listing currentPage/items in deps used to rebind a
  // global capture listener on every page rotation and every focus tick.
  const focusIdxRef = useRef(focusIdx);
  const pageIdxRef = useRef(pageIdx);
  const itemsRef = useRef(items);
  const currentPageRef = useRef(currentPage);
  const totalPagesRef = useRef(totalPages);
  const activeRef = useRef(active);
  const onExitDownRef = useRef(onExitDown);
  const onExitUpRef = useRef(onExitUp);

  useEffect(() => { focusIdxRef.current = focusIdx; }, [focusIdx]);
  useEffect(() => { pageIdxRef.current = pageIdx; }, [pageIdx]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { onExitDownRef.current = onExitDown; }, [onExitDown]);
  useEffect(() => { onExitUpRef.current = onExitUp; }, [onExitUp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      const focusIdx = focusIdxRef.current;
      const pageIdx = pageIdxRef.current;
      const items = itemsRef.current;
      const currentPage = currentPageRef.current;
      const totalPages = totalPagesRef.current;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault(); e.stopPropagation();
          if (focusIdx > 0) {
            setFocusIdx(focusIdx - 1);
          } else if (totalPages > 1) {
            const newPage = (pageIdx - 1 + totalPages) % totalPages;
            setPageIdx(newPage);
            const newPageLen = Math.min(PAGE_SIZE, items.length);
            setTimeout(() => setFocusIdx(Math.max(0, newPageLen - 1)), 0);
          }
          break;
        case 'ArrowRight':
          e.preventDefault(); e.stopPropagation();
          if (focusIdx < currentPage.length - 1) {
            setFocusIdx(focusIdx + 1);
          } else if (totalPages > 1) {
            setPageIdx((pageIdx + 1) % totalPages);
            setFocusIdx(0);
          }
          break;
        case 'ArrowDown':
          e.preventDefault(); e.stopPropagation();
          onExitDownRef.current?.();
          break;
        case 'ArrowUp':
          e.preventDefault(); e.stopPropagation();
          onExitUpRef.current?.();
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault(); e.stopPropagation();
          const item = currentPage[focusIdx];
          if (item) handleClick(item);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const isEmpty = items.length === 0;

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-media-bar
      // flex-shrink-0: this is a flex item in the home column; without it the
      // bar is what gets squeezed when the page runs short of height and its
      // own overflow:hidden then crops the tiles.
      className="relative z-10 flex-shrink-0 border-y border-primary/30"
      style={{
        backgroundColor: 'hsl(var(--brand-navy) / 0.95)',
        contain: 'layout paint style',
      }}
    >
      <div className="flex items-stretch gap-3 py-3 px-2">
        <button
          type="button"
          onClick={goPrev}
          disabled={isEmpty || totalPages <= 1}
          aria-label="Previous"
          className="flex-shrink-0 flex items-center justify-center w-10 rounded-xl bg-black/40 hover:bg-black/70 text-white disabled:opacity-30 transition-transform duration-150 ease-out hover:scale-110"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <div className="flex-1 grid gap-3 min-w-0" style={{ gridTemplateColumns: `repeat(${PAGE_SIZE}, minmax(0, 1fr))` }}>
          {isEmpty
            ? (loaded ? null : Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <div key={i} className="media-poster rounded-2xl bg-black/30 animate-pulse" />
              )))
            : currentPage.map((item, idx) => {
                const badge = SOURCE_BADGE[item.source];
                const clickable = !!item.channel || !!item.ratingKey || !!item.deepLink || !!item.webLink;
                const isFocused = active && idx === focusIdx;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => clickable && handleClick(item)}
                    disabled={!clickable}
                    title={item.title}
                    data-focused={isFocused ? 'true' : 'false'}
                    className={`tv-ring flex flex-col bg-black/40 border border-white/10 rounded-2xl overflow-hidden text-left min-w-0 transition-transform duration-200 ease-out ${
                      isFocused
                        ? 'scale-[1.08] z-10'
                        : ''
                    }`}
                  >
                    <div className={`relative w-full flex-shrink-0 overflow-hidden media-poster ${item.channel ? 'bg-white/90' : 'bg-black/60'}`}>
                      {item.poster && imagesReady ? (
                        <BarPoster
                          src={item.poster}
                          // Channel logos are drawn for a light card and must
                          // not be cropped; posters fill the tile.
                          className={item.channel ? 'absolute inset-0 m-auto max-w-[80%] max-h-[70%] object-contain' : 'absolute top-0 left-0 w-full h-full object-cover'}
                        />
                      ) : item.channel ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Tv className="w-8 h-8 text-black/40" />
                        </div>
                      ) : null}
                      {badge && (
                        <span
                          className="absolute top-2 left-2 text-xs font-bold tracking-wider px-2 py-1 rounded-lg"
                          style={{ backgroundColor: badge.color, color: 'hsl(0 0% 10%)' }}
                        >
                          {badge.label}
                        </span>
                      )}
                    </div>
                    <div className="px-3 py-2 min-w-0 w-full media-tile-text">
                      <span className="text-white text-sm font-semibold leading-tight line-clamp-1">
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span className="text-brand-ice/70 text-xs leading-tight line-clamp-1">
                          {item.subtitle}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
        </div>

        <button
          type="button"
          onClick={goNext}
          disabled={isEmpty || totalPages <= 1}
          aria-label="Next"
          className="flex-shrink-0 flex items-center justify-center w-10 rounded-md bg-black/40 hover:bg-black/70 text-white disabled:opacity-30 transition-all hover:scale-110"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-1 pb-2">
          <span className="text-xs text-white/50 mr-2">∞</span>
          {Array.from({ length: Math.min(totalPages, 12) }).map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-[width] duration-150 ease-out ${
                i === pageIdx % 12 ? 'w-4 bg-primary' : 'w-1 bg-white/30'
              }`}
            />
          ))}
          <span className="text-xs text-brand-ice/70 ml-2">{pageIdx + 1}/{totalPages}</span>
        </div>
      )}

      <Dialog open={demoNotice} onOpenChange={(o) => { if (!o) setDemoNotice(false); }}>
        <DialogContent className="max-w-md sm:rounded-3xl">
          <DialogHeader>
            <DialogTitle>Live demo</DialogTitle>
          </DialogHeader>
          <p className="text-white/80 font-nunito text-sm leading-relaxed">{DEMO_DIALOG_MSG}</p>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-12 px-6 rounded-xl text-base transition-transform duration-150 ease-out bg-blue-600/20 border-blue-400/50 text-white hover:bg-blue-600/40"
              onClick={() => setDemoNotice(false)}
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

MediaBar.displayName = 'MediaBar';

export default MediaBar;
