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
  if (pinnedApps.length === 0) {
    return null;
  }

  const isFocused = (id: string) => focusedElement === id;
  const focusRing = (id: string) => isFocused(id) 
    ? 'ring-4 ring-brand-ice ring-offset-2 ring-offset-slate-800 scale-105' 
    : '';

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Pin className="w-5 h-5 text-brand-gold" />
        <h2 className="text-lg font-semibold text-white">Pinned Apps</h2>
        <Badge variant="secondary" className="bg-brand-gold/20 text-brand-gold border-brand-gold/30">
          {pinnedApps.length}/5
        </Badge>
      </div>
      
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
        {pinnedApps.map((pinnedApp, index) => {
          const fullApp = apps.find(a => a.id === pinnedApp.id);
          const focusId = `pinned-${pinnedApp.id}`;
          
          return (
            <Card
              key={pinnedApp.id}
              data-focus-id={focusId}
              onClick={() => fullApp && onLaunchApp(fullApp)}
              className={`
                flex-shrink-0 w-28 h-32 p-3 cursor-pointer
                bg-gradient-to-br from-slate-700/80 to-slate-800/80 border-slate-600
                hover:from-slate-600/80 hover:to-slate-700/80
                transition-all duration-200
                ${focusRing(focusId)}
              `}
            >
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <div className="w-12 h-12 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center overflow-hidden">
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
                <span className="text-xs text-white text-center font-medium line-clamp-2">
                  {pinnedApp.name}
                </span>
                <Play className="w-4 h-4 text-brand-ice" />
              </div>
            </Card>
          );
        })}
      </div>
      
      <p className="text-xs text-slate-400 mt-2">
        💡 Press and hold on any app below to pin/unpin
      </p>
    </div>
  );
};

export default PinnedAppsBar;
