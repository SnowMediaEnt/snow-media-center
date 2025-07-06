
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, Package, ArrowLeft, Loader2 } from 'lucide-react';
import { useApps } from '@/hooks/useApps';

interface InstallAppsProps {
  onBack: () => void;
}

const InstallApps = ({ onBack }: InstallAppsProps) => {
  const { apps, loading, error, handleDownload } = useApps();

  const featuredApps = apps.filter(app => app.is_featured);
  const otherApps = apps.filter(app => !app.is_featured);

  if (loading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-400 mx-auto mb-4" />
          <p className="text-xl text-blue-200">Loading apps...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-red-400 mb-4">Error loading apps: {error}</p>
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
            <h1 className="text-4xl font-bold text-white mb-2">Main Apps</h1>
            <p className="text-xl text-blue-200">Your premium streaming applications</p>
          </div>
        </div>

        {/* Featured Apps Row */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-white mb-6">Featured Apps</h2>
          <div className="grid grid-cols-5 gap-4 max-w-6xl mx-auto">
            {featuredApps.map((app) => (
              <Card key={app.id} className="bg-gradient-to-br from-blue-600 to-blue-800 border-blue-500 p-4 hover:scale-105 transition-all duration-300">
                <div className="text-center">
                  <div className="bg-white p-2 rounded-lg mx-auto mb-3 w-fit">
                    <img src={app.icon_url || ''} alt={app.name} className="w-12 h-12" onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                    }} />
                    <Package className="w-12 h-12 text-blue-600 hidden" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-1">{app.name}</h3>
                  <span className={`px-2 py-1 rounded-full text-xs ${app.is_installed ? 'bg-green-600 text-white' : 'bg-yellow-600 text-white'} mb-3 inline-block`}>
                    {app.is_installed ? 'Installed' : app.size}
                  </span>
                  <p className="text-blue-100 text-sm mb-4">{app.description}</p>
                  
                  <Button 
                    onClick={() => handleDownload(app)}
                    className={`w-full text-sm py-2 ${app.is_installed ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
                  >
                    <Download className="w-4 h-4 mr-1" />
                    {app.is_installed ? 'Launch' : 'Install'}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Other Apps Section */}
        <div>
          <h2 className="text-2xl font-bold text-white mb-6">Additional Apps</h2>
          <div className="grid grid-cols-2 gap-6">
            {otherApps.map((app) => (
              <Card key={app.id} className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6 hover:scale-105 transition-all duration-300 opacity-75">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <div className="bg-slate-600 p-3 rounded-lg mr-4">
                      <img src={app.icon_url || ''} alt={app.name} className="w-8 h-8 opacity-50" onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                      }} />
                      <Package className="w-8 h-8 text-slate-400 hidden" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-slate-300">{app.name}</h3>
                      <p className="text-slate-400">{app.category}</p>
                    </div>
                  </div>
                  <span className="bg-slate-600 text-slate-300 px-3 py-1 rounded-full text-sm">
                    {app.size}
                  </span>
                </div>
                
                <p className="text-slate-400 mb-6">{app.description}</p>
                
                <Button 
                  onClick={() => handleDownload(app)}
                  className="w-full bg-slate-600 hover:bg-slate-700 text-slate-300 text-lg py-3"
                >
                  <Download className="w-5 h-5 mr-2" />
                  Install APK
                </Button>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InstallApps;
