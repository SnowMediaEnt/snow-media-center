import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { ArrowLeft, Loader2, Play, Search, Star } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import {
  getVodCategories,
  getVodStreams,
  getVodInfo,
  buildMovieUrl,
  loadVolume,
  saveVolume,
  XTREAM_REFRESH_EVENT,
  type XtreamCreds,
  type XtreamCategory,
  type XtreamVodStream,
  type XtreamVodInfo,
} from '@/lib/xtream';
import PosterCard from './PosterCard';
import { isFireTV } from '@/utils/platform';
import { trackEvent } from '@/lib/analytics';
import { isDemo, DEMO_DIALOG_MSG } from '@/lib/demoMode';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';
import SnowLoader from '@/components/SnowLoader';
import { useTransientVisible } from '@/hooks/useTransientVisible';

const VideoPlayer = lazy(() => import('./VideoPlayer'));

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
}

type Pane = 'categories' | 'grid' | 'detail';
const ALL_ID = '__all__';
const GRID_COLS = 5;
// Demo latch (?demo=1) — canned catalog; play shows the demo dialog instead.
const DEMO = isDemo();

const MoviesSection = memo(({ creds, isActive, onExitLeft, onExitUp }: Props) => {
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [moviesByCat, setMoviesByCat] = useState<Map<string, XtreamVodStream[]>>(new Map());
  const [loadingCat, setLoadingCat] = useState<string | null>(null);

  const [pane, setPane] = useState<Pane>('categories');
  // Start on ALL sentinel (0). A separate effect bumps focus to the first
  // REAL category (index 1) once categories arrive, but only if the user
  // hasn't moved yet. This prevents accidentally triggering an "All Movies"
  // fetch on a transient frame where visibleCategories.length === 1.
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [gridIdx, setGridIdx] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchFocusedRef = useRef(searchFocused);
  useEffect(() => { searchFocusedRef.current = searchFocused; }, [searchFocused]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Tracks whether the user has explicitly moved category focus.
  const userMovedRef = useRef(false);
  // "All Movies" loads the entire VOD catalog (huge) — never auto-load.
  // Only fetch when the user explicitly opens that bucket (Enter / click).
  const allOptedInRef = useRef(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allMovies, setAllMovies] = useState<XtreamVodStream[] | null>(null);
  const [allMoviesLoading, setAllMoviesLoading] = useState(false);

  const [selectedMovie, setSelectedMovie] = useState<XtreamVodStream | null>(null);
  const [movieInfo, setMovieInfo] = useState<XtreamVodInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null);
  // On-screen title: shows 4 s on play / title change / any key, then hides.
  const [titleShown] = useTransientVisible(4000, { watchKeys: !!playing, deps: [playing?.title ?? null] });
  const [demoNotice, setDemoNotice] = useState(false);
  const [volume, setVolume] = useState(() => loadVolume());
  useEffect(() => { saveVolume(volume); }, [volume]);

  // Refresh tick — clear per-category cache + refetch categories on the
  // global 'xtream:refresh' event. We never eagerly fetch every category.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const onRefresh = () => {
      setMoviesByCat(new Map());
      setAllMovies(null);
      allOptedInRef.current = false;
      setRefreshTick(t => t + 1);
    };
    window.addEventListener(XTREAM_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(XTREAM_REFRESH_EVENT, onRefresh);
  }, []);

  // Fetch categories on mount + on each refresh tick.
  useEffect(() => {
    let cancelled = false;
    setCategoriesLoading(true);
    (async () => {
      try {
        const cats = await getVodCategories(creds).catch(() => [] as XtreamCategory[]);
        if (cancelled) return;
        setCategories(cats);
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [creds, refreshTick]);

  const visibleCategories = useMemo(() => {
    const base = [{ id: ALL_ID, name: 'All Movies' }];
    for (const c of categories) base.push({ id: String(c.category_id), name: c.category_name });
    return base;
  }, [categories]);

  // Clamp focus when category list shrinks; once real categories arrive, bump
  // focus to the first real category (index 1) iff the user hasn't moved yet.
  useEffect(() => {
    if (visibleCategories.length === 0) return;
    if (categoryIdx >= visibleCategories.length) {
      setCategoryIdx(visibleCategories.length - 1);
      return;
    }
    if (
      categories.length > 0 &&
      !userMovedRef.current &&
      categoryIdx < 1 &&
      visibleCategories.length > 1
    ) {
      setCategoryIdx(1);
    }
  }, [visibleCategories.length, categoryIdx, categories.length]);

  const currentCat = visibleCategories[categoryIdx];

  // Lazy-load focused category's movies.
  // "All Movies" is STRICTLY opt-in: never auto-fetch on focus.
  useEffect(() => {
    if (pane !== 'grid') return;
    if (!currentCat) return;
    if (currentCat.id === ALL_ID && !allOptedInRef.current) return;
    if (moviesByCat.has(currentCat.id)) return;
    let cancelled = false;
    const key = currentCat.id;
    setLoadingCat(key);
    const p = key === ALL_ID ? getVodStreams(creds) : getVodStreams(creds, key);
    p.then(list => {
      if (cancelled) return;
      setMoviesByCat(prev => { const n = new Map(prev); n.set(key, list); return n; });
    }).catch(() => {
      if (cancelled) return;
      setMoviesByCat(prev => { const n = new Map(prev); n.set(key, []); return n; });
    }).finally(() => {
      if (cancelled) return;
      setLoadingCat(prev => prev === key ? null : prev);
    });
    return () => { cancelled = true; };
  }, [pane, currentCat, creds, moviesByCat]);

  // Lazy-load the full movie catalog when the search panel opens.
  useEffect(() => {
    if (!searchOpen) return;
    if (allMovies || allMoviesLoading) return;
    setAllMoviesLoading(true);
    let cancelled = false;
    getVodStreams(creds)
      .then(list => { if (!cancelled) setAllMovies(list); })
      .catch(() => { if (!cancelled) setAllMovies([]); })
      .finally(() => { if (!cancelled) setAllMoviesLoading(false); });
    return () => { cancelled = true; };
  }, [searchOpen, allMovies, allMoviesLoading, creds]);

  const visibleMovies = useMemo(() => {
    if (searchOpen) {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return [];
      const src = allMovies || [];
      const out: XtreamVodStream[] = [];
      for (const m of src) {
        if (m.name.toLowerCase().includes(q)) {
          out.push(m);
          if (out.length >= 500) break;
        }
      }
      return out;
    }
    if (!currentCat) return [];
    return moviesByCat.get(currentCat.id) || [];
  }, [searchOpen, searchQuery, allMovies, currentCat, moviesByCat]);

  // Only show "loading" for buckets we actually fetch. The All-Movies sentinel
  // doesn't auto-load, so don't render a spinner there until the user opts in.
  const moviesLoading = searchOpen
    ? allMoviesLoading
    : !!(
        currentCat
        && (currentCat.id !== ALL_ID || allOptedInRef.current)
        && (loadingCat === currentCat.id || !moviesByCat.has(currentCat.id))
      );


  // Reset grid focus when switching category.
  useEffect(() => { setGridIdx(0); }, [categoryIdx, searchOpen, searchQuery]);
  useEffect(() => { if (gridIdx >= visibleMovies.length) setGridIdx(0); }, [visibleMovies.length, gridIdx]);

  // Load detail
  const openMovie = useCallback(async (m: XtreamVodStream) => {
    setSelectedMovie(m);
    setMovieInfo(null);
    setPane('detail');
    setInfoLoading(true);
    try {
      const info = await getVodInfo(creds, m.stream_id);
      setMovieInfo(info);
    } catch {
      setMovieInfo(null);
    } finally {
      setInfoLoading(false);
    }
  }, [creds]);

  const playMovie = useCallback(() => {
    // Demo: never build a stream URL or mount a player — show the demo dialog.
    if (DEMO) { setDemoNotice(true); return; }
    if (!selectedMovie) return;
    const ext = movieInfo?.movie_data?.container_extension || selectedMovie.container_extension || 'mp4';
    const url = buildMovieUrl(creds, selectedMovie.stream_id, ext);
    setPlaying({ url, title: selectedMovie.name });
    try { trackEvent('movie_play', 'player', { title: selectedMovie.name }); } catch { /* ignore */ }
  }, [creds, selectedMovie, movieInfo]);

  // player_search — debounce
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (!q) return;
    const t = window.setTimeout(() => {
      if (!DEMO) { try { trackEvent('player_search', 'player', { scope: 'movies', query: q.slice(0, 64) }); } catch { /* ignore */ } }
    }, 750);
    return () => window.clearTimeout(t);
  }, [searchOpen, searchQuery]);


  // Keyboard
  const paneRef = useRef(pane);
  const categoryIdxRef = useRef(categoryIdx);
  const gridIdxRef = useRef(gridIdx);
  const visibleCategoriesRef = useRef(visibleCategories);
  const visibleMoviesRef = useRef(visibleMovies);
  const playingRef = useRef(playing);
  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { categoryIdxRef.current = categoryIdx; }, [categoryIdx]);
  useEffect(() => { gridIdxRef.current = gridIdx; }, [gridIdx]);
  useEffect(() => { visibleCategoriesRef.current = visibleCategories; }, [visibleCategories]);
  useEffect(() => { visibleMoviesRef.current = visibleMovies; }, [visibleMovies]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  const searchOpenRef = useRef(searchOpen);
  useEffect(() => { searchOpenRef.current = searchOpen; }, [searchOpen]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;

      // Fullscreen player owns keys
      if (playingRef.current) {
        if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) {
          e.preventDefault(); e.stopPropagation();
          setPlaying(null);
          return;
        }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); setVolume(v => Math.max(0, +(v - 0.05).toFixed(2))); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); setVolume(v => Math.min(1, +(v + 0.05).toFixed(2))); return; }
        return;
      }

      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        if (paneRef.current === 'detail') { setPane('grid'); setSelectedMovie(null); }
        else if (paneRef.current === 'grid') setPane('categories');
        else onExitLeft();
        return;
      }

      const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!arrows.includes(e.key)) return;
      e.preventDefault();

      if (paneRef.current === 'categories') {
        const cats = visibleCategoriesRef.current;
        if (searchFocusedRef.current) {
          if (e.key === 'ArrowUp')   { setSearchFocused(false); onExitUp?.(); return; }
          if (e.key === 'ArrowDown') {
            if (searchOpenRef.current && searchInputRef.current) { searchInputRef.current.focus(); return; }
            setSearchFocused(false); return;
          }
          if (e.key === 'ArrowLeft') { onExitLeft(); return; }
          if (e.key === 'Enter' || e.key === ' ') {
            const willOpen = !searchOpenRef.current;
            setSearchOpen(willOpen);
            if (willOpen) requestAnimationFrame(() => searchInputRef.current?.focus());
            else setSearchQuery('');
            return;
          }
          return;
        }
        if (e.key === 'ArrowDown') { userMovedRef.current = true; setCategoryIdx(i => cats.length ? (i + 1) % cats.length : 0); }
        else if (e.key === 'ArrowUp') {
          if (categoryIdxRef.current === 0) { setSearchFocused(true); return; }
          userMovedRef.current = true;
          setCategoryIdx(i => cats.length ? (i - 1 + cats.length) % cats.length : 0);
        }
        else if (e.key === 'ArrowLeft') onExitLeft();
        else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
          userMovedRef.current = true;
          if (cats[categoryIdxRef.current]?.id === ALL_ID) allOptedInRef.current = true;
          setPane('grid');
        }
        return;
      }

      if (paneRef.current === 'grid') {
        const list = visibleMoviesRef.current;
        const i = gridIdxRef.current;
        if (!list.length) return;
        if (e.key === 'ArrowRight') {
          if ((i + 1) % GRID_COLS !== 0 && i + 1 < list.length) setGridIdx(i + 1);
        } else if (e.key === 'ArrowLeft') {
          if (i % GRID_COLS === 0) setPane('categories');
          else setGridIdx(i - 1);
        } else if (e.key === 'ArrowDown') {
          const next = i + GRID_COLS;
          setGridIdx(next < list.length ? next : i); // stay on last row
        } else if (e.key === 'ArrowUp') {
          if (i < GRID_COLS) { if (onExitUp) onExitUp(); return; }
          setGridIdx(i - GRID_COLS);
        
        } else if (e.key === 'Enter' || e.key === ' ') {
          const m = list[i];
          if (m) openMovie(m);
        }
        return;
      }

      if (paneRef.current === 'detail') {
        if (e.key === 'Enter' || e.key === ' ') playMovie();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, onExitLeft, onExitUp, openMovie, playMovie]);

  // --- Virtualize grid by rows ---
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  // Virtualize grid by rows — measure row height from real layout so the
  // virtual stride matches the rendered poster row at any TV resolution.
  const [rowH, setRowH] = useState(280);
  const rowHRef = useRef(280);
  useEffect(() => { rowHRef.current = rowH; }, [rowH]);
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const calc = () => {
      const cs = getComputedStyle(el);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const gap = 16; // gap-4
      const inner = Math.max(0, el.clientWidth - padL - padR);
      const colW = (inner - gap * (GRID_COLS - 1)) / GRID_COLS;
      const posterH = colW * 1.5; // aspect 2/3
      const titleArea = 56;
      const next = Math.max(180, Math.ceil(posterH + titleArea + 16));
      setRowH(prev => (prev !== next ? next : prev));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rowCount = Math.ceil(visibleMovies.length / GRID_COLS);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridScrollRef.current,
    estimateSize: () => rowHRef.current,
    overscan: isFireTV() ? 1 : 3,
  });
  useEffect(() => { rowVirtualizer.measure(); /* eslint-disable-next-line */ }, [rowH]);

  useEffect(() => { rowVirtualizer.scrollToOffset(0); /* eslint-disable-next-line */ }, [categoryIdx, searchOpen, searchQuery]);

  useEffect(() => {
    if (!visibleMovies.length) return;
    const row = Math.floor(gridIdx / GRID_COLS);
    rowVirtualizer.scrollToIndex(row, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridIdx, visibleMovies.length]);

  // Demo notice owns the D-pad while open: swallow every key so focus can't
  // leak into the grid behind it. OK / Back / Escape dismiss. (Plex pattern.)
  useEffect(() => {
    if (!demoNotice) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
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
      <div className="max-w-md w-full rounded-3xl border border-brand-gold/40 bg-[#0b1622] p-8 text-center shadow-2xl">
        <p className="font-nunito text-white/90 text-base leading-relaxed">{DEMO_DIALOG_MSG}</p>
        <button type="button" autoFocus onClick={() => setDemoNotice(false)}
          className="mt-6 px-6 py-3 rounded-xl bg-brand-gold text-black font-semibold font-nunito focus:outline-none focus:ring-2 focus:ring-white">
          OK
        </button>
      </div>
    </div>
  ) : null;

  // Fullscreen player
  if (playing) {
    return (
      <div className="fixed inset-0 z-[60] bg-black">
        <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><div className="w-full max-w-md"><SnowLoader size="lg" label="Loading…" /></div></div>}>
          <VideoPlayer
            src={playing.url}
            volume={volume}
            className="w-full h-full"
            onError={(msg) => {
              try { trackEvent('player_error', 'player', { kind: 'movie', channel_or_title: playing.title, server: creds.serverLabel, message: msg.slice(0, 200) }); } catch { /* ignore */ }
            }}
          />
        </Suspense>
        {titleShown && (
          <div className="absolute top-4 left-4 max-w-[70%] truncate px-4 py-2 rounded-xl bg-black/70 text-white font-quicksand font-bold text-lg pointer-events-none">
            {playing.title}
          </div>
        )}
      </div>
    );
  }

  // Detail view
  if (pane === 'detail' && selectedMovie) {
    const info = movieInfo?.info;
    const cover = info?.movie_image || info?.cover_big || selectedMovie.stream_icon;
    return (
      <div className="flex-1 min-h-0 flex flex-col text-white bg-black/40">
        <div className={`${BACK_ROW} flex-shrink-0 px-8 pt-8 mb-4`}>
          <BackButton onClick={() => { setPane('grid'); setSelectedMovie(null); }} label="Back" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8">
        <div className="flex gap-8 max-w-4xl">
          <div className="w-80 aspect-[2/3] rounded-2xl overflow-hidden bg-black/40 border border-white/10 flex-shrink-0">
            {cover ? <img src={cover} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : <div className="w-full h-full" />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-3xl font-quicksand font-bold mb-3">{selectedMovie.name}</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm text-brand-ice/80 font-nunito mb-4">
              {info?.rating != null && (
                <span className="flex items-center gap-1"><Star className="w-4 h-4 text-brand-gold fill-brand-gold" />{Number(info.rating).toFixed(1)}</span>
              )}
              {info?.releasedate && <span>{String(info.releasedate).slice(0, 4)}</span>}
              {info?.genre && <span>{info.genre}</span>}
              {info?.duration && <span>{info.duration}</span>}
            </div>
            {infoLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
            ) : (
              <p className="text-brand-ice/90 font-nunito leading-relaxed max-w-3xl mb-6">
                {info?.plot || 'No description available.'}
              </p>
            )}
            <Button
              variant="gold"
              onClick={playMovie}
              autoFocus
              data-focused={isActive && !demoNotice ? 'true' : 'false'}
              className="tv-ring tv-ring-contrast h-12 rounded-xl text-xl px-8 transition-transform duration-150 ease-out scale-105 z-10"
            >
              <Play className="w-5 h-5 mr-2 fill-current" />
              Play Movie
            </Button>
          </div>
        </div>
        </div>
        {demoNoticeOverlay}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex">
      {/* Pane 2 — Categories */}
      <div className={`w-64 max-w-[16rem] flex-shrink-0 border-r border-white/10 p-3 overflow-y-auto overflow-x-hidden bg-black/40 ${pane === 'categories' && isActive ? 'bg-white/5' : ''}`}>
        <button
          onClick={() => setSearchOpen(o => !o)}
          data-focused={searchFocused ? 'true' : 'false'}
          className={`tv-ring w-full flex items-center gap-2 px-3 py-3 mb-2 rounded-xl border border-white/10 text-brand-ice font-nunito text-base ${searchFocused ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-black/40'}`}
        >
          <Search className="w-4 h-4" />
          {searchOpen ? 'Close search' : 'Search movies'}
        </button>
        {searchOpen && (
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.blur(); setPane('grid'); setGridIdx(0); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); e.currentTarget.blur(); setSearchFocused(true); }
              else if (e.key === 'Escape')  { e.preventDefault(); e.currentTarget.blur(); setSearchFocused(true); }
            }}
            placeholder="Type to search…"
            className="w-full mb-3 rounded-xl bg-black/40 text-white border border-white/20 px-3 py-3 font-nunito text-base focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
        )}
        {!searchOpen && (
          <div className="space-y-1">
            {categoriesLoading && categories.length === 0 && (
              <div className="px-3 py-2 text-brand-ice/70 font-nunito text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> Loading categories…
              </div>
            )}
            {visibleCategories.map((c, i) => {
              const isFocused = isActive && pane === 'categories' && !searchFocused && categoryIdx === i;
              const isSelected = categoryIdx === i;
              const isLoadingThis = loadingCat === c.id;
              return (
                <div
                  key={c.id}
                  data-focused={isFocused ? 'true' : 'false'}
                  onClick={() => {
                    userMovedRef.current = true;
                    if (c.id === ALL_ID) allOptedInRef.current = true;
                    setCategoryIdx(i); setGridIdx(0); setPane('grid');
                  }}
                  className={`
                    tv-ring flex items-center gap-2 px-3 py-3 rounded-xl cursor-pointer font-nunito text-brand-ice
                    ${isFocused ? 'bg-brand-gold/25 scale-[1.02] z-10' : ''}
                    ${!isFocused && isSelected ? 'bg-white/10' : ''}
                    ${!isFocused && !isSelected ? 'hover:bg-white/5' : ''}
                  `}
                >
                  <span className="flex-1 truncate">{c.name}</span>
                  {isLoadingThis && <Loader2 className="w-3 h-3 animate-spin text-brand-gold flex-shrink-0" />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pane 3 — Grid (virtualized by row) */}
      <div ref={gridScrollRef} className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-6 bg-black/30">
        {moviesLoading && visibleMovies.length === 0 ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}>
            {Array.from({ length: GRID_COLS * 3 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-white/5 animate-pulse" style={{ aspectRatio: '2 / 3' }} />
            ))}
          </div>
        ) : visibleMovies.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito">
            {searchOpen
              ? (searchQuery
                  ? (allMoviesLoading ? 'Loading movie catalog…' : 'No movies match your search.')
                  : (allMoviesLoading ? 'Loading movie catalog…' : 'Type to search all movies.'))
              : 'No movies in this category.'}
          </div>

        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {rowVirtualizer.getVirtualItems().map(vr => {
              const rowStart = vr.index * GRID_COLS;
              const rowItems = visibleMovies.slice(rowStart, rowStart + GRID_COLS);
              return (
                <div
                  key={vr.key}
                  className="grid gap-4"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vr.start}px)`,
                    height: rowH,
                    gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
                    paddingBottom: 16,
                  }}
                >
                  {rowItems.map((m, ci) => {
                    const i = rowStart + ci;
                    const isFocused = isActive && pane === 'grid' && i === gridIdx;
                    return (
                      <div key={m.stream_id}>
                        <PosterCard
                          title={m.name}
                          image={m.stream_icon}
                          rating={m.rating_5based ? m.rating_5based * 2 : m.rating}
                          year={m.year}
                          isFocused={isFocused}
                          variant="movie"
                          onFocus={() => { setGridIdx(i); setPane('grid'); }}
                          onActivate={() => openMovie(m)}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {demoNoticeOverlay}
    </div>
  );
});

MoviesSection.displayName = 'MoviesSection';
export default MoviesSection;
