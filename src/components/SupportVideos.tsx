
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Play, ArrowLeft, Clock, Loader2, AlertCircle } from 'lucide-react';
import { useVimeoVideos } from '@/hooks/useVimeoVideos';

interface SupportVideosProps {
  onBack: () => void;
}

const SupportVideos = ({ onBack }: SupportVideosProps) => {
  const { videos, loading, error } = useVimeoVideos();
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);

  const handleVideoClick = (embedUrl: string) => {
    setSelectedVideo(embedUrl);
  };

  const handleCloseVideo = () => {
    setSelectedVideo(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-400 mx-auto mb-4" />
          <p className="text-xl text-blue-200">Loading support videos...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-xl text-red-400 mb-4">Error loading videos: {error}</p>
          <Button onClick={onBack} variant="outline" className="bg-blue-600 border-blue-500 text-white hover:bg-blue-700">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

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
            <h1 className="text-4xl font-bold text-white mb-2">Support Videos</h1>
            <p className="text-xl text-blue-200">Help tutorials and guides from Vimeo</p>
          </div>
        </div>

        {videos.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-xl text-slate-400">No videos found. Upload some videos to your Vimeo account to see them here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            {videos.map((video) => (
              <Card key={video.id} className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 overflow-hidden hover:scale-105 transition-all duration-300">
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
        )}

        {/* Video Player Dialog */}
        <Dialog open={!!selectedVideo} onOpenChange={handleCloseVideo}>
          <DialogContent className="max-w-4xl w-full h-[80vh] p-0 bg-black border-slate-700">
            <DialogHeader className="p-4 bg-slate-800">
              <DialogTitle className="text-white">Support Video</DialogTitle>
            </DialogHeader>
            <div className="flex-1 p-4">
              {selectedVideo && (
                <iframe
                  src={selectedVideo}
                  className="w-full h-full rounded-lg"
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
