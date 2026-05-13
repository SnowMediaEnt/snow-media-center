import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { isNativePlatform } from '@/utils/platform';

type MediaItem = {
  id: string;
  source: 'plex' | 'tmdb' | 'sports';
  kind: string;
  title: string;
  subtitle?: string;
  poster?: string;
  deepLink?: string;
};

const STORAGE_KEY = 'snow-media-bar-cache-v1';
const REFRESH_MS = 5 * 60 * 1000;
const PAGE_SIZE = 8;
const AUTO_ROTATE_MS = 30 * 1000;

const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  plex: { label: 'PLEX', color: 'hsl(45 100% 50%)' },
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

const handleClick = (item: MediaItem) => {
  if (!item.deepLink) return;
  if (isNativePlatform()) {
    window.location.href = item.deepLink;
  } else {
    window.open(item.deepLink, '_blank');
  }
};

const MediaBar = memo(() => {
  const cached = useMemo(readCache, []);
  const [items, setItems] = useState<MediaItem[]>(cached ?? []);
  const [pageIdx, setPageIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Auto-rotate every 30s (paused on hover/focus)
  useEffect(() => {
    if (paused || totalPages <= 1) return;
    const id = window.setInterval(() => {
      setPageIdx((p) => (p + 1) % totalPages);
    }, AUTO_ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, totalPages]);

  // Reset to first page if items shrink
  useEffect(() => {
    if (pageIdx >= totalPages) setPageIdx(0);
  }, [pageIdx, totalPages]);

  const goPrev = () => setPageIdx((p) => (p - 1 + totalPages) % totalPages);
  const goNext = () => setPageIdx((p) => (p + 1) % totalPages);

  const isEmpty = items.length === 0;

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) setPaused(false);
      }}
      className="relative z-10 border-y border-primary/30"
      style={{
        backgroundColor: 'hsl(var(--brand-navy) / 0.95)',
        contain: 'layout paint style',
      }}
    >
      <div className="flex items-stretch gap-2 py-2 px-2">
        {/* Prev arrow */}
        <button
          type="button"
          onClick={goPrev}
          disabled={isEmpty || totalPages <= 1}
          aria-label="Previous"
          className="flex-shrink-0 flex items-center justify-center w-9 rounded-md bg-black/40 hover:bg-black/70 text-white disabled:opacity-30 disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all hover:scale-110 focus-visible:scale-110"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {/* Page */}
        <div className="flex-1 grid gap-2 min-w-0" style={{ gridTemplateColumns: `repeat(${PAGE_SIZE}, minmax(0, 1fr))` }}>
          {isEmpty
            ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <div key={i} className="h-[64px] rounded-md bg-black/30 animate-pulse" />
              ))
            : currentPage.map((item) => {
                const badge = SOURCE_BADGE[item.source];
                const clickable = !!item.deepLink;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => clickable && handleClick(item)}
                    disabled={!clickable}
                    title={item.title}
                    className="flex items-center gap-2 bg-black/40 hover:bg-black/70 rounded-md p-1.5 pr-2 text-left min-w-0 transition-all hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:scale-110 focus-visible:shadow-[0_0_18px_hsl(var(--brand-gold)/0.6)] disabled:cursor-default"
                  >
                    {item.poster ? (
                      <img
                        src={item.poster}
                        alt=""
                        loading="lazy"
                        className="h-12 w-9 object-cover rounded flex-shrink-0 bg-black/60"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                      />
                    ) : (
                      <div className="h-12 w-9 rounded bg-black/60 flex-shrink-0" />
                    )}
                    <div className="flex flex-col items-start min-w-0 flex-1">
                      <span
                        className="text-[8px] font-bold tracking-wider px-1 py-0.5 rounded"
                        style={{ backgroundColor: badge.color, color: 'hsl(0 0% 10%)' }}
                      >
                        {badge.label}
                      </span>
                      <span className="text-white text-[11px] font-semibold leading-tight mt-0.5 line-clamp-1 w-full">
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span className="text-white/60 text-[9px] leading-tight line-clamp-1 w-full">
                          {item.subtitle}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
        </div>

        {/* Next arrow */}
        <button
          type="button"
          onClick={goNext}
          disabled={isEmpty || totalPages <= 1}
          aria-label="Next"
          className="flex-shrink-0 flex items-center justify-center w-9 rounded-md bg-black/40 hover:bg-black/70 text-white disabled:opacity-30 disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all hover:scale-110 focus-visible:scale-110"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Page dots */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-1 pb-1.5">
          {Array.from({ length: totalPages }).map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-all ${
                i === pageIdx ? 'w-4 bg-primary' : 'w-1 bg-white/30'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
});

MediaBar.displayName = 'MediaBar';

export default MediaBar;
