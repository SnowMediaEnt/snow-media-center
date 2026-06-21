import { memo, useEffect, useMemo, useState } from 'react';
import { isNativePlatform } from '@/utils/platform';
import { robustFetch } from '@/utils/network';
import { setPausableInterval } from '@/utils/pausableInterval';
import { useTenant } from '@/contexts/TenantContext';

const FALLBACK_NEWS = [
  '🚀 New streaming app update available',
  '📺 Live support available now',
  '🎬 Fresh video tutorials added to Support section',
  '💫 Store updated with new content',
];

const INITIAL_NEWS = ['Loading news feed...'];

const sameItems = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

const STORAGE_KEY = 'snow-media-news-ticker-v2';
const STORAGE_TIMESTAMP_KEY = 'snow-media-news-ticker-ts-v2';
const NATIVE_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
const WEB_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

type CachedNews = { items: string[]; updatedAt: number } | null;

const readCachedNews = (): CachedNews => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ts = localStorage.getItem(STORAGE_TIMESTAMP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return {
      items: parsed.filter((entry) => typeof entry === 'string'),
      updatedAt: ts ? Number(ts) || 0 : 0,
    };
  } catch {
    return null;
  }
};

const writeCachedNews = (items: string[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    localStorage.setItem(STORAGE_TIMESTAMP_KEY, String(Date.now()));
  } catch {
    // Storage might be unavailable on first launch — fail silently.
  }
};

interface NewsTickerProps {
  compact?: boolean;
}

const NewsTicker = memo(({ compact = false }: NewsTickerProps) => {
  const { settings } = useTenant();
  const rssUrl = settings.rss_url;
  const cached = useMemo(readCachedNews, []);
  const [newsItems, setNewsItems] = useState<string[]>(cached?.items ?? INITIAL_NEWS);
  const isNative = useMemo(() => isNativePlatform(), []);
  const refreshMs = isNative ? NATIVE_REFRESH_MS : WEB_REFRESH_MS;

  useEffect(() => {
    // Tenants without an RSS URL skip the remote feed entirely and use the
    // bundled fallback strings.
    if (!rssUrl) {
      setNewsItems((prev) => (sameItems(prev, FALLBACK_NEWS) ? prev : FALLBACK_NEWS));
      return;
    }
    let cancelled = false;
    let timeoutId: number | null = null;

    const applyItems = (items: string[]) => {
      setNewsItems((prev) => (sameItems(prev, items) ? prev : items));
      writeCachedNews(items);
    };

    const fetchRSSFeed = async () => {
      try {
        // Use edge-function proxy first — bypasses CORS in browser preview AND
        // gives a single reliable code path on native. Falls back to direct
        // fetch (via robustFetch) only if the proxy itself fails.
        const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
        const proxyUrl = `${supabaseUrl}/functions/v1/news-feed-proxy?ts=${Date.now()}`;

        let xmlText: string | null = null;
        try {
          const proxyRes = await robustFetch(proxyUrl, {
            timeout: isNative ? 12000 : 8000,
            retries: 1,
          });
          xmlText = await proxyRes.text();
        } catch (proxyErr) {
          console.warn('[NewsTicker] proxy failed, trying direct:', (proxyErr as Error).message);
          const directUrl = `${rssUrl}${rssUrl.includes('?') ? '&' : '?'}ts=${Date.now()}`;
          const direct = await robustFetch(directUrl, {
            timeout: isNative ? 12000 : 8000,
            retries: 1,
            useCorsProxy: !isNative,
          });
          xmlText = await direct.text();
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) throw new Error('XML parse error');

        const items = xmlDoc.querySelectorAll('item');
        const newsArray: string[] = [];

        items.forEach((item) => {
          const title = item.querySelector('title')?.textContent;
          const description = item.querySelector('description')?.textContent;
          const pubDate = item.querySelector('pubDate')?.textContent;

          if (title && description && pubDate) {
            const formattedDate = new Date(pubDate).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
            newsArray.push(`${title} - ${description} • ${formattedDate}`);
          } else if (title && description) {
            newsArray.push(`${title} - ${description}`);
          } else if (title) {
            newsArray.push(title);
          }
        });

        if (cancelled) return;
        applyItems(newsArray.length > 0 ? newsArray : FALLBACK_NEWS);
      } catch (error) {
        if (cancelled) return;
        console.warn('Error fetching RSS feed:', error);
        // Don't poison the cache with fallback strings — only show fallback
        // in-memory so the next successful fetch replaces it cleanly.
        setNewsItems((prev) => (sameItems(prev, FALLBACK_NEWS) ? prev : FALLBACK_NEWS));
      }
    };

    const cachedAge = cached?.updatedAt ? Date.now() - cached.updatedAt : Number.POSITIVE_INFINITY;
    const shouldFetchSoon = cachedAge > refreshMs;

    if (shouldFetchSoon) {
      // Don't compete with first paint — defer the very first fetch a moment so
      // the home screen can settle before we light up network + parse work.
      timeoutId = window.setTimeout(fetchRSSFeed, isNative ? 2500 : 1500);
    }

    const cancelInterval = setPausableInterval(fetchRSSFeed, refreshMs);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      cancelInterval();
    };
  }, [cached?.updatedAt, isNative, refreshMs, rssUrl]);

  // Build one continuous string so the marquee never restarts mid-cycle.
  // Trailing separator ensures the join between the duplicated copies looks
  // identical to every other join (no fused/missing items at the seam).
  const tickerText = useMemo(() => `${newsItems.join('   •   ')}   •   `, [newsItems]);

  const trackHeight = compact ? 'h-8' : 'h-[3.75rem] py-1';
  const textSize = compact ? 'text-sm' : 'text-xl';
  const padLeft = compact ? '80px' : '128px';
  const maskStart = compact ? '60px' : '110px';
  const maskEnd = compact ? '80px' : '128px';
  const badgeMargin = compact ? 'ml-2' : 'ml-3';

  return (
    <div
      className="news-ticker relative z-10 border-y border-primary/30 overflow-hidden"
      style={{
        backgroundColor: 'hsl(var(--brand-navy))',
        contain: 'layout paint style',
      }}
    >
      <div className={`relative flex items-center ${trackHeight}`}>
        {/* Full-width scrolling track sits behind the LIVE badge */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            contain: 'layout paint',
            paddingLeft: padLeft,
            WebkitMaskImage:
              `linear-gradient(to right, transparent 0, transparent ${maskStart}, black ${maskEnd}, black 100%)`,
            maskImage:
              `linear-gradient(to right, transparent 0, transparent ${maskStart}, black ${maskEnd}, black 100%)`,
          }}
        >
          <div
            className="news-ticker-track h-full flex items-center"
            style={{
              willChange: 'transform',
              transform: 'translate3d(0,0,0)',
              backfaceVisibility: 'hidden',
            }}
          >
            <span className={`${textSize} leading-none text-white font-semibold news-ticker-item`}>
              {tickerText}
            </span>
            <span
              className={`${textSize} leading-none text-white font-semibold news-ticker-item`}
              aria-hidden="true"
            >
              {tickerText}
            </span>
          </div>
        </div>
        {/* LIVE badge overlays on top */}
        <div className={`bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs font-bold ${badgeMargin} z-10 flex-shrink-0 leading-tight relative`}>
          LIVE
        </div>
      </div>
    </div>
  );
});

NewsTicker.displayName = 'NewsTicker';

export default NewsTicker;
