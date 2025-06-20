
import { useState, useEffect } from 'react';

const NewsTicker = () => {
  const [newsItems] = useState([
    "🚀 New streaming app update available",
    "📺 Live support available now - Chat with Josh",
    "🎬 Fresh video tutorials added to Support section",
    "💫 Snow Media Store updated with new content",
    "🔥 Community chat active - Join the conversation",
    "⚡ Performance improvements deployed"
  ]);

  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % newsItems.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [newsItems.length]);

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
