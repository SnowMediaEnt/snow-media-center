import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Download, Play, Smartphone, Tv, Settings, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppData } from '@/hooks/useAppData';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { AppManager } from '@/capacitor/AppManager';
import { generatePackageName } from '@/utils/downloadApk';
import DownloadProgress from '@/components/DownloadProgress';

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
  const { toast } = useToast();
  const { apps, loading, error } = useAppData();

  // Early returns MUST happen before any other hooks
  if (loading) {
    return (
      <div className="tv-scroll-container tv-safe flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-ice mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading apps...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tv-scroll-container tv-safe flex items-center justify-center">
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

  return <InstallAppsContent onBack={onBack} apps={apps} />;
};

const InstallAppsContent = ({ onBack, apps }: { onBack: () => void; apps: AppData[] }) => {
  const [appStatuses, setAppStatuses] = useState<Map<string, { installed: boolean }>>(new Map());
  const [focusedElement, setFocusedElement] = useState<'back' | 'tab-0' | 'tab-1' | 'tab-2' | 'tab-3' | string>('back');
  const [activeTab, setActiveTab] = useState<string>('featured');
  const [downloadingApp, setDownloadingApp] = useState<AppData | null>(null);
  const { toast } = useToast();
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
      
      const categoryApps = apps.filter(app => activeTab === 'featured' ? app.featured : app.category === activeTab);
      
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
            if (categoryApps.length > 0) setFocusedElement(`app-${categoryApps[0].id}`);
          }
          break;
          
        case 'ArrowUp':
          if (focusedElement.startsWith('app-')) {
            const currentIndex = categoryApps.findIndex(app => focusedElement === `app-${app.id}`);
            if (currentIndex > 0) {
              setFocusedElement(`app-${categoryApps[currentIndex - 1].id}`);
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
            if (categoryApps.length > 0) setFocusedElement(`app-${categoryApps[0].id}`);
          } else if (focusedElement.startsWith('app-')) {
            const currentIndex = categoryApps.findIndex(app => focusedElement === `app-${app.id}`);
            if (currentIndex + 1 < categoryApps.length) {
              setFocusedElement(`app-${categoryApps[currentIndex + 1].id}`);
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
            const app = categoryApps.find(a => focusedElement === `app-${a.id}`);
            if (app) {
              setFocusedElement(`download-${app.id}`);
            }
          } else if (focusedElement.startsWith('download-')) {
            // Trigger download
            const appId = focusedElement.replace('download-', '');
            const app = categoryApps.find(a => a.id === appId);
            if (app) handleDownload(app);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, activeTab, onBack, apps]);

  // App status management functions
  const generateAppPackageName = (app: AppData) => app.packageName || generatePackageName(app.name);

  const checkInstallStatus = useCallback(async (app: AppData): Promise<boolean> => {
    try {
      const packageName = generateAppPackageName(app);
      console.log(`Checking install status for ${app.name} (${packageName})`);
      
      if (Capacitor.isNativePlatform()) {
        const { installed } = await AppManager.isInstalled({ packageName });
        console.log(`${app.name} installed: ${installed}`);
        return installed;
      }
      return false;
    } catch (error) {
      console.error('Error checking install status:', error);
      return false;
    }
  }, []);

  const ensureStatus = useCallback(async (app: AppData): Promise<{ installed: boolean }> => {
    try {
      const installed = await checkInstallStatus(app);
      setAppStatuses(prev => new Map(prev.set(app.id, { installed })));
      return { installed };
    } catch (error) {
      console.error('Error checking app status:', error);
      return { installed: false };
    }
  }, [checkInstallStatus]);

  const handleDownload = useCallback(async (app: AppData) => {
    if (!app.downloadUrl) {
      toast({
        title: "Download Error",
        description: "No download URL available for this app",
        variant: "destructive",
      });
      return;
    }

    // On native platform, use in-app download with progress
    if (Capacitor.isNativePlatform()) {
      setDownloadingApp(app);
    } else {
      // On web, open in browser (fallback)
      let url = app.downloadUrl;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }
      window.open(url, '_blank');
      toast({
        title: "Download Started",
        description: `${app.name} download opened in browser.`,
      });
    }
  }, [toast]);

  // Initialize app statuses when apps load
  useEffect(() => {
    if (apps.length > 0) {
      apps.forEach(app => {
        ensureStatus(app);
      });
    }
  }, [apps, ensureStatus]);

  // Re-check all app statuses (useful after returning from external actions)
  const refreshAllStatuses = useCallback(() => {
    apps.forEach(app => ensureStatus(app));
  }, [apps, ensureStatus]);

  // Refresh statuses when component becomes visible/focused
  useEffect(() => {
    const handleFocus = () => refreshAllStatuses();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshAllStatuses]);

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



  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'streaming': return Tv;
      case 'support': return Settings;
      default: return Smartphone;
    }
  };

  // Removed handleDownloadComplete - using real Android install process

  const renderAppGrid = (categoryApps: AppData[]) => (
    <div className="space-y-4 pb-8">
      <div className="space-y-4">
        {categoryApps.map((app) => {
          const status = appStatuses.get(app.id) || { installed: false };
          const isInstalled = status.installed;
          const isFocused = focusedElement === `app-${app.id}` || focusedElement.startsWith(`download-${app.id}`) || focusedElement.startsWith(`launch-${app.id}`);
          
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
                  {/* Show Download button if NOT installed */}
                  {!isInstalled && (
                    <Button 
                      onClick={() => handleDownload(app)}
                      className={`flex-1 ${focusedElement === `download-${app.id}` ? 'ring-2 ring-white' : ''} bg-brand-ice hover:bg-brand-ice/80 text-white`}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  )}
                  
                  {/* Launch Button - Only available if installed */}
                  {isInstalled && (
                    <Button 
                      onClick={() => handleLaunch(app)}
                      className="flex-1 bg-primary hover:bg-primary/80 text-primary-foreground"
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

      {/* Download Progress Modal */}
      {downloadingApp && (
        <DownloadProgress
          app={downloadingApp}
          onClose={() => setDownloadingApp(null)}
          onComplete={() => {
            // Refresh the app status after download/install
            ensureStatus(downloadingApp);
            setDownloadingApp(null);
          }}
        />
      )}
    </div>
  );
};

export default InstallApps;
