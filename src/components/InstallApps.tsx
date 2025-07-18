
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Download, Play, Package, Smartphone, Tv, Settings, HardDrive, Database, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import DownloadProgress from './DownloadProgress';

interface InstallAppsProps {
  onBack: () => void;
}

interface App {
  id: string;
  name: string;
  description: string;
  category: 'streaming' | 'support';
  icon: string;
  downloadUrl: string;
  packageName: string; // For launching
  size: string;
  version: string;
  featured?: boolean;
}

// Apps from your actual server - update paths as needed
const apps: App[] = [
  // Featured Apps
  {
    id: 'dreamstreams',
    name: 'Dreamstreams 3.0',
    description: 'Premium IPTV streaming service',
    category: 'streaming',
    icon: 'http://104.168.157.178/apps/icons/dreamstreams.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/dreamstreams.apk',
    packageName: 'com.dreamstreams.tv',
    size: '54MB',
    version: '3.0',
    featured: true
  },
  {
    id: 'vibeztv',
    name: 'VibezTV',
    description: 'Live TV streaming application',
    category: 'streaming',
    icon: 'http://104.168.157.178/apps/icons/vibeztv.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/vibeztv.apk',
    packageName: 'com.vibeztv.android',
    size: '96MB',
    version: '2.1.5',
    featured: true
  },
  {
    id: 'plex',
    name: 'Plex',
    description: 'Stream your media library anywhere',
    category: 'streaming',
    icon: 'http://104.168.157.178/apps/icons/plex.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/plex.apk',
    packageName: 'com.plexapp.android',
    size: '95MB',
    version: '9.12.1',
    featured: true
  },
  {
    id: 'cinemahd',
    name: 'Cinema HD',
    description: 'Movies and TV shows streaming app',
    category: 'streaming',
    icon: 'http://104.168.157.178/apps/icons/cinemahd.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/cinemahd.apk',
    packageName: 'com.cinema.hd.tv',
    size: '45MB',
    version: '2.4.1',
    featured: true
  },
  {
    id: 'ipvanish',
    name: 'IPVanish VPN',
    description: 'Secure VPN for streaming and privacy',
    category: 'support',
    icon: 'http://104.168.157.178/apps/icons/ipvanish.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/ipvanish.apk',
    packageName: 'com.ipvanish.mobile',
    size: '42MB',
    version: '4.5.11',
    featured: true
  },

  // Streaming Apps (Live TV, Movies, Series)
  {
    id: 'cinemahd',
    name: 'Cinema HD',
    description: 'Movies and TV shows streaming app',
    category: 'streaming',
    icon: 'http://104.168.157.178/apps/icons/cinemahd.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/cinemahd.apk',
    packageName: 'com.cinema.hd.tv',
    size: '45MB',
    version: '2.4.1'
  },
  {
    id: 'beetv',
    name: 'BeeTV',
    description: 'Free movies and TV series streaming',
    category: 'streaming',
    icon: 'http://104.168.157.178/apps/icons/beetv.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/beetv.apk',
    packageName: 'com.beetv.android',
    size: '28MB',
    version: '2.9.8'
  },
  {
    id: 'stremio',
    name: 'Stremio',
    description: 'Organize and watch video content from torrents',
    category: 'streaming',
    icon: 'http://104.168.157.178/apps/icons/stremio.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/stremio.apk',
    packageName: 'com.stremio.one',
    size: '55MB',
    version: '1.6.11'
  },
  {
    id: 'plex',
    name: 'Plex',
    description: 'Stream your media library anywhere',
    category: 'streaming',
    icon: 'http://104.168.157.178/apps/icons/plex.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/plex.apk',
    packageName: 'com.plexapp.android',
    size: '95MB',
    version: '9.12.1'
  },

  // Support Apps (Utilities, VPNs, Tools)
  {
    id: 'speedtest',
    name: 'Speedtest by Ookla',
    description: 'Test your internet speed and performance',
    category: 'support',
    icon: 'http://104.168.157.178/apps/icons/speedtest.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/speedtest.apk',
    packageName: 'org.zwanoo.android.speedtest',
    size: '35MB',
    version: '5.2.5'
  },
  {
    id: 'ipvanish',
    name: 'IPVanish VPN',
    description: 'Secure VPN for streaming and privacy',
    category: 'support',
    icon: 'http://104.168.157.178/apps/icons/ipvanish.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/ipvanish.apk',
    packageName: 'com.ipvanish.mobile',
    size: '42MB',
    version: '4.5.11'
  },
  {
    id: 'nordvpn',
    name: 'NordVPN',
    description: 'Fast and secure VPN service',
    category: 'support',
    icon: 'http://104.168.157.178/apps/icons/nordvpn.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/nordvpn.apk',
    packageName: 'com.nordvpn.android',
    size: '38MB',
    version: '5.12.4'
  },
  {
    id: 'teamviewer',
    name: 'TeamViewer',
    description: 'Remote access and support tool',
    category: 'support',
    icon: 'http://104.168.157.178/apps/icons/teamviewer.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/teamviewer.apk',
    packageName: 'com.teamviewer.teamviewer.market.mobile',
    size: '65MB',
    version: '15.49.5'
  },
  {
    id: 'esfileexplorer',
    name: 'ES File Explorer',
    description: 'File manager and network browser',
    category: 'support',
    icon: 'http://104.168.157.178/apps/icons/esfileexplorer.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/esfileexplorer.apk',
    packageName: 'com.estrongs.android.pop',
    size: '22MB',
    version: '4.2.9.9'
  },
  {
    id: 'downloader',
    name: 'Downloader',
    description: 'Easy APK and file downloader for Android TV',
    category: 'support',
    icon: 'http://104.168.157.178/apps/icons/downloader.png',
    downloadUrl: 'http://104.168.157.178/apps/apks/downloader.apk',
    packageName: 'com.esaba.downloader',
    size: '8MB',
    version: '1.8.0'
  }
];

const InstallApps = ({ onBack }: InstallAppsProps) => {
  const [downloadingApps, setDownloadingApps] = useState<Set<string>>(new Set());
  const [downloadedApps, setDownloadedApps] = useState<Set<string>>(new Set());
  const [installedApps, setInstalledApps] = useState<Set<string>>(new Set());
  const [currentDownload, setCurrentDownload] = useState<App | null>(null);
  const { toast } = useToast();

  const handleDownload = async (app: App) => {
    setCurrentDownload(app);
    setDownloadingApps(prev => new Set(prev.add(app.id)));
    
    // Start actual download
    const link = document.createElement('a');
    link.href = app.downloadUrl;
    link.download = `${app.name.replace(/\s+/g, '_')}.apk`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Show progress modal - the DownloadProgress component will handle the simulation
    // while the actual file downloads in background
  };

  const handleDownloadComplete = () => {
    if (currentDownload) {
      setDownloadingApps(prev => {
        const updated = new Set(prev);
        updated.delete(currentDownload.id);
        return updated;
      });
      setDownloadedApps(prev => new Set(prev.add(currentDownload.id)));
      setCurrentDownload(null);
      
      toast({
        title: "Download Complete",
        description: "APK downloaded successfully! Click Install to proceed.",
      });
    }
  };

  const handleInstall = (app: App) => {
    // Android APK installation intent
    const installIntent = `intent://install?package=${app.packageName}#Intent;scheme=package;action=android.intent.action.INSTALL_PACKAGE;end`;
    
    try {
      window.location.href = installIntent;
      setInstalledApps(prev => new Set(prev.add(app.id)));
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

  const handleClearCache = (app: App) => {
    // Android clear cache intent
    const clearCacheIntent = `intent://${app.packageName}#Intent;scheme=package;action=android.settings.APPLICATION_DETAILS_SETTINGS;end`;
    
    try {
      window.location.href = clearCacheIntent;
      toast({
        title: "Clearing App Cache",
        description: `Opening settings to clear ${app.name} cache...`,
      });
    } catch (error) {
      toast({
        title: "Clear Cache Failed",
        description: "Could not clear app cache. Please try manually.",
        variant: "destructive",
      });
    }
  };

  const handleClearData = (app: App) => {
    // Android clear data intent
    const clearDataIntent = `intent://${app.packageName}#Intent;scheme=package;action=android.settings.APPLICATION_DETAILS_SETTINGS;end`;
    
    try {
      window.location.href = clearDataIntent;
      toast({
        title: "Clearing App Data",
        description: `Opening settings to clear ${app.name} data...`,
      });
    } catch (error) {
      toast({
        title: "Clear Data Failed",
        description: "Could not clear app data. Please try manually.",
        variant: "destructive",
      });
    }
  };

  const handleUninstall = (app: App) => {
    // Android uninstall intent
    const uninstallIntent = `intent://uninstall?package=${app.packageName}#Intent;scheme=package;action=android.intent.action.DELETE;end`;
    
    try {
      window.location.href = uninstallIntent;
      setInstalledApps(prev => {
        const updated = new Set(prev);
        updated.delete(app.id);
        return updated;
      });
      toast({
        title: "Uninstalling App",
        description: `${app.name} is being uninstalled...`,
        variant: "destructive",
      });
    } catch (error) {
      toast({
        title: "Uninstall Failed",
        description: "Could not uninstall the app. Please try manually.",
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
      case 'support': return Settings;
      default: return Smartphone;
    }
  };

  // Removed handleDownloadComplete - using real Android install process

  const renderAppGrid = (categoryApps: App[]) => (
    <div className="grid grid-cols-2 gap-6">
      {categoryApps.map((app) => {
        const isDownloading = downloadingApps.has(app.id);
        const isDownloaded = downloadedApps.has(app.id);
        const isInstalled = installedApps.has(app.id);
        
        return (
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
              
              <div className="space-y-2">
                <div className="flex gap-2">
                  {/* Download Button - Only available if not downloading/downloaded/installed */}
                  <Button 
                    onClick={() => handleDownload(app)}
                    disabled={isDownloading || isDownloaded || isInstalled}
                    className={`flex-1 ${isDownloading || isDownloaded || isInstalled ? 'bg-gray-600 text-gray-400' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    {isDownloading ? 'Downloading...' : isDownloaded ? 'Downloaded' : 'Download'}
                  </Button>
                  
                  {/* Install Button - Only available after download completes */}
                  <Button 
                    onClick={() => handleInstall(app)}
                    disabled={!isDownloaded || isInstalled}
                    variant="outline"
                    className={`${isDownloaded && !isInstalled ? 'bg-green-600/20 border-green-500/50 text-green-400 hover:bg-green-600/30' : 'bg-gray-600/20 border-gray-500/50 text-gray-400'}`}
                  >
                    <Package className="w-4 h-4 mr-2" />
                    {isInstalled ? 'Installed' : 'Install'}
                  </Button>
                  
                  {/* Launch Button - Only available after install */}
                  {isInstalled && (
                    <Button 
                      onClick={() => handleLaunch(app)}
                      variant="outline"
                      className="bg-purple-600 border-purple-500 text-white hover:bg-purple-700"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Launch
                    </Button>
                  )}
                </div>
                
                {/* Management buttons - Only available after install */}
                {isInstalled && (
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => handleClearCache(app)}
                      variant="outline"
                      size="sm"
                      className="flex-1 bg-yellow-600/20 border-yellow-500/50 text-yellow-400 hover:bg-yellow-600/30"
                    >
                      <HardDrive className="w-3 h-3 mr-1" />
                      Clear Cache
                    </Button>
                    
                    <Button 
                      onClick={() => handleClearData(app)}
                      variant="outline"
                      size="sm"
                      className="flex-1 bg-orange-600/20 border-orange-500/50 text-orange-400 hover:bg-orange-600/30"
                    >
                      <Database className="w-3 h-3 mr-1" />
                      Clear Data
                    </Button>
                    
                    <Button 
                      onClick={() => handleUninstall(app)}
                      variant="outline"
                      size="sm"
                      className="flex-1 bg-red-600/20 border-red-500/50 text-red-400 hover:bg-red-600/30"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Uninstall
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
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
          <TabsList className="grid w-full grid-cols-3 mb-8 bg-slate-800">
            <TabsTrigger value="featured" className="text-white data-[state=active]:bg-blue-600">
              Featured ({getCategoryApps('featured').length})
            </TabsTrigger>
            <TabsTrigger value="streaming" className="text-white data-[state=active]:bg-blue-600">
              Streaming ({getCategoryApps('streaming').length})
            </TabsTrigger>
            <TabsTrigger value="support" className="text-white data-[state=active]:bg-blue-600">
              Support ({getCategoryApps('support').length})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="featured" className="mt-0">
            {renderAppGrid(getCategoryApps('featured'))}
          </TabsContent>
          
          <TabsContent value="streaming" className="mt-0">
            {renderAppGrid(getCategoryApps('streaming'))}
          </TabsContent>
          
          <TabsContent value="support" className="mt-0">
            {renderAppGrid(getCategoryApps('support'))}
          </TabsContent>
        </Tabs>
      </div>

      {/* Download Progress Modal */}
      {currentDownload && (
        <DownloadProgress 
          app={currentDownload}
          onClose={() => setCurrentDownload(null)}
          onComplete={handleDownloadComplete}
        />
      )}
    </div>
  );
};

export default InstallApps;
