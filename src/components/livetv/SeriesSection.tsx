import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { ArrowLeft, Loader2, Play, Star } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import {
  getSeriesCategories,
  getSeries,
  getSeriesInfo,
  buildEpisodeUrl,
  loadVolume,
  saveVolume,
  type XtreamCreds,
  type XtreamCategory,
  type XtreamSeries,
  type XtreamSeriesInfo,
  type XtreamEpisode,
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
const AUTOPLAY_KEY = 'snow-livetv-autoplay-next';

const SeriesSection = memo(({ creds, isActive, onExitLeft }: Props) => {
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [seriesByCat, setSeriesByCat] = useState<Map<string, XtreamSeries[]>>(new Map());
  const [loadingCat, setLoadingCat] = useState<string | null>(null);

  const [pane, setPane] = useState<Pane>('categories');
  const [categoryIdx, setCategoryIdx] = useState(1);
  const [gridIdx, setGridIdx] = useState(0);

  // Detail
  const [selectedSeries, setSelectedSeries] = useState<XtreamSeries | null>(null);
  const [seriesInfo, setSeriesInfo] = useState<XtreamSeriesInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [episodeIdx, setEpisodeIdx] = useState(0);
  const [detailFocus, setDetailFocus] = useState<'seasons' | 'episodes' | 'play'>('episodes');

  const [playing, setPlaying] = useState<{ url: string; title: string; episodeIdx: number } | null>(null);
  const [volume, setVolume] = useState(() => loadVolume());
  useEffect(() => { saveVolume(volume); }, [volume]);
  const [autoplayNext, setAutoplayNext] = useState<boolean>(() => {
    try { return localStorage.getItem(AUTOPLAY_KEY) !== 'false'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(AUTOPLAY_KEY, String(autoplayNext)); } catch { /* ignore */ }
  }, [autoplayNext]);

  useEffect(() => {
    let cancelled = false;
    setCategoriesLoading(true);
    (async () => {
      try {
        const cats = await getSeriesCategories(creds).catch(() => [] as XtreamCategory[]);
        if (cancelled) return;
        setCategories(cats);
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [creds]);

  const visibleCategories = useMemo(() => {
    const base = [{ id: ALL_ID, name: 'All Series' }];
    for (const c of categories) base.push({ id: String(c.category_id), name: c.category_name });
    return base;
  }, [categories]);

  useEffect(() => {
    if (categoryIdx >= visibleCategories.length) setCategoryIdx(Math.max(0, visibleCategories.length - 1));
  }, [visibleCategories.length, categoryIdx]);

  const currentCat = visibleCategories[categoryIdx];

  useEffect(() => {
    if (!currentCat) return;
    if (seriesByCat.has(currentCat.id)) return;
    let cancelled = false;
    const key = currentCat.id;
    setLoadingCat(key);
    const p = key === ALL_ID ? getSeries(creds) : getSeries(creds, key);
    p.then(list => {
      if (cancelled) return;
      setSeriesByCat(prev => { const n = new Map(prev); n.set(key, list); return n; });
    }).catch(() => {
      if (cancelled) return;
      setSeriesByCat(prev => { const n = new Map(prev); n.set(key, []); return n; });
    }).finally(() => {
      if (cancelled) return;
      setLoadingCat(prev => prev === key ? null : prev);
    });
    return () => { cancelled = true; };
  }, [currentCat, creds, seriesByCat]);

  const visibleSeries = useMemo(() => {
    if (!currentCat) return [];
    return seriesByCat.get(currentCat.id) || [];
  }, [currentCat, seriesByCat]);

  const seriesLoading = currentCat && (loadingCat === currentCat.id || !seriesByCat.has(currentCat.id));

  // Reset grid focus when switching category.
  useEffect(() => { setGridIdx(0); }, [categoryIdx]);
  useEffect(() => { if (gridIdx >= visibleSeries.length) setGridIdx(0); }, [visibleSeries.length, gridIdx]);


  const seasons = seriesInfo?.seasons || [];
  const currentSeasonNumber = seasons[seasonIdx]?.season_number;
  const episodes: XtreamEpisode[] = useMemo(() => {
    if (!seriesInfo || currentSeasonNumber == null) return [];
    return seriesInfo.episodes?.[String(currentSeasonNumber)] || [];
  }, [seriesInfo, currentSeasonNumber]);

  const openSeries = useCallback(async (s: XtreamSeries) => {
    setSelectedSeries(s);
    setSeriesInfo(null);
    setSeasonIdx(0);
    setEpisodeIdx(0);
    setDetailFocus('episodes');
    setPane('detail');
    setInfoLoading(true);
    try {
      const info = await getSeriesInfo(creds, s.series_id);
      setSeriesInfo(info);
    } catch {
      setSeriesInfo(null);
    } finally {
      setInfoLoading(false);
    }
  }, [creds]);

  const playEpisode = useCallback((index: number) => {
    const ep = episodes[index];
    if (!ep || !selectedSeries) return;
    const url = buildEpisodeUrl(creds, ep.id, ep.container_extension || 'mp4');
    setPlaying({
      url,
      title: `${selectedSeries.name} · S${currentSeasonNumber}E${ep.episode_num} · ${ep.title}`,
      episodeIdx: index,
    });
  }, [episodes, selectedSeries, creds, currentSeasonNumber]);

  // Refs
  const paneRef = useRef(pane);
  const categoryIdxRef = useRef(categoryIdx);
  const gridIdxRef = useRef(gridIdx);
  const visibleCategoriesRef = useRef(visibleCategories);
  const visibleSeriesRef = useRef(visibleSeries);
  const playingRef = useRef(playing);
  const detailFocusRef = useRef(detailFocus);
  const seasonIdxRef = useRef(seasonIdx);
  const episodeIdxRef = useRef(episodeIdx);
  const seasonsRef = useRef(seasons);
  const episodesRef = useRef(episodes);
  const autoplayNextRef = useRef(autoplayNext);
  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { categoryIdxRef.current = categoryIdx; }, [categoryIdx]);
  useEffect(() => { gridIdxRef.current = gridIdx; }, [gridIdx]);
  useEffect(() => { visibleCategoriesRef.current = visibleCategories; }, [visibleCategories]);
  useEffect(() => { visibleSeriesRef.current = visibleSeries; }, [visibleSeries]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { detailFocusRef.current = detailFocus; }, [detailFocus]);
  useEffect(() => { seasonIdxRef.current = seasonIdx; }, [seasonIdx]);
  useEffect(() => { episodeIdxRef.current = episodeIdx; }, [episodeIdx]);
  useEffect(() => { seasonsRef.current = seasons; }, [seasons]);
  useEffect(() => { episodesRef.current = episodes; }, [episodes]);
  useEffect(() => { autoplayNextRef.current = autoplayNext; }, [autoplayNext]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;

      if (playingRef.current) {
        if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) {
          e.preventDefault(); e.stopPropagation(); setPlaying(null); return;
        }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); setVolume(v => Math.max(0, +(v - 0.05).toFixed(2))); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); setVolume(v => Math.min(1, +(v + 0.05).toFixed(2))); return; }
        return;
      }

      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        if (paneRef.current === 'detail') { setPane('grid'); setSelectedSeries(null); setSeriesInfo(null); }
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
        const list = visibleSeriesRef.current;
        const i = gridIdxRef.current;
        if (!list.length) return;
        if (e.key === 'ArrowRight') {
          if ((i + 1) % GRID_COLS !== 0 && i + 1 < list.length) setGridIdx(i + 1);
        } else if (e.key === 'ArrowLeft') {
          if (i % GRID_COLS === 0) setPane('categories');
          else setGridIdx(i - 1);
        } else if (e.key === 'ArrowDown') {
          const next = i + GRID_COLS;
          setGridIdx(next < list.length ? next : i);
        } else if (e.key === 'ArrowUp') {
          if (i < GRID_COLS) return;
          setGridIdx(i - GRID_COLS);
        } else if (e.key === 'Enter' || e.key === ' ') {
          const s = list[i];
          if (s) openSeries(s);
        }
        return;
      }

      // pane === 'detail'
      const focus = detailFocusRef.current;
      const seas = seasonsRef.current;
      const eps = episodesRef.current;
      if (focus === 'seasons') {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          if (seasonIdxRef.current + 1 < seas.length) { setSeasonIdx(seasonIdxRef.current + 1); setEpisodeIdx(0); }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          if (seasonIdxRef.current > 0) { setSeasonIdx(seasonIdxRef.current - 1); setEpisodeIdx(0); }
        } else if (e.key === 'Enter' || e.key === ' ') {
          setDetailFocus('episodes');
        }
      } else if (focus === 'episodes') {
        if (e.key === 'ArrowDown') {
          if (!eps.length) return;
          setEpisodeIdx(i => (i + 1) % eps.length);
        }
        else if (e.key === 'ArrowUp') {
          if (!eps.length) return;
          if (episodeIdxRef.current === 0) setDetailFocus('play');
          else setEpisodeIdx(episodeIdxRef.current - 1);
        }
        else if (e.key === 'ArrowLeft') setDetailFocus('seasons');
        else if (e.key === 'Enter' || e.key === ' ') playEpisode(episodeIdxRef.current);
      } else if (focus === 'play') {
        if (e.key === 'ArrowDown') setDetailFocus('episodes');
        else if (e.key === 'ArrowLeft') setDetailFocus('seasons');
        else if (e.key === 'Enter' || e.key === ' ') {
          if (eps.length) { setEpisodeIdx(0); playEpisode(0); }
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, onExitLeft, openSeries, playEpisode]);

  // Virtualize series grid by row — measure row height from real layout so
  // virtual stride matches what's rendered at any TV resolution.
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
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
      const titleArea = 56; // title + meta
      const next = Math.max(180, Math.ceil(posterH + titleArea + 16));
      setRowH(prev => (prev !== next ? next : prev));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rowCount = Math.ceil(visibleSeries.length / GRID_COLS);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridScrollRef.current,
    estimateSize: () => rowHRef.current,
    overscan: 3,
  });
  useEffect(() => { rowVirtualizer.measure(); /* eslint-disable-next-line */ }, [rowH]);
  useEffect(() => { rowVirtualizer.scrollToOffset(0); /* eslint-disable-next-line */ }, [categoryIdx]);
  useEffect(() => {
    if (!visibleSeries.length) return;
    rowVirtualizer.scrollToIndex(Math.floor(gridIdx / GRID_COLS), { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridIdx, visibleSeries.length]);
  const focusedEpRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { focusedEpRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [episodeIdx]);

  // Fullscreen episode player with autoplay next
  if (playing) {
    return (
      <div className="fixed inset-0 z-[60] bg-black">
        <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-brand-gold" /></div>}>
          <VideoPlayer
            src={playing.url}
            volume={volume}
            className="w-full h-full"
            onError={() => { /* let VideoPlayer retry */ }}
          />
        </Suspense>
        <div className="absolute top-4 left-4 right-4 text-white font-quicksand font-bold text-lg drop-shadow-lg truncate">
          {playing.title}
        </div>
        <video
          // hidden listener video isn't useful; rely on ended via main player
          // (mpegts/hls won't fire ended on infinite live; episodes are finite mp4/mkv).
          // We attach an 'ended' listener via the actual <video> in DOM:
          style={{ display: 'none' }}
        />
        {/* Bind to the player's ended event via DOM query */}
        <PlaybackEndedWatcher
          onEnded={() => {
            if (!autoplayNextRef.current) { setPlaying(null); return; }
            const next = playing.episodeIdx + 1;
            if (next < episodes.length) playEpisode(next);
            else setPlaying(null);
          }}
        />
      </div>
    );
  }

  // Detail
  if (pane === 'detail' && selectedSeries) {
    const info = seriesInfo?.info;
    const cover = info?.cover || selectedSeries.cover;
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-6 text-white bg-black/40">
        <Button variant="white" size="sm" onClick={() => { setPane('grid'); setSelectedSeries(null); setSeriesInfo(null); }} className="tv-focusable home-focus-surface mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <div className="flex gap-6 mb-6">
          <div className="w-48 aspect-[2/3] rounded-2xl overflow-hidden bg-black/40 border border-white/10 flex-shrink-0">
            {cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full" />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-3xl font-quicksand font-bold mb-2">{selectedSeries.name}</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm text-brand-ice/80 font-nunito mb-3">
              {info?.rating != null && (
                <span className="flex items-center gap-1"><Star className="w-4 h-4 text-brand-gold fill-brand-gold" />{Number(info.rating).toFixed(1)}</span>
              )}
              {info?.releaseDate && <span>{String(info.releaseDate).slice(0, 4)}</span>}
              {info?.genre && <span>{info.genre}</span>}
            </div>
            {infoLoading ? <Loader2 className="w-5 h-5 animate-spin text-brand-gold" /> : (
              <p className="text-brand-ice/90 font-nunito leading-relaxed line-clamp-4">{info?.plot || 'No description available.'}</p>
            )}
            <div className="flex items-center gap-4 mt-4">
              <Button
                variant="gold"
                onClick={() => { if (episodes.length) { setEpisodeIdx(0); playEpisode(0); } }}
                data-focused={detailFocus === 'play' ? 'true' : 'false'}
                className={`tv-focusable home-focus-surface ${detailFocus === 'play' ? 'ring-2 ring-brand-gold scale-105' : ''}`}
                disabled={!episodes.length}
              >
                <Play className="w-4 h-4 mr-2 fill-current" />
                Play S1·E1
              </Button>
              <label className="flex items-center gap-2 text-sm font-nunito text-brand-ice cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoplayNext}
                  onChange={(e) => setAutoplayNext(e.target.checked)}
                  className="accent-brand-gold w-4 h-4"
                />
                Autoplay next episode
              </label>
            </div>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Seasons */}
          <div className="w-44 flex-shrink-0">
            <h4 className="font-quicksand font-semibold mb-2 text-brand-ice/80">Seasons</h4>
            <div className="space-y-1">
              {seasons.length === 0 && <p className="text-brand-ice/50 text-sm font-nunito">No seasons</p>}
              {seasons.map((s, i) => {
                const focused = detailFocus === 'seasons' && seasonIdx === i;
                const selected = seasonIdx === i;
                return (
                  <div
                    key={s.season_number}
                    onClick={() => { setSeasonIdx(i); setEpisodeIdx(0); setDetailFocus('episodes'); }}
                    className={`
                      px-3 py-2 rounded-lg cursor-pointer font-nunito text-sm transition-all duration-150
                      ${focused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-[1.02]' : ''}
                      ${!focused && selected ? 'bg-white/10' : ''}
                      ${!focused && !selected ? 'hover:bg-white/5' : ''}
                      text-brand-ice
                    `}
                  >
                    {s.name || `Season ${s.season_number}`}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Episodes */}
          <div className="flex-1 min-w-0">
            <h4 className="font-quicksand font-semibold mb-2 text-brand-ice/80">Episodes</h4>
            <div className="space-y-1 max-h-[55vh] overflow-y-auto pr-2">
              {episodes.length === 0 && <p className="text-brand-ice/50 text-sm font-nunito">No episodes</p>}
              {episodes.map((ep, i) => {
                const focused = detailFocus === 'episodes' && episodeIdx === i;
                return (
                  <div
                    key={ep.id}
                    ref={focused ? focusedEpRef : null}
                    onClick={() => { setEpisodeIdx(i); playEpisode(i); }}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150
                      ${focused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-[1.01]' : 'bg-white/5 hover:bg-white/10'}
                    `}
                  >
                    <span className="w-10 text-right font-quicksand font-bold text-brand-gold">{ep.episode_num}</span>
                    <span className="flex-1 truncate font-nunito text-white">{ep.title || `Episode ${ep.episode_num}`}</span>
                    {ep.info?.duration && <span className="text-xs text-brand-ice/60 font-nunito">{ep.info.duration}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex">
      <div className={`w-64 flex-shrink-0 border-r border-white/10 p-3 overflow-y-auto bg-black/40 ${pane === 'categories' && isActive ? 'bg-white/5' : ''}`}>
        <div className="space-y-1">
          {categoriesLoading && categories.length === 0 && (
            <div className="px-3 py-2 text-brand-ice/60 font-nunito text-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> Loading categories…
            </div>
          )}
          {visibleCategories.map((c, i) => {
            const isFocused = isActive && pane === 'categories' && categoryIdx === i;
            const isSelected = categoryIdx === i;
            const isLoadingThis = loadingCat === c.id;
            return (
              <div
                key={c.id}
                data-focused={isFocused ? 'true' : 'false'}
                onClick={() => { setCategoryIdx(i); setGridIdx(0); setPane('grid'); }}
                className={`
                  flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 font-nunito text-brand-ice
                  ${isFocused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-[1.02] shadow-lg' : ''}
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
      </div>

      <div ref={gridScrollRef} className="flex-1 min-w-0 overflow-y-auto p-5 bg-black/30">
        {seriesLoading && visibleSeries.length === 0 ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}>
            {Array.from({ length: GRID_COLS * 3 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-white/5 animate-pulse" style={{ aspectRatio: '2 / 3' }} />
            ))}
          </div>
        ) : visibleSeries.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/60 font-nunito">No series in this category.</div>

        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {rowVirtualizer.getVirtualItems().map(vr => {
              const rowStart = vr.index * GRID_COLS;
              const rowItems = visibleSeries.slice(rowStart, rowStart + GRID_COLS);
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
                  {rowItems.map((s, ci) => {
                    const i = rowStart + ci;
                    const isFocused = isActive && pane === 'grid' && i === gridIdx;
                    return (
                      <div key={s.series_id}>
                        <PosterCard
                          title={s.name}
                          image={s.cover}
                          rating={s.rating}
                          year={s.releaseDate ? String(s.releaseDate).slice(0, 4) : undefined}
                          isFocused={isFocused}
                          variant="series"
                          onFocus={() => { setGridIdx(i); setPane('grid'); }}
                          onActivate={() => openSeries(s)}
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

SeriesSection.displayName = 'SeriesSection';
export default SeriesSection;

/**
 * Tiny helper that finds the active <video> element in the page and forwards
 * its `ended` event. Used by the fullscreen episode player to drive autoplay
 * without modifying VideoPlayer.
 */
const PlaybackEndedWatcher = ({ onEnded }: { onEnded: () => void }) => {
  useEffect(() => {
    const handle = () => onEnded();
    const attach = () => {
      const v = document.querySelector('video');
      if (!v) { window.setTimeout(attach, 300); return; }
      v.addEventListener('ended', handle);
      return () => v.removeEventListener('ended', handle);
    };
    const detach = attach();
    return () => { if (typeof detach === 'function') detach(); };
  }, [onEnded]);
  return null;
};
