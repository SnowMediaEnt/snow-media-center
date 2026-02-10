import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Download, Play, Smartphone, Tv, Settings, Trash2, Pin } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppData, AppData } from '@/hooks/useAppData';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { AppManager } from '@/capacitor/AppManager';
import { generatePackageName } from '@/utils/downloadApk';
import DownloadProgress from '@/components/DownloadProgress';
import PinnedAppsBar from '@/components/PinnedAppsBar';
import AppContextMenu from '@/components/AppContextMenu';
import { usePinnedApps } from '@/hooks/usePinnedApps';

interface InstallAppsProps {
  onBack: () => void;
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

// Focus types for navigation
type FocusType = 
  | 'back' 
  | 'tab-0' | 'tab-1' | 'tab-2' 
  | `app-${string}` 
  | `download-${string}` 
  | `launch-${string}` 
  | `settings-${string}` 
  | `uninstall-${string}`
  | `pinned-${string}`;

interface ContextMenuState {
  app: AppData | null;
  position: { x: number; y: number };
}

const InstallAppsContent = ({ onBack, apps }: { onBack: () => void; apps: AppData[] }) => {
  const [appStatuses, setAppStatuses] = useState<Map<string, { installed: boolean }>>(new Map());
  const [focusedElement, setFocusedElement] = useState<FocusType>('back');
  const [activeTab, setActiveTab] = useState<string>('featured');
  const [downloadingApp, setDownloadingApp] = useState<AppData | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ app: null, position: { x: 0, y: 0 } });
  const { toast } = useToast();
  const focusedRef = useRef<HTMLElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Pinned apps hook
  const { pinnedApps, isPinned, pinApp, unpinApp, canPinMore } = usePinnedApps();

  // Helper function to get category apps
  const getCategoryApps = useCallback((category: string) => {
    return apps.filter(app => category === 'featured' ? app.featured : app.category === category);
  }, [apps]);

  // Get buttons for an app based on install status
  const getAppButtons = useCallback((app: AppData): string[] => {
    const status = appStatuses.get(app.id);
    if (status?.installed) {
      return [`launch-${app.id}`, `settings-${app.id}`, `uninstall-${app.id}`];
    }
    return [`download-${app.id}`];
  }, [appStatuses]);

  // TV Remote Navigation with button-level focus
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
      
      const categoryApps = getCategoryApps(activeTab);
      const tabs = ['tab-0', 'tab-1', 'tab-2'];
      
      // Build a flat list of focusable elements in order
      const focusOrder: FocusType[] = ['back', 'tab-0', 'tab-1', 'tab-2'];
      categoryApps.forEach(app => {
        focusOrder.push(`app-${app.id}` as FocusType);
        getAppButtons(app).forEach(btn => focusOrder.push(btn as FocusType));
      });
      
      const currentIdx = focusOrder.indexOf(focusedElement);
      
      switch (event.key) {
        case 'ArrowLeft':
          if (focusedElement === 'tab-1') setFocusedElement('tab-0');
          else if (focusedElement === 'tab-2') setFocusedElement('tab-1');
          else if (focusedElement.startsWith('app-') || focusedElement === 'tab-0') {
            setFocusedElement('back');
          } else if (focusedElement.includes('-') && !focusedElement.startsWith('tab-')) {
            // From a button, go to the app card
            const appId = focusedElement.split('-').slice(1).join('-');
            setFocusedElement(`app-${appId}` as FocusType);
          }
          break;
          
        case 'ArrowRight':
          if (focusedElement === 'tab-0') setFocusedElement('tab-1');
          else if (focusedElement === 'tab-1') setFocusedElement('tab-2');
          else if (focusedElement === 'back') {
            setFocusedElement('tab-0');
          } else if (focusedElement.startsWith('app-')) {
            // From app card, go to first button
            const appId = focusedElement.replace('app-', '');
            const app = categoryApps.find(a => a.id === appId);
            if (app) {
              const buttons = getAppButtons(app);
              if (buttons.length > 0) {
                setFocusedElement(buttons[0] as FocusType);
              }
            }
          }
          break;
          
        case 'ArrowUp':
          if (focusedElement.startsWith('tab-')) {
            setFocusedElement('back');
          } else if (focusedElement === 'back') {
            // Stay on back
          } else {
            // Find current app and go to previous app or tabs
            const appId = focusedElement.includes('-') 
              ? focusedElement.split('-').slice(1).join('-').replace('app-', '')
              : '';
            const currentAppIdx = categoryApps.findIndex(app => 
              focusedElement === `app-${app.id}` || 
              focusedElement.endsWith(`-${app.id}`)
            );
            
            if (currentAppIdx > 0) {
              setFocusedElement(`app-${categoryApps[currentAppIdx - 1].id}` as FocusType);
            } else if (currentAppIdx === 0) {
              setFocusedElement('tab-0');
            }
          }
          break;
          
        case 'ArrowDown':
          if (focusedElement === 'back') {
            setFocusedElement('tab-0');
          } else if (focusedElement.startsWith('tab-')) {
            if (categoryApps.length > 0) {
              setFocusedElement(`app-${categoryApps[0].id}` as FocusType);
            }
          } else {
            // Find current app and go to next app or next button row
            const currentAppIdx = categoryApps.findIndex(app => 
              focusedElement === `app-${app.id}` || 
              focusedElement.endsWith(`-${app.id}`)
            );
            
            if (focusedElement.startsWith('app-')) {
              // From app card, go to first button
              const app = categoryApps[currentAppIdx];
              if (app) {
                const buttons = getAppButtons(app);
                if (buttons.length > 0) {
                  setFocusedElement(buttons[0] as FocusType);
                } else if (currentAppIdx + 1 < categoryApps.length) {
                  setFocusedElement(`app-${categoryApps[currentAppIdx + 1].id}` as FocusType);
                }
              }
            } else {
              // From a button, go to next app
              if (currentAppIdx + 1 < categoryApps.length) {
                setFocusedElement(`app-${categoryApps[currentAppIdx + 1].id}` as FocusType);
              }
            }
          }
          break;
          
        case 'Enter':
        case ' ':
          if (focusedElement === 'back') {
            onBack();
          } else if (focusedElement === 'tab-0') {
            setActiveTab('featured');
          } else if (focusedElement === 'tab-1') {
            setActiveTab('streaming');
          } else if (focusedElement === 'tab-2') {
            setActiveTab('support');
          } else if (focusedElement.startsWith('download-')) {
            const appId = focusedElement.replace('download-', '');
            const app = categoryApps.find(a => a.id === appId);
            if (app) handleDownload(app);
          } else if (focusedElement.startsWith('launch-')) {
            const appId = focusedElement.replace('launch-', '');
            const app = categoryApps.find(a => a.id === appId);
            if (app) handleLaunch(app);
          } else if (focusedElement.startsWith('settings-')) {
            const appId = focusedElement.replace('settings-', '');
            const app = categoryApps.find(a => a.id === appId);
            if (app) handleOpenAppSettings(app);
          } else if (focusedElement.startsWith('uninstall-')) {
            const appId = focusedElement.replace('uninstall-', '');
            const app = categoryApps.find(a => a.id === appId);
            if (app) handleUninstall(app);
          } else if (focusedElement.startsWith('app-')) {
            // Pressing enter on app card goes to first button
            const appId = focusedElement.replace('app-', '');
            const app = categoryApps.find(a => a.id === appId);
            if (app) {
              const buttons = getAppButtons(app);
              if (buttons.length > 0) {
                setFocusedElement(buttons[0] as FocusType);
              }
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, activeTab, onBack, apps, getCategoryApps, getAppButtons, appStatuses]);

  // Scroll focused element into view
  useEffect(() => {
    const el = document.querySelector(`[data-focus-id="${focusedElement}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedElement]);

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

  // Long press handlers for pinning
  const handleLongPressStart = (app: AppData, event: React.TouchEvent | React.MouseEvent) => {
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    
    longPressTimerRef.current = setTimeout(() => {
      setContextMenu({
        app,
        position: { x: clientX, y: clientY }
      });
    }, 600); // 600ms for long press
  };

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePinApp = (app: AppData) => {
    const success = pinApp({
      id: app.id,
      name: app.name,
      icon: app.icon,
      packageName: app.packageName
    });
    
    if (success) {
      toast({
        title: "App Pinned! 📌",
        description: `${app.name} added to your pinned apps.`,
      });
    } else {
      toast({
        title: "Cannot Pin App",
        description: "Maximum of 5 apps can be pinned.",
        variant: "destructive",
      });
    }
  };

  const handleUnpinApp = (appId: string, appName: string) => {
    unpinApp(appId);
    toast({
      title: "App Unpinned",
      description: `${appName} removed from pinned apps.`,
    });
  };

  const isFocused = (id: string) => focusedElement === id;
  const focusRing = (id: string) => isFocused(id) ? 'scale-110 shadow-[0_0_20px_rgba(161,213,220,0.5)] brightness-110 z-10' : '';

  const renderAppGrid = (categoryApps: AppData[]) => (
    <div className="space-y-6 pb-8">
      {categoryApps.map((app) => {
        const status = appStatuses.get(app.id) || { installed: false };
        const isInstalled = status.installed;
        const appFocused = isFocused(`app-${app.id}`);
        const appIsPinned = isPinned(app.id);
        
        return (
          <Card 
            key={app.id} 
            data-focus-id={`app-${app.id}`}
            onClick={() => isInstalled ? handleLaunch(app) : handleDownload(app)}
            className={`bg-gradient-to-br from-slate-700/80 to-slate-800/80 border-slate-600 overflow-hidden transition-all duration-200 cursor-pointer ${appFocused ? 'ring-4 ring-brand-ice scale-[1.02]' : ''} ${appIsPinned ? 'border-l-4 border-l-brand-gold' : ''}`}
            onTouchStart={(e) => handleLongPressStart(app, e)}
            onTouchEnd={handleLongPressEnd}
            onTouchCancel={handleLongPressEnd}
            onMouseDown={(e) => handleLongPressStart(app, e)}
            onMouseUp={handleLongPressEnd}
            onMouseLeave={handleLongPressEnd}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({
                app,
                position: { x: e.clientX, y: e.clientY }
              });
            }}
          >
            <div className="p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-16 h-16 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0">
                  <img 
                    src={app.icon || '/icons/default.png'} 
                    alt={`${app.name} icon`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="text-xl font-bold text-white">{app.name}</h3>
                    {appIsPinned && (
                      <Badge className="bg-brand-gold/20 text-brand-gold border border-brand-gold/30">📌 Pinned</Badge>
                    )}
                    {app.featured && (
                      <Badge className="bg-green-600 text-white">Featured</Badge>
                    )}
                  </div>
                  <p className="text-slate-400 text-sm mb-2 line-clamp-2">{app.description}</p>
                  <div className="flex gap-2 text-xs text-slate-500">
                    <span>{app.size}</span>
                  </div>
                </div>

                {/* Pin/Unpin Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (appIsPinned) {
                      handleUnpinApp(app.id, app.name);
                    } else {
                      handlePinApp(app);
                    }
                  }}
                  className={`flex-shrink-0 transition-all ${
                    appIsPinned 
                      ? 'text-brand-gold hover:text-red-400 hover:bg-red-500/20' 
                      : 'text-slate-400 hover:text-brand-gold hover:bg-brand-gold/20'
                  }`}
                  title={appIsPinned ? 'Unpin app' : 'Pin app for quick access'}
                >
                  <Pin className={`w-5 h-5 ${appIsPinned ? 'fill-current' : ''}`} />
                </Button>
              </div>
              
              {/* Action Buttons - each individually focusable */}
              <div className="space-y-3">
                {!isInstalled && (
                  <Button 
                    data-focus-id={`download-${app.id}`}
                    onClick={() => handleDownload(app)}
                    className={`w-full transition-all duration-200 ${focusRing(`download-${app.id}`)} bg-brand-ice hover:bg-brand-ice/80 text-white`}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                )}
                
                {isInstalled && (
                  <>
                    <Button 
                      data-focus-id={`launch-${app.id}`}
                      onClick={() => handleLaunch(app)}
                      className={`w-full transition-all duration-200 ${focusRing(`launch-${app.id}`)} bg-primary hover:bg-primary/80 text-primary-foreground`}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Launch
                    </Button>
                    
                    <div className="flex gap-2">
                      <Button 
                        data-focus-id={`settings-${app.id}`}
                        onClick={() => handleOpenAppSettings(app)}
                        variant="outline"
                        className={`flex-1 transition-all duration-200 ${focusRing(`settings-${app.id}`)} bg-blue-600/20 border-blue-500/50 text-blue-400 hover:bg-blue-600/30`}
                      >
                        <Settings className="w-4 h-4 mr-2" />
                        App Settings
                      </Button>
                      
                      <Button 
                        data-focus-id={`uninstall-${app.id}`}
                        onClick={() => handleUninstall(app)}
                        variant="outline"
                        className={`flex-1 transition-all duration-200 ${focusRing(`uninstall-${app.id}`)} bg-red-600/20 border-red-500/50 text-red-400 hover:bg-red-600/30`}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Uninstall
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );

  return (
    <div className="tv-scroll-container tv-safe">
      <div className="max-w-6xl mx-auto pb-16">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center w-full justify-between">
          <Button 
            data-focus-id="back"
            onClick={onBack}
            variant="gold" 
            size="lg"
            className={`transition-all duration-200 ${focusRing('back')}`}
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

        {/* Pinned Apps Bar */}
        <PinnedAppsBar
          pinnedApps={pinnedApps}
          onLaunchApp={handleLaunch}
          focusedElement={focusedElement}
          onFocus={(id) => setFocusedElement(id as FocusType)}
          apps={apps}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8 bg-slate-800/50 border-slate-600">
            <TabsTrigger 
              data-focus-id="tab-0"
              value="featured" 
              className={`text-white data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-0')}`}
            >
              Featured ({getCategoryApps('featured').length})
            </TabsTrigger>
            <TabsTrigger 
              data-focus-id="tab-1"
              value="streaming" 
              className={`text-white data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-1')}`}
            >
              Streaming ({getCategoryApps('streaming').length})
            </TabsTrigger>
            <TabsTrigger 
              data-focus-id="tab-2"
              value="support" 
              className={`text-white data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-2')}`}
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

      {/* Context Menu for Pin/Unpin */}
      {contextMenu.app && (
        <AppContextMenu
          app={contextMenu.app}
          isPinned={isPinned(contextMenu.app.id)}
          canPinMore={canPinMore}
          position={contextMenu.position}
          onPin={() => handlePinApp(contextMenu.app!)}
          onUnpin={() => handleUnpinApp(contextMenu.app!.id, contextMenu.app!.name)}
          onClose={() => setContextMenu({ app: null, position: { x: 0, y: 0 } })}
        />
      )}
    </div>
  );
};

export default InstallApps;