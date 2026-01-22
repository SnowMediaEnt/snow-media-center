
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Play, ArrowLeft, Clock, Loader2, AlertCircle } from 'lucide-react';
import { useVimeoVideos } from '@/hooks/useVimeoVideos';

interface SupportVideosProps {
  onBack: () => void;
}

const SupportVideos = ({ onBack }: SupportVideosProps) => {
  const { videos, loading, error } = useVimeoVideos();
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [focusedElement, setFocusedElement] = useState<'back' | 'tab-0' | 'tab-1' | 'tab-2' | string>('back');
  const [activeTab, setActiveTab] = useState<string>('device');

  // TV Remote Navigation with video controls
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle Android back button
      if (event.key === 'Escape' || event.key === 'Backspace' || 
          event.keyCode === 4 || event.which === 4) {
        event.preventDefault();
        event.stopPropagation();
        if (selectedVideo) {
          handleCloseVideo();
        } else {
          onBack();
        }
        return;
      }
      
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }
      
      const { deviceVideos, serviceVideos, allVideos } = categorizeVideos();
      const currentVideos = activeTab === 'device' ? deviceVideos : 
                           activeTab === 'service' ? serviceVideos : allVideos;
      
      switch (event.key) {
        case 'ArrowLeft':
          if (focusedElement === 'tab-1') setFocusedElement('tab-0');
          else if (focusedElement === 'tab-2') setFocusedElement('tab-1');
          else if (focusedElement.startsWith('video-')) {
            const currentIndex = currentVideos.findIndex(video => focusedElement === `video-${video.id}`);
            if (currentIndex > 0 && currentIndex % 2 === 1) {
              setFocusedElement(`video-${currentVideos[currentIndex - 1].id}`);
            } else {
              setFocusedElement('back');
            }
          }
          break;
          
        case 'ArrowRight':
          if (focusedElement === 'tab-0') setFocusedElement('tab-1');
          else if (focusedElement === 'tab-1') setFocusedElement('tab-2');
          else if (focusedElement === 'back') {
            if (currentVideos.length > 0) setFocusedElement(`video-${currentVideos[0].id}`);
          } else if (focusedElement.startsWith('video-')) {
            const currentIndex = currentVideos.findIndex(video => focusedElement === `video-${video.id}`);
            if (currentIndex < currentVideos.length - 1 && currentIndex % 2 === 0) {
              setFocusedElement(`video-${currentVideos[currentIndex + 1].id}`);
            }
          }
          break;
          
        case 'ArrowUp':
          if (focusedElement.startsWith('video-')) {
            const currentIndex = currentVideos.findIndex(video => focusedElement === `video-${video.id}`);
            if (currentIndex >= 2) {
              setFocusedElement(`video-${currentVideos[currentIndex - 2].id}`);
            } else {
              setFocusedElement('tab-0');
            }
          } else if (focusedElement === 'tab-0') {
            setFocusedElement('back');
          } else if (focusedElement === 'tab-1' || focusedElement === 'tab-2') {
            setFocusedElement('tab-0');
          }
          break;
          
        case 'ArrowDown':
          if (focusedElement === 'back') {
            setFocusedElement('tab-0');
          }
          else if (focusedElement.startsWith('tab-')) {
            if (currentVideos.length > 0) setFocusedElement(`video-${currentVideos[0].id}`);
          } else if (focusedElement.startsWith('video-')) {
            const currentIndex = currentVideos.findIndex(video => focusedElement === `video-${video.id}`);
            if (currentIndex + 2 < currentVideos.length) {
              setFocusedElement(`video-${currentVideos[currentIndex + 2].id}`);
            }
          }
          break;
          
        case 'Enter':
        case ' ':
          if (focusedElement === 'back') onBack();
          else if (focusedElement === 'tab-0') setActiveTab('device');
          else if (focusedElement === 'tab-1') setActiveTab('service');
          else if (focusedElement === 'tab-2') setActiveTab('all');
          else if (focusedElement.startsWith('video-')) {
            const video = currentVideos.find(v => focusedElement === `video-${v.id}`);
            if (video) handleVideoClick(video.embed_url);
          }
          break;
          
        // Video playback controls when video is open
        case 'p':
        case 'k':
          if (selectedVideo) {
            // Send play/pause to iframe (basic attempt)
            const iframe = document.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
              iframe.contentWindow.postMessage('{"method":"pause"}', '*');
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, activeTab, selectedVideo, videos, onBack]);

  // Scroll focused element into view for TV navigation - always keep selector visible
  useEffect(() => {
    const el = document.querySelector(`[data-focus-id="${focusedElement}"]`) as HTMLElement;
    if (!el) return;
    
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const margin = 150; // Extra margin for visibility
    
    // Check if element is off-screen in any direction
    if (rect.top < margin) {
      // Element is above viewport - scroll up
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - margin), behavior: 'smooth' });
    } else if (rect.bottom > viewportHeight - margin) {
      // Element is below viewport
      const scrollTarget = window.scrollY + rect.bottom - viewportHeight + margin;
      window.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    }
  }, [focusedElement]);

  const handleVideoClick = (embedUrl: string) => {
    // Add fullscreen parameters to the embed URL
    const fullscreenUrl = embedUrl.includes('?') 
      ? `${embedUrl}&autoplay=1&autopause=0&controls=1`
      : `${embedUrl}?autoplay=1&autopause=0&controls=1`;
    
    setSelectedVideo(fullscreenUrl);
  };

  const handleCloseVideo = () => {
    setSelectedVideo(null);
  };

  // Categorize videos based on tags
  const deviceTags = ['x96', 'firetv', 'older', 'firestick', 'device'];
  const serviceTags = ['dreamstreams', 'vibez tv', 'vibeztv', 'plex', 'support'];

  const categorizeVideos = () => {
    const deviceVideos = videos.filter(video => 
      video.tags.some(tag => deviceTags.includes(tag.toLowerCase()))
    );
    const serviceVideos = videos.filter(video => 
      video.tags.some(tag => serviceTags.includes(tag.toLowerCase()))
    );
    // All videos - don't filter anything
    const allVideos = videos;
    
    return { deviceVideos, serviceVideos, allVideos };
  };

  const { deviceVideos, serviceVideos, allVideos } = categorizeVideos();

  const renderVideoGrid = (videoList: typeof videos) => (
    <div className="grid grid-cols-2 gap-6">
      {videoList.map((video) => (
        <Card 
          key={video.id} 
          data-focus-id={`video-${video.id}`}
          className={`bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 overflow-hidden hover:scale-105 transition-all duration-300 ${focusedElement === `video-${video.id}` ? 'ring-4 ring-brand-ice scale-105' : ''}`}
        >
          <div className="relative">
            <img 
              src={video.thumbnail} 
              alt={video.title}
              className="w-full h-48 object-cover"
            />
            <div 
              className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
              onClick={() => handleVideoClick(video.embed_url)}
            >
              <div className="bg-green-600 rounded-full p-4">
                <Play className="w-8 h-8 text-white fill-current" />
              </div>
            </div>
            <div className="absolute bottom-2 right-2 bg-black/75 text-white px-2 py-1 rounded text-sm flex items-center">
              <Clock className="w-3 h-3 mr-1" />
              {video.duration}
            </div>
            {video.tags.length > 0 && (
              <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                {video.tags.slice(0, 2).map((tag, index) => (
                  <span key={index} className="bg-blue-600/80 text-white text-xs px-2 py-1 rounded">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          
          <div className="p-6">
            <h3 className="text-xl font-bold text-white mb-2">{video.title}</h3>
            <p className="text-slate-300 mb-4 line-clamp-2">{video.description}</p>
            
            <Button 
              onClick={() => handleVideoClick(video.embed_url)}
              className="w-full bg-green-600 hover:bg-green-700 text-white"
            >
              <Play className="w-4 h-4 mr-2" />
              Watch Video
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="tv-scroll-container tv-safe flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-400 mx-auto mb-4" />
          <p className="text-xl text-blue-200">Loading support videos...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tv-scroll-container tv-safe flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-xl text-red-400 mb-4">Error loading videos: {error}</p>
          <Button onClick={onBack} variant="gold" className="">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="tv-scroll-container tv-safe">
      <div className="max-w-6xl mx-auto pb-16">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center w-full justify-between">
            <Button 
              onClick={onBack}
              variant="gold" 
              size="lg"
              className={focusedElement === 'back' ? 'ring-2 ring-brand-ice' : ''}
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Home
            </Button>
            <div className="invisible">
              <Button variant="gold" size="lg">Placeholder</Button>
            </div>
          </div>
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Support Videos</h1>
            <p className="text-xl text-blue-200">Help tutorials and guides from Vimeo</p>
          </div>
        </div>

        {videos.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-xl text-slate-400">No videos found. Upload some videos to your Vimeo account to see them here.</p>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-8 bg-slate-800/50 border-slate-600">
              <TabsTrigger 
                value="device" 
                className={`text-white data-[state=active]:bg-brand-gold text-center ${focusedElement === 'tab-0' ? 'ring-2 ring-brand-ice' : ''}`}
              >
                Device ({deviceVideos.length})
              </TabsTrigger>
              <TabsTrigger 
                value="service" 
                className={`text-white data-[state=active]:bg-brand-gold text-center ${focusedElement === 'tab-1' ? 'ring-2 ring-brand-ice' : ''}`}
              >
                Service ({serviceVideos.length})
              </TabsTrigger>
              <TabsTrigger 
                value="all" 
                className={`text-white data-[state=active]:bg-brand-gold text-center ${focusedElement === 'tab-2' ? 'ring-2 ring-brand-ice' : ''}`}
              >
                All ({allVideos.length})
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="device" className="mt-0">
              {deviceVideos.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-xl text-slate-400">No device videos found. Tag your videos with: x96, FireTV, or Older</p>
                </div>
              ) : (
                renderVideoGrid(deviceVideos)
              )}
            </TabsContent>
            
            <TabsContent value="service" className="mt-0">
              {serviceVideos.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-xl text-slate-400">No service videos found. Tag your videos with: Dreamstreams, Vibez TV, Plex, or Support</p>
                </div>
              ) : (
                renderVideoGrid(serviceVideos)
              )}
            </TabsContent>
            
            <TabsContent value="all" className="mt-0">
              {allVideos.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-xl text-slate-400">No videos found in your Vimeo account.</p>
                </div>
              ) : (
                renderVideoGrid(allVideos)
              )}
            </TabsContent>
          </Tabs>
        )}

        {/* Fullscreen Video Player Dialog with TV Controls */}
        <Dialog open={!!selectedVideo} onOpenChange={handleCloseVideo}>
          <DialogContent className="max-w-[100vw] max-h-[100vh] w-full h-full p-0 bg-black border-0 m-0">
            <div className="relative w-full h-full">
              <div className="absolute top-4 right-4 z-50 flex gap-2">
                <div className="bg-black/80 text-white px-3 py-1 rounded text-sm">
                  Press ESC/Back to Close | P/K to Play/Pause
                </div>
                <Button 
                  onClick={handleCloseVideo}
                  variant="outline"
                  size="sm"
                  className="bg-black/50 border-white/20 text-white hover:bg-black/80"
                >
                  ✕ Close
                </Button>
              </div>
              {selectedVideo && (
                <iframe
                  src={selectedVideo}
                  className="w-full h-full"
                  frameBorder="0"
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                  title="Support Video"
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default SupportVideos;
