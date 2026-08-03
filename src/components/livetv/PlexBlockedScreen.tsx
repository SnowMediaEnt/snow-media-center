import { memo, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import RenewQR from './RenewQR';

interface Props {
  serverLabel: string;
  onBack: () => void;
}

/**
 * Full-screen D-pad focusable block shown in place of <PlexSection/> whenever
 * the local Xtream PlayerAccount is EXPIRED. Explicit "renew" messaging with
 * a "Renew now" QR; Back / Enter / OK return to the previous view via
 * `onBack` (the QR view's Back returns here first).
 */
const PlexBlockedScreen = memo(({ serverLabel, onBack }: Props) => {
  const { account, days } = usePlayerAccount();
  const DEMO = isDemo();
  const username = account?.username || null;
  const label = account?.serverLabel || serverLabel;
  const showRenew = !DEMO && !!username;
  const BTN_COUNT = showRenew ? 2 : 1; // [Renew now?, OK]
  const [view, setView] = useState<'notice' | 'qr'>('notice');
  const [focusIdx, setFocusIdx] = useState(0);
  const focusIdxRef = useRef(focusIdx);
  useEffect(() => { focusIdxRef.current = focusIdx; }, [focusIdx]);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try { trackEvent('plex_blocked_expired', 'player', { server: serverLabel }); } catch { /* ignore */ }
  }, [serverLabel]);

  const openRenew = () => {
    if (!DEMO) {
      try { trackEvent('renew_qr_shown', 'player', { server: label, days_left: days }); } catch { /* ignore */ }
    }
    setView('qr');
  };

  useEffect(() => {
    setTimeout(() => { if (!showRenew) okRef.current?.focus(); }, 50);
    const onKey = (e: KeyboardEvent) => {
      if (view === 'qr') return; // RenewQR owns the keyboard
      const isNav = ['ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape', 'Backspace'].includes(e.key) || e.keyCode === 4;
      if (!isNav) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowLeft') setFocusIdx(i => (i - 1 + BTN_COUNT) % BTN_COUNT);
      else if (e.key === 'ArrowRight') setFocusIdx(i => (i + 1) % BTN_COUNT);
      else if (e.key === 'Enter' || e.key === ' ') {
        if (showRenew && focusIdxRef.current === 0) openRenew();
        else onBack();
      } else {
        onBack(); // Back / Escape
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onBack, view, BTN_COUNT, showRenew, days, label, DEMO]);

  if (view === 'qr' && username) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-8 text-white bg-black/60">
        <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-2 border-brand-gold/60 ring-4 ring-brand-gold/25 p-8">
          <RenewQR username={username} serverLabel={label} onBack={() => setView('notice')} />
        </div>
      </div>
    );
  }

  const focusedCls = 'ring-brand-ice scale-105';

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
        <div className="flex justify-center gap-3">
          {showRenew && (
            <Button
              variant="gold"
              onClick={openRenew}
              data-focused={focusIdx === 0 ? 'true' : 'false'}
              className={`min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 transition tv-focusable home-focus-surface ${focusIdx === 0 ? focusedCls : ''}`}
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Renew now
            </Button>
          )}
          <Button
            ref={okRef}
            variant={showRenew ? 'white' : 'gold'}
            onClick={onBack}
            data-focused={focusIdx === BTN_COUNT - 1 ? 'true' : 'false'}
            className={`min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 transition tv-focusable home-focus-surface ${focusIdx === BTN_COUNT - 1 ? focusedCls : ''}`}
          >
            OK
          </Button>
        </div>
      </div>
    </div>
  );
});

PlexBlockedScreen.displayName = 'PlexBlockedScreen';
export default PlexBlockedScreen;
