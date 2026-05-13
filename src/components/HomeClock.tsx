import { memo, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';

interface HomeClockProps {
  version: string;
  onUpdateClick?: () => void;
}

/**
 * Isolated clock component — re-renders every second WITHOUT
 * re-rendering the rest of the home tree. Shaves significant work
 * on low-power STB/FireTV devices.
 */
const HomeClock = memo(({ version, onUpdateClick }: HomeClockProps) => {
  const [now, setNow] = useState(() => new Date());
  const { updateAvailable, latestVersion } = useUpdateCheck(version);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="absolute z-20"
      style={{
        top: 'max(env(safe-area-inset-top, 0px), clamp(0.5rem, 1.5vh, 1rem))',
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 'min(80vw, 32rem)',
      }}
    >
      <div className="bg-black/80 rounded-full border border-white/20 shadow-lg flex items-center gap-3 px-4 py-2 sm:gap-4 sm:px-5 md:gap-5 md:px-6 md:py-2.5 whitespace-nowrap overflow-hidden">
        <div
          className="font-bold font-quicksand text-shadow-soft text-white"
          style={{ fontSize: 'clamp(0.65rem, 0.95vw, 1rem)' }}
        >
          {now.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}
        </div>
        <div className="w-px h-4 bg-white/40 flex-shrink-0" />
        <div
          className="opacity-90 font-nunito text-shadow-soft text-white"
          style={{ fontSize: 'clamp(0.65rem, 0.95vw, 1rem)' }}
        >
          {now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </div>
        <div className="w-px h-4 bg-white/40 flex-shrink-0" />
        <div
          className="font-nunito text-shadow-soft flex items-center gap-1.5"
          style={{ color: '#FFD700', fontSize: 'clamp(0.65rem, 0.95vw, 1rem)' }}
        >
          v{version}
          {updateAvailable && (
            <button
              type="button"
              onClick={onUpdateClick}
              title={latestVersion ? `Update available: v${latestVersion}` : 'Update available'}
              aria-label="Update available — open Settings → Updates"
              className="flex items-center justify-center rounded-full p-0.5 hover:bg-white/10 transition-colors animate-pulse"
            >
              <AlertTriangle
                className="text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]"
                style={{ width: 'clamp(14px, 1.1vw, 20px)', height: 'clamp(14px, 1.1vw, 20px)' }}
                fill="currentColor"
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

HomeClock.displayName = 'HomeClock';

export default HomeClock;
