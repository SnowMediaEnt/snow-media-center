import { memo, useEffect, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics';

interface Props {
  serverLabel: string;
  onBack: () => void;
}

/**
 * Full-screen D-pad focusable block shown in place of <PlexSection/> whenever
 * the local Xtream PlayerAccount is EXPIRED. Explicit "renew" messaging;
 * Back / Enter / OK all return to the previous view via `onBack`.
 */
const PlexBlockedScreen = memo(({ serverLabel, onBack }: Props) => {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try { trackEvent('plex_blocked_expired', 'player', { server: serverLabel }); } catch { /* ignore */ }
  }, [serverLabel]);


  useEffect(() => {
    setTimeout(() => okRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'Escape', 'Backspace'].includes(e.key) || e.keyCode === 4) {
        e.preventDefault();
        e.stopPropagation();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onBack]);

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-8 text-white bg-black/60">
      <div className="max-w-xl w-full rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-2 border-red-500/60 shadow-[0_0_60px_rgba(239,68,68,0.35)] ring-4 ring-red-500/25 p-8 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/20 flex items-center justify-center mb-4">
          <ShieldAlert className="w-9 h-9 text-red-300" />
        </div>
        <h2 className="text-2xl font-quicksand font-bold mb-3">
          ⛔ Plex access paused
        </h2>
        <p className="text-brand-ice/90 font-nunito text-base leading-relaxed mb-6">
          Your <span className="font-semibold text-white">{serverLabel}</span> subscription has expired.
          Renew with Snow Media to restore Plex access.
        </p>
        <Button
          ref={okRef}
          variant="gold"
          onClick={onBack}
          className="min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 focus:ring-brand-ice focus:scale-105 transition tv-focusable home-focus-surface"
        >
          OK
        </Button>
      </div>
    </div>
  );
});

PlexBlockedScreen.displayName = 'PlexBlockedScreen';
export default PlexBlockedScreen;
