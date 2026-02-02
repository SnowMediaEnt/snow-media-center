import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pin, Plus, Play } from 'lucide-react';
import { PinnedApp } from '@/hooks/usePinnedApps';
import { AppData } from '@/hooks/useAppData';

interface PinnedAppsPopupProps {
  pinnedApps: PinnedApp[];
  onLaunchApp: (app: AppData) => void;
  onAddApps: () => void;
  apps: AppData[];
  isVisible: boolean;
}

const PinnedAppsPopup = ({ 
  pinnedApps, 
  onLaunchApp, 
  onAddApps,
  apps,
  isVisible
}: PinnedAppsPopupProps) => {
  if (!isVisible) return null;

  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <Card className="bg-slate-900/95 backdrop-blur-md border-slate-600 shadow-2xl p-4 min-w-[320px] max-w-[500px]">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Pin className="w-4 h-4 text-brand-gold" />
            <span className="text-sm font-semibold text-white">Pinned Apps</span>
            <Badge variant="secondary" className="bg-brand-gold/20 text-brand-gold border-brand-gold/30 text-xs">
              {pinnedApps.length}/5
            </Badge>
          </div>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onAddApps();
            }}
            variant="ghost"
            size="sm"
            className="text-brand-ice hover:text-white hover:bg-slate-700 h-7 px-2"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
        </div>
        
        {/* Apps Grid */}
        {pinnedApps.length === 0 ? (
          <div className="text-center py-4 px-2">
            <div className="w-12 h-12 mx-auto mb-2 rounded-xl bg-slate-700/50 flex items-center justify-center">
              <Plus className="w-6 h-6 text-slate-500" />
            </div>
            <p className="text-slate-400 text-sm mb-1">
              No pinned apps yet
            </p>
            <p className="text-slate-500 text-xs">
              Click "Add" or pin apps from Main Apps
            </p>
          </div>
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
                  onAddApps();
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
  );
};

export default PinnedAppsPopup;
