
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
        // Using a CORS proxy to fetch the RSS feed
        const response = await fetch(`https://api.allorigins.win/raw?url=http://104.168.157.178/smc/newsfeed.xml`);
        const xmlText = await response.text();
        
        // Parse the XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        // Extract news items from RSS feed
        const items = xmlDoc.querySelectorAll('item');
        const newsArray: string[] = [];
        
        items.forEach((item) => {
          const title = item.querySelector('title')?.textContent;
          if (title) {
            newsArray.push(title);
          }
        });

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
          "📺 Live support available now - Chat with Josh",
          "🎬 Fresh video tutorials added to Support section",
          "💫 Snow Media Store updated with new content"
        ]);
        setIsLoading(false);
      }
    };

    fetchRSSFeed();
    
    // Refresh RSS feed every 5 minutes
    const refreshInterval = setInterval(fetchRSSFeed, 5 * 60 * 1000);
    
    return () => clearInterval(refreshInterval);
  }, []);

  useEffect(() => {
    if (!isLoading && newsItems.length > 0) {
      const interval = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % newsItems.length);
      }, 4000);

      return () => clearInterval(interval);
    }
  }, [newsItems.length, isLoading]);

  return (
    <div className="relative z-10 bg-gradient-to-r from-blue-600/20 to-purple-600/20 border-y border-blue-400/30 py-3 overflow-hidden">
      <div className="flex items-center justify-center">
        <div className="bg-blue-500 text-white px-4 py-1 rounded-full text-sm font-bold mr-4">
          LIVE
        </div>
        <div className="flex-1 max-w-4xl">
          <div 
            className="transition-all duration-500 ease-in-out text-center"
            key={currentIndex}
          >
            <p className="text-xl text-white animate-fade-in">
              {newsItems[currentIndex]}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewsTicker;
