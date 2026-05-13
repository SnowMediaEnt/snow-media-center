import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Tv } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { isNativePlatform } from '@/utils/platform';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type MediaItem = {
  id: string;
  source: 'plex' | 'tmdb' | 'sports';
  kind: string;
  title: string;
  subtitle?: string;
  poster?: string;
  deepLink?: string;
  webLink?: string;
};

type Props = {
  active?: boolean;
  onExitDown?: () => void;
  onExitUp?: () => void;
};

const STORAGE_KEY = 'snow-media-bar-cache-v1';
const REFRESH_MS = 5 * 60 * 1000;
const PAGE_SIZE = 8;
const AUTO_ROTATE_MS = 30 * 1000;

const SOURCE_BADGE: Record<string, { label: string; color: string } | null> = {
  plex: null, // hidden per design
  tmdb: { label: 'TRENDING', color: 'hsl(200 90% 55%)' },
  sports: { label: 'LIVE', color: 'hsl(0 80% 55%)' },
};

const readCache = (): MediaItem[] | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : null;
  } catch { return null; }
};

const writeCache = (items: MediaItem[]) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, ts: Date.now() })); } catch {}
};

const openPlex = (item: MediaItem) => {
  const native = isNativePlatform();
  const target = native ? (item.deepLink ?? item.webLink) : (item.webLink ?? item.deepLink);
  if (!target) return;
  if (native) {
    window.location.href = target;
  } else {
    window.open(target, '_blank', 'noopener,noreferrer');
  }
};

const MediaBar = memo(({ active = false, onExitDown, onExitUp }: Props) => {
  const cached = useMemo(readCache, []);
  const [items, setItems] = useState<MediaItem[]>(cached ?? []);
  const [pageIdx, setPageIdx] = useState(0);
  const [focusIdx, setFocusIdx] = useState(0); // index within current page
  const [paused, setPaused] = useState(false);
  const [liveDialog, setLiveDialog] = useState<MediaItem | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sports = live TV. Plex/TMDB items = deep link into Plex.
  const handleClick = (item: MediaItem) => {
    if (item.source === 'sports') {
      setLiveDialog(item);
      return;
    }
    openPlex(item);
  };

  // Fetch
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('media-bar-feed');
        if (cancelled) return;
        if (error) throw error;
        const next: MediaItem[] = (data?.items ?? []).filter((i: MediaItem) => i?.title);
        if (next.length) {
          setItems(next);
          writeCache(next);
        }
      } catch (e) {
        console.warn('[MediaBar] fetch failed:', (e as Error).message);
      }
    };
    const t = window.setTimeout(load, 1500);
    const i = window.setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearTimeout(t); clearInterval(i); };
  }, []);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = items.slice(pageIdx * PAGE_SIZE, pageIdx * PAGE_SIZE + PAGE_SIZE);

  // Auto-rotate every 30s (paused on hover/focus/active)
  useEffect(() => {
    if (paused || active || totalPages <= 1) return;
    const id = window.setInterval(() => {
      setPageIdx((p) => (p + 1) % totalPages);
    }, AUTO_ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, active, totalPages]);

  useEffect(() => {
    if (pageIdx >= totalPages) setPageIdx(0);
  }, [pageIdx, totalPages]);

  // Reset focus when page changes
  useEffect(() => { setFocusIdx(0); }, [pageIdx]);

  const goPrev = () => setPageIdx((p) => (p - 1 + totalPages) % totalPages);
  const goNext = () => setPageIdx((p) => (p + 1) % totalPages);

  // D-pad handling when active
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault(); e.stopPropagation();
          if (focusIdx > 0) {
            setFocusIdx(focusIdx - 1);
          } else if (totalPages > 1) {
            const newPage = (pageIdx - 1 + totalPages) % totalPages;
            setPageIdx(newPage);
            // focus last item of new page
            const newPageLen = items.slice(newPage * PAGE_SIZE, newPage * PAGE_SIZE + PAGE_SIZE).length;
            setTimeout(() => setFocusIdx(Math.max(0, newPageLen - 1)), 0);
          }
          break;
        case 'ArrowRight':
          e.preventDefault(); e.stopPropagation();
          if (focusIdx < currentPage.length - 1) {
            setFocusIdx(focusIdx + 1);
          } else if (totalPages > 1) {
            setPageIdx((pageIdx + 1) % totalPages);
            setFocusIdx(0);
          }
          break;
        case 'ArrowDown':
          e.preventDefault(); e.stopPropagation();
          onExitDown?.();
          break;
        case 'ArrowUp':
          e.preventDefault(); e.stopPropagation();
          onExitUp?.();
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault(); e.stopPropagation();
          const item = currentPage[focusIdx];
          if (item) handleClick(item);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, focusIdx, currentPage, totalPages, pageIdx, items, onExitDown, onExitUp]);

  const isEmpty = items.length === 0;

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative z-10 border-y border-primary/30"
      style={{
        backgroundColor: 'hsl(var(--brand-navy) / 0.95)',
        contain: 'layout paint style',
      }}
    >
      <div className="flex items-stretch gap-2 py-3 px-2">
        <button
          type="button"
          onClick={goPrev}
          disabled={isEmpty || totalPages <= 1}
          aria-label="Previous"
          className="flex-shrink-0 flex items-center justify-center w-10 rounded-md bg-black/40 hover:bg-black/70 text-white disabled:opacity-30 transition-all hover:scale-110"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <div className="flex-1 grid gap-2 min-w-0" style={{ gridTemplateColumns: `repeat(${PAGE_SIZE}, minmax(0, 1fr))` }}>
          {isEmpty
            ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <div key={i} className="h-[140px] rounded-md bg-black/30 animate-pulse" />
              ))
            : currentPage.map((item, idx) => {
                const badge = SOURCE_BADGE[item.source];
                const clickable = item.source === 'sports' || !!item.deepLink || !!item.webLink;
                const isFocused = active && idx === focusIdx;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => clickable && handleClick(item)}
                    disabled={!clickable}
                    title={item.title}
                    data-focused={isFocused ? 'true' : 'false'}
                    className={`flex flex-col bg-black/40 hover:bg-black/70 rounded-md overflow-hidden text-left min-w-0 transition-all ${
                      isFocused
                        ? 'scale-110 shadow-[0_0_24px_hsl(var(--brand-gold)/0.7)] ring-2 ring-[hsl(var(--brand-gold))]'
                        : 'hover:scale-105'
                    }`}
                  >
                    <div className="relative w-full aspect-[2/3] bg-black/60 flex-shrink-0">
                      {item.poster ? (
                        <img
                          src={item.poster}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                        />
                      ) : null}
                      {badge && (
                        <span
                          className="absolute top-1 left-1 text-[8px] font-bold tracking-wider px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: badge.color, color: 'hsl(0 0% 10%)' }}
                        >
                          {badge.label}
                        </span>
                      )}
                    </div>
                    <div className="px-1.5 py-1 min-w-0 w-full">
                      <span className="block text-white text-[11px] font-semibold leading-tight line-clamp-1">
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span className="block text-white/60 text-[9px] leading-tight line-clamp-1">
                          {item.subtitle}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
        </div>

        <button
          type="button"
          onClick={goNext}
          disabled={isEmpty || totalPages <= 1}
          aria-label="Next"
          className="flex-shrink-0 flex items-center justify-center w-10 rounded-md bg-black/40 hover:bg-black/70 text-white disabled:opacity-30 transition-all hover:scale-110"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-1 pb-1.5">
          <span className="text-[10px] text-white/50 mr-2">∞</span>
          {Array.from({ length: Math.min(totalPages, 12) }).map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-all ${
                i === pageIdx % 12 ? 'w-4 bg-primary' : 'w-1 bg-white/30'
              }`}
            />
          ))}
          <span className="text-[10px] text-white/50 ml-2">{pageIdx + 1}/{totalPages}</span>
        </div>
      )}
    </div>
  );
});

MediaBar.displayName = 'MediaBar';

export default MediaBar;
