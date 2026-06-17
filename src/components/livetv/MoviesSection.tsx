import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { ArrowLeft, Loader2, Play, Star } from 'lucide-react';
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
import { MOCK_VOD_CATEGORIES, MOCK_VOD_STREAMS, mockVodInfo } from '@/lib/mockLiveTV';
import PosterCard from './PosterCard';

const VideoPlayer = lazy(() => import('./VideoPlayer'));

interface Props {
  creds: XtreamCreds | null;
  usingMock: boolean;
  isActive: boolean;
  onExitLeft: () => void;
}

type Pane = 'categories' | 'grid' | 'detail';
const ALL_ID = '__all__';
const GRID_COLS = 5;

const MoviesSection = memo(({ creds, usingMock, isActive, onExitLeft }: Props) => {
  const [categories, setCategories] = useState<XtreamCategory[]>(MOCK_VOD_CATEGORIES);
  const [movies, setMovies] = useState<XtreamVodStream[]>(MOCK_VOD_STREAMS);
  const [loading, setLoading] = useState(false);

  const [pane, setPane] = useState<Pane>('categories');
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [gridIdx, setGridIdx] = useState(0);

  const [selectedMovie, setSelectedMovie] = useState<XtreamVodStream | null>(null);
  const [movieInfo, setMovieInfo] = useState<XtreamVodInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null);
  const [volume, setVolume] = useState(() => loadVolume());
  useEffect(() => { saveVolume(volume); }, [volume]);

  // Fetch
  useEffect(() => {
    let cancelled = false;
    if (!creds || usingMock) {
      setCategories(MOCK_VOD_CATEGORIES);
      setMovies(MOCK_VOD_STREAMS);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const [cats, vods] = await Promise.all([
          getVodCategories(creds).catch(() => [] as XtreamCategory[]),
          getVodStreams(creds).catch(() => [] as XtreamVodStream[]),
        ]);
        if (cancelled) return;
        setCategories(cats);
        setMovies(vods);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [creds, usingMock]);

  const visibleCategories = useMemo(() => {
    const base = [{ id: ALL_ID, name: 'All Movies' }];
    for (const c of categories) base.push({ id: c.category_id, name: c.category_name });
    return base;
  }, [categories]);

  const visibleMovies = useMemo(() => {
    const cat = visibleCategories[categoryIdx];
    if (!cat) return [];
    if (cat.id === ALL_ID) return movies;
    return movies.filter(m => m.category_id === cat.id);
  }, [visibleCategories, categoryIdx, movies]);

  useEffect(() => { if (gridIdx >= visibleMovies.length) setGridIdx(0); }, [visibleMovies.length, gridIdx]);

  // Load detail
  const openMovie = useCallback(async (m: XtreamVodStream) => {
    setSelectedMovie(m);
    setMovieInfo(null);
    setPane('detail');
    if (!creds || usingMock) {
      setMovieInfo(mockVodInfo(m));
      return;
    }
    setInfoLoading(true);
    try {
      const info = await getVodInfo(creds, m.stream_id);
      setMovieInfo(info);
    } catch {
      setMovieInfo(mockVodInfo(m));
    } finally {
      setInfoLoading(false);
    }
  }, [creds, usingMock]);

  const playMovie = useCallback(() => {
    if (!selectedMovie) return;
    if (!creds || usingMock) {
      // Demo mode — nothing to play
      return;
    }
    const ext = movieInfo?.movie_data?.container_extension || selectedMovie.container_extension || 'mp4';
    const url = buildMovieUrl(creds, selectedMovie.stream_id, ext);
    setPlaying({ url, title: selectedMovie.name });
  }, [creds, usingMock, selectedMovie, movieInfo]);

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
        if (e.key === 'ArrowDown') setCategoryIdx(i => Math.min(cats.length - 1, i + 1));
        else if (e.key === 'ArrowUp') setCategoryIdx(i => Math.max(0, i - 1));
        else if (e.key === 'ArrowLeft') onExitLeft();
        else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { setGridIdx(0); setPane('grid'); }
        return;
      }

      if (paneRef.current === 'grid') {
        const list = visibleMoviesRef.current;
        const i = gridIdxRef.current;
        if (e.key === 'ArrowRight') {
          if ((i + 1) % GRID_COLS !== 0 && i + 1 < list.length) setGridIdx(i + 1);
        } else if (e.key === 'ArrowLeft') {
          if (i % GRID_COLS === 0) setPane('categories');
          else setGridIdx(i - 1);
        } else if (e.key === 'ArrowDown') {
          setGridIdx(Math.min(list.length - 1, i + GRID_COLS));
        } else if (e.key === 'ArrowUp') {
          if (i < GRID_COLS) return; // already on top row
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

  const focusedTileRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { focusedTileRef.current?.scrollIntoView({ block: 'nearest' }); }, [gridIdx]);

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
              disabled={!creds || usingMock}
            >
              <Play className="w-5 h-5 mr-2 fill-current" />
              {usingMock || !creds ? 'Sign in to play' : 'Play Movie'}
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

      {/* Pane 3 — Grid */}
      <div className="flex-1 min-w-0 overflow-y-auto p-5">
        {loading ? (
          <div className="h-full flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>
        ) : visibleMovies.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/60 font-nunito">No movies in this category.</div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}>
            {visibleMovies.map((m, i) => {
              const isFocused = isActive && pane === 'grid' && i === gridIdx;
              return (
                <div key={m.stream_id} ref={isFocused ? focusedTileRef : null}>
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
        )}
      </div>
    </div>
  );
});

MoviesSection.displayName = 'MoviesSection';
export default MoviesSection;
