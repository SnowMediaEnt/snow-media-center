import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Play, Search, Star } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  getSeriesCategories,
  getSeries,
  getSeriesInfo,
  buildEpisodeUrl,
  XTREAM_REFRESH_EVENT,
  type XtreamCreds,
  type XtreamCategory,
  type XtreamSeries,
  type XtreamSeriesInfo,
} from '@/lib/xtream';
import { nextEpisode, seriesSeasons } from '@/lib/xtreamSeasons';
import {
  formatCount,
  readCounts,
  recordCounts,
  tallyByCategory,
  type CatalogCounts,
} from '@/lib/catalogCounts';
import PosterCard from './PosterCard';
import { followGridRow } from './posterGrid';
import { tmdbSized } from '@/lib/tmdbImage';
import { keepInView } from '@/utils/keepInView';
import { isFireTV } from '@/utils/platform';
import ScrollText, { ScrollLines } from '@/components/ScrollText';
import { trackEvent, startTimer, stopTimer } from '@/lib/analytics';
import { isDemo, demoDialogMsg } from '@/lib/demoMode';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';
import { useTransientVisible } from '@/hooks/useTransientVisible';
import { loadPlayerVolume, savePlayerVolume } from '@/utils/volume';
import VodPlayer from './VodPlayer';
import { PosterFrame } from './FitPoster';

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
  /** Back from the category list: one step out (Live TV's Movies / Series
   *  chooser). Without it Back goes to the side menu, as Left does. */
  onBack?: () => void;
}

type Pane = 'categories' | 'grid' | 'detail';
// A series page: Play and the autoplay switch on the left, then the seasons,
// then the episodes. Each list scrolls on its own to keep the highlight in view.
type DetailFocus = 'play' | 'autoplay' | 'seasons' | 'episodes';
const ALL_ID = '__all__';
const GRID_COLS = 5;
const AUTOPLAY_KEY = 'snow-livetv-autoplay-next';
// Demo latch (?demo=1) — canned catalog; play shows the demo dialog instead.
const DEMO = isDemo();

const SeriesSection = memo(({ creds, isActive, onExitLeft, onExitUp, onBack }: Props) => {
  const { t } = useTranslation();
  const catLabel = (c: { id: string; name: string }): string => (c.id === ALL_ID ? t('live.series.allSeries') : c.name);
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [seriesByCat, setSeriesByCat] = useState<Map<string, XtreamSeries[]>>(new Map());
  const [loadingCat, setLoadingCat] = useState<string | null>(null);

  // How many series this service carries, per category and in total. Same
  // deal as Movies: filled in from lists that arrive, never fetched for the
  // sake of a number.
  const [counts, setCounts] = useState<CatalogCounts>(() => readCounts(creds, 'series'));
  useEffect(() => { setCounts(readCounts(creds, 'series')); }, [creds]);
  const noteCounts = useCallback((patch: { total?: number; byCat?: Record<string, number> }) => {
    setCounts(recordCounts(creds, 'series', patch));
  }, [creds]);

  const [pane, setPane] = useState<Pane>('categories');
  // Start on ALL sentinel (0). A separate effect bumps focus to the first
  // REAL category (index 1) once categories arrive, but only if the user
  // hasn't moved yet. Prevents triggering an "All Series" fetch on a
  // transient frame where visibleCategories.length === 1.
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [gridIdx, setGridIdx] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchFocusedRef = useRef(searchFocused);
  useEffect(() => { searchFocusedRef.current = searchFocused; }, [searchFocused]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Tracks whether the user has explicitly moved category focus.
  const userMovedRef = useRef(false);
  // "All Series" loads the entire series catalog — never auto-load.
  // Only fetch when the user explicitly opens that bucket.
  const allOptedInRef = useRef(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allSeries, setAllSeries] = useState<XtreamSeries[] | null>(null);
  const [allSeriesLoading, setAllSeriesLoading] = useState(false);

  // Detail
  const [selectedSeries, setSelectedSeries] = useState<XtreamSeries | null>(null);
  const [seriesInfo, setSeriesInfo] = useState<XtreamSeriesInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [episodeIdx, setEpisodeIdx] = useState(0);
  const [detailFocus, setDetailFocus] = useState<DetailFocus>('episodes');

  const [playing, setPlaying] = useState<{ url: string; title: string; seasonIdx: number; episodeIdx: number } | null>(null);
  // On-screen title: shows 4 s on play / episode change / any key, then hides.
  const [titleShown] = useTransientVisible(4000, { watchKeys: !!playing, deps: [playing?.title ?? null] });
  const [demoNotice, setDemoNotice] = useState(false);
  // The shared player volume (Live TV, Plex): 0..150%, never back at 0 on
  // a new start (VodPlayer's bar changes it).
  const [volume, setVolume] = useState(() => loadPlayerVolume());
  useEffect(() => { savePlayerVolume(volume); }, [volume]);
  const [autoplayNext, setAutoplayNext] = useState<boolean>(() => {
    try { return localStorage.getItem(AUTOPLAY_KEY) !== 'false'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(AUTOPLAY_KEY, String(autoplayNext)); } catch { /* ignore */ }
  }, [autoplayNext]);

  // Refresh tick — clear per-category cache + refetch categories on the
  // global 'xtream:refresh' event. We never eagerly fetch every category.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const onRefresh = () => {
      setSeriesByCat(new Map());
      setAllSeries(null);
      allOptedInRef.current = false;
      setRefreshTick(t => t + 1);
    };
    window.addEventListener(XTREAM_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(XTREAM_REFRESH_EVENT, onRefresh);
  }, []);

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
  }, [creds, refreshTick]);

  // How long an episode is watched, on top of the series_play count.
  useEffect(() => {
    if (DEMO || !playing) return;
    try {
      startTimer('watch', 'series_watch', 'player', {
        series: playing.title, episode_index: playing.episodeIdx,
      });
    } catch { /* ignore */ }
    return () => { try { stopTimer('watch'); } catch { /* ignore */ } };
  }, [playing]);

  const visibleCategories = useMemo(() => {
    const base: { id: string; name: string; count?: number }[] = [
      { id: ALL_ID, name: '', count: seriesByCat.get(ALL_ID)?.length ?? counts.total ?? undefined },
    ];
    for (const c of categories) {
      const key = String(c.category_id);
      base.push({ id: key, name: c.category_name, count: seriesByCat.get(key)?.length ?? counts.byCat[key] });
    }
    return base;
  }, [categories, seriesByCat, counts]);

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

  // Lazy-load focused category's series.
  // "All Series" is STRICTLY opt-in: never auto-fetch on focus.
  useEffect(() => {
    if (pane !== 'grid') return;
    if (!currentCat) return;
    if (currentCat.id === ALL_ID && !allOptedInRef.current) return;
    if (seriesByCat.has(currentCat.id)) return;
    let cancelled = false;
    const key = currentCat.id;
    setLoadingCat(key);
    const p = key === ALL_ID ? getSeries(creds) : getSeries(creds, key);
    p.then(list => {
      if (cancelled) return;
      setSeriesByCat(prev => { const n = new Map(prev); n.set(key, list); return n; });
      if (key === ALL_ID) noteCounts({ total: list.length, byCat: tallyByCategory(list) });
      else noteCounts({ byCat: { [key]: list.length } });
    }).catch(() => {
      if (cancelled) return;
      setSeriesByCat(prev => { const n = new Map(prev); n.set(key, []); return n; });
    }).finally(() => {
      // Even when cancelled: the list arriving re-runs this effect (the
      // category's count changes), which cancels this run, and the spinner
      // stayed on the category for good. Another category's load owns the
      // spinner by then, so this leaves that one alone.
      setLoadingCat(prev => prev === key ? null : prev);
    });
    return () => { cancelled = true; };
  }, [pane, currentCat, creds, seriesByCat, noteCounts]);

  // Lazy-load the full series catalog when the search panel opens.
  useEffect(() => {
    if (!searchOpen) return;
    if (allSeries || allSeriesLoading) return;
    setAllSeriesLoading(true);
    let cancelled = false;
    getSeries(creds)
      .then(list => {
        if (cancelled) return;
        setAllSeries(list);
        noteCounts({ total: list.length, byCat: tallyByCategory(list) });
      })
      .catch(() => { if (!cancelled) setAllSeries([]); })
      .finally(() => { if (!cancelled) setAllSeriesLoading(false); });
    return () => { cancelled = true; };
  }, [searchOpen, allSeries, allSeriesLoading, creds, noteCounts]);

  const visibleSeries = useMemo(() => {
    if (searchOpen) {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return [];
      const src = allSeries || [];
      const out: XtreamSeries[] = [];
      for (const s of src) {
        if (s.name.toLowerCase().includes(q)) {
          out.push(s);
          if (out.length >= 500) break;
        }
      }
      return out;
    }
    if (!currentCat) return [];
    return seriesByCat.get(currentCat.id) || [];
  }, [searchOpen, searchQuery, allSeries, currentCat, seriesByCat]);

  // Only show "loading" for buckets we actually fetch. All-Series sentinel
  // doesn't auto-load, so no spinner there until the user opts in.
  const seriesLoading = searchOpen
    ? allSeriesLoading
    : !!(
        currentCat
        && (currentCat.id !== ALL_ID || allOptedInRef.current)
        && (loadingCat === currentCat.id || !seriesByCat.has(currentCat.id))
      );

  // Reset grid focus when switching category.
  useEffect(() => { setGridIdx(0); }, [categoryIdx, searchOpen, searchQuery]);
  useEffect(() => { if (gridIdx >= visibleSeries.length) setGridIdx(0); }, [visibleSeries.length, gridIdx]);


  // Built from the episodes the panel actually sent (see xtreamSeasons).
  const seasons = useMemo(() => seriesSeasons(seriesInfo), [seriesInfo]);
  const episodes = useMemo(() => seasons[seasonIdx]?.episodes ?? [], [seasons, seasonIdx]);
  const seasonsRef = useRef(seasons);
  seasonsRef.current = seasons;

  // A slow answer for an earlier series must not fill in a newer one's page.
  const openSeqRef = useRef(0);
  const openSeries = useCallback(async (s: XtreamSeries) => {
    const seq = ++openSeqRef.current;
    setSelectedSeries(s);
    setSeriesInfo(null);
    setSeasonIdx(0);
    setEpisodeIdx(0);
    setDetailFocus('episodes');
    setPane('detail');
    setInfoLoading(true);
    try {
      const info = await getSeriesInfo(creds, s.series_id);
      if (seq !== openSeqRef.current) return;
      setSeriesInfo(info);
      // Nothing to list: the highlight waits on Play (Back still works).
      if (!seriesSeasons(info).length) setDetailFocus('play');
    } catch {
      if (seq === openSeqRef.current) { setSeriesInfo(null); setDetailFocus('play'); }
    } finally {
      if (seq === openSeqRef.current) setInfoLoading(false);
    }
  }, [creds]);

  // Any season's episode (autoplay crosses into the next season). The page
  // follows along, so Back from the player lands on the episode just watched.
  const playEpisode = useCallback((sIdx: number, eIdx: number) => {
    // Demo: never build a stream URL or mount a player — show the demo dialog.
    if (DEMO) { setDemoNotice(true); return; }
    const season = seasonsRef.current[sIdx];
    const ep = season?.episodes[eIdx];
    if (!ep || !selectedSeries) return;
    setSeasonIdx(sIdx);
    setEpisodeIdx(eIdx);
    setDetailFocus('episodes');
    const url = buildEpisodeUrl(creds, ep.id, ep.container_extension || 'mp4');
    setPlaying({
      url,
      title: `${selectedSeries.name} · S${season.number}E${ep.episode_num} · ${ep.title}`,
      seasonIdx: sIdx,
      episodeIdx: eIdx,
    });
    try {
      trackEvent('series_play', 'player', {
        series: selectedSeries.name,
        season: season.number,
        episode: ep.episode_num,
      });
    } catch { /* ignore */ }
  }, [selectedSeries, creds]);
  // "Play S1·E1": the first episode of the first season.
  const playFirst = useCallback(() => {
    const first = seasonsRef.current.findIndex((x) => x.episodes.length > 0);
    if (first >= 0) playEpisode(first, 0);
  }, [playEpisode]);

  // player_search — debounce
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (!q) return;
    const t = window.setTimeout(() => {
      if (!DEMO) { try { trackEvent('player_search', 'player', { scope: 'series', query: q.slice(0, 64) }); } catch { /* ignore */ } }
    }, 750);
    return () => window.clearTimeout(t);
  }, [searchOpen, searchQuery]);


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
  const episodesRef = useRef(episodes);
  const autoplayNextRef = useRef(autoplayNext);
  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { categoryIdxRef.current = categoryIdx; }, [categoryIdx]);
  useEffect(() => { gridIdxRef.current = gridIdx; }, [gridIdx]);
  useEffect(() => { visibleCategoriesRef.current = visibleCategories; }, [visibleCategories]);
  useEffect(() => { visibleSeriesRef.current = visibleSeries; }, [visibleSeries]);
  // One handler for every tile, so PosterCard's memo holds as focus moves.
  const openSeriesRef = useRef(openSeries);
  useEffect(() => { openSeriesRef.current = openSeries; }, [openSeries]);
  const onTileFocus = useCallback((i: number) => { setGridIdx(i); setPane('grid'); }, []);
  const onTileActivate = useCallback((i: number) => {
    const s = visibleSeriesRef.current[i];
    if (s) void openSeriesRef.current(s);
  }, []);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  const searchOpenRef = useRef(searchOpen);
  useEffect(() => { searchOpenRef.current = searchOpen; }, [searchOpen]);
  useEffect(() => { detailFocusRef.current = detailFocus; }, [detailFocus]);
  useEffect(() => { seasonIdxRef.current = seasonIdx; }, [seasonIdx]);
  useEffect(() => { episodeIdxRef.current = episodeIdx; }, [episodeIdx]);
  useEffect(() => { episodesRef.current = episodes; }, [episodes]);
  useEffect(() => { autoplayNextRef.current = autoplayNext; }, [autoplayNext]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;

      // The player owns every key while it plays (VodPlayer's bar: Back, seek, volume).
      if (playingRef.current) return;

      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        if (paneRef.current === 'detail') { openSeqRef.current++; setPane('grid'); setSelectedSeries(null); setSeriesInfo(null); }
        else if (paneRef.current === 'grid') setPane('categories');
        else (onBackRef.current ?? onExitLeft)();
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
          if (i < GRID_COLS) { if (onExitUp) onExitUp(); return; }
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
      const sIdx = seasonIdxRef.current;
      const eIdx = episodeIdxRef.current;
      // Right from the left column: the seasons, or straight to the
      // episodes when there is only one season to pick.
      const intoLists = () => {
        if (seas.length > 1) setDetailFocus('seasons');
        else if (eps.length) setDetailFocus('episodes');
      };
      if (focus === 'play') {
        if (e.key === 'ArrowDown') setDetailFocus('autoplay');
        else if (e.key === 'ArrowRight') intoLists();
        else if (e.key === 'Enter' || e.key === ' ') playFirst();
      } else if (focus === 'autoplay') {
        if (e.key === 'ArrowUp') setDetailFocus('play');
        else if (e.key === 'ArrowRight') intoLists();
        else if (e.key === 'Enter' || e.key === ' ') setAutoplayNext((v) => !v);
      } else if (focus === 'seasons') {
        if (e.key === 'ArrowDown') {
          if (sIdx + 1 < seas.length) { setSeasonIdx(sIdx + 1); setEpisodeIdx(0); }
        } else if (e.key === 'ArrowUp') {
          if (sIdx > 0) { setSeasonIdx(sIdx - 1); setEpisodeIdx(0); }
        } else if (e.key === 'ArrowLeft') setDetailFocus('play');
        else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
          if (eps.length) setDetailFocus('episodes');
        }
      } else if (focus === 'episodes') {
        if (e.key === 'ArrowDown') {
          if (eIdx + 1 < eps.length) setEpisodeIdx(eIdx + 1);
        } else if (e.key === 'ArrowUp') {
          if (eIdx > 0) setEpisodeIdx(eIdx - 1);
        } else if (e.key === 'ArrowLeft') setDetailFocus(seas.length > 1 ? 'seasons' : 'play');
        else if (e.key === 'Enter' || e.key === ' ') {
          if (!e.repeat) playEpisode(sIdx, eIdx);
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, onExitLeft, onExitUp, openSeries, playEpisode, playFirst]);

  // Virtualize series grid by row — measure row height from real layout so
  // virtual stride matches what's rendered at any TV resolution.
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const [rowH, setRowH] = useState(280);
  const rowHRef = useRef(280);
  useEffect(() => { rowHRef.current = rowH; }, [rowH]);
  // Keyed on the grid being on screen: the series page and the player
  // replace it, and the observer was left watching the old, detached one.
  const gridShown = !playing && !(pane === 'detail' && !!selectedSeries);
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
  }, [gridShown]);
  const rowCount = Math.ceil(visibleSeries.length / GRID_COLS);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridScrollRef.current,
    estimateSize: () => rowHRef.current,
    overscan: isFireTV() ? 1 : 3,
  });
  useEffect(() => { rowVirtualizer.measure(); /* eslint-disable-next-line */ }, [rowH]);
  useEffect(() => { rowVirtualizer.scrollToOffset(0); /* eslint-disable-next-line */ }, [categoryIdx, searchOpen, searchQuery]);
  useEffect(() => {
    if (!visibleSeries.length) return;
    const row = Math.floor(gridIdx / GRID_COLS);
    rowVirtualizer.scrollToIndex(row, { align: 'auto' });
    return followGridRow(gridScrollRef.current, row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridIdx, visibleSeries.length]);

  // Every list keeps its highlight on screen as the remote moves through it
  // (keepInView: only that list scrolls, never the page around it). Also when
  // the grid or the page is drawn again, coming back from a series or a film.
  const catScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = catScrollRef.current;
    if (!node) return;
    if (categoryIdx === 0) { node.scrollTop = 0; return; }
    const el = node.querySelector<HTMLElement>(`[data-cat-i="${categoryIdx}"]`);
    if (el) keepInView(node, el, 8);
  }, [categoryIdx, gridShown, searchOpen, visibleCategories.length]);
  const seasonsScrollRef = useRef<HTMLDivElement | null>(null);
  const episodesScrollRef = useRef<HTMLDivElement | null>(null);
  const infoScrollRef = useRef<HTMLDivElement | null>(null);
  const detailShown = !playing && pane === 'detail' && !!selectedSeries;
  useEffect(() => {
    if (!detailShown) return;
    const node = seasonsScrollRef.current;
    const el = node?.querySelector<HTMLElement>(`[data-season-i="${seasonIdx}"]`);
    if (node && el) keepInView(node, el, 8);
  }, [detailShown, seasonIdx, seasons.length]);
  useEffect(() => {
    if (!detailShown) return;
    const node = episodesScrollRef.current;
    if (!node) return;
    if (episodeIdx === 0) { node.scrollTop = 0; return; }
    const el = node.querySelector<HTMLElement>(`[data-episode-i="${episodeIdx}"]`);
    if (el) keepInView(node, el, 8);
  }, [detailShown, episodeIdx, seasonIdx, episodes.length]);
  useEffect(() => {
    if (!detailShown) return;
    const node = infoScrollRef.current;
    const el = node?.querySelector<HTMLElement>(`[data-detail-btn="${detailFocus}"]`);
    if (node && el) keepInView(node, el, 8);
  }, [detailShown, detailFocus]);

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
        <p className="font-nunito text-white/90 text-base leading-relaxed">{demoDialogMsg()}</p>
        <button type="button" autoFocus onClick={() => setDemoNotice(false)}
          className="mt-6 px-6 py-3 rounded-xl bg-brand-gold text-black font-semibold font-nunito focus:outline-none focus:ring-2 focus:ring-white">
          {t('common.ok')}
        </button>
      </div>
    </div>
  ) : null;

  // Fullscreen episode player with autoplay next
  if (playing) {
    return (
      <VodPlayer
        src={playing.url}
        volume={volume}
        onVolumeChange={setVolume}
        title={playing.title}
        onClose={() => setPlaying(null)}
        onNext={() => playEpisode(playing.episodeIdx + 1)}
        hasNext={playing.episodeIdx + 1 < episodes.length}
        onError={(msg) => {
          try { trackEvent('player_error', 'player', { kind: 'series', channel_or_title: playing.title, server: creds.serverLabel, message: msg.slice(0, 200) }); } catch { /* ignore */ }
        }}
        onEnded={() => {
          if (!autoplayNextRef.current) { setPlaying(null); return; }
          // The next episode, into the next season after a season's last.
          const next = nextEpisode(seasonsRef.current, playing.seasonIdx, playing.episodeIdx);
          if (next) playEpisode(next.season, next.episode);
          else setPlaying(null);
        }}
      >
        {titleShown && (
          <div className="absolute top-4 left-4 max-w-[70%] truncate px-4 py-2 rounded-xl bg-black/70 text-white font-quicksand font-bold text-lg pointer-events-none">
            {playing.title}
          </div>
        )}
      </VodPlayer>
    );
  }

  // Detail: three columns that each fit the screen and scroll on their own
  // (the old page ran its episodes off the bottom of a 960×540 screen).
  if (pane === 'detail' && selectedSeries) {
    const info = seriesInfo?.info;
    const cover = tmdbSized(info?.cover || selectedSeries.cover);
    const plot = info?.plot || selectedSeries.plot || '';
    const firstPlayable = seasons.some((x) => x.episodes.length > 0);
    const btnFocused = (f: DetailFocus) => isActive && !demoNotice && detailFocus === f;
    return (
      <div data-series-detail="" className="flex-1 min-h-0 min-w-0 flex flex-col text-white bg-black/40">
        <div className={`${BACK_ROW} flex-shrink-0 px-6 pt-4 mb-3`}>
          <BackButton onClick={() => { openSeqRef.current++; setPane('grid'); setSelectedSeries(null); setSeriesInfo(null); }} label={t('common.back')} />
        </div>
        <div className="flex-1 min-h-0 flex px-6 pb-4">
          {/* About the series, Play, autoplay */}
          <div ref={infoScrollRef} className="w-72 flex-shrink-0 min-h-0 overflow-y-auto overflow-x-hidden pr-4 mr-4 border-r border-white/10">
            <div className="flex items-start mb-3">
              <div className="w-24 flex-shrink-0 mr-3">
                <PosterFrame src={cover} className="rounded-xl" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-quicksand font-bold leading-tight line-clamp-3 mb-2">{selectedSeries.name}</h2>
                <div className="flex flex-wrap items-center text-sm text-brand-ice/80 font-nunito">
                  {info?.rating != null && info.rating !== '' && (
                    <span className="flex items-center mr-3"><Star className="w-4 h-4 mr-1 text-brand-gold fill-brand-gold" />{Number(info.rating).toFixed(1)}</span>
                  )}
                  {info?.releaseDate && <span className="mr-3">{String(info.releaseDate).slice(0, 4)}</span>}
                  {info?.genre && <ScrollText text={info.genre} active={isActive} className="w-full" />}
                </div>
              </div>
            </div>
            {infoLoading ? <Loader2 className="w-5 h-5 mb-3 animate-spin text-brand-gold" /> : (
              <ScrollLines text={plot || t('live.vod.noDescription')} maxLines={5} className="text-brand-ice/90 font-nunito text-sm leading-snug mb-3" />
            )}
            <Button
              variant="gold"
              data-detail-btn="play"
              onClick={playFirst}
              data-focused={btnFocused('play') ? 'true' : 'false'}
              className={`tv-ring tv-ring-contrast w-full rounded-xl h-12 px-4 text-base transition-transform duration-150 ease-out ${btnFocused('play') ? 'scale-105 z-10' : ''}`}
              disabled={!firstPlayable}
            >
              <Play className="w-4 h-4 mr-2 fill-current" />
              <span className="min-w-0 truncate">{t('live.series.playFirstBtn')}</span>
            </Button>
            <div
              role="switch"
              aria-checked={autoplayNext}
              data-detail-btn="autoplay"
              data-focused={btnFocused('autoplay') ? 'true' : 'false'}
              onClick={() => setAutoplayNext((v) => !v)}
              className={`tv-ring mt-3 flex items-center px-3 py-2 rounded-xl cursor-pointer font-nunito text-sm text-brand-ice ${btnFocused('autoplay') ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-white/5'}`}
            >
              <span className={`w-5 h-5 mr-2 flex-shrink-0 rounded flex items-center justify-center border ${autoplayNext ? 'bg-brand-gold border-brand-gold' : 'border-white/40'}`}>
                {autoplayNext && <Check className="w-4 h-4 text-brand-navy" />}
              </span>
              <span className="min-w-0">{t('live.series.autoplayNext')}</span>
            </div>
          </div>

          {/* Seasons */}
          <div className="w-40 flex-shrink-0 min-h-0 flex flex-col mr-4">
            <h4 className="flex-shrink-0 font-quicksand font-semibold text-lg mb-2 text-white/90">{t('live.series.seasons')}</h4>
            <div ref={seasonsScrollRef} data-series-seasons="" className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-1 px-1 py-1">
              {!infoLoading && seasons.length === 0 && <p className="text-brand-ice/70 text-sm font-nunito">{t('live.series.noSeasons')}</p>}
              {seasons.map((x, i) => {
                const focused = isActive && !demoNotice && detailFocus === 'seasons' && seasonIdx === i;
                const selected = seasonIdx === i;
                return (
                  <div
                    key={x.number}
                    data-season-i={i}
                    data-focused={focused ? 'true' : 'false'}
                    onClick={() => { setSeasonIdx(i); setEpisodeIdx(0); setDetailFocus('episodes'); }}
                    className={`
                      tv-ring px-3 py-3 rounded-xl cursor-pointer font-nunito text-base text-brand-ice
                      ${focused ? 'bg-brand-gold/25 scale-[1.02] z-10' : ''}
                      ${!focused && selected ? 'bg-white/10' : ''}
                      ${!focused && !selected ? 'hover:bg-white/5' : ''}
                    `}
                  >
                    <ScrollText text={x.name || t('live.series.seasonN', { n: x.number })} active={focused} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Episodes */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <h4 className="flex-shrink-0 font-quicksand font-semibold text-lg mb-2 text-white/90">{t('live.series.episodes')}</h4>
            <div ref={episodesScrollRef} data-series-episodes="" className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-1 px-2 py-1">
              {infoLoading && <Loader2 className="w-5 h-5 animate-spin text-brand-gold" />}
              {!infoLoading && episodes.length === 0 && <p className="text-brand-ice/70 text-sm font-nunito">{t('live.series.noEpisodes')}</p>}
              {episodes.map((ep, i) => {
                const focused = isActive && !demoNotice && detailFocus === 'episodes' && episodeIdx === i;
                return (
                  <div
                    key={ep.id}
                    data-episode-i={i}
                    onClick={() => playEpisode(seasonIdx, i)}
                    data-focused={focused ? 'true' : 'false'}
                    className={`
                      tv-ring flex items-center px-4 py-3 rounded-xl border border-white/10 cursor-pointer
                      ${focused ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-white/5 hover:bg-white/10'}
                    `}
                  >
                    <span className="w-8 mr-3 flex-shrink-0 text-right font-quicksand font-bold text-brand-gold">{ep.episode_num}</span>
                    <ScrollText text={ep.title || t('live.series.episodeN', { n: ep.episode_num })} active={focused} className="flex-1 font-nunito text-white" />
                    {ep.info?.duration && <span className="ml-3 flex-shrink-0 text-xs text-brand-ice/70 font-nunito">{ep.info.duration}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {demoNoticeOverlay}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex">
      <div ref={catScrollRef} data-series-cats="" className={`w-64 max-w-[16rem] flex-shrink-0 border-r border-white/10 p-3 overflow-y-auto overflow-x-hidden bg-black/40 ${pane === 'categories' && isActive ? 'bg-white/5' : ''}`}>
        <button
          onClick={() => setSearchOpen(o => !o)}
          data-focused={searchFocused ? 'true' : 'false'}
          className={`tv-ring w-full flex items-center gap-2 px-3 py-3 mb-2 rounded-xl border border-white/10 text-brand-ice font-nunito text-base ${searchFocused ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-black/40'}`}
        >
          <Search className="w-4 h-4" />
          <span className="min-w-0 truncate">{searchOpen ? t('live.list.closeSearchBtn') : t('live.series.searchSeriesBtn')}</span>
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
            placeholder={t('live.list.searchPlaceholder')}
            className="w-full mb-3 rounded-xl bg-black/40 text-white border border-white/20 px-3 py-3 font-nunito text-base focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
        )}
        {!searchOpen && (
          <div className="space-y-1">
            {categoriesLoading && categories.length === 0 && (
              <div className="px-3 py-2 text-brand-ice/70 font-nunito text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> {t('live.list.loadingCategories')}
              </div>
            )}
            {visibleCategories.map((c, i) => {
              const isFocused = isActive && pane === 'categories' && !searchFocused && categoryIdx === i;
              const isSelected = categoryIdx === i;
              const isLoadingThis = loadingCat === c.id;
              return (
                <div
                  key={c.id}
                  data-cat-i={i}
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
                  <ScrollText text={catLabel(c)} active={isFocused} className="flex-1" />
                  {isLoadingThis && <Loader2 className="w-3 h-3 animate-spin text-brand-gold flex-shrink-0" />}
                  {!isLoadingThis && c.count != null && c.count > 0 && (
                    <span className={`text-xs tabular-nums px-2 py-1 rounded-lg flex-shrink-0 ${isFocused ? 'bg-brand-navy/40 text-brand-gold' : 'bg-white/10 text-brand-ice/70'}`}>
                      {formatCount(c.count)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div ref={gridScrollRef} data-series-grid="" className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-6 bg-black/30">
        {seriesLoading && visibleSeries.length === 0 ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}>
            {Array.from({ length: GRID_COLS * 3 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-white/5 animate-pulse" style={{ height: 0, paddingBottom: '150%' }} />
            ))}
          </div>
        ) : visibleSeries.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito">
            {searchOpen
              ? (searchQuery
                  ? (allSeriesLoading ? t('live.series.loadingCatalog') : t('live.series.noMatch'))
                  : (allSeriesLoading ? t('live.series.loadingCatalog') : t('live.series.typeToSearch')))
              : t('live.series.noSeries')}
          </div>

        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {rowVirtualizer.getVirtualItems().map(vr => {
              const rowStart = vr.index * GRID_COLS;
              const rowItems = visibleSeries.slice(rowStart, rowStart + GRID_COLS);
              return (
                <div
                  key={vr.key}
                  data-grid-row={vr.index}
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
                  {rowItems.map((s, ci) => {
                    const i = rowStart + ci;
                    const isFocused = isActive && pane === 'grid' && i === gridIdx;
                    return (
                      <div key={s.series_id}>
                        <PosterCard
                          title={s.name}
                          image={tmdbSized(s.cover)}
                          rating={s.rating}
                          year={s.releaseDate ? String(s.releaseDate).slice(0, 4) : undefined}
                          isFocused={isFocused}
                          variant="series"
                          index={i}
                          onFocus={onTileFocus}
                          onActivate={onTileActivate}
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

SeriesSection.displayName = 'SeriesSection';
export default SeriesSection;
