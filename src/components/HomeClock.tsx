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
const HomeClock = memo(({ version }: HomeClockProps) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="absolute z-20"
      style={{
        // Use safe-area + viewport-aware spacing so Android TV boxes
        // (X96, T95, etc.) that overscan don't push us off-screen.
        top: 'max(env(safe-area-inset-top, 0px), clamp(0.5rem, 1.5vh, 1rem))',
        left: 'max(env(safe-area-inset-left, 0px), clamp(0.5rem, 1.5vw, 1rem))',
        // Hard cap so we never bleed into the right-side controls.
        maxWidth: 'min(60vw, 28rem)',
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
          className="font-nunito text-shadow-soft"
          style={{ color: '#FFD700', fontSize: 'clamp(0.65rem, 0.95vw, 1rem)' }}
        >
          v{version}
        </div>
      </div>
    </div>
  );
});

HomeClock.displayName = 'HomeClock';

export default HomeClock;
