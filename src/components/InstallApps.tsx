
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Download, Play, Package, Smartphone, Tv, Settings, HardDrive, Database, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useApps } from '@/hooks/useApps';
import DownloadProgress from './DownloadProgress';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

interface InstallAppsProps {
  onBack: () => void;
}

interface App {
  id: string;
  name: string;
  description: string;
  size: string;
  category: string;
  icon_url: string | null;
  download_url: string | null;
  is_installed: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
}

const InstallApps = ({ onBack }: InstallAppsProps) => {
  const [downloadingApps, setDownloadingApps] = useState<Set<string>>(new Set());
  const [downloadedApps, setDownloadedApps] = useState<Set<string>>(new Set());
  const [installedApps, setInstalledApps] = useState<Set<string>>(new Set());
  const [currentDownload, setCurrentDownload] = useState<App | null>(null);
  const { toast } = useToast();
  const { apps, loading, error } = useApps();

  const handleDownload = async (app: App) => {
    setCurrentDownload(app);
    setDownloadingApps(prev => new Set(prev.add(app.id)));
    
    try {
      if (!app.download_url) {
        toast({
          title: "Download Error",
          description: "No download URL available for this app",
          variant: "destructive",
        });
        return;
      }

      // Validate and fix download URL
      let downloadUrl = app.download_url;
      
      if (!downloadUrl) {
        throw new Error("No download URL available");
      }
      
      // Ensure URL has proper protocol
      if (!downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
        downloadUrl = `https://${downloadUrl}`;
      }
      
      console.log(`Attempting to download from: ${downloadUrl}`);

      if (Capacitor.isNativePlatform()) {
        // Use Capacitor filesystem for native platforms
        const fileName = `${app.name.replace(/\s+/g, '_')}.apk`;
        
        // Fetch the file with CORS proxy for better compatibility
        let response;
        try {
          // Try direct download first
          response = await fetch(downloadUrl);
          if (!response.ok) {
            throw new Error(`Direct download failed: ${response.status}`);
          }
        } catch (directError) {
          console.log('Direct download failed, trying CORS proxy:', directError);
          // Fallback to CORS proxy
          const corsProxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(downloadUrl)}`;
          response = await fetch(corsProxy);
          if (!response.ok) {
            throw new Error(`CORS proxy download failed: ${response.status}`);
          }
        }
        
        const blob = await response.blob();
        
        if (blob.size === 0) {
          throw new Error("Downloaded file is empty");
        }
        
        console.log(`Downloaded blob size: ${blob.size} bytes`);
        
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        
        // Save to device
        await Filesystem.writeFile({
          path: `Downloads/${fileName}`,
          data: base64,
          directory: Directory.External
        });
        
        toast({
          title: "Download Complete",
          description: `${app.name} (${(blob.size / 1024 / 1024).toFixed(1)}MB) saved to Downloads`,
        });
      } else {
        // Fallback for web - try direct download with CORS proxy if needed
        try {
          // Try direct download first
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = `${app.name.replace(/\s+/g, '_')}.apk`;
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          toast({
            title: "Download Started",
            description: `${app.name} download initiated`,
          });
        } catch (webError) {
          console.log('Web download failed, trying CORS proxy:', webError);
          // Fallback to CORS proxy for web
          const corsProxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(downloadUrl)}`;
          const link = document.createElement('a');
          link.href = corsProxy;
          link.download = `${app.name.replace(/\s+/g, '_')}.apk`;
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          toast({
            title: "Download Started",
            description: `${app.name} download initiated via proxy`,
          });
        }
      }
      
      // Show progress modal
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: "Download Failed",
        description: `Failed to download ${app.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
      setDownloadingApps(prev => {
        const updated = new Set(prev);
        updated.delete(app.id);
        return updated;
      });
      setCurrentDownload(null);
    }
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

  const handleInstall = async (app: App) => {
    try {
      if (Capacitor.isNativePlatform()) {
        // For native Android, trigger APK installation
        const fileName = `${app.name.replace(/\s+/g, '_')}.apk`;
        
        // Open file manager to the Downloads folder so user can install manually
        const installIntent = `intent:#Intent;action=android.intent.action.VIEW;data=file:///storage/emulated/0/Download/${fileName};type=application/vnd.android.package-archive;flags=0x10000000;end`;
        
        if (window.open) {
          window.open(installIntent, '_system');
        } else {
          window.location.href = installIntent;
        }
        
        setInstalledApps(prev => new Set(prev.add(app.id)));
        toast({
          title: "Opening Installer",
          description: `Please complete installation for ${app.name}`,
        });
      } else {
        toast({
          title: "Installation Not Available",
          description: "APK installation only works on Android devices",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Installation Failed",
        description: "Please manually install the downloaded APK file from Downloads folder.",
        variant: "destructive",
      });
    }
  };

  const handleLaunch = (app: App) => {
    // Android app launch intent using package name derived from app name
    const packageName = `com.${app.name.toLowerCase().replace(/\s+/g, '')}.app`;
    const launchIntent = `intent://${packageName}#Intent;scheme=package;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end`;
    
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
    // Android clear cache intent using package name derived from app name
    const packageName = `com.${app.name.toLowerCase().replace(/\s+/g, '')}.app`;
    const clearCacheIntent = `intent://${packageName}#Intent;scheme=package;action=android.settings.APPLICATION_DETAILS_SETTINGS;end`;
    
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
    // Android clear data intent using package name derived from app name
    const packageName = `com.${app.name.toLowerCase().replace(/\s+/g, '')}.app`;
    const clearDataIntent = `intent://${packageName}#Intent;scheme=package;action=android.settings.APPLICATION_DETAILS_SETTINGS;end`;
    
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
    // Android uninstall intent using package name derived from app name
    const packageName = `com.${app.name.toLowerCase().replace(/\s+/g, '')}.app`;
    const uninstallIntent = `intent://uninstall?package=${packageName}#Intent;scheme=package;action=android.intent.action.DELETE;end`;
    
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
    return apps.filter(app => category === 'featured' ? app.is_featured : app.category === category);
  };

  if (loading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-ice mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading apps...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">Error loading apps: {error}</p>
          <Button onClick={onBack} variant="gold" className="">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

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
          <Card key={app.id} className="bg-gradient-to-br from-slate-700 to-slate-800 border-slate-600 overflow-hidden hover:scale-105 transition-all duration-300">
            <div className="p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-16 h-16 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center overflow-hidden">
                  <img 
                    src={app.icon_url || '/icons/default.png'} 
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
                    {app.is_featured && (
                      <Badge className="bg-green-600 text-white">Featured</Badge>
                    )}
                  </div>
                  <p className="text-slate-400 text-sm mb-2">{app.description}</p>
                  <div className="flex gap-2 text-xs text-slate-500">
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
                    className={`flex-1 ${isDownloading || isDownloaded || isInstalled ? 'bg-gray-600 text-gray-400' : 'bg-brand-ice hover:bg-brand-ice/80 text-white'}`}
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
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center w-full justify-between">
            <Button 
              onClick={onBack}
              variant="gold" 
              size="lg"
              className=""
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Home
            </Button>
            <div className="invisible">
              <Button variant="gold" size="lg">Placeholder</Button>
            </div>
          </div>
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Main Apps</h1>
            <p className="text-xl text-blue-200">Download, Install & Launch APKs</p>
          </div>
        </div>

        <Tabs defaultValue="featured" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8 bg-slate-800/50 border-slate-600">
            <TabsTrigger value="featured" className="text-white data-[state=active]:bg-brand-gold text-center">
              Featured ({getCategoryApps('featured').length})
            </TabsTrigger>
            <TabsTrigger value="streaming" className="text-white data-[state=active]:bg-brand-gold text-center">
              Streaming ({getCategoryApps('streaming').length})
            </TabsTrigger>
            <TabsTrigger value="support" className="text-white data-[state=active]:bg-brand-gold text-center">
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
