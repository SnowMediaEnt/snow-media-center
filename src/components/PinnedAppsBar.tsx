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
    ? 'scale-110 ring-4 ring-brand-gold shadow-[0_0_20px_rgba(255,200,80,0.6)] brightness-125 z-10' 
    : '';

  // Create 4 equal slots
  const slots = Array.from({ length: 4 }, (_, i) => pinnedApps[i] || null);

  return (
    <div className="mb-3 px-3 py-2 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-center gap-2 mb-2">
        <Pin className="w-4 h-4 text-brand-gold" />
        <h2 className="text-sm font-semibold text-white">Pinned Apps</h2>
        <Badge variant="secondary" className="bg-brand-gold/20 text-brand-gold border-brand-gold/30 text-xs h-5 px-1.5">
          {pinnedApps.length}/4
        </Badge>
      </div>
      
      {/* 4 Equal Slots Grid - compact */}
      <div className="grid grid-cols-4 gap-2 max-w-md">
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
                  p-1.5 cursor-pointer
                  bg-gradient-to-br from-slate-700/80 to-slate-800/80 border-slate-600
                  hover:from-slate-600/80 hover:to-slate-700/80
                  transition-all duration-200
                  ${focusRing(focusId)}
                `}
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-slate-600 to-slate-700 rounded-md flex items-center justify-center overflow-hidden flex-shrink-0">
                    <img 
                      src={pinnedApp.icon} 
                      alt={`${pinnedApp.name} icon`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = `https://via.placeholder.com/32/475569/ffffff?text=${pinnedApp.name.charAt(0)}`;
                      }}
                    />
                  </div>
                  <span className="text-xs text-white font-medium line-clamp-1 flex-1 min-w-0">
                    {pinnedApp.name}
                  </span>
                </div>
              </Card>
            );
          } else {
            // Empty slot placeholder - small
            return (
              <div
                key={`empty-${index}`}
                className="h-11 rounded-md border border-dashed border-slate-600/50 flex items-center justify-center"
              >
                <Pin className="w-3.5 h-3.5 text-slate-600/50" />
              </div>
            );
          }
        })}
      </div>
    </div>
  );
};

export default PinnedAppsBar;
