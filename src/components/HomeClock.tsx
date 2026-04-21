import { memo, useEffect, useState } from 'react';

interface HomeClockProps {
  version: string;
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
    <div className="absolute z-20 top-4 left-4">
      <div className="bg-black/70 backdrop-blur-sm rounded-full border border-white/20 shadow-lg px-6 py-2.5 flex items-center gap-5">
        <div
          className="font-bold font-quicksand text-shadow-soft text-white"
          style={{ fontSize: 'clamp(0.75rem, 1vw, 1rem)' }}
        >
          {now.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}
        </div>
        <div className="w-px h-5 bg-white/40" />
        <div
          className="opacity-90 font-nunito text-shadow-soft text-white"
          style={{ fontSize: 'clamp(0.75rem, 1vw, 1rem)' }}
        >
          {now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </div>
        <div className="w-px h-5 bg-white/40" />
        <div
          className="font-nunito text-shadow-soft"
          style={{ color: '#FFD700', fontSize: 'clamp(0.75rem, 1vw, 1rem)' }}
        >
          v{version}
        </div>
      </div>
    </div>
  );
});

HomeClock.displayName = 'HomeClock';

export default HomeClock;
