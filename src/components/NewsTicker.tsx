import { memo, useEffect, useMemo, useRef, useState } from 'react';
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

const NewsTicker = memo(() => {
  const [newsItems, setNewsItems] = useState<string[]>(INITIAL_NEWS);
  const trackRef = useRef<HTMLDivElement>(null);
  const isNative = useMemo(() => isNativePlatform(), []);

  useEffect(() => {
    let cancelled = false;

    const fetchRSSFeed = async () => {
      try {
        const rssUrl = 'https://snowmediaapps.com/smc/newsfeed.xml';

        const response = await robustFetch(rssUrl, {
          timeout: isNative ? 4000 : 10000,
          retries: isNative ? 0 : 2,
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
              year: 'numeric'
            });
            newsArray.push(`${title} - ${description} • ${formattedDate}`);
          } else if (title && description) {
            newsArray.push(`${title} - ${description}`);
          } else if (title) {
            newsArray.push(title);
          }
        });

        if (cancelled) return;
        const nextItems = newsArray.length > 0 ? newsArray : FALLBACK_NEWS;
        setNewsItems((prev) => (sameItems(prev, nextItems) ? prev : nextItems));
      } catch (error) {
        if (cancelled) return;
        console.warn('Error fetching RSS feed:', error);
        setNewsItems((prev) => (sameItems(prev, FALLBACK_NEWS) ? prev : FALLBACK_NEWS));
      }
    };

    fetchRSSFeed();
    const refreshInterval = window.setInterval(fetchRSSFeed, isNative ? 300000 : 60000);
    return () => {
      cancelled = true;
      clearInterval(refreshInterval);
    };
  }, [isNative]);

  // Build one continuous string so the marquee never restarts mid-cycle.
  // Duplicate it so the loop appears seamless without React re-mounts.
  const tickerText = useMemo(
    () => newsItems.join('   •   '),
    [newsItems]
  );

  // Pause animation when tab/app is hidden to save CPU and avoid catch-up jank
  useEffect(() => {
    const handleVisibility = () => {
      if (!trackRef.current) return;
      trackRef.current.style.animationPlayState =
        document.hidden ? 'paused' : 'running';
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return (
    <div
      className="news-ticker relative z-10 border-y border-blue-400/30 py-3 overflow-hidden"
      style={{
        // Solid color (not gradient) → cheap to paint, no resampling on scroll
        backgroundColor: 'hsl(225 60% 25%)',
        // Promote to its own GPU layer so animations elsewhere don't repaint it
        willChange: 'transform',
        transform: 'translateZ(0)',
        contain: 'layout paint style',
      }}
    >
      <div className="flex items-center h-12">
        <div className="bg-blue-500 text-white px-4 py-1 rounded-full text-sm font-bold ml-4 z-10 flex-shrink-0">
          LIVE
        </div>
        <div
          className="flex-1 overflow-hidden ml-4 news-ticker-mask"
          style={{ contain: 'layout paint' }}
        >
          <div
            ref={trackRef}
            className="news-ticker-track"
            style={{
              willChange: 'transform',
              transform: 'translate3d(0,0,0)',
              backfaceVisibility: 'hidden',
              perspective: 1000,
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
