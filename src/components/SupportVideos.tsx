
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Play, ArrowLeft, Clock } from 'lucide-react';

interface SupportVideosProps {
  onBack: () => void;
}

const SupportVideos = ({ onBack }: SupportVideosProps) => {
  const videos = [
    {
      title: "Getting Started with Snow Media Center",
      duration: "5:32",
      thumbnail: "https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400&h=225&fit=crop",
      description: "Complete setup guide for new users"
    },
    {
      title: "Installing Apps on Android TV",
      duration: "8:15",
      thumbnail: "https://images.unsplash.com/photo-1593508512255-86ab42a8e620?w=400&h=225&fit=crop",
      description: "Step-by-step APK installation tutorial"
    },
    {
      title: "Troubleshooting Common Issues",
      duration: "12:08",
      thumbnail: "https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=400&h=225&fit=crop",
      description: "Solutions for frequent problems"
    },
    {
      title: "Remote Control Navigation Tips",
      duration: "6:45",
      thumbnail: "https://images.unsplash.com/photo-1606889464198-fcb18894cf50?w=400&h=225&fit=crop",
      description: "Master your TV remote controls"
    }
  ];

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
            <p className="text-xl text-blue-200">Help tutorials and guides</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {videos.map((video, index) => (
            <Card key={index} className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 overflow-hidden hover:scale-105 transition-all duration-300">
              <div className="relative">
                <img 
                  src={video.thumbnail} 
                  alt={video.title}
                  className="w-full h-48 object-cover"
                />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
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
                <p className="text-slate-300 mb-4">{video.description}</p>
                
                <Button className="w-full bg-green-600 hover:bg-green-700 text-white">
                  <Play className="w-4 h-4 mr-2" />
                  Watch Video
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SupportVideos;
