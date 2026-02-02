import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Pin, Play } from 'lucide-react';
import { PinnedApp } from '@/hooks/usePinnedApps';
import { AppData } from '@/hooks/useAppData';

interface PinnedAppsBarProps {
  pinnedApps: PinnedApp[];
  onLaunchApp: (app: AppData) => void;
  focusedElement: string;
  onFocus: (id: string) => void;
  apps: AppData[];
}

const PinnedAppsBar = ({ 
  pinnedApps, 
  onLaunchApp, 
  focusedElement, 
  onFocus,
  apps 
}: PinnedAppsBarProps) => {
  const isFocused = (id: string) => focusedElement === id;
  const focusRing = (id: string) => isFocused(id) 
    ? 'ring-4 ring-brand-ice ring-offset-2 ring-offset-slate-800 scale-105' 
    : '';

  // Create 7 equal slots
  const slots = Array.from({ length: 7 }, (_, i) => pinnedApps[i] || null);

  return (
    <div className="mb-6 p-4 bg-slate-800/50 rounded-xl border border-slate-700">
      <div className="flex items-center gap-2 mb-3">
        <Pin className="w-5 h-5 text-brand-gold" />
        <h2 className="text-lg font-semibold text-white">Pinned Apps</h2>
        <Badge variant="secondary" className="bg-brand-gold/20 text-brand-gold border-brand-gold/30">
          {pinnedApps.length}/7
        </Badge>
      </div>
      
      {/* 7 Equal Slots Grid */}
      <div className="grid grid-cols-7 gap-2">
        {slots.map((pinnedApp, index) => {
          const fullApp = pinnedApp ? apps.find(a => a.id === pinnedApp.id) : null;
          const focusId = pinnedApp ? `pinned-${pinnedApp.id}` : `pinned-empty-${index}`;
          
          if (pinnedApp) {
            return (
              <Card
                key={pinnedApp.id}
                data-focus-id={focusId}
                onClick={() => fullApp && onLaunchApp(fullApp)}
                className={`
                  p-2 cursor-pointer aspect-square
                  bg-gradient-to-br from-slate-700/80 to-slate-800/80 border-slate-600
                  hover:from-slate-600/80 hover:to-slate-700/80
                  transition-all duration-200
                  ${focusRing(focusId)}
                `}
              >
                <div className="flex flex-col items-center justify-center h-full gap-1">
                  <div className="w-12 h-12 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center overflow-hidden">
                    <img 
                      src={pinnedApp.icon} 
                      alt={`${pinnedApp.name} icon`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = `https://via.placeholder.com/48/475569/ffffff?text=${pinnedApp.name.charAt(0)}`;
                      }}
                    />
                  </div>
                  <span className="text-xs text-white text-center font-medium line-clamp-1 w-full">
                    {pinnedApp.name}
                  </span>
                  <Play className="w-3 h-3 text-brand-ice" />
                </div>
              </Card>
            );
          } else {
            // Empty slot placeholder
            return (
              <div
                key={`empty-${index}`}
                className="aspect-square rounded-xl border border-dashed border-slate-600/50 flex items-center justify-center"
              >
                <Pin className="w-5 h-5 text-slate-600/50" />
              </div>
            );
          }
        })}
      </div>
    </div>
  );
};

export default PinnedAppsBar;
