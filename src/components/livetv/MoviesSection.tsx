import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_DWELL_MS, KEPT_CATEGORY_SETTLE_MS } from '@/lib/categoryDwell';
import { ArrowLeft, Check, Film, Loader2, Play, Search, Star } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  getVodCategories,
  getVodStreams,
  getVodInfo,
  buildMovieUrl,
  XTREAM_REFRESH_EVENT,
  type XtreamCreds,
  type XtreamCategory,
  type XtreamVodStream,
  type XtreamVodInfo,
} from '@/lib/xtream';
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
import { searchVodTitles } from '@/lib/vodSearch';
import { fingerIsDriving, isTouchUI, usePhoneLayout } from '@/lib/phoneMode';
import ScrollText, { ScrollLines } from '@/components/ScrollText';
import { isFireTV } from '@/utils/platform';
import { trackEvent, startTimer, stopTimer } from '@/lib/analytics';
import { isDemo, demoDialogMsg } from '@/lib/demoMode';
import { useTransientVisible } from '@/hooks/useTransientVisible';
import { loadPlayerVolume, savePlayerVolume } from '@/utils/volume';
import VodPlayer from './VodPlayer';
import FitPoster from './FitPoster';
import { noteFilmFinished, noteFilmProgress } from '@/lib/watchedMarks';
import { useWatchedFilms } from '@/hooks/useWatchedVod';
import TrailerButton from './TrailerButton';
import TrailerOverlay from './TrailerOverlay';
import { movieTrailer, openTrailer } from '@/lib/trailer';
import { castNames, findFranchise, findMoreLikeThis } from '@/lib/vodRelated';
import { loadFullVodCatalogue, lowMemoryBox } from '@/lib/vodCatalogue';
import { adultCategoryIds, isAdultHit } from '@/lib/adultSearch';

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
  /** Live TV's VOD section: a "Plex" entry sits first in the categories and
   *  opens Plex for everything else. */
  onOpenPlex?: () => void;
  /** Back from the category list: one step out (Live TV's Movies / Series
   *  chooser). Without it Back goes to the side menu, as Left does. */
  onBack?: () => void;
}

type Pane = 'categories' | 'grid' | 'detail';
const ALL_ID = '__all__';
const PLEX_ID = '__plex__';
// Category lists kept while browsing; the oldest go first past this.
const MAX_KEPT_CATEGORIES = 6;
// Posters a row: a TV's 5; a phone held upright 3 (phoneMode).
const GRID_COLS_TV = 5;
const GRID_COLS_UPRIGHT = 3;
// Demo latch (?demo=1) — canned catalog; play shows the demo dialog instead.
const DEMO = isDemo();
// A film's page: the related rows under it ("More in this series", "More like
// this"). One row shows at a time, the next one's label peeking under it.
const REL_ROW_H = 164;
const REL_CARD_W = 84;
const REL_PEEK = 22;
// Films opened from a related row, for Back (one step per film).
const MAX_BACK_STACK = 20;
type DetailFocus = 'play' | 'trailer' | 'related';
type RelRow = { kind: 'series' | 'like'; items: XtreamVodStream[] };
// A related card's index for PosterCard: its row and column in one number.
const REL_STRIDE = 1000;

// A row's highlighted card stays in view, by its own scrollLeft only.
function keepInViewX(container: HTMLElement, el: HTMLElement, pad = 12): void {
  if (fingerIsDriving()) return;
  const left = el.offsetLeft;
  const right = left + el.offsetWidth;
  if (left - pad < container.scrollLeft) container.scrollLeft = Math.max(0, left - pad);
  else if (right + pad > container.scrollLeft + container.clientWidth) container.scrollLeft = right + pad - container.clientWidth;
}

const MoviesSection = memo(({ creds, isActive, onExitLeft, onExitUp, onOpenPlex, onBack }: Props) => {
  // Upright on a phone: three posters a row and the categories as a row of
  // chips over them (phone-vod.css, Tronix 6c3e919); the keys read the ref.
  const GRID_COLS = usePhoneLayout() === 'portrait' ? GRID_COLS_UPRIGHT : GRID_COLS_TV;
  const gridColsRef = useRef(GRID_COLS);
  gridColsRef.current = GRID_COLS;
  const { t } = useTranslation();
  // Plex and All Movies are ours to translate; the rest are the provider's category names.
  const catLabel = (c: { id: string; name: string }): string =>
    c.id === PLEX_ID ? t('live.vod.plexTitle') : c.id === ALL_ID ? t('live.vod.allMovies') : c.name;
  const hasPlex = !!onOpenPlex;
  const onOpenPlexRef = useRef(onOpenPlex);
  useEffect(() => { onOpenPlexRef.current = onOpenPlex; }, [onOpenPlex]);
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [moviesByCat, setMoviesByCat] = useState<Map<string, XtreamVodStream[]>>(new Map());
  const [loadingCat, setLoadingCat] = useState<string | null>(null);
  const moviesByCatRef = useRef(moviesByCat);
  useEffect(() => { moviesByCatRef.current = moviesByCat; }, [moviesByCat]);

  // How many movies this service carries, per category and in total. Filled
  // in by every list that arrives and remembered between launches, so a
  // category shows its size before it is opened. Never fetched for its own
  // sake: the VOD catalogue is the biggest list a panel serves.
  const [counts, setCounts] = useState<CatalogCounts>(() => readCounts(creds, 'vod'));
  useEffect(() => { setCounts(readCounts(creds, 'vod')); }, [creds]);
  const noteCounts = useCallback((patch: { total?: number; byCat?: Record<string, number> }) => {
    setCounts(recordCounts(creds, 'vod', patch));
  }, [creds]);

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
  const allMoviesRef = useRef(allMovies);
  useEffect(() => { allMoviesRef.current = allMovies; }, [allMovies]);

  const [selectedMovie, setSelectedMovie] = useState<XtreamVodStream | null>(null);
  const [movieInfo, setMovieInfo] = useState<XtreamVodInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  // The film page's buttons: Play, and Trailer on its own line under it once
  // the page's info is in (its video, else a search; none on a Kids profile).
  // ▼ from Play reaches it, ▲ goes back (Tronix 1039497).
  const [detailFocus, setDetailFocus] = useState<DetailFocus>('play');
  const detailFocusRef = useRef(detailFocus);
  detailFocusRef.current = detailFocus;
  // Under the page: the film's series and more from its category (owner,
  // 2026-10-27: open a film, go straight to its sequel). Worked out on the
  // box from lists already held, never by asking the panel about each film.
  const [related, setRelated] = useState<{ forId: number; series: XtreamVodStream[]; like: XtreamVodStream[] } | null>(null);
  const [relPos, setRelPos] = useState({ row: 0, col: 0 });
  const relPosRef = useRef(relPos);
  relPosRef.current = relPos;
  // The related film highlighted, by id: kept when the rows are worked out
  // again (the whole catalogue arriving adds the series row above).
  const relFocusIdRef = useRef<number | null>(null);
  // Films opened from a related row: Back reopens the one before.
  const backStackRef = useRef<Array<{ movie: XtreamVodStream; focusId: number | null }>>([]);
  const trailer = useMemo(() => (selectedMovie && !infoLoading ? movieTrailer(selectedMovie, movieInfo) : null), [selectedMovie, movieInfo, infoLoading]);
  const trailerRef = useRef(trailer);
  trailerRef.current = trailer;
  // The trailer playing over the page (TrailerOverlay), by its video id. While
  // it is up the page's keys stand aside: the layer owns the remote.
  const [trailerVideo, setTrailerVideo] = useState<string | null>(null);
  const trailerVideoRef = useRef(trailerVideo);
  const showTrailer = useCallback((id: string | null) => { trailerVideoRef.current = id; setTrailerVideo(id); }, []);
  const closeTrailer = useCallback(() => showTrailer(null), [showTrailer]);
  const pressTrailer = useCallback(() => {
    const target = trailerRef.current;
    if (target) void openTrailer(target, 'movie', showTrailer);
  }, [showTrailer]);

  const [playing, setPlaying] = useState<{ url: string; title: string; streamId: number } | null>(null);
  // Off the film's page, or playing: no trailer (the page's keys never wait
  // on a layer that is not drawn).
  useEffect(() => { if (pane !== 'detail' || !selectedMovie || playing) showTrailer(null); }, [pane, selectedMovie, playing, showTrailer]);
  // On-screen title: shows 4 s on play / title change / any key, then hides.
  const [titleShown] = useTransientVisible(4000, { watchKeys: !!playing, deps: [playing?.title ?? null] });
  const [demoNotice, setDemoNotice] = useState(false);
  // The shared player volume (Live TV, Plex): 0..150%, never back at 0 on
  // a new start (VodPlayer's bar changes it).
  const [volume, setVolume] = useState(() => loadPlayerVolume());
  useEffect(() => { savePlayerVolume(volume); }, [volume]);

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
    const base: { id: string; name: string; count?: number }[] = [
      ...(hasPlex ? [{ id: PLEX_ID, name: '' }] : []),
      { id: ALL_ID, name: '', count: moviesByCat.get(ALL_ID)?.length ?? counts.total ?? undefined },
    ];
    for (const c of categories) {
      const key = String(c.category_id);
      base.push({ id: key, name: c.category_name, count: moviesByCat.get(key)?.length ?? counts.byCat[key] });
    }
    return base;
  }, [categories, moviesByCat, counts, hasPlex]);

  // Clamp focus when category list shrinks; once real categories arrive, bump
  // focus to the first real category (index 1) iff the user hasn't moved yet.
  useEffect(() => {
    if (visibleCategories.length === 0) return;
    if (categoryIdx >= visibleCategories.length) {
      setCategoryIdx(visibleCategories.length - 1);
      return;
    }
    // With Plex pinned first, focus stays on it: it is the way in.
    if (
      !hasPlex &&
      categories.length > 0 &&
      !userMovedRef.current &&
      categoryIdx < 1 &&
      visibleCategories.length > 1
    ) {
      setCategoryIdx(1);
    }
  }, [visibleCategories.length, categoryIdx, categories.length, hasPlex]);

  const currentCat = visibleCategories[categoryIdx];
  const currentCatId = currentCat?.id;

  // The category the highlight has rested on for CATEGORY_DWELL_MS (owner,
  // 2026-10-11: "populate the list of movies or series ... without having to
  // click it first please the same way we do with channels"): its films load
  // and show beside the list, as Live TV's channels do, and a fast pass over a
  // category downloads nothing. OK or ▶ still load it at once.
  // A list already kept shows after KEPT_CATEGORY_SETTLE_MS instead, so a
  // held ▼ does not draw the posters of every kept category it passes.
  // "All Movies" is never downloaded by a rest, only by OK.
  const [restedCat, setRestedCat] = useState<string | null>(null);
  const [settledCat, setSettledCat] = useState<string | null>(null);
  useEffect(() => {
    setRestedCat(null);
    setSettledCat(null);
    if (!isActive || !currentCatId || currentCatId === PLEX_ID) return;
    const shown = window.setTimeout(() => setSettledCat(currentCatId), KEPT_CATEGORY_SETTLE_MS);
    const rested = currentCatId === ALL_ID ? null : window.setTimeout(() => setRestedCat(currentCatId), CATEGORY_DWELL_MS);
    return () => { window.clearTimeout(shown); if (rested != null) window.clearTimeout(rested); };
  }, [isActive, currentCatId]);

  // The category to download now, or null: the one opened (OK / ▶) or rested
  // on, not kept yet. "All Movies" is STRICTLY opt-in: never on focus. Keyed
  // on the id alone, so a rest and then OK, or a count arriving for another
  // category, never restarts a download under way.
  const wantCat = currentCat
    && currentCat.id !== PLEX_ID
    && (pane === 'grid' || restedCat === currentCat.id)
    && (currentCat.id !== ALL_ID || allOptedInRef.current)
    && !moviesByCat.has(currentCat.id)
    ? currentCat.id : null;
  const noteCountsRef = useRef(noteCounts);
  noteCountsRef.current = noteCounts;
  useEffect(() => {
    if (!wantCat) return;
    let cancelled = false;
    const key = wantCat;
    setLoadingCat(key);
    // Search already holds the whole catalogue: never download it twice.
    const p = key === ALL_ID
      ? (allMoviesRef.current ? Promise.resolve(allMoviesRef.current) : loadFullVodCatalogue(creds))
      : getVodStreams(creds, key);
    p.then(list => {
      if (cancelled) return;
      setMoviesByCat(prev => {
        const n = new Map(prev);
        n.set(key, list);
        // Keep the last few categories, not every one opened this visit.
        for (const k of n.keys()) {
          if (n.size <= MAX_KEPT_CATEGORIES) break;
          if (k !== key) n.delete(k);
        }
        return n;
      });
      if (key === ALL_ID) noteCountsRef.current({ total: list.length, byCat: tallyByCategory(list) });
      else noteCountsRef.current({ byCat: { [key]: list.length } });
    }).catch(() => {
      if (cancelled) return;
      setMoviesByCat(prev => { const n = new Map(prev); n.set(key, []); return n; });
    }).finally(() => {
      // Even when cancelled: the list arriving re-runs this effect (the
      // category's count changes), which cancels this run, and the spinner
      // stayed on the category for good. Another category's load owns the
      // spinner by then, so this leaves that one alone.
      setLoadingCat(prev => prev === key ? null : prev);
    });
    return () => { cancelled = true; };
  }, [wantCat, creds]);

  // Lazy-load the full movie catalog when the search panel opens — or reuse
  // the one "All Movies" already downloaded.
  useEffect(() => {
    if (!searchOpen) return;
    if (allMovies || allMoviesLoading) return;
    const have = moviesByCatRef.current.get(ALL_ID);
    if (have) { setAllMovies(have); return; }
    setAllMoviesLoading(true);
    let cancelled = false;
    loadFullVodCatalogue(creds)
      .then(list => {
        if (cancelled) return;
        setAllMovies(list);
        noteCounts({ total: list.length, byCat: tallyByCategory(list) });
      })
      .catch(() => { if (!cancelled) setAllMovies([]); })
      .finally(() => { if (!cancelled) setAllMoviesLoading(false); });
    return () => { cancelled = true; };
  }, [searchOpen, allMovies, allMoviesLoading, creds, noteCounts]);

  // Films watched to the end on this line: a check on the poster and the
  // film's page (lib/watchedMarks), read once for the whole grid.
  const watchedFilms = useWatchedFilms(creds);
  const watchedLabel = t('live.vod.watched');

  // How long a film is watched, on top of the movie_play count.
  useEffect(() => {
    if (DEMO || !playing) return;
    try { startTimer('watch', 'movie_watch', 'player', { title: playing.title }); } catch { /* ignore */ }
    return () => { try { stopTimer('watch'); } catch { /* ignore */ } };
  }, [playing]);

  // On the list, a category's films show once the highlight settles on it.
  const catShown = pane === 'grid' || (!!currentCat && settledCat === currentCat.id);
  const visibleMovies = useMemo(() => {
    // Never an adult title, whatever is typed (lib/vodSearch).
    if (searchOpen) return searchVodTitles(searchQuery, allMovies, categories);
    if (!currentCat || !catShown) return [];
    return moviesByCat.get(currentCat.id) || [];
  }, [searchOpen, searchQuery, allMovies, categories, currentCat, catShown, moviesByCat]);

  // Only show "loading" for buckets we actually fetch. The All-Movies sentinel
  // doesn't auto-load, so don't render a spinner there until the user opts in.
  const moviesLoading = searchOpen
    ? allMoviesLoading
    : !!(
        currentCat
        && currentCat.id !== PLEX_ID
        && (currentCat.id !== ALL_ID || allOptedInRef.current)
        && (loadingCat === currentCat.id || !moviesByCat.has(currentCat.id) || !catShown)
      );


  // Reset grid focus when switching category.
  useEffect(() => { setGridIdx(0); }, [categoryIdx, searchOpen, searchQuery]);
  useEffect(() => { if (gridIdx >= visibleMovies.length) setGridIdx(0); }, [visibleMovies.length, gridIdx]);

  // Load detail
  // A slow answer for an earlier film must not fill in a newer one's page.
  const openSeqRef = useRef(0);
  // `keepStack`: opened from a related row, or Back to one (the back stack
  // stays); `focusId`: the related film to highlight once the rows are in.
  const openMovie = useCallback(async (m: XtreamVodStream, opts?: { keepStack?: boolean; focusId?: number | null }) => {
    const seq = ++openSeqRef.current;
    if (!opts?.keepStack) backStackRef.current = [];
    setSelectedMovie(m);
    setMovieInfo(null);
    setRelated(null);
    relFocusIdRef.current = opts?.focusId ?? null;
    setRelPos({ row: 0, col: 0 });
    setDetailFocus(opts?.focusId != null ? 'related' : 'play');
    setPane('detail');
    setInfoLoading(true);
    try {
      const info = await getVodInfo(creds, m.stream_id);
      if (seq === openSeqRef.current) setMovieInfo(info);
    } catch {
      if (seq === openSeqRef.current) setMovieInfo(null);
    } finally {
      if (seq === openSeqRef.current) setInfoLoading(false);
    }
  }, [creds]);

  const playMovie = useCallback(() => {
    // Demo: never build a stream URL or mount a player — show the demo dialog.
    if (DEMO) { setDemoNotice(true); return; }
    if (!selectedMovie) return;
    const ext = movieInfo?.movie_data?.container_extension || selectedMovie.container_extension || 'mp4';
    const url = buildMovieUrl(creds, selectedMovie.stream_id, ext);
    setPlaying({ url, title: selectedMovie.name, streamId: selectedMovie.stream_id });
    try { trackEvent('movie_play', 'player', { title: selectedMovie.name }); } catch { /* ignore */ }
  }, [creds, selectedMovie, movieInfo]);

  // The whole catalogue for "More in this series": the copy search or "All
  // Movies" holds, else one download, once the page's own info is in (never
  // two calls at once), shared with search after. Not on a box short of
  // memory: the series row then reads the categories already held.
  const fullList = allMovies ?? moviesByCat.get(ALL_ID) ?? null;
  useEffect(() => {
    if (pane !== 'detail' || !selectedMovie || infoLoading || fullList || lowMemoryBox()) return;
    let cancelled = false;
    loadFullVodCatalogue(creds)
      .then((list) => {
        if (cancelled || allMoviesRef.current) return;
        setAllMovies(list);
        noteCounts({ total: list.length, byCat: tallyByCategory(list) });
      })
      .catch(() => { /* no series row from the catalogue: the held lists still give one */ });
    return () => { cancelled = true; };
  }, [pane, selectedMovie, infoLoading, fullList, creds, noteCounts]);

  // Every category list held, as one (for the series row without the catalogue).
  const heldMovies = useMemo(() => {
    const out: XtreamVodStream[] = [];
    for (const list of moviesByCat.values()) out.push(...list);
    return out;
  }, [moviesByCat]);

  // The rows, worked out after the page is drawn (its info in first), off
  // the key's own frame. An adult film gets none; an adult title never shows
  // in them (as in search). Any failure: no rows.
  const pageGenre = movieInfo?.info?.genre ?? null;
  useEffect(() => {
    if (pane !== 'detail' || !selectedMovie || infoLoading) return;
    const cur = selectedMovie;
    const timer = window.setTimeout(() => {
      try {
        const adultCats = adultCategoryIds(categories);
        const adult = (m: XtreamVodStream) => isAdultHit({ name: m.name, categoryId: m.category_id, row: m }, adultCats);
        if (adult(cur)) { setRelated({ forId: cur.stream_id, series: [], like: [] }); return; }
        const series = findFranchise(cur, fullList ?? heldMovies).filter((m) => !adult(m));
        const catId = cur.category_id != null && cur.category_id !== '' ? String(cur.category_id) : null;
        const fromCat = catId ? moviesByCat.get(catId) : undefined;
        const fromFull = !fromCat && catId && fullList ? fullList.filter((m) => String(m.category_id ?? '') === catId) : null;
        const browsed = currentCatId ? moviesByCat.get(currentCatId) : undefined;
        const catList = (fromCat ?? fromFull ?? browsed ?? []).filter((m) => !adult(m));
        const like = findMoreLikeThis(cur, catList, pageGenre, series.map((m) => m.stream_id));
        setRelated({ forId: cur.stream_id, series, like });
      } catch {
        setRelated(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pane, selectedMovie, infoLoading, fullList, heldMovies, moviesByCat, categories, currentCatId, pageGenre]);

  const relRows = useMemo<RelRow[]>(() => {
    if (!related || !selectedMovie || related.forId !== selectedMovie.stream_id) return [];
    const rows: RelRow[] = [];
    if (related.series.length) rows.push({ kind: 'series', items: related.series });
    if (related.like.length) rows.push({ kind: 'like', items: related.like });
    return rows;
  }, [related, selectedMovie]);
  const relRowsRef = useRef(relRows);
  relRowsRef.current = relRows;
  // New rows: the same film stays highlighted if it is still there, else
  // the nearest card.
  useEffect(() => {
    const want = relFocusIdRef.current;
    if (want != null) {
      for (let r = 0; r < relRows.length; r++) {
        const c = relRows[r].items.findIndex((m) => m.stream_id === want);
        if (c >= 0) { setRelPos({ row: r, col: c }); return; }
      }
    }
    if (!relRows.length) return;
    setRelPos((p) => {
      const row = Math.min(p.row, relRows.length - 1);
      const col = Math.min(p.col, relRows[row].items.length - 1);
      return row === p.row && col === p.col ? p : { row, col };
    });
  }, [relRows]);
  useEffect(() => {
    if (detailFocus !== 'related') return;
    const m = relRowsRef.current[relPos.row]?.items[relPos.col];
    if (m) relFocusIdRef.current = m.stream_id;
  }, [relPos, detailFocus]);

  // OK on a related film: its page, the one left on the back stack.
  const openRelated = useCallback((m: XtreamVodStream) => {
    const from = selectedMovie;
    if (!from || m.stream_id === from.stream_id) return;
    const stack = backStackRef.current;
    stack.push({ movie: from, focusId: m.stream_id });
    if (stack.length > MAX_BACK_STACK) stack.shift();
    try { trackEvent('movie_related_open', 'player', { title: m.name }); } catch { /* ignore */ }
    void openMovie(m, { keepStack: true });
  }, [selectedMovie, openMovie]);
  const openRelatedRef = useRef(openRelated);
  openRelatedRef.current = openRelated;
  const onRelFocus = useCallback((i: number) => {
    setRelPos({ row: Math.floor(i / REL_STRIDE), col: i % REL_STRIDE });
    setDetailFocus('related');
  }, []);
  const onRelActivate = useCallback((i: number) => {
    const m = relRowsRef.current[Math.floor(i / REL_STRIDE)]?.items[i % REL_STRIDE];
    if (m) openRelatedRef.current(m);
  }, []);

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
  // One handler for every tile, so PosterCard's memo holds as focus moves:
  // inline arrows re-rendered every mounted tile on every key press.
  const openMovieRef = useRef(openMovie);
  useEffect(() => { openMovieRef.current = openMovie; }, [openMovie]);
  const onTileFocus = useCallback((i: number) => { setGridIdx(i); setPane('grid'); }, []);
  const onTileActivate = useCallback((i: number) => {
    const m = visibleMoviesRef.current[i];
    if (m) void openMovieRef.current(m);
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;

      // The player owns every key while it plays (VodPlayer's bar: Back, seek, volume).
      if (playingRef.current) return;
      // So does a trailer over the film's page (TrailerOverlay: OK pauses, Back closes it).
      if (trailerVideoRef.current) return;

      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        if (paneRef.current === 'detail') {
          // A film opened from a related row: back to the one before, its
          // highlight on the film just left. Else back to the list.
          const prev = backStackRef.current.pop();
          if (prev) void openMovieRef.current(prev.movie, { keepStack: true, focusId: prev.focusId });
          else { setPane('grid'); setSelectedMovie(null); }
        }
        // A touch screen shows no highlight to walk back through (the
        // categories are on screen beside or over the posters): the search
        // closes first, then Back leaves (Tronix 93ecbf4).
        else if (paneRef.current === 'grid' && !isTouchUI()) setPane('categories');
        else if (isTouchUI() && searchOpenRef.current) { setSearchOpen(false); setSearchQuery(''); }
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
          const id = cats[categoryIdxRef.current]?.id;
          if (id === PLEX_ID) {
            // Right is just a move; only OK opens Plex.
            if (e.key !== 'ArrowRight' && !e.repeat) onOpenPlexRef.current?.();
            return;
          }
          if (id === ALL_ID) allOptedInRef.current = true;
          setPane('grid');
        }
        return;
      }

      if (paneRef.current === 'grid') {
        const list = visibleMoviesRef.current;
        const i = gridIdxRef.current;
        const cols = gridColsRef.current;
        if (!list.length) return;
        if (e.key === 'ArrowRight') {
          if ((i + 1) % cols !== 0 && i + 1 < list.length) setGridIdx(i + 1);
        } else if (e.key === 'ArrowLeft') {
          if (i % cols === 0) setPane('categories');
          else setGridIdx(i - 1);
        } else if (e.key === 'ArrowDown') {
          const next = i + cols;
          setGridIdx(next < list.length ? next : i); // stay on last row
        } else if (e.key === 'ArrowUp') {
          if (i < cols) { if (onExitUp) onExitUp(); return; }
          setGridIdx(i - cols);
        
        } else if (e.key === 'Enter' || e.key === ' ') {
          const m = list[i];
          if (m) openMovie(m);
        }
        return;
      }

      if (paneRef.current === 'detail') {
        // Play, and Trailer on the line under it (owner via Tronix, 2026-10-10:
        // "you cant just drop down from 'play movie' to go to trailer"): ▼
        // reaches it, ▲ goes back to Play, ◀ ▶ there do nothing. Under them
        // the related rows: ▼ into the first, ▲ ▼ between rows, ◀ ▶ along a
        // row, ▲ from the first back to the buttons, OK opens that film.
        const rows = relRowsRef.current;
        if (detailFocusRef.current === 'related' && rows.length) {
          const { row, col } = relPosRef.current;
          const r = Math.min(row, rows.length - 1);
          const len = rows[r].items.length;
          if (e.key === 'ArrowLeft') { if (col > 0) setRelPos({ row: r, col: col - 1 }); }
          else if (e.key === 'ArrowRight') { if (col + 1 < len) setRelPos({ row: r, col: col + 1 }); }
          else if (e.key === 'ArrowDown') {
            if (r + 1 < rows.length) setRelPos({ row: r + 1, col: Math.min(col, rows[r + 1].items.length - 1) });
          } else if (e.key === 'ArrowUp') {
            if (r > 0) setRelPos({ row: r - 1, col: Math.min(col, rows[r - 1].items.length - 1) });
            else { relFocusIdRef.current = null; setDetailFocus(trailerRef.current ? 'trailer' : 'play'); }
          } else if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
            const m = rows[r].items[Math.min(col, len - 1)];
            if (m) openRelatedRef.current(m);
          }
          return;
        }
        const onTrailer = detailFocusRef.current === 'trailer' && !!trailerRef.current;
        if (e.key === 'ArrowDown') {
          if (!onTrailer && trailerRef.current) setDetailFocus('trailer');
          else if (rows.length) { setRelPos({ row: 0, col: 0 }); setDetailFocus('related'); }
        }
        else if (e.key === 'ArrowUp') setDetailFocus('play');
        else if (e.key === 'Enter' || e.key === ' ') {
          if (onTrailer) { if (!e.repeat) pressTrailer(); }
          else playMovie();
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, onExitLeft, onExitUp, openMovie, playMovie, pressTrailer]);

  // --- Virtualize grid by rows ---
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  // Virtualize grid by rows — measure row height from real layout so the
  // virtual stride matches the rendered poster row at any TV resolution.
  const [rowH, setRowH] = useState(280);
  const rowHRef = useRef(280);
  useEffect(() => { rowHRef.current = rowH; }, [rowH]);
  // Keyed on the grid being on screen: the detail page and the player
  // replace it, and the observer was left watching the old, detached one.
  const gridShown = !playing && !(pane === 'detail' && !!selectedMovie);
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const calc = () => {
      const cs = getComputedStyle(el);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const gap = 16; // gap-4
      const inner = Math.max(0, el.clientWidth - padL - padR);
      const colW = (inner - gap * (gridColsRef.current - 1)) / gridColsRef.current;
      const posterH = colW * 1.5; // aspect 2/3
      const titleArea = 56;
      const next = Math.max(180, Math.ceil(posterH + titleArea + 16));
      setRowH(prev => (prev !== next ? next : prev));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gridShown, GRID_COLS]);
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
    // A finger scrolling the grid is never pulled back to the highlight (phoneMode).
    if (!visibleMovies.length || fingerIsDriving()) return;
    const row = Math.floor(gridIdx / GRID_COLS);
    rowVirtualizer.scrollToIndex(row, { align: 'auto' });
    return followGridRow(gridScrollRef.current, row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridIdx, visibleMovies.length]);

  // Keep the highlighted category on screen as the remote moves down the
  // list — it had no scroll-follow at all, so the highlight slid off the
  // bottom of the pane. Also on return from a film (the pane is rebuilt).
  const catScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = catScrollRef.current;
    if (!node) return;
    if (categoryIdx === 0) { node.scrollTop = 0; return; }
    const el = node.querySelector<HTMLElement>(`[data-cat-i="${categoryIdx}"]`);
    if (el) keepInView(node, el, 8);
  }, [categoryIdx, gridShown, searchOpen, visibleCategories.length]);

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

  // The film page's text column: the highlighted button stays in view (a big
  // font size can push Trailer's line under the bottom of the screen).
  const detailTextRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = detailTextRef.current;
    const el = node?.querySelector<HTMLElement>('[data-detail-btn][data-focused="true"]');
    if (node && el) keepInView(node, el, 8);
  }, [detailFocus, trailer, pane]);

  // The related strip shows the highlighted row (one at a time, the next
  // one's label peeking), and the row keeps its highlighted card in view.
  const relStripRef = useRef<HTMLDivElement | null>(null);
  const relLitNow = detailFocus === 'related' && relRows.length > 0;
  useEffect(() => {
    const strip = relStripRef.current;
    if (!strip || fingerIsDriving()) return;
    const row = relLitNow ? Math.min(relPos.row, relRows.length - 1) : 0;
    strip.scrollTop = row * REL_ROW_H;
    if (!relLitNow) return;
    const scroller = strip.querySelector<HTMLElement>(`[data-related-row="${relRows[row]?.kind}"] [data-related-scroll]`);
    const card = scroller?.querySelector<HTMLElement>(`[data-related-col="${relPos.col}"]`);
    if (scroller && card) keepInViewX(scroller, card);
  }, [relPos, relLitNow, relRows]);

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

  // Fullscreen player
  if (playing) {
    return (
      <VodPlayer
        src={playing.url}
        volume={volume}
        onVolumeChange={setVolume}
        title={playing.title}
        onClose={() => setPlaying(null)}
        onError={(msg) => {
          try { trackEvent('player_error', 'player', { kind: 'movie', channel_or_title: playing.title, server: creds.serverLabel, message: msg.slice(0, 200) }); } catch { /* ignore */ }
        }}
        // Watched marks: watched at 92%, its last minute or its end.
        onProgress={(pos, dur) => { try { noteFilmProgress(creds, playing.streamId, pos, dur); } catch { /* ignore */ } }}
        onEnded={() => { try { noteFilmFinished(creds, playing.streamId); } catch { /* ignore */ } }}
      >
        {titleShown && (
          <div className="absolute top-4 left-4 max-w-[70%] truncate px-4 py-2 rounded-xl bg-black/70 text-white font-quicksand font-bold text-lg pointer-events-none">
            {playing.title}
          </div>
        )}
      </VodPlayer>
    );
  }

  // Detail view: sized to fit a 960×540 screen with nothing to scroll by
  // hand (the remote only reaches Play); a long plot scrolls itself.
  if (pane === 'detail' && selectedMovie) {
    const info = movieInfo?.info;
    const cover = tmdbSized(info?.movie_image || info?.cover_big || selectedMovie.stream_icon, 'w500');
    // Play keeps the highlight unless it is on a Trailer or a related film
    // that is drawn.
    const trailerLit = isActive && !demoNotice && detailFocus === 'trailer' && !!trailer;
    const relLit = isActive && !demoNotice && relLitNow;
    const playLit = isActive && !demoNotice && !trailerLit && !relLit;
    const hasRows = relRows.length > 0;
    const cast = castNames(info?.cast);
    const director = String(info?.director ?? '').trim();
    const litRow = Math.min(relPos.row, Math.max(0, relRows.length - 1));
    return (
      <div data-movie-detail="" className="flex-1 min-h-0 min-w-0 flex flex-col text-white bg-black/40">
        {/* No Back button of its own: the screen's top bar has one, and the
            remote's Back returns to the list. The space goes to the info. */}
        {/* The cover takes the row's height (FitPoster), with a margin above
            the bottom edge; the text beside it scrolls if it ever must. */}
        <div className={`flex-1 min-h-0 flex px-8 pt-4 ${hasRows ? 'pb-2' : 'pb-6'}`} data-detail-body="">
          <FitPoster src={cover} maxWidth={300} className="mr-8" />
          <div ref={detailTextRef} className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden max-w-3xl px-2 py-2">
            <h2 className="text-3xl font-quicksand font-bold leading-tight line-clamp-2 mb-3">{selectedMovie.name}</h2>
            <div className="flex flex-wrap items-center text-sm text-brand-ice/80 font-nunito mb-4">
              {watchedFilms.has(Number(selectedMovie.stream_id)) && (
                <span data-watched="" className="flex items-center mr-3 text-brand-gold font-semibold">
                  <span className="flex items-center justify-center w-6 h-6 mr-1.5 rounded-full bg-brand-gold" aria-hidden="true">
                    <Check className="w-4 h-4 text-brand-navy" strokeWidth={3} />
                  </span>
                  {watchedLabel}
                </span>
              )}
              {info?.rating != null && (
                <span className="flex items-center mr-3"><Star className="w-4 h-4 mr-1 text-brand-gold fill-brand-gold" />{Number(info.rating).toFixed(1)}</span>
              )}
              {info?.releasedate && <span className="mr-3">{String(info.releasedate).slice(0, 4)}</span>}
              {info?.genre && <span className="mr-3">{info.genre}</span>}
              {info?.duration && <span>{info.duration}</span>}
            </div>
            {/* Who is in it: names only (the panel sends no photos), one line. */}
            {!infoLoading && (cast.length > 0 || director) && (
              <p data-movie-cast="" className="text-sm font-nunito text-brand-ice/80 mb-3 truncate">
                {director && (
                  <span className="mr-3"><span className="text-brand-ice/50 mr-1">{t('live.vod.directorLabel')}</span>{director}</span>
                )}
                {cast.length > 0 && (
                  <span><span className="text-brand-ice/50 mr-1">{t('live.vod.castLabel')}</span>{cast.join(', ')}</span>
                )}
              </p>
            )}
            {infoLoading ? (
              <Loader2 className="w-6 h-6 mb-6 animate-spin text-brand-gold" />
            ) : (
              <ScrollLines text={info?.plot || t('live.vod.noDescription')} maxLines={hasRows ? 4 : 7} className={`text-brand-ice/90 font-nunito leading-snug max-w-3xl ${hasRows ? 'mb-4' : 'mb-6'}`} />
            )}
            <Button
              variant="gold"
              onClick={() => { setDetailFocus('play'); playMovie(); }}
              autoFocus
              data-detail-btn="play"
              data-focused={playLit ? 'true' : 'false'}
              className={`tv-ring tv-ring-contrast h-12 rounded-xl text-xl px-8 transition-transform duration-150 ease-out ${playLit ? 'scale-105 z-10' : ''}`}
            >
              <Play className="w-5 h-5 mr-2 fill-current" />
              {t('live.vod.playMovieBtn')}
            </Button>
            {/* Trailer on its own line under Play: ▼ from Play, ▲ back. */}
            {trailer && (
              <div data-movie-trailer-line="" className="mt-3">
                <TrailerButton
                  target={trailer}
                  detailBtn="trailer"
                  focused={trailerLit}
                  onPress={() => { setDetailFocus('trailer'); pressTrailer(); }}
                  className={`tv-ring h-11 rounded-xl text-lg px-5 bg-black/40 border-white/20 text-white transition-transform duration-150 ease-out ${trailerLit ? 'scale-105 z-10' : ''}`}
                />
              </div>
            )}
          </div>
        </div>
        {/* Related films, the TV's whole width: one slim row at a time. */}
        {hasRows && (
          <div
            ref={relStripRef}
            data-related=""
            className={`flex-shrink-0 px-6 ${isTouchUI() ? 'overflow-y-auto' : 'overflow-hidden'}`}
            style={{ height: relRows.length > 1 ? REL_ROW_H + REL_PEEK : REL_ROW_H }}
          >
            {relRows.map((r, ri) => (
              <div key={r.kind} data-related-row={r.kind} style={{ height: REL_ROW_H }}>
                <div className={`h-6 px-2 text-sm font-quicksand font-semibold truncate ${relLit && litRow === ri ? 'text-brand-gold' : 'text-brand-ice/80'}`}>
                  {r.kind === 'series' ? t('live.vod.moreInSeries') : t('live.vod.moreLikeThis')}
                </div>
                <div
                  data-related-scroll=""
                  className={`relative flex px-2 py-2 ${isTouchUI() ? 'overflow-x-auto' : 'overflow-x-hidden'} overflow-y-hidden`}
                >
                  {r.items.map((m, ci) => (
                    <div key={m.stream_id} data-related-col={ci} data-related-id={m.stream_id} className="flex-shrink-0 mr-3" style={{ width: REL_CARD_W }}>
                      <PosterCard
                        title={m.name}
                        image={tmdbSized(m.stream_icon, 'w185')}
                        year={m.year}
                        isFocused={relLit && litRow === ri && relPos.col === ci}
                        variant="movie"
                        watched={watchedFilms.has(Number(m.stream_id)) ? watchedLabel : null}
                        index={ri * REL_STRIDE + ci}
                        onFocus={onRelFocus}
                        onActivate={onRelActivate}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {demoNoticeOverlay}
        {trailerVideo && <TrailerOverlay video={trailerVideo} title={selectedMovie.name} kind="movie" onClose={closeTrailer} />}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex" data-vod-browse="">
      {/* Pane 2 — Categories */}
      <div ref={catScrollRef} data-howto="vod.categories" data-vod-cats="" className={`w-64 max-w-[16rem] flex-shrink-0 border-r border-white/10 p-3 overflow-y-auto overflow-x-hidden bg-black/40 ${pane === 'categories' && isActive ? 'bg-white/5' : ''}`}>
        <button
          onClick={() => setSearchOpen(o => !o)}
          data-focused={searchFocused ? 'true' : 'false'}
          className={`tv-ring w-full flex items-center gap-2 px-3 py-3 mb-2 rounded-xl border border-white/10 text-brand-ice font-nunito text-base ${searchFocused ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-black/40'}`}
        >
          <Search className="w-4 h-4" />
          <span className="min-w-0 truncate">{searchOpen ? t('live.list.closeSearchBtn') : t('live.vod.searchMoviesBtn')}</span>
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
                    if (c.id === PLEX_ID) { setCategoryIdx(i); onOpenPlexRef.current?.(); return; }
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
                  {c.id === PLEX_ID && <Film className="w-4 h-4 text-brand-gold flex-shrink-0" />}
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

      {/* Pane 3 — Grid (virtualized by row) */}
      <div ref={gridScrollRef} data-howto="vod.grid" data-vod-grid="" className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-6 bg-black/30">
        {!searchOpen && currentCat?.id === PLEX_ID ? (
          <div className="h-full flex items-center justify-center">
            <div className="max-w-md text-center rounded-3xl border border-brand-gold/30 bg-black/40 px-10 py-10">
              <Film className="w-14 h-14 text-brand-gold mx-auto mb-4" />
              <h3 className="text-2xl font-quicksand font-bold text-white mb-2">{t('live.vod.plexTitle')}</h3>
              <p className="text-brand-ice/85 font-nunito leading-relaxed">
                {t('live.vod.plexBody')}
              </p>
            </div>
          </div>
        ) : moviesLoading && visibleMovies.length === 0 ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}>
            {Array.from({ length: GRID_COLS * 3 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-white/5 animate-pulse" style={{ height: 0, paddingBottom: '150%' }} />
            ))}
          </div>
        ) : visibleMovies.length === 0 ? (
          <div className="h-full flex items-center justify-center text-brand-ice/70 font-nunito">
            {searchOpen
              ? (searchQuery
                  ? (allMoviesLoading ? t('live.vod.loadingCatalog') : t('live.vod.noMatch'))
                  : (allMoviesLoading ? t('live.vod.loadingCatalog') : t('live.vod.typeToSearch')))
              : currentCat?.id === ALL_ID && !allOptedInRef.current
                ? t('live.vod.pressOkLoadAll')
                : t('live.vod.noMovies')}
          </div>

        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {rowVirtualizer.getVirtualItems().map(vr => {
              const rowStart = vr.index * GRID_COLS;
              const rowItems = visibleMovies.slice(rowStart, rowStart + GRID_COLS);
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
                  {rowItems.map((m, ci) => {
                    const i = rowStart + ci;
                    const isFocused = isActive && pane === 'grid' && i === gridIdx;
                    return (
                      <div key={m.stream_id}>
                        <PosterCard
                          title={m.name}
                          image={tmdbSized(m.stream_icon)}
                          rating={m.rating_5based ? m.rating_5based * 2 : m.rating}
                          year={m.year}
                          isFocused={isFocused}
                          variant="movie"
                          watched={watchedFilms.has(Number(m.stream_id)) ? watchedLabel : null}
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

MoviesSection.displayName = 'MoviesSection';
export default MoviesSection;
