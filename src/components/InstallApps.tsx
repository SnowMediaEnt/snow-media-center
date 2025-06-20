
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, Package, ArrowLeft } from 'lucide-react';

interface InstallAppsProps {
  onBack: () => void;
}

const InstallApps = ({ onBack }: InstallAppsProps) => {
  const apps = [
    {
      name: "Cinema HD",
      description: "Premium streaming application",
      size: "25.6 MB",
      category: "Streaming"
    },
    {
      name: "Stremio",
      description: "Media center for video content",
      size: "89.2 MB",
      category: "Media"
    },
    {
      name: "Kodi",
      description: "Open source media center",
      size: "75.4 MB",
      category: "Media"
    },
    {
      name: "Tivimate",
      description: "IPTV player application",
      size: "12.8 MB",
      category: "IPTV"
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
            <h1 className="text-4xl font-bold text-white mb-2">Install Apps</h1>
            <p className="text-xl text-blue-200">Download and install streaming applications</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {apps.map((app, index) => (
            <Card key={index} className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6 hover:scale-105 transition-all duration-300">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                  <div className="bg-blue-600 p-3 rounded-lg mr-4">
                    <Package className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-white">{app.name}</h3>
                    <p className="text-blue-200">{app.category}</p>
                  </div>
                </div>
                <span className="bg-green-600 text-white px-3 py-1 rounded-full text-sm">
                  {app.size}
                </span>
              </div>
              
              <p className="text-slate-300 mb-6">{app.description}</p>
              
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white text-lg py-3">
                <Download className="w-5 h-5 mr-2" />
                Install APK
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default InstallApps;
