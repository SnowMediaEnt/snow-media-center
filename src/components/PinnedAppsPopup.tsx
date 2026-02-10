import { useState, useEffect, useRef } from 'react';
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
  focusedIndex: number; // -1 = none focused, 0-6 = app slots, 7 = add button
  onFocusChange: (index: number) => void;
  onExitFocus: () => void; // Called when user navigates out of popup
}

const PinnedAppsPopup = ({ 
  pinnedApps, 
  onLaunchApp, 
  onPinApp,
  onUnpinApp,
  apps,
  isVisible,
  isPinned,
  canPinMore,
  focusedIndex,
  onFocusChange,
  onExitFocus
}: PinnedAppsPopupProps) => {
  const [showAppSelector, setShowAppSelector] = useState(false);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Handle keyboard navigation within the popup
  useEffect(() => {
    if (!isVisible || focusedIndex < 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        if (focusedIndex > 0) {
          onFocusChange(focusedIndex - 1);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        const maxIndex = Math.min(pinnedApps.length, 6); // up to 7 slots (0-6) + add button
        if (focusedIndex < maxIndex) {
          onFocusChange(focusedIndex + 1);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        onExitFocus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        buttonsRef.current[focusedIndex]?.click();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isVisible, focusedIndex, pinnedApps.length, onFocusChange, onExitFocus]);

  // Focus the button when focusedIndex changes
  useEffect(() => {
    if (focusedIndex >= 0 && buttonsRef.current[focusedIndex]) {
      buttonsRef.current[focusedIndex]?.focus();
    }
  }, [focusedIndex]);

  if (!isVisible) return null;

  const handleTogglePin = (app: InstalledApp | AppData) => {
    if (isPinned(app.id)) {
      onUnpinApp(app.id);
    } else if (canPinMore) {
      // Convert AppData to InstalledApp format
      const installedApp: InstalledApp = {
        id: app.id,
        name: app.name,
        icon: 'icon' in app ? app.icon : '',
        packageName: app.packageName,
      };
      onPinApp(installedApp);
    }
  };

  // Merge defaultInstalledApps with fetched apps for the selector, deduplicating by packageName
  const allSelectableApps: InstalledApp[] = [...defaultInstalledApps];
  for (const app of apps) {
    const alreadyExists = allSelectableApps.some(a => a.packageName === app.packageName);
    if (!alreadyExists) {
      allSelectableApps.push({
        id: app.id,
        name: app.name,
        icon: app.icon,
        packageName: app.packageName,
      });
    }
  }

  // Create 7 equal slots
  const slots = Array.from({ length: 7 }, (_, i) => pinnedApps[i] || null);

  return (
    <>
      <div className="absolute bottom-full left-0 mb-4 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <Card className="bg-slate-900/95 backdrop-blur-md border-slate-600 shadow-2xl p-4">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <Pin className="w-4 h-4 text-brand-gold" />
            <span className="text-sm font-semibold text-white">Pinned Apps</span>
            <Badge variant="secondary" className="bg-brand-gold/20 text-brand-gold border-brand-gold/30 text-xs">
              {pinnedApps.length}/7
            </Badge>
          </div>
          
          {/* 7 Equal Slots Grid */}
          <div className="grid grid-cols-7 gap-2" style={{ width: 'max(490px, 35vw)' }}>
            {slots.map((pinnedApp, index) => {
              const isFocused = focusedIndex === index;
              
              if (pinnedApp) {
                const fullApp = apps.find(a => a.id === pinnedApp.id);
                
                return (
                  <button
                    key={pinnedApp.id}
                    ref={el => buttonsRef.current[index] = el}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (fullApp) onLaunchApp(fullApp);
                    }}
                    className={`
                      flex-shrink-0 p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 
                      border border-slate-600 hover:border-brand-ice/50 
                      transition-all duration-150 group cursor-pointer
                      ${isFocused ? 'ring-2 ring-brand-ice border-brand-ice scale-105' : ''}
                    `}
                  >
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="w-12 h-12 bg-gradient-to-br from-slate-600 to-slate-700 rounded-lg flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform">
                        <img 
                          src={pinnedApp.icon} 
                          alt={`${pinnedApp.name} icon`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src = 'https://via.placeholder.com/48?text=' + pinnedApp.name.charAt(0);
                          }}
                        />
                      </div>
                      <span className="text-xs text-white text-center font-medium line-clamp-1 w-full">
                        {pinnedApp.name}
                      </span>
                    </div>
                  </button>
                );
              } else {
                // Empty slot - show add button
                return (
                  <button
                    key={`empty-${index}`}
                    ref={el => buttonsRef.current[index] = el}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAppSelector(true);
                    }}
                    className={`
                      flex-shrink-0 p-2 rounded-xl bg-slate-800/30 hover:bg-slate-700/50 
                      border border-dashed border-slate-600 hover:border-brand-gold/50 
                      transition-all duration-150 group cursor-pointer
                      ${isFocused ? 'ring-2 ring-brand-ice border-brand-ice scale-105' : ''}
                    `}
                  >
                    <div className="flex flex-col items-center justify-center gap-1.5">
                      <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-slate-700/30 group-hover:bg-brand-gold/20 transition-colors">
                        <Plus className="w-6 h-6 text-slate-500 group-hover:text-brand-gold transition-colors" />
                      </div>
                      <span className="text-xs text-slate-500 group-hover:text-brand-gold transition-colors">
                        Add
                      </span>
                    </div>
                  </button>
                );
              }
            })}
          </div>
          
          {/* Arrow pointer */}
          <div className="absolute -bottom-2 left-8 w-4 h-4 bg-slate-900/95 border-r border-b border-slate-600 rotate-45" />
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
                          target.src = 'https://via.placeholder.com/48?text=' + app.name.charAt(0);
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
              ? `You can pin ${7 - pinnedApps.length} more app${7 - pinnedApps.length !== 1 ? 's' : ''}`
              : 'Maximum 7 apps pinned. Unpin one to add more.'
            }
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PinnedAppsPopup;