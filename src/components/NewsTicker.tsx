import { memo, useEffect, useMemo, useState } from 'react';
import { isNativePlatform } from '@/utils/platform';
import { robustFetch } from '@/utils/network';

const FALLBACK_NEWS = [
  '🚀 New streaming app update available',
  '📺 Live support available now - Chat with Snow Media',
  '🎬 Fresh video tutorials added to Support section',
  '💫 Snow Media Store updated with new content',
];

const INITIAL_NEWS = ['Loading news feed...'];

const sameItems = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

const STORAGE_KEY = 'snow-media-news-ticker-v1';
const STORAGE_TIMESTAMP_KEY = 'snow-media-news-ticker-ts-v1';
const NATIVE_REFRESH_MS = 30 * 60 * 1000; // 30 minutes
const WEB_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
const PAUSE_AFTER_KEY_MS = 600;

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

const NewsTicker = memo(() => {
  const cached = useMemo(readCachedNews, []);
  const [newsItems, setNewsItems] = useState<string[]>(cached?.items ?? INITIAL_NEWS);
  const trackRef = useRef<HTMLDivElement>(null);
  const isNative = useMemo(() => isNativePlatform(), []);
  const refreshMs = isNative ? NATIVE_REFRESH_MS : WEB_REFRESH_MS;

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;

    const applyItems = (items: string[]) => {
      setNewsItems((prev) => (sameItems(prev, items) ? prev : items));
      writeCachedNews(items);
    };

    const fetchRSSFeed = async () => {
      try {
        const rssUrl = 'https://snowmediaapps.com/smc/newsfeed.xml';

        const response = await robustFetch(rssUrl, {
          timeout: isNative ? 4000 : 8000,
          retries: isNative ? 0 : 1,
          useCorsProxy: !isNative,
        });

        const xmlText = await response.text();
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
        applyItems(FALLBACK_NEWS);
      }
    };

    const cachedAge = cached?.updatedAt ? Date.now() - cached.updatedAt : Number.POSITIVE_INFINITY;
    const shouldFetchSoon = cachedAge > refreshMs;

    if (shouldFetchSoon) {
      // Don't compete with first paint — defer the very first fetch a moment so
      // the home screen can settle before we light up network + parse work.
      timeoutId = window.setTimeout(fetchRSSFeed, isNative ? 2500 : 1500);
    }

    const refreshInterval = window.setInterval(fetchRSSFeed, refreshMs);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      clearInterval(refreshInterval);
    };
  }, [cached?.updatedAt, isNative, refreshMs]);

  // Pause ticker briefly while user is using the D-pad, then resume.
  // This is the single biggest win on Android WebViews — the marquee no longer
  // competes with the focus animation for compositor time during cursor moves.
  useEffect(() => {
    let resumeTimer: number | null = null;

    const pauseTrack = () => {
      const node = trackRef.current;
      if (!node) return;
      node.style.animationPlayState = 'paused';
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        if (trackRef.current) {
          trackRef.current.style.animationPlayState = 'running';
        }
      }, PAUSE_AFTER_KEY_MS);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown'
      ) {
        pauseTrack();
      }
    };

    const handleVisibility = () => {
      const node = trackRef.current;
      if (!node) return;
      node.style.animationPlayState = document.hidden ? 'paused' : 'running';
    };

    window.addEventListener('keydown', handleKeyDown, { passive: true });
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (resumeTimer) window.clearTimeout(resumeTimer);
    };
  }, []);

  // Build one continuous string so the marquee never restarts mid-cycle.
  // Duplicate it so the loop appears seamless without React re-mounts.
  const tickerText = useMemo(() => newsItems.join('   •   '), [newsItems]);

  return (
    <div
      className="news-ticker relative z-10 border-y border-blue-400/30 py-3 overflow-hidden"
      style={{
        // Solid color (not gradient) → cheap to paint, no resampling on scroll
        backgroundColor: 'hsl(225 60% 25%)',
        // Promote to its own GPU layer so animations elsewhere don't repaint it
        contain: 'layout paint style',
      }}
    >
      <div className="flex items-center h-12">
        <div className="bg-blue-500 text-white px-4 py-1 rounded-full text-sm font-bold ml-4 z-10 flex-shrink-0">
          LIVE
        </div>
        <div className="flex-1 overflow-hidden ml-4 news-ticker-mask" style={{ contain: 'layout paint' }}>
          <div
            ref={trackRef}
            className="news-ticker-track"
            style={{
              willChange: 'transform',
              transform: 'translate3d(0,0,0)',
              backfaceVisibility: 'hidden',
            }}
          >
            <span className="text-xl text-white font-medium news-ticker-item">
              {tickerText}
            </span>
            <span
              className="text-xl text-white font-medium news-ticker-item"
              aria-hidden="true"
            >
              {tickerText}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

NewsTicker.displayName = 'NewsTicker';

export default NewsTicker;
