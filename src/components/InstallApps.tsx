
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Download, Play, Package, Smartphone, Tv, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface InstallAppsProps {
  onBack: () => void;
}

interface App {
  id: string;
  name: string;
  description: string;
  category: 'streaming' | 'utility' | 'browser' | 'media';
  icon: string;
  downloadUrl: string;
  packageName: string; // For launching
  size: string;
  version: string;
  featured?: boolean;
}

// Your server apps - update URLs to match your server structure
const apps: App[] = [
  {
    id: 'kodi',
    name: 'Kodi Media Center',
    description: 'Ultimate media center for streaming and local content',
    category: 'streaming',
    icon: 'http://104.168.157.178/smc/icons/kodi.png',
    downloadUrl: 'http://104.168.157.178/smc/apks/kodi.apk',
    packageName: 'org.xbmc.kodi',
    size: '85MB',
    version: '21.0',
    featured: true
  },
  {
    id: 'tivimate',
    name: 'TiviMate IPTV Player',
    description: 'Premium IPTV player with EPG support',
    category: 'streaming',
    icon: 'http://104.168.157.178/smc/icons/tivimate.png',
    downloadUrl: 'http://104.168.157.178/smc/apks/tivimate.apk',
    packageName: 'ar.tvplayer.tv',
    size: '32MB',
    version: '4.7.0',
    featured: true
  },
  {
    id: 'smarttube',
    name: 'SmartTube Next',
    description: 'YouTube client for Android TV without ads',
    category: 'streaming',
    icon: 'http://104.168.157.178/smc/icons/smarttube.png',
    downloadUrl: 'http://104.168.157.178/smc/apks/smarttube.apk',
    packageName: 'com.liskovsoft.smarttubetv',
    size: '18MB',
    version: '20.45',
    featured: true
  },
  {
    id: 'mx-player',
    name: 'MX Player Pro',
    description: 'Professional video player with codec support',
    category: 'media',
    icon: 'http://104.168.157.178/smc/icons/mxplayer.png',
    downloadUrl: 'http://104.168.157.178/smc/apks/mxplayer.apk',
    packageName: 'com.mxtech.videoplayer.pro',
    size: '45MB',
    version: '1.85.2'
  },
  {
    id: 'file-manager',
    name: 'X-plore File Manager',
    description: 'Dual-pane file manager for Android TV',
    category: 'utility',
    icon: 'http://104.168.157.178/smc/icons/xplore.png',
    downloadUrl: 'http://104.168.157.178/smc/apks/xplore.apk',
    packageName: 'com.lonelycatgames.Xplore',
    size: '8MB',
    version: '4.36.05'
  },
  {
    id: 'chrome-browser',
    name: 'Chrome Browser TV',
    description: 'Chrome browser optimized for Android TV',
    category: 'browser',
    icon: 'http://104.168.157.178/smc/icons/chrome.png',
    downloadUrl: 'http://104.168.157.178/smc/apks/chrome-tv.apk',
    packageName: 'com.android.chrome',
    size: '125MB',
    version: '120.0'
  }
];

const InstallApps = ({ onBack }: InstallAppsProps) => {
  const [downloadingApps, setDownloadingApps] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const handleDownload = async (app: App) => {
    setDownloadingApps(prev => new Set(prev.add(app.id)));
    
    try {
      // Create download link
      const link = document.createElement('a');
      link.href = app.downloadUrl;
      link.download = `${app.name.replace(/\s+/g, '_')}.apk`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: "Download Started",
        description: `${app.name} is downloading. Check your downloads folder.`,
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: `Failed to download ${app.name}. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setDownloadingApps(prev => {
        const updated = new Set(prev);
        updated.delete(app.id);
        return updated;
      });
    }
  };

  const handleInstall = (app: App) => {
    // Android APK installation intent
    const installIntent = `intent://install?package=${app.packageName}#Intent;scheme=package;action=android.intent.action.INSTALL_PACKAGE;end`;
    
    try {
      window.location.href = installIntent;
      toast({
        title: "Installation Started",
        description: `Opening ${app.name} installer...`,
      });
    } catch (error) {
      toast({
        title: "Installation Failed",
        description: "Please manually install the downloaded APK file.",
        variant: "destructive",
      });
    }
  };

  const handleLaunch = (app: App) => {
    // Android app launch intent
    const launchIntent = `intent://${app.packageName}#Intent;scheme=package;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end`;
    
    try {
      window.location.href = launchIntent;
      toast({
        title: "Launching App",
        description: `Opening ${app.name}...`,
      });
    } catch (error) {
      toast({
        title: "Launch Failed",
        description: `Could not launch ${app.name}. Make sure it's installed.`,
        variant: "destructive",
      });
    }
  };

  const getCategoryApps = (category: string) => {
    return apps.filter(app => category === 'featured' ? app.featured : app.category === category);
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'streaming': return Tv;
      case 'utility': return Settings;
      case 'browser': return Package;
      case 'media': return Play;
      default: return Smartphone;
    }
  };

  const renderAppGrid = (categoryApps: App[]) => (
    <div className="grid grid-cols-2 gap-6">
      {categoryApps.map((app) => (
        <Card key={app.id} className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 overflow-hidden hover:scale-105 transition-all duration-300">
          <div className="p-6">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center overflow-hidden">
                <img 
                  src={app.icon} 
                  alt={`${app.name} icon`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent) {
                      const IconComponent = getCategoryIcon(app.category);
                      const iconElement = document.createElement('div');
                      iconElement.className = 'w-8 h-8 text-white flex items-center justify-center';
                      iconElement.innerHTML = '📱'; // Fallback emoji
                      parent.appendChild(iconElement);
                    }
                  }}
                />
              </div>
              
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-xl font-bold text-white">{app.name}</h3>
                  {app.featured && (
                    <Badge className="bg-green-600 text-white">Featured</Badge>
                  )}
                </div>
                <p className="text-slate-300 text-sm mb-2">{app.description}</p>
                <div className="flex gap-2 text-xs text-slate-400">
                  <span>v{app.version}</span>
                  <span>•</span>
                  <span>{app.size}</span>
                </div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <Button 
                onClick={() => handleDownload(app)}
                disabled={downloadingApps.has(app.id)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Download className="w-4 h-4 mr-2" />
                {downloadingApps.has(app.id) ? 'Downloading...' : 'Download'}
              </Button>
              
              <Button 
                onClick={() => handleInstall(app)}
                variant="outline"
                className="bg-green-600/20 border-green-500/50 text-green-400 hover:bg-green-600/30"
              >
                <Package className="w-4 h-4 mr-2" />
                Install
              </Button>
              
              <Button 
                onClick={() => handleLaunch(app)}
                variant="outline"
                className="bg-purple-600/20 border-purple-500/50 text-purple-400 hover:bg-purple-600/30"
              >
                <Play className="w-4 h-4 mr-2" />
                Launch
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );

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
            <p className="text-xl text-blue-200">Download, Install & Launch APKs</p>
          </div>
        </div>

        <Tabs defaultValue="featured" className="w-full">
          <TabsList className="grid w-full grid-cols-5 mb-8 bg-slate-800">
            <TabsTrigger value="featured" className="text-white data-[state=active]:bg-blue-600">
              Featured ({getCategoryApps('featured').length})
            </TabsTrigger>
            <TabsTrigger value="streaming" className="text-white data-[state=active]:bg-blue-600">
              Streaming ({getCategoryApps('streaming').length})
            </TabsTrigger>
            <TabsTrigger value="media" className="text-white data-[state=active]:bg-blue-600">
              Media ({getCategoryApps('media').length})
            </TabsTrigger>
            <TabsTrigger value="utility" className="text-white data-[state=active]:bg-blue-600">
              Utility ({getCategoryApps('utility').length})
            </TabsTrigger>
            <TabsTrigger value="browser" className="text-white data-[state=active]:bg-blue-600">
              Browser ({getCategoryApps('browser').length})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="featured" className="mt-0">
            {renderAppGrid(getCategoryApps('featured'))}
          </TabsContent>
          
          <TabsContent value="streaming" className="mt-0">
            {renderAppGrid(getCategoryApps('streaming'))}
          </TabsContent>
          
          <TabsContent value="media" className="mt-0">
            {renderAppGrid(getCategoryApps('media'))}
          </TabsContent>
          
          <TabsContent value="utility" className="mt-0">
            {renderAppGrid(getCategoryApps('utility'))}
          </TabsContent>
          
          <TabsContent value="browser" className="mt-0">
            {renderAppGrid(getCategoryApps('browser'))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default InstallApps;
