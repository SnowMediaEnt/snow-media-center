// "Request" tab inside Movies & Shows — search Overseerr and request titles.
// Owns the keyboard entirely while active (PlexSection gates itself out).
import { memo, useEffect, useRef, useState } from 'react';
import { Loader2, Search, Film, Tv } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ResultItem {
  id: number; mediaType: 'movie' | 'tv'; title: string;
  year: string | null; posterUrl: string | null; status: number;
}
interface Props { isActive: boolean; onExitToTabs: () => void; }

const COLS = 6;

const statusBadge = (s: number): { label: string; cls: string } | null => {
  if (s === 5) return { label: 'On Plex', cls: 'bg-emerald-600/80 text-white' };
  if (s === 4) return { label: 'Partial', cls: 'bg-yellow-600/80 text-white' };
  if (s === 3) return { label: 'Requested', cls: 'bg-yellow-600/80 text-white' };
  if (s === 2) return { label: 'Pending', cls: 'bg-yellow-600/80 text-white' };
  return null;
};

const OverseerrRequestPanel = memo(({ isActive, onExitToTabs }: Props) => {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [zone, setZone] = useState<'search' | 'results'>('search');
  const [confirming, setConfirming] = useState<ResultItem | null>(null);
  const [confirmIdx, setConfirmIdx] = useState(0);
  const [requesting, setRequesting] = useState(false);

  const resultsRef = useRef(results); useEffect(() => { resultsRef.current = results; }, [results]);
  const cursorRef = useRef(cursor); useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const zoneRef = useRef(zone); useEffect(() => { zoneRef.current = zone; }, [zone]);
  const confirmingRef = useRef(confirming); useEffect(() => { confirmingRef.current = confirming; }, [confirming]);
  const confirmIdxRef = useRef(confirmIdx); useEffect(() => { confirmIdxRef.current = confirmIdx; }, [confirmIdx]);

  const runSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('overseerr-request', { body: { action: 'search', query: trimmed } });
      if (error) throw error;
      setResults((data?.results || []) as ResultItem[]);
      setCursor(0);
      if ((data?.results || []).length) setZone('results');
    } catch {
      toast({ title: 'Search failed', description: 'Could not reach the request service.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const activate = (item: ResultItem) => {
    if (item.status === 5) { toast({ title: 'Already on Plex', description: `${item.title} is already available.` }); return; }
    if (item.status >= 2) { toast({ title: 'Already requested', description: `${item.title} has already been requested.` }); return; }
    setConfirmIdx(0);
    setConfirming(item);
  };

  const submitRequest = async (item: ResultItem) => {
    if (requesting) return;
    setRequesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('overseerr-request', {
        body: { action: 'request', mediaType: item.mediaType, tmdbId: item.id },
      });
      if (error) throw new Error('failed');
      if (data?.already) {
        toast({ title: 'Already requested', description: `${item.title} was already requested.` });
        setResults((rs) => rs.map((r) => (r.id === item.id && r.mediaType === item.mediaType ? { ...r, status: 3 } : r)));
        return;
      }
      if (data?.error || !data?.ok) throw new Error(data?.error || 'failed');
      toast({ title: 'Requested!', description: `${item.title} has been requested. It'll appear on Plex once it's ready.` });
      setResults((rs) => rs.map((r) => (r.id === item.id && r.mediaType === item.mediaType ? { ...r, status: 3 } : r)));
    } catch {
      toast({ title: 'Request failed', description: 'Please try again in a moment.', variant: 'destructive' });
    } finally {
      setRequesting(false);
      setConfirming(null);
    }
  };

  // Focus the search box when the panel becomes active in search zone.
  useEffect(() => {
    if (isActive && zone === 'search') {
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [isActive, zone]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Confirm dialog owns everything.
      if (confirmingRef.current) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
        if (isBack) { setConfirming(null); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { setConfirmIdx((i) => (i === 0 ? 1 : 0)); return; }
        if (e.key === 'Enter' || e.key === ' ') {
          if (confirmIdxRef.current === 0) void submitRequest(confirmingRef.current);
          else setConfirming(null);
        }
        return;
      }

      if (typing) return; // the input's own onKeyDown handles Enter/ArrowDown/Back

      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      if (isBack) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        onExitToTabs();
        return;
      }
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();

      if (zoneRef.current === 'search') {
        if (e.key === 'ArrowDown' && resultsRef.current.length) setZone('results');
        else if (e.key === 'ArrowUp') onExitToTabs();
        else if (e.key === 'Enter' || e.key === ' ') inputRef.current?.focus();
        return;
      }
      // results zone
      const total = resultsRef.current.length;
      const cur = cursorRef.current;
      if (e.key === 'ArrowUp') { if (cur < COLS) setZone('search'); else setCursor(cur - COLS); }
      else if (e.key === 'ArrowDown') { if (cur + COLS < total) setCursor(cur + COLS); }
      else if (e.key === 'ArrowLeft') { if (cur % COLS !== 0) setCursor(cur - 1); }
      else if (e.key === 'ArrowRight') { if ((cur % COLS) < COLS - 1 && cur + 1 < total) setCursor(cur + 1); }
      else if (e.key === 'Enter' || e.key === ' ') { const it = resultsRef.current[cur]; if (it) activate(it); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, onExitToTabs]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4">
      <div className="flex-shrink-0 flex items-center gap-3 mb-4">
        <Search className="w-5 h-5 text-brand-gold flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); (e.target as HTMLInputElement).blur(); void runSearch(query); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); (e.target as HTMLInputElement).blur(); if (results.length) setZone('results'); }
            else if (e.key === 'Escape' || (e.key === 'Backspace' && !query)) { e.stopPropagation(); (e.target as HTMLInputElement).blur(); }
          }}
          placeholder="Search for a movie or show to request…"
          className="tv-focusable flex-1 bg-black/40 border border-white/20 rounded-xl px-4 py-2.5 text-white font-nunito placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-brand-gold"
          data-focused={isActive && zone === 'search' ? 'true' : 'false'}
        />
        {loading && <Loader2 className="w-5 h-5 animate-spin text-brand-gold flex-shrink-0" />}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {results.length === 0 && !loading && (
          <div className="h-full flex flex-col items-center justify-center text-brand-ice/60 font-nunito text-sm gap-2">
            <Film className="w-8 h-8 text-brand-gold/60" />
            <p>Search for something you'd like added to Plex.</p>
            <p className="text-xs text-brand-ice/40">Press OK on the search box to type · results show below</p>
          </div>
        )}
        <div className="grid grid-cols-6 gap-3">
          {results.map((it, idx) => {
            const focused = isActive && zone === 'results' && cursor === idx;
            const badge = statusBadge(it.status);
            return (
              <div key={`${it.mediaType}-${it.id}`}
                ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest' }); }}
                data-focused={focused ? 'true' : 'false'}
                onClick={() => { setCursor(idx); activate(it); }}
                className={`relative cursor-pointer rounded-lg overflow-hidden transition-transform duration-150 ${focused ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_16px_rgba(245,200,80,0.4)]' : 'ring-1 ring-white/10'}`}>
                <div className="aspect-[2/3] bg-black/40 flex items-center justify-center">
                  {it.posterUrl
                    ? <img src={it.posterUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                    : (it.mediaType === 'tv' ? <Tv className="w-8 h-8 text-brand-ice/40" /> : <Film className="w-8 h-8 text-brand-ice/40" />)}
                </div>
                {badge && (
                  <span className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-[9px] font-nunito font-bold ${badge.cls}`}>{badge.label}</span>
                )}
                <div className="px-1.5 py-1">
                  <div className="text-[11px] font-nunito text-white/90 truncate">{it.title}</div>
                  <div className="text-[9px] font-nunito text-brand-ice/50">{it.year || ''} · {it.mediaType === 'tv' ? 'Show' : 'Movie'}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
          <div className="w-full max-w-md rounded-3xl bg-slate-900/95 border-2 border-brand-gold/50 p-7 text-center">
            <h3 className="text-xl font-quicksand font-bold text-white mb-2">Request {confirming.title}?</h3>
            <p className="text-brand-ice/70 font-nunito text-sm mb-6">
              {confirming.mediaType === 'tv' ? 'All seasons will be requested.' : 'The movie will be added to the request queue.'}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => void submitRequest(confirming)} data-focused={confirmIdx === 0 ? 'true' : 'false'}
                className={`tv-focusable home-focus-surface px-6 py-2.5 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold ${confirmIdx === 0 ? 'scale-105 ring-2 ring-brand-gold' : ''}`}>
                {requesting ? 'Requesting…' : 'Request'}
              </button>
              <button onClick={() => setConfirming(null)} data-focused={confirmIdx === 1 ? 'true' : 'false'}
                className={`tv-focusable home-focus-surface px-6 py-2.5 rounded-xl bg-white/10 text-white font-quicksand font-bold ${confirmIdx === 1 ? 'scale-105 ring-2 ring-white/60' : ''}`}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

OverseerrRequestPanel.displayName = 'OverseerrRequestPanel';
export default OverseerrRequestPanel;
