
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Download, Play, Package, Smartphone, Tv, Settings, HardDrive, Database, Trash2, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppData } from '@/hooks/useAppData';
import DownloadProgress from './DownloadProgress';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { AppManager } from '@/capacitor/AppManager';
import { downloadApkToCache, generateFileName, generatePackageName } from '@/utils/downloadApk';

interface InstallAppsProps {
  onBack: () => void;
}

interface AppData {
  id: string;
  name: string;
  version: string;
  size: string;
  description: string;
  icon: string;
  apk: string;
  downloadUrl: string;
  packageName: string;
  featured: boolean;
  category: 'streaming' | 'support';
}

const InstallApps = ({ onBack }: InstallAppsProps) => {
  const [downloadingApps, setDownloadingApps] = useState<Set<string>>(new Set());
  const [downloadedApps, setDownloadedApps] = useState<Set<string>>(new Set());
  const [installedApps, setInstalledApps] = useState<Set<string>>(new Set());
  const [appStatuses, setAppStatuses] = useState<Map<string, { downloaded: boolean; installed: boolean; lastPath?: string }>>(new Map());
  const [currentDownload, setCurrentDownload] = useState<AppData | null>(null);
  const [focusedElement, setFocusedElement] = useState<'back' | 'tab-0' | 'tab-1' | 'tab-2' | 'tab-3' | string>('back');
  const [activeTab, setActiveTab] = useState<string>('featured');
  const [selectedApp, setSelectedApp] = useState<AppData | null>(null);
  const { toast } = useToast();
  const { apps, loading, error } = useAppData();
  const focusedElementRef = useRef<HTMLElement>(null);

  // Helper function to get category apps
  const getCategoryApps = useCallback((category: string) => {
    return apps.filter(app => category === 'featured' ? app.featured : app.category === category);
  }, [apps]);

  // TV Remote Navigation with improved app selection
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle Android back button and other back buttons
      if (event.key === 'Escape' || event.key === 'Backspace' || 
          event.keyCode === 4 || event.which === 4 || event.code === 'GoBack') {
        event.preventDefault();
        event.stopPropagation();
        onBack();
        return;
      }
      
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }
      
      switch (event.key) {
        case 'ArrowLeft':
          if (focusedElement === 'tab-1') setFocusedElement('tab-0');
          else if (focusedElement === 'tab-2') setFocusedElement('tab-1');
          else if (focusedElement === 'tab-3') setFocusedElement('tab-2');
          else if (focusedElement.startsWith('app-')) setFocusedElement('back');
          break;
          
        case 'ArrowRight':
          if (focusedElement === 'tab-0') setFocusedElement('tab-1');
          else if (focusedElement === 'tab-1') setFocusedElement('tab-2');
          else if (focusedElement === 'tab-2') setFocusedElement('tab-3');
          else if (focusedElement === 'back') {
            const currentCategoryApps = getCategoryApps(activeTab);
            if (currentCategoryApps.length > 0) setFocusedElement(`app-${currentCategoryApps[0].id}`);
          }
          break;
          
        case 'ArrowUp':
          if (focusedElement.startsWith('app-')) {
            const currentCategoryApps = getCategoryApps(activeTab);
            const currentIndex = currentCategoryApps.findIndex(app => focusedElement === `app-${app.id}`);
            if (currentIndex > 0) {
              setFocusedElement(`app-${currentCategoryApps[currentIndex - 1].id}`);
            } else {
              setFocusedElement('tab-0');
            }
          } else if (focusedElement.startsWith('tab-')) {
            setFocusedElement('back');
          }
          break;
          
        case 'ArrowDown':
          if (focusedElement === 'back') setFocusedElement('tab-0');
          else if (focusedElement.startsWith('tab-')) {
            const currentCategoryApps = getCategoryApps(activeTab);
            if (currentCategoryApps.length > 0) setFocusedElement(`app-${currentCategoryApps[0].id}`);
          } else if (focusedElement.startsWith('app-')) {
            const currentCategoryApps = getCategoryApps(activeTab);
            const currentIndex = currentCategoryApps.findIndex(app => focusedElement === `app-${app.id}`);
            if (currentIndex + 1 < currentCategoryApps.length) {
              setFocusedElement(`app-${currentCategoryApps[currentIndex + 1].id}`);
            }
          }
          break;
          
        case 'Enter':
        case ' ':
          if (focusedElement === 'back') onBack();
          else if (focusedElement === 'tab-0') setActiveTab('featured');
          else if (focusedElement === 'tab-1') setActiveTab('streaming');
          else if (focusedElement === 'tab-2') setActiveTab('support');
          else if (focusedElement === 'tab-3') setActiveTab('other');
          else if (focusedElement.startsWith('app-')) {
            // Find the focused app and show its actions
            const currentCategoryApps = getCategoryApps(activeTab);
            const app = currentCategoryApps.find(a => focusedElement === `app-${a.id}`);
            if (app) {
              setFocusedElement(`download-${app.id}`);
            }
          } else if (focusedElement.startsWith('download-')) {
            // Trigger download
            const appId = focusedElement.replace('download-', '');
            const currentCategoryApps = getCategoryApps(activeTab);
            const app = currentCategoryApps.find(a => a.id === appId);
            if (app) handleDownload(app);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, activeTab, onBack, getCategoryApps]);

  // App status management functions
  const generateAppFileName = (app: AppData) => generateFileName(app.name, app.version);
  const generateAppPackageName = (app: AppData) => app.packageName || generatePackageName(app.name);
  
  const isDownloaded = async (app: AppData): Promise<boolean> => {
    try {
      const fileName = generateAppFileName(app);
      await Filesystem.stat({
        path: `apk/${fileName}`,
        directory: Directory.Cache,
      });
      return true;
    } catch {
      return false;
    }
  };

  const ensureStatus = useCallback(async (app: AppData): Promise<{ downloaded: boolean; installed: boolean }> => {
    try {
      const downloaded = await isDownloaded(app);
      const packageName = generateAppPackageName(app);
      const { installed } = await AppManager.isInstalled({ packageName });
      
      setAppStatuses(prev => new Map(prev.set(app.id, { downloaded, installed })));
      return { downloaded, installed };
    } catch (error) {
      console.error('Error checking app status:', error);
      return { downloaded: false, installed: false };
    }
  }, []);

  // Initialize app statuses when apps load
  useEffect(() => {
    if (apps.length > 0) {
      apps.forEach(app => {
        ensureStatus(app);
      });
    }
  }, [apps, ensureStatus]);

  const handleDownload = async (app: AppData) => {
    if (!app.downloadUrl) {
      toast({
        title: "Download Error",
        description: "No download URL available for this app",
        variant: "destructive",
      });
      return;
    }

    setDownloadingApps(prev => new Set(prev.add(app.id)));
    
    try {
      const fileName = generateAppFileName(app);
      const path = await downloadApkToCache(app.downloadUrl, fileName);
      
      setAppStatuses(prev => new Map(prev.set(app.id, { 
        downloaded: true, 
        installed: prev.get(app.id)?.installed || false,
        lastPath: path 
      })));
      
      toast({
        title: "Download Complete",
        description: `${app.name} downloaded successfully!`,
      });
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: "Download Failed",
        description: `Failed to download ${app.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

  const handleInstall = async (app: AppData) => {
    try {
      const status = appStatuses.get(app.id);
      const path = status?.lastPath || await Filesystem.getUri({
        path: `apk/${generateAppFileName(app)}`,
        directory: Directory.Cache
      }).then(r => r.uri);
      
      await AppManager.installApk({ filePath: path });
      
      // Re-check installation status after user returns from installer
      setTimeout(async () => {
        await ensureStatus(app);
      }, 1000);
      
      toast({
        title: "Opening Installer",
        description: `Please complete installation for ${app.name}`,
      });
    } catch (error) {
      console.error('Install error:', error);
      toast({
        title: "Installation Failed",
        description: `Could not start installer: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
    }
  };

  const handleLaunch = async (app: AppData) => {
    try {
      const packageName = generateAppPackageName(app);
      await AppManager.launch({ packageName });
      
      toast({
        title: "Launching App",
        description: `Opening ${app.name}...`,
      });
    } catch (error) {
      console.error('Launch error:', error);
      toast({
        title: "Launch Failed",
        description: `Could not launch ${app.name}. Make sure it's installed.`,
        variant: "destructive",
      });
    }
  };

  const handleUninstall = async (app: AppData) => {
    try {
      const packageName = generateAppPackageName(app);
      await AppManager.uninstall({ packageName });
      
      // Update status immediately and re-check after delay
      setAppStatuses(prev => new Map(prev.set(app.id, { 
        ...prev.get(app.id), 
        installed: false 
      })));
      
      setTimeout(async () => {
        await ensureStatus(app);
      }, 1000);
      
      toast({
        title: "Uninstalling App",
        description: `${app.name} is being uninstalled...`,
        variant: "destructive",
      });
    } catch (error) {
      console.error('Uninstall error:', error);
      toast({
        title: "Uninstall Failed",
        description: `Could not uninstall ${app.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
    }
  };

  const handleOpenAppSettings = async (app: AppData) => {
    try {
      const packageName = generateAppPackageName(app);
      await AppManager.openAppSettings({ packageName });
      
      toast({
        title: "Opening App Settings",
        description: `${app.name} settings opened for cache/data management`,
      });
    } catch (error) {
      console.error('App settings error:', error);
      toast({
        title: "Settings Failed",
        description: `Could not open ${app.name} settings.`,
        variant: "destructive",
      });
    }
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

  const renderAppGrid = (categoryApps: AppData[]) => (
    <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto bg-gradient-to-t from-black/90 to-transparent backdrop-blur-sm">
      <div className="p-6 space-y-4">
        {categoryApps.map((app) => {
          const status = appStatuses.get(app.id) || { downloaded: false, installed: false };
          const isDownloading = downloadingApps.has(app.id);
          const isDownloaded = status.downloaded;
          const isInstalled = status.installed;
          const isFocused = focusedElement === `app-${app.id}` || focusedElement.startsWith(`download-${app.id}`) || focusedElement.startsWith(`install-${app.id}`) || focusedElement.startsWith(`launch-${app.id}`);
          
          return (
            <Card key={app.id} className={`bg-gradient-to-br from-slate-700/80 to-slate-800/80 border-slate-600 overflow-hidden hover:scale-105 transition-all duration-300 ${isFocused ? 'ring-2 ring-brand-ice scale-105' : ''}`}>
            <div className="p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-16 h-16 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center overflow-hidden">
                  <img 
                    src={app.icon || '/icons/default.png'} 
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
                    className={`flex-1 ${focusedElement === `download-${app.id}` ? 'ring-2 ring-white' : ''} ${isDownloading || isDownloaded || isInstalled ? 'bg-gray-600 text-gray-400' : 'bg-brand-ice hover:bg-brand-ice/80 text-white'}`}
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
                      onClick={() => handleOpenAppSettings(app)}
                      variant="outline"
                      size="sm"
                      className="flex-1 bg-blue-600/20 border-blue-500/50 text-blue-400 hover:bg-blue-600/30"
                    >
                      <Settings className="w-3 h-3 mr-1" />
                      App Settings
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
    </div>
  );

  // Auto-scroll focused element into view
  useEffect(() => {
    if (focusedElementRef.current) {
      focusedElementRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusedElement]);

  return (
    <div className="min-h-dvh max-h-dvh overflow-y-auto overscroll-contain px-6 py-6 tv-safe">
      <div className="max-w-6xl mx-auto">
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
            <h1 className="text-4xl font-bold text-white mb-2">Main Apps</h1>
            <p className="text-xl text-blue-200">Download, Install & Launch APKs</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8 bg-slate-800/50 border-slate-600">
            <TabsTrigger 
              value="featured" 
              className={`text-white data-[state=active]:bg-brand-gold text-center ${focusedElement === 'tab-0' ? 'ring-2 ring-brand-ice' : ''}`}
            >
              Featured ({getCategoryApps('featured').length})
            </TabsTrigger>
            <TabsTrigger 
              value="streaming" 
              className={`text-white data-[state=active]:bg-brand-gold text-center ${focusedElement === 'tab-1' ? 'ring-2 ring-brand-ice' : ''}`}
            >
              Streaming ({getCategoryApps('streaming').length})
            </TabsTrigger>
            <TabsTrigger 
              value="support" 
              className={`text-white data-[state=active]:bg-brand-gold text-center ${focusedElement === 'tab-2' ? 'ring-2 ring-brand-ice' : ''}`}
            >
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

      {/* Initialize app status checks when apps load */}
      <div className="hidden">
        {/* This runs once when apps change to initialize status for all apps */}
      </div>
    </div>
  );
};

export default InstallApps;
