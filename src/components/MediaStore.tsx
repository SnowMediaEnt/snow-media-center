
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink } from 'lucide-react';

interface MediaStoreProps {
  onBack: () => void;
}

const MediaStore = ({ onBack }: MediaStoreProps) => {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simulate loading
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  const openFullscreenWebView = () => {
    // In a real Android TV app, this would open a fullscreen WebView
    window.open('https://snowmediaent.com', '_blank');
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center mb-8">
          <Button 
            onClick={onBack}
            variant="outline" 
            size="lg"
            className="mr-6 bg-blue-600 border-blue-500 text-white hover:bg-blue-700"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Home
          </Button>
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Snow Media Store</h1>
            <p className="text-xl text-blue-200">Official store and content hub</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-900/50 to-blue-900/50 rounded-lg p-8 text-center">
          {isLoading ? (
            <div className="py-16">
              <div className="animate-spin w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-xl text-white">Loading Snow Media Store...</p>
            </div>
          ) : (
            <div className="py-16">
              <h2 className="text-3xl font-bold text-white mb-4">Welcome to Snow Media Store</h2>
              <p className="text-xl text-blue-200 mb-8">
                Access the official Snow Media Entertainment store with exclusive content and applications
              </p>
              
              <Button 
                onClick={openFullscreenWebView}
                size="lg"
                className="bg-purple-600 hover:bg-purple-700 text-white text-xl px-8 py-4"
              >
                <ExternalLink className="w-6 h-6 mr-3" />
                Open Store in Full Screen
              </Button>
              
              <p className="text-sm text-slate-400 mt-4">
                Opens https://snowmediaent.com in fullscreen mode
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaStore;
