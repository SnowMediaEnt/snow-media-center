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
  resolutionLabel, type PlexItem,
} from '@/lib/plex';
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
  const [focusedRowId, setFocusedRowId] = useState<string>(specs[0]?.id ?? 'browseAll');
  const [col, setCol] = useState(0);

  const row = useMemo(() => {
    const i = rows.findIndex((r) => r.spec.id === focusedRowId);
    return i >= 0 ? i : 0;
  }, [rows, focusedRowId]);

  // If the row holding focus disappears (a filter emptied it), fall back to a
  // real neighbour rather than leaving the id dangling.
  useEffect(() => {
    if (rows.length === 0) return;
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

  // ── D-pad ────────────────────────────────────────────────────────────────
  const rowsRef = useRef(rows); useEffect(() => { rowsRef.current = rows; }, [rows]);
  const rowIdxRef = useRef(row); useEffect(() => { rowIdxRef.current = row; }, [row]);
  const colRef = useRef(col); useEffect(() => { colRef.current = col; }, [col]);
  const onOpenRef = useRef(onOpen); useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);
  const onBrowseAllRef = useRef(onBrowseAll); useEffect(() => { onBrowseAllRef.current = onBrowseAll; }, [onBrowseAll]);
  const onExitRef = useRef(onExitToTabs); useEffect(() => { onExitRef.current = onExitToTabs; }, [onExitToTabs]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;

      const list = rowsRef.current;
      const r = rowIdxRef.current;
      const c = colRef.current;

      // VERTICAL AND ESCAPE FIRST, before any current-row lookup. Doing it the
      // other way round (preventDefault, then bail on a missing row) swallows
      // every key while the rows are still loading — including the only way
      // out of the screen.
      if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (r <= 0) onExitRef.current();
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

  return (
    <div className="flex flex-col gap-6">
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
    </div>
  );
});
PlexLibraryRows.displayName = 'PlexLibraryRows';

export default PlexLibraryRows;
