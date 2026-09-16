import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Eye, EyeOff, ListFilter, Loader2 } from 'lucide-react';
import { BackButton } from '@/components/ui/BackButton';
import {
  getLiveCategories,
  loadCreds,
  loadSavedAccounts,
  type XtreamCategory,
  type XtreamCreds,
} from '@/lib/xtream';
import { buildLines, lineKey, lineLabel, loadHiddenCategories, saveHiddenCategories } from '@/lib/liveLines';
import { trackEvent } from '@/lib/analytics';

interface Props {
  onBack: () => void;
}

interface Row {
  kind: 'header' | 'all' | 'cat';
  line: XtreamCreds;
  key: string;
  cat?: XtreamCategory;
}

/**
 * Player → Settings → Hide Categories. Every signed-in line, every category
 * it carries, and a switch per row. Hidden categories leave the Live TV
 * pane on the next visit; nothing on the panel changes. Stored on this box,
 * per line.
 */
const HideCategoriesScreen = memo(({ onBack }: Props) => {
  const [lines, setLines] = useState<XtreamCreds[]>([]);
  const [cats, setCats] = useState<Map<string, XtreamCategory[]>>(new Map());
  const [hidden, setHidden] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [focusIdx, setFocusIdx] = useState(1);
  const focusIdxRef = useRef(focusIdx);
  useEffect(() => { focusIdxRef.current = focusIdx; }, [focusIdx]);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [active, saved] = await Promise.all([loadCreds(), loadSavedAccounts()]);
      if (cancelled) return;
      if (!active) { setLoading(false); return; }
      const ls = buildLines(active, saved);
      setLines(ls);
      const h = new Map<string, Set<string>>();
      for (const l of ls) h.set(lineKey(l), loadHiddenCategories(lineKey(l)));
      setHidden(h);
      const results = await Promise.all(ls.map((l) => getLiveCategories(l).catch(() => [] as XtreamCategory[])));
      if (cancelled) return;
      const m = new Map<string, XtreamCategory[]>();
      ls.forEach((l, i) => m.set(lineKey(l), results[i]));
      setCats(m);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const l of lines) {
      const k = lineKey(l);
      out.push({ kind: 'header', line: l, key: k });
      out.push({ kind: 'all', line: l, key: k });
      for (const c of cats.get(k) ?? []) out.push({ kind: 'cat', line: l, key: k, cat: c });
    }
    return out;
  }, [lines, cats]);
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  /** Rows the highlight can land on (headers are labels, not controls). */
  const focusable = useMemo(() => rows.map((r, i) => (r.kind === 'header' ? -1 : i)).filter((i) => i >= 0), [rows]);
  const focusableRef = useRef(focusable);
  useEffect(() => { focusableRef.current = focusable; }, [focusable]);

  const toggle = useCallback((row: Row) => {
    setHidden((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(row.key) ?? []);
      if (row.kind === 'all') {
        // "Show everything" for this line.
        set.clear();
      } else if (row.cat) {
        const id = String(row.cat.category_id);
        if (set.has(id)) set.delete(id); else set.add(id);
        try { trackEvent('live_category_hide', 'player', { service: row.line.serverLabel ?? null, category: row.cat.category_name, hidden: set.has(id) }); } catch { /* ignore */ }
      }
      next.set(row.key, set);
      saveHiddenCategories(row.key, set);
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;
      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        onBack();
        return;
      }
      const arrows = ['ArrowUp', 'ArrowDown', 'Enter', ' '];
      if (!arrows.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      // Slot 0 is Back; slot n is focusable[n - 1].
      const total = focusableRef.current.length + 1;
      if (e.key === 'ArrowDown') setFocusIdx((i) => (i + 1) % total);
      else if (e.key === 'ArrowUp') setFocusIdx((i) => (i - 1 + total) % total);
      else {
        const i = focusIdxRef.current;
        if (i === 0) { onBack(); return; }
        const row = rowsRef.current[focusableRef.current[i - 1]];
        if (row) toggle(row);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onBack, toggle]);

  // Keep the highlighted row on screen. Vertical only, like the Live pane.
  useEffect(() => {
    if (focusIdx === 0) { listRef.current?.scrollTo({ top: 0 }); return; }
    const rowIdx = focusable[focusIdx - 1];
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${rowIdx}"]`);
    const node = listRef.current;
    if (!el || !node) return;
    const top = el.offsetTop - 12;
    const bottom = el.offsetTop + el.offsetHeight + 12;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (bottom > node.scrollTop + node.clientHeight) node.scrollTop = bottom - node.clientHeight;
  }, [focusIdx, focusable]);

  const focusedRow = focusIdx > 0 ? focusable[focusIdx - 1] : -1;

  return (
    <div className="min-h-screen flex flex-col text-white bg-black/70">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-black/30">
        <BackButton onClick={onBack} label="Back" data-player-header-btn="" focused={focusIdx === 0} />
        <div className="flex items-center gap-2">
          <ListFilter className="w-7 h-7 text-brand-gold" />
          <h1 className="text-2xl font-quicksand font-bold text-white">Hide Categories</h1>
        </div>
        {loading && <Loader2 className="w-5 h-5 animate-spin text-brand-gold ml-2" />}
      </div>

      <div ref={listRef} className="flex-1 overflow-auto p-6 flex items-start justify-center">
        <div className="w-full max-w-2xl space-y-2">
          <p className="text-brand-ice/80 font-nunito mb-4">
            Press OK on a category to hide it from the Player. Hidden categories stay on your service;
            they just stop taking up room here. Press OK again to bring one back.
          </p>
          {!loading && lines.length === 0 && (
            <p className="text-white/70 text-sm text-center py-6">Sign in to the Player first.</p>
          )}
          {rows.map((r, i) => {
            if (r.kind === 'header') {
              return (
                <div key={`h-${r.key}`} className="pt-4 pb-1 flex items-center gap-2">
                  <Badge className="bg-brand-gold/25 text-brand-gold border border-brand-gold/40 text-sm">{lineLabel(r.line)}</Badge>
                  <span className="text-white/60 text-sm font-nunito truncate">{r.line.username}</span>
                  <span className="ml-auto text-white/50 text-xs font-nunito">
                    {(hidden.get(r.key)?.size ?? 0) > 0 ? `${hidden.get(r.key)!.size} hidden` : 'nothing hidden'}
                  </span>
                </div>
              );
            }
            const focused = focusedRow === i;
            const isHidden = r.kind === 'cat' && !!r.cat && (hidden.get(r.key)?.has(String(r.cat.category_id)) ?? false);
            return (
              <div
                key={r.kind === 'all' ? `all-${r.key}` : `${r.key}-${r.cat!.category_id}`}
                data-row={i}
                data-focused={focused ? 'true' : 'false'}
                onClick={() => { const n = focusable.indexOf(i); if (n >= 0) setFocusIdx(n + 1); toggle(r); }}
                className={`tv-ring flex items-center gap-3 rounded-xl px-4 py-3 border cursor-pointer ${
                  r.kind === 'all'
                    ? 'bg-slate-900/40 border-dashed border-white/20'
                    : isHidden ? 'bg-slate-900/40 border-white/10 opacity-70' : 'bg-slate-900/70 border-white/10'
                } ${focused ? 'scale-[1.02] z-10' : ''}`}
              >
                {r.kind === 'all'
                  ? <Eye className="w-5 h-5 text-brand-ice shrink-0" />
                  : isHidden ? <EyeOff className="w-5 h-5 text-rose-300 shrink-0" /> : <Eye className="w-5 h-5 text-emerald-300 shrink-0" />}
                <span className={`flex-1 font-nunito truncate ${isHidden ? 'line-through text-white/60' : ''}`}>
                  {r.kind === 'all' ? 'Show every category on this line' : r.cat!.category_name}
                </span>
                {r.kind === 'cat' && (
                  <span className={`text-xs font-nunito px-2 py-1 rounded-lg ${isHidden ? 'bg-rose-500/20 text-rose-200' : 'bg-white/10 text-brand-ice/70'}`}>
                    {isHidden ? 'Hidden' : 'Shown'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

HideCategoriesScreen.displayName = 'HideCategoriesScreen';
export default HideCategoriesScreen;
