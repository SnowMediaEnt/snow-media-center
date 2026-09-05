// Row-based browsing for a Plex library section.
//
// Opening Movies used to page the ENTIRE section into memory and render one
// A-Z grid, with no way to change the order. This is what you land on instead:
// Continue Watching, Recently Released, Recently Added, then more rows, and a
// "Browse all" bar at the bottom that opens the old grid.
//
// Several details here are defensive for reasons that are not obvious; each is
// commented where it appears. The load-bearing ones:
//   • The focus cursor tracks a stable ROW ID, not an array index. Wave-2 rows
//     arrive asynchronously and rows are dropped when empty, so an index
//     cursor drifts under a stationary user — the ring jumps and OK activates
//     something they did not aim at.
//   • "Browse all" is a real entry in the rows array, so index 0 always exists
//     and the D-pad works from the first frame. With an empty array, a handler
//     that preventDefaults before checking for a current row swallows every
//     key — including the escape — for as long as the first fetches take.
//   • Rails mount in a WINDOW around the focus, not a growing prefix. A prefix
//     ends with every rail mounted at once: ~100 poster GETs and 7 composited
//     scroll layers on a 1GB stick.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlexImage from './PlexImage';
import {
  getPlexSectionOnDeck, getPlexSectionRow, getCachedHub, setCachedHub,
  getPlexSectionMeta, getPlexFilterValues, getPlexLibraryQuery,
  resolutionLabel, type PlexItem, type PlexSectionMeta, type PlexFilterValue,
} from '@/lib/plex';
import {
  EMPTY_FILTERS, hasAnyFilter, describeFilters, buildLibraryQuery,
  availableSorts, findFilter, type LibraryFilterState,
} from '@/lib/plexLibraryFilters';
import {
  libraryRowSpecs, tileCaption, resumeFraction,
  type LibraryRowSpec, type PlexSectionType,
} from '@/lib/plexLibraryRows';

interface LoadedRow {
  spec: LibraryRowSpec;
  items: PlexItem[];
}

export interface PlexLibraryRowsProps {
  isActive: boolean;
  base: string;
  token: string;
  libKey: string;
  libTitle: string;
  sectionType: PlexSectionType;
  totalSize?: number;
  onOpen: (it: PlexItem) => void;
  onBrowseAll: () => void;
  onExitToTabs: () => void;
}

/** Cache key for a row, so a revisit paints instantly from the hub cache. */
const rowCachePath = (libKey: string, spec: LibraryRowSpec) =>
  spec.kind === 'onDeck'
    ? `/library/sections/${libKey}/onDeck`
    : `/library/sections/${libKey}/all?${spec.query}`;

const PlexLibraryRows = memo(({
  isActive, base, token, libKey, libTitle, sectionType, totalSize,
  onOpen, onBrowseAll, onExitToTabs,
}: PlexLibraryRowsProps) => {
  const specs = useMemo(() => libraryRowSpecs(sectionType), [sectionType]);

  // Seed synchronously from the hub cache so a revisit paints with no flash.
  // getPlexHub does NOT cache on its own — the cache is entirely caller-driven,
  // so every fetch below pairs getCachedHub with setCachedHub explicitly.
  const [loaded, setLoaded] = useState<Record<string, PlexItem[]>>(() => {
    const seed: Record<string, PlexItem[]> = {};
    for (const s of specs) {
      if (s.kind === 'browseAll') continue;
      const c = getCachedHub(base, rowCachePath(libKey, s));
      if (c && c.length) seed[s.id] = c;
    }
    return seed;
  });

  // Rows actually shown: a spec appears once it has items, except browseAll
  // which is always present so there is never an empty rows array.
  const rows = useMemo<LoadedRow[]>(() => {
    const out: LoadedRow[] = [];
    for (const s of specs) {
      if (s.kind === 'browseAll') { out.push({ spec: s, items: [] }); continue; }
      const items = loaded[s.id];
      if (items && items.length) out.push({ spec: s, items });
    }
    return out;
  }, [specs, loaded]);

  // ── focus, tracked by stable id ──────────────────────────────────────────
  // NULL means "wherever the top is". That matters because at first paint the
  // only row that exists is "Browse all" — the rails have not loaded yet. If
  // focus were pinned to a concrete id here it would latch onto that bar, and
  // when the rails arrived a moment later focus would still be on the BOTTOM
  // of the screen with unmounted placeholders above it. Staying null until the
  // user actually moves keeps focus on the first row as the rows fill in.
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [col, setCol] = useState(0);

  const row = useMemo(() => {
    if (focusedRowId == null) return 0;
    const i = rows.findIndex((r) => r.spec.id === focusedRowId);
    return i >= 0 ? i : 0;
  }, [rows, focusedRowId]);

  // If the row holding focus disappears, fall back to a real neighbour rather
  // than leaving the id dangling. Only when focus was explicitly placed.
  useEffect(() => {
    if (rows.length === 0 || focusedRowId == null) return;
    if (!rows.some((r) => r.spec.id === focusedRowId)) {
      setFocusedRowId(rows[0].spec.id);
      setCol(0);
    }
  }, [rows, focusedRowId]);

  // Keep the column inside the current row.
  useEffect(() => {
    const r = rows[row];
    if (r && r.spec.kind !== 'browseAll' && col > r.items.length - 1) {
      setCol(Math.max(0, r.items.length - 1));
    }
  }, [rows, row, col]);

  // ── filter bar ───────────────────────────────────────────────────────────
  // 'bar' is a zone above the content, not a row in the rows array. Keeping it
  // out of that array is deliberate: the rows array mutates as wave-2 rows
  // arrive, and a cursor that has to survive insertion is exactly the thing
  // that made focus jump before.
  const [zone, setZone] = useState<'bar' | 'content'>('content');
  const [chipId, setChipId] = useState<string>('sort');
  const [filters, setFilters] = useState<LibraryFilterState>(EMPTY_FILTERS);
  const [meta, setMeta] = useState<PlexSectionMeta | null>(null);
  const [metaTried, setMetaTried] = useState(false);
  const [values, setValues] = useState<Record<string, PlexFilterValue[]>>({});
  const [menu, setMenu] = useState<{ chip: string; options: PlexFilterValue[]; idx: number } | null>(null);
  const [results, setResults] = useState<{ items: PlexItem[]; total: number } | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [gridCursor, setGridCursor] = useState(0);

  const filtering = hasAnyFilter(filters);
  const GRID_COLS = 6;

  // The section's own sort/filter vocabulary, fetched LAZILY the first time the
  // bar is entered — so it costs nothing for anyone who never filters.
  // Deliberately NOT /library/sections/{k}/filters or /sorts: Plex's docs say
  // not to use those and both are admin-token only, so a user browsing a
  // SHARED library would get a 401 and an empty bar.
  useEffect(() => {
    if (zone !== 'bar' || metaTried) return;
    setMetaTried(true);
    let cancelled = false;
    void getPlexSectionMeta(base, token, libKey)
      .then((m) => { if (!cancelled) setMeta(m); })
      .catch(() => { /* chips fall back to the built-in sort list */ });
    return () => { cancelled = true; };
  }, [zone, metaTried, base, token, libKey]);

  const sortOptions = useMemo(
    () => availableSorts(meta?.sorts ?? []).map((x) => ({ key: x.key, title: x.title })),
    [meta],
  );

  const chips = useMemo(() => {
    const out: Array<{ id: string; label: string; set: boolean }> = [];
    out.push({
      id: 'sort',
      label: `Sort: ${sortOptions.find((o) => o.key === filters.sort)?.title ?? 'Default'}`,
      set: !!filters.sort,
    });
    if (!meta || findFilter(meta.filters, 'genre')) {
      out.push({ id: 'genre', label: `Genre: ${filters.genre?.title ?? 'All'}`, set: !!filters.genre });
    }
    if (!meta || findFilter(meta.filters, 'year') || findFilter(meta.filters, 'decade')) {
      out.push({ id: 'year', label: `Year: ${filters.year?.title ?? 'All'}`, set: !!filters.year });
    }
    if (!meta || findFilter(meta.filters, 'contentRating')) {
      out.push({ id: 'contentRating', label: `Rated: ${filters.contentRating?.title ?? 'All'}`, set: !!filters.contentRating });
    }
    out.push({ id: 'unwatched', label: `Unwatched: ${filters.unwatched ? 'On' : 'Off'}`, set: filters.unwatched });
    if (filtering) out.push({ id: 'clear', label: 'Clear', set: false });
    return out;
  }, [meta, filters, sortOptions, filtering]);

  // Chip focus by stable id — the Clear chip appears and disappears, and the
  // rest appear only once the vocabulary resolves, so an index would drift.
  const chipIdx = useMemo(() => {
    const i = chips.findIndex((c) => c.id === chipId);
    return i >= 0 ? i : 0;
  }, [chips, chipId]);

  // ── fetching ─────────────────────────────────────────────────────────────
  const fetchedRef = useRef<Set<string>>(new Set());
  const [wave2, setWave2] = useState(false);

  const fetchRow = useCallback(async (spec: LibraryRowSpec) => {
    if (spec.kind === 'browseAll') return;
    if (fetchedRef.current.has(spec.id)) return;
    fetchedRef.current.add(spec.id);
    const path = rowCachePath(libKey, spec);
    try {
      const items = spec.kind === 'onDeck'
        ? await getPlexSectionOnDeck(base, token, libKey)
        : await getPlexSectionRow(base, token, libKey, spec.query || '');
      // An empty-but-successful response is a real answer: the row is hidden.
      // That is the documented behaviour for every guarded row (the date and
      // rating bounds can legitimately match nothing).
      setLoaded((prev) => ({ ...prev, [spec.id]: items }));
      if (items.length) setCachedHub(base, path, items);
    } catch {
      // Leave it absent — the row simply does not appear. A failed row must
      // never block the others.
      fetchedRef.current.delete(spec.id);
    }
  }, [base, token, libKey]);

  // Wave 1, behind the same 400ms dwell the grid loader uses. The panel mounts
  // as soon as its tab becomes current — including while the user is still
  // arrow-scrubbing across the tab strip — so firing immediately would put
  // three uncancellable native requests on every tab they pass through.
  useEffect(() => {
    if (!isActive) return;
    const t = window.setTimeout(() => {
      specs.filter((s) => s.wave === 1).forEach((s) => { void fetchRow(s); });
    }, 400);
    return () => window.clearTimeout(t);
  }, [isActive, specs, fetchRow]);

  // Wave 2 once the user moves down past the first rows — never at tab-enter.
  useEffect(() => {
    if (wave2 || !isActive) return;
    if (row >= 2) setWave2(true);
  }, [row, wave2, isActive]);

  useEffect(() => {
    if (!wave2) return;
    specs.filter((s) => s.wave === 2).forEach((s) => { void fetchRow(s); });
  }, [wave2, specs, fetchRow]);

  // Filtered results, straight from the server. The whole point of doing this
  // server-side is that a 4000-title library costs the same as a 40-title one;
  // the old screen pulled the entire section into memory to sort it locally.
  useEffect(() => {
    if (!filtering) { setResults(null); setGridCursor(0); return; }
    let cancelled = false;
    setResultsLoading(true);
    setGridCursor(0);
    const q = buildLibraryQuery(sectionType, filters);
    void getPlexLibraryQuery(base, token, libKey, q, 0, 120)
      .then((page) => {
        if (cancelled) return;
        setResults({ items: page.items, total: page.totalSize });
      })
      .catch(() => { if (!cancelled) setResults({ items: [], total: 0 }); })
      .finally(() => { if (!cancelled) setResultsLoading(false); });
    return () => { cancelled = true; };
  }, [filtering, filters, sectionType, base, token, libKey]);

  // Open a chip's menu, fetching its vocabulary once.
  const openMenu = useCallback(async (chip: string) => {
    if (chip === 'sort') {
      const opts: PlexFilterValue[] = [{ key: '', title: 'Default order' }, ...sortOptions];
      setMenu({ chip, options: opts, idx: Math.max(0, opts.findIndex((o) => o.key === filters.sort)) });
      return;
    }
    // A sentinel first entry. Without it the only way to undo a genre is
    // Clear, which also throws away the sort the user picked — so choosing a
    // wrong genre costs them their sort. `key: ''` is the unset marker;
    // buildLibraryQuery never sees it because applyMenuChoice deletes the
    // whole field instead of storing it.
    const withAll = (opts: PlexFilterValue[]): PlexFilterValue[] =>
      [{ key: '', title: 'All' }, ...opts];

    const cached = values[chip];
    if (cached) {
      setMenu({ chip, options: withAll(cached), idx: 0 });
      return;
    }
    const filterName = chip === 'year'
      ? (findFilter(meta?.filters ?? [], 'year') ?? findFilter(meta?.filters ?? [], 'decade'))
      : findFilter(meta?.filters ?? [], chip);
    if (!filterName) { setMenu({ chip, options: [], idx: 0 }); return; }
    try {
      const opts = await getPlexFilterValues(base, token, filterName.key);
      setValues((v) => ({ ...v, [chip]: opts }));
      setMenu({ chip, options: withAll(opts), idx: 0 });
    } catch {
      setMenu({ chip, options: [], idx: 0 });
    }
  }, [sortOptions, filters.sort, values, meta, base, token]);

  const applyMenuChoice = useCallback((chip: string, opt: PlexFilterValue) => {
    const unset = !opt.key;
    setFilters((f) => {
      if (chip === 'sort') return { ...f, sort: opt.key };
      if (chip === 'genre') return { ...f, genre: unset ? undefined : opt };
      if (chip === 'year') return { ...f, year: unset ? undefined : opt };
      if (chip === 'contentRating') return { ...f, contentRating: unset ? undefined : opt };
      return f;
    });
    setMenu(null);
  }, []);

  const activateChip = useCallback((id: string) => {
    if (id === 'clear') { setFilters(EMPTY_FILTERS); return; }
    if (id === 'unwatched') { setFilters((f) => ({ ...f, unwatched: !f.unwatched })); return; }
    void openMenu(id);
  }, [openMenu]);

  // ── D-pad ────────────────────────────────────────────────────────────────
  const rowsRef = useRef(rows); useEffect(() => { rowsRef.current = rows; }, [rows]);
  const rowIdxRef = useRef(row); useEffect(() => { rowIdxRef.current = row; }, [row]);
  const colRef = useRef(col); useEffect(() => { colRef.current = col; }, [col]);
  const onOpenRef = useRef(onOpen); useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);
  const onBrowseAllRef = useRef(onBrowseAll); useEffect(() => { onBrowseAllRef.current = onBrowseAll; }, [onBrowseAll]);
  const onExitRef = useRef(onExitToTabs); useEffect(() => { onExitRef.current = onExitToTabs; }, [onExitToTabs]);

  const zoneRef = useRef(zone); useEffect(() => { zoneRef.current = zone; }, [zone]);
  const menuRef = useRef(menu); useEffect(() => { menuRef.current = menu; }, [menu]);
  const chipsRef = useRef(chips); useEffect(() => { chipsRef.current = chips; }, [chips]);
  const chipIdxRef = useRef(chipIdx); useEffect(() => { chipIdxRef.current = chipIdx; }, [chipIdx]);
  const activateChipRef = useRef(activateChip); useEffect(() => { activateChipRef.current = activateChip; }, [activateChip]);
  const applyMenuChoiceRef = useRef(applyMenuChoice); useEffect(() => { applyMenuChoiceRef.current = applyMenuChoice; }, [applyMenuChoice]);
  const filteringRef = useRef(filtering); useEffect(() => { filteringRef.current = filtering; }, [filtering]);
  const resultsRef = useRef(results); useEffect(() => { resultsRef.current = results; }, [results]);
  const gridCursorRef = useRef(gridCursor); useEffect(() => { gridCursorRef.current = gridCursor; }, [gridCursor]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;

      // MENU FIRST, and inside this one handler rather than by claiming a new
      // global key-owner. A menu that owns the keyboard through a global token
      // can strand the whole remote if it is torn down while the token is
      // still set — the other panels all bail on that token.
      const m = menuRef.current;
      if (m) {
        if (isBack) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          setMenu(null);
          return;
        }
        if (!keys.includes(e.key)) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (e.key === 'ArrowUp') setMenu({ ...m, idx: Math.max(0, m.idx - 1) });
        else if (e.key === 'ArrowDown') setMenu({ ...m, idx: Math.min(m.options.length - 1, m.idx + 1) });
        else if (e.key === 'Enter' || e.key === ' ') {
          const opt = m.options[m.idx];
          if (opt) applyMenuChoiceRef.current(m.chip, opt);
          else setMenu(null);
        }
        return;
      }

      // BACK, before the key filter. Falling through to PlexSection's handler
      // would leave the library entirely — so a user who filtered to one genre
      // and pressed Back to undo it would land back on the tab strip instead,
      // with the filter still set and waiting for them on the way in.
      if (isBack) {
        if (filteringRef.current) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          setFilters(EMPTY_FILTERS);
          setZone('content');
          return;
        }
        if (zoneRef.current === 'bar') {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          setZone('content');
          return;
        }
        return; // nothing filtered, on the rows — let the section handle it
      }

      if (!keys.includes(e.key)) return;

      // THE CHIP BAR
      if (zoneRef.current === 'bar') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const cs = chipsRef.current;
        const ci = chipIdxRef.current;
        if (e.key === 'ArrowUp') { onExitRef.current(); return; }
        if (e.key === 'ArrowDown') { setZone('content'); return; }
        if (e.key === 'ArrowLeft') { if (ci > 0) setChipId(cs[ci - 1].id); return; }
        if (e.key === 'ArrowRight') { if (ci < cs.length - 1) setChipId(cs[ci + 1].id); return; }
        if (e.key === 'Enter' || e.key === ' ') { const chip = cs[ci]; if (chip) activateChipRef.current(chip.id); }
        return;
      }

      // THE FILTERED GRID
      if (filteringRef.current) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const items = resultsRef.current?.items ?? [];
        const cur = gridCursorRef.current;
        if (e.key === 'ArrowUp') {
          if (cur < GRID_COLS) setZone('bar');
          else setGridCursor(cur - GRID_COLS);
          return;
        }
        if (e.key === 'ArrowDown') { if (cur + GRID_COLS < items.length) setGridCursor(cur + GRID_COLS); return; }
        if (e.key === 'ArrowLeft') { if (cur % GRID_COLS !== 0) setGridCursor(cur - 1); return; }
        if (e.key === 'ArrowRight') { if ((cur % GRID_COLS) < GRID_COLS - 1 && cur + 1 < items.length) setGridCursor(cur + 1); return; }
        if (e.key === 'Enter' || e.key === ' ') { const it = items[cur]; if (it) onOpenRef.current(it); }
        return;
      }

      const list = rowsRef.current;
      const r = rowIdxRef.current;
      const c = colRef.current;

      // VERTICAL AND ESCAPE FIRST, before any current-row lookup. Doing it the
      // other way round (preventDefault, then bail on a missing row) swallows
      // every key while the rows are still loading — including the only way
      // out of the screen.
      if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (r <= 0) setZone('bar');
        else { setFocusedRowId(list[r - 1].spec.id); setCol(0); }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (r < list.length - 1) { setFocusedRowId(list[r + 1].spec.id); setCol(0); }
        return;
      }

      const current = list[r];
      if (!current) return; // nothing to act on horizontally yet — let it pass

      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();

      if (current.spec.kind === 'browseAll') {
        if (e.key === 'Enter' || e.key === ' ') onBrowseAllRef.current();
        return; // left/right do nothing on a full-width bar
      }
      if (e.key === 'ArrowLeft') { if (c > 0) setCol(c - 1); return; }
      if (e.key === 'ArrowRight') { if (c < current.items.length - 1) setCol(c + 1); return; }
      if (e.key === 'Enter' || e.key === ' ') {
        const it = current.items[c];
        if (it) onOpenRef.current(it);
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [isActive]);

  // ── render ───────────────────────────────────────────────────────────────
  // A WINDOW around the focus, not a growing prefix: at most three rails are
  // ever mounted, which bounds live posters at ~45 instead of ~100.
  const mountFrom = Math.max(0, row - 1);
  const mountTo = Math.min(rows.length - 1, row + 1);

  const anyLoaded = Object.keys(loaded).length > 0;

  const sortTitle = sortOptions.find((o) => o.key === filters.sort)?.title;

  return (
    <div className="flex flex-col gap-6">
      {/* CHIP BAR. gap-2 deliberately — it is in the html.no-flex-gap
          emulation allowlist; gap-5/6/8 are not and collapse on Chromium 66. */}
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip, i) => {
          const focused = isActive && zone === 'bar' && i === chipIdx && !menu;
          const open = menu?.chip === chip.id;
          return (
            <div
              key={chip.id}
              ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }}
              onClick={() => { setZone('bar'); setChipId(chip.id); activateChip(chip.id); }}
              data-focused={focused ? 'true' : 'false'}
              className={`tv-ring cursor-pointer rounded-full px-4 py-2 text-sm font-nunito font-semibold border ${
                focused
                  ? 'bg-brand-gold/25 text-white border-brand-gold scale-[1.04] z-10'
                  : open
                    ? 'bg-black/60 text-brand-gold border-brand-gold'
                    : chip.set
                      ? 'bg-white/10 text-brand-gold border-white/20'
                      : 'bg-white/5 text-brand-ice/80 border-white/10'
              }`}
            >
              {chip.label}
            </div>
          );
        })}
        <span className="ml-auto text-xs text-brand-ice/50 font-nunito">◀ ▶ pick · OK opens · ▼ list</span>
      </div>

      {/* FILTER MENU. Capped and scrollable, and the focused row scrolls itself
          into view — a genre list is commonly 30+ entries, where the player's
          fixed 5-item pickers would run off the bottom of the screen with no
          way to see what is selected. */}
      {menu && (
        <div className="rounded-2xl bg-black/90 border border-white/15 p-2 max-h-[60vh] overflow-y-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70">
              {chips.find((c) => c.id === menu.chip)?.label ?? 'Choose'}
            </p>
            <span className="text-xs text-brand-ice/60 font-nunito">▲▼ · OK · Back</span>
          </div>
          {menu.options.length === 0 ? (
            <div className="px-3 py-3 text-sm font-nunito text-brand-ice/60">
              Nothing to choose here for this library.
            </div>
          ) : (
            <div className="space-y-1">
              {menu.options.map((opt, i) => {
                const f = i === menu.idx;
                return (
                  <div
                    key={`${opt.key}-${i}`}
                    ref={(el) => { if (f && el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }}
                    onClick={() => applyMenuChoice(menu.chip, opt)}
                    data-focused={f ? 'true' : 'false'}
                    className={`tv-ring px-3 py-2 rounded-xl font-nunito text-sm cursor-pointer ${
                      f ? 'bg-brand-gold/20 text-white scale-[1.02] z-10' : 'text-brand-ice/90'
                    }`}
                  >
                    {opt.title}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* FILTERED RESULTS — a plain grid, not the virtualizer. Deliberate: the
          virtualizer assumes its container starts at scrollTop 0, and anything
          rendered above it inside the same scroller offsets every scrollToIndex
          by that height. Server-side paging keeps this small enough not to
          need it. */}
      {filtering ? (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-xl font-quicksand font-semibold text-white/90">
              {describeFilters(filters, sortTitle) || 'Filtered'}
            </div>
            {results ? (
              <div className="text-sm font-nunito text-brand-ice/60">
                {results.total} {results.total === 1 ? 'title' : 'titles'}
              </div>
            ) : null}
          </div>
          {resultsLoading && !results ? (
            <div className="text-brand-ice/70 font-nunito text-sm px-2">Searching {libTitle}…</div>
          ) : (results?.items.length ?? 0) === 0 ? (
            <div className="text-brand-ice/70 font-nunito text-sm px-2">
              Nothing matches that. Press Up and change a filter, or pick Clear.
            </div>
          ) : (
            <div className="grid grid-cols-6 gap-3">
              {(results?.items ?? []).map((it, i) => {
                const f = isActive && zone === 'content' && i === gridCursor;
                const label = resolutionLabel(it.videoResolution);
                const cap = tileCaption(it);
                return (
                  <div
                    key={it.ratingKey}
                    ref={(el) => { if (f && el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }}
                    onClick={() => { setZone('content'); setGridCursor(i); onOpen(it); }}
                    data-focused={f ? 'true' : 'false'}
                    className={`tv-ring relative cursor-pointer rounded-2xl overflow-hidden border border-white/10 ${f ? 'scale-[1.06] z-10' : ''}`}
                  >
                    <div className="relative aspect-[2/3]">
                      <PlexImage base={base} path={it.thumb} token={token} w={180} h={270} className="w-full h-full object-cover" />
                      {label ? (
                        <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-bold text-brand-gold">
                          {label}
                        </div>
                      ) : null}
                    </div>
                    <div className={`px-2 py-1 text-sm font-nunito font-semibold truncate ${f ? 'text-brand-gold' : 'text-white/90'}`}>
                      {cap.line1}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
      <>
      {!anyLoaded && (
        <div className="text-brand-ice/70 font-nunito text-sm px-2">Loading {libTitle}…</div>
      )}

      {rows.map((r, ri) => {
        const focused = isActive && ri === row;

        if (r.spec.kind === 'browseAll') {
          return (
            <div
              key={r.spec.id}
              ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }}
              onClick={onBrowseAll}
              data-focused={focused ? 'true' : 'false'}
              className={`tv-ring cursor-pointer rounded-2xl border border-white/15 bg-white/5 px-6 py-4 flex items-center justify-between ${focused ? 'scale-[1.01] z-10' : ''}`}
            >
              <span className={`text-lg font-quicksand font-semibold ${focused ? 'text-brand-gold' : 'text-white/90'}`}>
                Browse all {totalSize ? `${totalSize} ` : ''}{libTitle} A–Z
              </span>
              <span className="text-sm text-brand-ice/60 font-nunito">OK</span>
            </div>
          );
        }

        // Outside the mount window: keep the heading so the page height and the
        // scroll position stay stable, but drop the posters.
        if (ri < mountFrom || ri > mountTo) {
          return (
            <div key={r.spec.id}>
              <div className="text-xl font-quicksand font-semibold text-white/90 mb-3">{r.spec.title}</div>
              <div className="h-[240px]" aria-hidden="true" />
            </div>
          );
        }

        return (
          <div key={r.spec.id}>
            <div className="text-xl font-quicksand font-semibold text-white/90 mb-3">{r.spec.title}</div>
            <div className="flex gap-4 overflow-x-auto py-3 px-2 -mx-2">
              {r.items.map((it, ci) => {
                const tileFocused = focused && ci === col;
                const label = resolutionLabel(it.videoResolution);
                const cap = tileCaption(it);
                const progress = resumeFraction(it);
                return (
                  <div
                    key={it.ratingKey}
                    ref={(el) => { if (tileFocused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
                    onClick={() => { setFocusedRowId(r.spec.id); setCol(ci); onOpen(it); }}
                    data-focused={tileFocused ? 'true' : 'false'}
                    className={`tv-ring relative flex-shrink-0 w-[150px] cursor-pointer rounded-2xl overflow-hidden border border-white/10 ${tileFocused ? 'scale-[1.08] z-10' : ''}`}
                  >
                    <div className="relative aspect-[2/3]">
                      <PlexImage base={base} path={it.thumb} token={token} w={180} h={270} className="w-full h-full object-cover" />
                      {label ? (
                        <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-bold text-brand-gold">
                          {label}
                        </div>
                      ) : null}
                      {progress != null && (
                        // Inline width, no CSS features — this has to paint on
                        // a Chromium 66 WebView.
                        <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-black/60">
                          <div className="h-full bg-brand-gold" style={{ width: `${Math.round(progress * 100)}%` }} />
                        </div>
                      )}
                    </div>
                    <div className={`px-2 py-1 text-sm font-nunito font-semibold truncate ${tileFocused ? 'text-brand-gold' : 'text-white/90'}`}>
                      {cap.line1}
                    </div>
                    {cap.line2 ? (
                      <div className="px-2 pb-1 text-xs font-nunito text-brand-ice/60 truncate">{cap.line2}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      </>
      )}
    </div>
  );
});
PlexLibraryRows.displayName = 'PlexLibraryRows';

export default PlexLibraryRows;
