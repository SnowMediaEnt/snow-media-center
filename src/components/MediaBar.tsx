import { memo, useEffect, useMemo, useState } from 'react';
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

const handleClick = async (item: MediaItem) => {
  if (!item.deepLink) return;
  if (isNativePlatform()) {
    try {
      // Try native intent — Plex app handles plex:// scheme
      window.location.href = item.deepLink;
    } catch (e) { console.warn('[MediaBar] deep link failed', e); }
  } else {
    window.open(item.deepLink, '_blank');
  }
};

const MediaBar = memo(() => {
  const cached = useMemo(readCache, []);
  const [items, setItems] = useState<MediaItem[]>(cached ?? []);

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

  // Skeleton while empty so the bar is visibly present
  const isEmpty = items.length === 0;
  const loop = isEmpty ? [] : [...items, ...items];

  return (
    <div
      className="relative z-10 border-y border-primary/30 overflow-hidden"
      style={{
        backgroundColor: 'hsl(var(--brand-navy) / 0.95)',
        contain: 'layout paint style',
      }}
    >
      <div className="media-bar-track flex items-center gap-3 py-2 px-4" style={{
        willChange: 'transform',
        transform: 'translate3d(0,0,0)',
      }}>
        {loop.map((item, idx) => {
          const badge = SOURCE_BADGE[item.source];
          const clickable = !!item.deepLink;
          return (
            <button
              key={`${item.id}-${idx}`}
              type="button"
              onClick={() => clickable && handleClick(item)}
              disabled={!clickable}
              className="media-bar-item flex-shrink-0 flex items-center gap-2 bg-black/40 hover:bg-black/60 rounded-md p-1.5 pr-3 transition-all disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-primary"
              style={{ width: '260px' }}
            >
              {item.poster ? (
                <img
                  src={item.poster}
                  alt=""
                  loading="lazy"
                  className="h-14 w-10 object-cover rounded flex-shrink-0 bg-black/60"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                />
              ) : (
                <div className="h-14 w-10 rounded bg-black/60 flex-shrink-0" />
              )}
              <div className="flex flex-col items-start min-w-0 flex-1">
                <span
                  className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: badge.color, color: 'hsl(0 0% 10%)' }}
                >
                  {badge.label}
                </span>
                <span className="text-white text-xs font-semibold leading-tight mt-0.5 line-clamp-1 w-full text-left">
                  {item.title}
                </span>
                {item.subtitle && (
                  <span className="text-white/60 text-[10px] leading-tight line-clamp-1 w-full text-left">
                    {item.subtitle}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

MediaBar.displayName = 'MediaBar';

export default MediaBar;
