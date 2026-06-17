import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { ArrowLeft, Loader2, Play, Star } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import {
  getVodCategories,
  getVodStreams,
  getVodInfo,
  buildMovieUrl,
  loadVolume,
  saveVolume,
  type XtreamCreds,
  type XtreamCategory,
  type XtreamVodStream,
  type XtreamVodInfo,
} from '@/lib/xtream';
import PosterCard from './PosterCard';

const VideoPlayer = lazy(() => import('./VideoPlayer'));

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
}

type Pane = 'categories' | 'grid' | 'detail';
const ALL_ID = '__all__';
const GRID_COLS = 5;

const MoviesSection = memo(({ creds, isActive, onExitLeft }: Props) => {
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [moviesByCat, setMoviesByCat] = useState<Map<string, XtreamVodStream[]>>(new Map());
  const [loadingCat, setLoadingCat] = useState<string | null>(null);

  const [pane, setPane] = useState<Pane>('categories');
  // 0 = "All Movies" sentinel; default to first real category if available.
  const [categoryIdx, setCategoryIdx] = useState(1);
  const [gridIdx, setGridIdx] = useState(0);

  const [selectedMovie, setSelectedMovie] = useState<XtreamVodStream | null>(null);
  const [movieInfo, setMovieInfo] = useState<XtreamVodInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null);
  const [volume, setVolume] = useState(() => loadVolume());
  useEffect(() => { saveVolume(volume); }, [volume]);

  // Fetch categories only
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
  }, [creds]);

  const visibleCategories = useMemo(() => {
    const base = [{ id: ALL_ID, name: 'All Movies' }];
    for (const c of categories) base.push({ id: String(c.category_id), name: c.category_name });
    return base;
  }, [categories]);

  useEffect(() => {
    if (categoryIdx >= visibleCategories.length) setCategoryIdx(Math.max(0, visibleCategories.length - 1));
  }, [visibleCategories.length, categoryIdx]);

  const currentCat = visibleCategories[categoryIdx];

  // Lazy-load category's movies (ALL only on explicit selection — same gating)
  useEffect(() => {
    if (!currentCat) return;
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
  }, [currentCat, creds, moviesByCat]);

  const visibleMovies = useMemo(() => {
    if (!currentCat) return [];
    return moviesByCat.get(currentCat.id) || [];
  }, [currentCat, moviesByCat]);

  const moviesLoading = currentCat && (loadingCat === currentCat.id || !moviesByCat.has(currentCat.id));


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
    if (!selectedMovie) return;
    const ext = movieInfo?.movie_data?.container_extension || selectedMovie.container_extension || 'mp4';
    const url = buildMovieUrl(creds, selectedMovie.stream_id, ext);
    setPlaying({ url, title: selectedMovie.name });
  }, [creds, selectedMovie, movieInfo]);

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
        if (e.key === 'ArrowDown') setCategoryIdx(i => cats.length ? (i + 1) % cats.length : 0);
        else if (e.key === 'ArrowUp') setCategoryIdx(i => cats.length ? (i - 1 + cats.length) % cats.length : 0);
        else if (e.key === 'ArrowLeft') onExitLeft();
        else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { setPane('grid'); }
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
          if (i < GRID_COLS) return;
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
  }, [isActive, onExitLeft, openMovie, playMovie]);

  // --- Virtualize grid by rows ---
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const rowCount = Math.ceil(visibleMovies.length / GRID_COLS);
  // Row height: poster aspect 2/3, plus title (~3rem). Container is fluid; estimate ~ 280px.
  const ROW_H = 280;
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridScrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 3,
  });

  useEffect(() => { rowVirtualizer.scrollToOffset(0); /* eslint-disable-next-line */ }, [categoryIdx]);

  useEffect(() => {
    if (!visibleMovies.length) return;
    const row = Math.floor(gridIdx / GRID_COLS);
    rowVirtualizer.scrollToIndex(row, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridIdx, visibleMovies.length]);

  // Fullscreen player
  if (playing) {
    return (
      <div className="fixed inset-0 z-[60] bg-black">
        <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-brand-gold" /></div>}>
          <VideoPlayer src={playing.url} volume={volume} className="w-full h-full" />
        </Suspense>
        <div className="absolute top-4 left-4 text-white font-quicksand font-bold text-lg drop-shadow-lg">
          {playing.title}
        </div>
      </div>
    );
  }

  // Detail view
  if (pane === 'detail' && selectedMovie) {
    const info = movieInfo?.info;
    const cover = info?.movie_image || info?.cover_big || selectedMovie.stream_icon;
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-8 text-white">
        <Button variant="white" size="sm" onClick={() => { setPane('grid'); setSelectedMovie(null); }} className="tv-focusable home-focus-surface mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <div className="flex gap-8 max-w-6xl">
          <div className="w-64 aspect-[2/3] rounded-2xl overflow-hidden bg-black/40 border border-white/10 flex-shrink-0">
            {cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full" />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-4xl font-quicksand font-bold mb-3">{selectedMovie.name}</h2>
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
              className="tv-focusable home-focus-surface text-lg px-8 py-6"
            >
              <Play className="w-5 h-5 mr-2 fill-current" />
              Play Movie
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex">
      {/* Pane 2 — Categories */}
      <div className={`w-64 flex-shrink-0 border-r border-white/10 p-3 overflow-y-auto ${pane === 'categories' && isActive ? 'bg-white/5' : ''}`}>
        <div className="space-y-1">
          {visibleCategories.map((c, i) => {
            const isFocused = isActive && pane === 'categories' && categoryIdx === i;
            const isSelected = categoryIdx === i;
            return (
              <div
                key={c.id}
                data-focused={isFocused ? 'true' : 'false'}
                onClick={() => { setCategoryIdx(i); setGridIdx(0); setPane('grid'); }}
                className={`
                  px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 font-nunito text-brand-ice
                  ${isFocused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-[1.02] shadow-lg' : ''}
                  ${!isFocused && isSelected ? 'bg-white/10' : ''}
                  ${!isFocused && !isSelected ? 'hover:bg-white/5' : ''}
                `}
              >
                {c.name}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pane 3 — Grid (virtualized by row) */}
      <div ref={gridScrollRef} className="flex-1 min-w-0 overflow-y-auto p-5">
        {loading ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}>
            {Array.from({ length: GRID_COLS * 3 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-white/5 animate-pulse" style={{ aspectRatio: '2 / 3' }} />
            ))}
          </div>
        ) : visibleMovies.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/60 font-nunito">No movies in this category.</div>
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
                    height: ROW_H,
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
    </div>
  );
});

MoviesSection.displayName = 'MoviesSection';
export default MoviesSection;
