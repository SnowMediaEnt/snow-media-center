import { useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pin, PinOff, X } from 'lucide-react';
import { AppData } from '@/hooks/useAppData';

interface AppContextMenuProps {
  app: AppData;
  isPinned: boolean;
  canPinMore: boolean;
  position: { x: number; y: number };
  onPin: () => void;
  onUnpin: () => void;
  onClose: () => void;
}

const AppContextMenu = ({ 
  app, 
  isPinned, 
  canPinMore,
  position, 
  onPin, 
  onUnpin, 
  onClose 
}: AppContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Close on escape key
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedPosition = {
    x: Math.min(position.x, window.innerWidth - 200),
    y: Math.min(position.y, window.innerHeight - 150),
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/40"
      onClick={onClose}
    >
      <Card
        ref={menuRef}
        className="absolute bg-slate-800 border-slate-600 shadow-2xl p-2 min-w-[180px] z-50"
        style={{
          left: adjustedPosition.x,
          top: adjustedPosition.y,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 mb-2">
          <img 
            src={app.icon || '/icons/default.png'} 
            alt={app.name}
            className="w-8 h-8 rounded-lg object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <span className="text-white font-medium text-sm truncate">{app.name}</span>
        </div>

        {isPinned ? (
          <Button
            onClick={() => {
              onUnpin();
              onClose();
            }}
            variant="ghost"
            className="w-full justify-start text-red-400 hover:text-red-300 hover:bg-red-500/20"
          >
            <PinOff className="w-4 h-4 mr-2" />
            Remove Pin
          </Button>
        ) : (
          <Button
            onClick={() => {
              onPin();
              onClose();
            }}
            variant="ghost"
            className={`w-full justify-start ${
              canPinMore 
                ? 'text-brand-gold hover:text-brand-gold hover:bg-brand-gold/20' 
                : 'text-slate-500 cursor-not-allowed'
            }`}
            disabled={!canPinMore}
          >
            <Pin className="w-4 h-4 mr-2" />
            {canPinMore ? 'Pin App' : 'Max 5 Pinned'}
          </Button>
        )}

        <Button
          onClick={onClose}
          variant="ghost"
          className="w-full justify-start text-slate-400 hover:text-white hover:bg-slate-700"
        >
          <X className="w-4 h-4 mr-2" />
          Cancel
        </Button>
      </Card>
    </div>
  );
};

export default AppContextMenu;
