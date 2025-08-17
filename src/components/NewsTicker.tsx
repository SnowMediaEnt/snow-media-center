
import { useState, useEffect } from 'react';

const NewsTicker = () => {
  const [newsItems, setNewsItems] = useState<string[]>([
    "Loading news feed..."
  ]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRSSFeed = async () => {
      try {
        console.log('Fetching RSS feed from: https://snowmediaapps.com/smc/newsfeed.xml');
        // Using a CORS proxy to fetch the RSS feed
        const response = await fetch(`https://api.allorigins.win/raw?url=https://snowmediaapps.com/smc/newsfeed.xml`);
        const xmlText = await response.text();
        console.log('RSS feed XML response:', xmlText);
        
        // Parse the XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        // Extract news items from RSS feed
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

        console.log('Parsed news items:', newsArray);

        if (newsArray.length > 0) {
          setNewsItems(newsArray);
        } else {
          setNewsItems(["No news items available"]);
        }
        
        setIsLoading(false);
      } catch (error) {
        console.error('Error fetching RSS feed:', error);
        setNewsItems([
          "🚀 New streaming app update available",
          "📺 Live support available now - Chat with Snow Media",
          "🎬 Fresh video tutorials added to Support section",
          "💫 Snow Media Store updated with new content"
        ]);
        setIsLoading(false);
      }
    };

    fetchRSSFeed();
    
    // Refresh RSS feed every 1 minute
    const refreshInterval = setInterval(fetchRSSFeed, 1 * 60 * 1000);
    
    return () => clearInterval(refreshInterval);
  }, []);

  useEffect(() => {
    if (!isLoading && newsItems.length > 0) {
      const interval = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % newsItems.length);
      }, 22500); // Match the scroll animation duration (50% slower)

      return () => clearInterval(interval);
    }
  }, [newsItems.length, isLoading]);

  return (
    <div className="relative z-10 bg-gradient-to-r from-blue-600/60 to-purple-600/60 border-y border-blue-400/30 py-3 overflow-hidden">
      <div className="flex items-center h-12">
        <div className="bg-blue-500 text-white px-4 py-1 rounded-full text-sm font-bold ml-4 z-10 flex-shrink-0">
          LIVE
        </div>
        <div className="flex-1 overflow-hidden ml-4">
          <div 
            className="whitespace-nowrap animate-scroll-left"
            key={currentIndex}
          >
            <span className="text-xl text-white font-medium">
              {newsItems[currentIndex]}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewsTicker;
