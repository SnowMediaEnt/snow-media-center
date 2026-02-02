import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Pin, Plus, Play, Check } from 'lucide-react';
import { PinnedApp } from '@/hooks/usePinnedApps';
import { AppData } from '@/hooks/useAppData';
import { defaultInstalledApps, InstalledApp } from '@/data/installedApps';

interface PinnedAppsPopupProps {
  pinnedApps: PinnedApp[];
  onLaunchApp: (app: AppData) => void;
  onPinApp: (app: InstalledApp) => void;
  onUnpinApp: (appId: string) => void;
  apps: AppData[];
  isVisible: boolean;
  isPinned: (appId: string) => boolean;
  canPinMore: boolean;
}

const PinnedAppsPopup = ({ 
  pinnedApps, 
  onLaunchApp, 
  onPinApp,
  onUnpinApp,
  apps,
  isVisible,
  isPinned,
  canPinMore
}: PinnedAppsPopupProps) => {
  const [showAppSelector, setShowAppSelector] = useState(false);

  if (!isVisible) return null;

  const handleTogglePin = (app: InstalledApp) => {
    if (isPinned(app.id)) {
      onUnpinApp(app.id);
    } else if (canPinMore) {
      onPinApp(app);
    }
  };

  return (
    <>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <Card className="bg-slate-900/95 backdrop-blur-md border-slate-600 shadow-2xl p-4 min-w-[320px] max-w-[500px]">
          {/* Header */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <Pin className="w-4 h-4 text-brand-gold" />
            <span className="text-sm font-semibold text-white">Pinned Apps</span>
            <Badge variant="secondary" className="bg-brand-gold/20 text-brand-gold border-brand-gold/30 text-xs">
              {pinnedApps.length}/5
            </Badge>
          </div>
          
          {/* Apps Grid */}
          {pinnedApps.length === 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowAppSelector(true);
              }}
              className="w-full text-center py-4 px-2 cursor-pointer group"
            >
              <div className="w-14 h-14 mx-auto mb-2 rounded-xl bg-slate-700/50 flex items-center justify-center group-hover:bg-brand-gold/20 transition-colors">
                <Plus className="w-7 h-7 text-slate-400 group-hover:text-brand-gold transition-colors" />
              </div>
              <p className="text-slate-400 text-sm mb-1 group-hover:text-white transition-colors">
                No pinned apps yet
              </p>
              <p className="text-slate-500 text-xs group-hover:text-slate-400 transition-colors">
                Click to add apps
              </p>
            </button>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
              {pinnedApps.map((pinnedApp) => {
                const fullApp = apps.find(a => a.id === pinnedApp.id);
                
                return (
                  <button
                    key={pinnedApp.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (fullApp) onLaunchApp(fullApp);
                    }}
                    className="flex-shrink-0 w-20 p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600 hover:border-brand-ice/50 transition-all duration-150 group cursor-pointer"
                  >
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-lg flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform">
                        <img 
                          src={pinnedApp.icon || '/icons/default.png'} 
                          alt={`${pinnedApp.name} icon`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                          }}
                        />
                      </div>
                      <span className="text-xs text-white text-center font-medium line-clamp-1 w-full">
                        {pinnedApp.name}
                      </span>
                      <Play className="w-3 h-3 text-brand-ice opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                );
              })}
              
              {/* Add more button if less than 5 */}
              {pinnedApps.length < 5 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAppSelector(true);
                  }}
                  className="flex-shrink-0 w-20 p-2 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 border border-dashed border-slate-600 hover:border-brand-gold/50 transition-all duration-150 group cursor-pointer"
                >
                  <div className="flex flex-col items-center justify-center h-full gap-1.5">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-slate-700/50 group-hover:bg-brand-gold/20 transition-colors">
                      <Plus className="w-5 h-5 text-slate-500 group-hover:text-brand-gold transition-colors" />
                    </div>
                    <span className="text-xs text-slate-500 group-hover:text-brand-gold transition-colors">
                      Add
                    </span>
                  </div>
                </button>
              )}
            </div>
          )}
          
          {/* Arrow pointer */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-900/95 border-r border-b border-slate-600 rotate-45" />
        </Card>
      </div>

      {/* App Selector Dialog */}
      <Dialog open={showAppSelector} onOpenChange={setShowAppSelector}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pin className="w-5 h-5 text-brand-gold" />
              Select Apps to Pin
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-4">
            {defaultInstalledApps.map((app) => {
              const isAppPinned = isPinned(app.id);
              const canSelect = canPinMore || isAppPinned;
              
              return (
                <button
                  key={app.id}
                  onClick={() => handleTogglePin(app)}
                  disabled={!canSelect}
                  className={`
                    p-3 rounded-xl border transition-all duration-150
                    ${isAppPinned 
                      ? 'bg-brand-gold/20 border-brand-gold' 
                      : canSelect
                        ? 'bg-slate-800 border-slate-600 hover:border-brand-ice/50'
                        : 'bg-slate-800/50 border-slate-700 opacity-50 cursor-not-allowed'
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-slate-600 to-slate-700 rounded-lg flex items-center justify-center overflow-hidden">
                      <img 
                        src={app.icon} 
                        alt={`${app.name} icon`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                        }}
                      />
                    </div>
                    <div className="flex-1 text-left">
                      <span className="text-sm text-white font-medium block">
                        {app.name}
                      </span>
                      {isAppPinned && (
                        <span className="text-xs text-brand-gold flex items-center gap-1">
                          <Check className="w-3 h-3" /> Pinned
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 text-center mt-4">
            {canPinMore 
              ? `You can pin ${5 - pinnedApps.length} more app${5 - pinnedApps.length !== 1 ? 's' : ''}`
              : 'Maximum 5 apps pinned. Unpin one to add more.'
            }
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PinnedAppsPopup;
