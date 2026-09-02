import { memo, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { trackEvent } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import RenewQR from './RenewQR';

interface Props {
  open: boolean;
  serverLabel: string;
  days: number;          // <0 = expired; 0..7 = warning window (0 = today)
  username?: string | null;
  onDismiss: () => void;
}

const ExpirationNoticeDialog = memo(({ open, serverLabel, days, username, onDismiss }: Props) => {
  const DEMO = isDemo();
  const showRenew = !DEMO && !!username;
  const BTN_COUNT = showRenew ? 2 : 1; // [Renew now?, OK, got it]
  const [view, setView] = useState<'notice' | 'qr'>('notice');
  const [focusIdx, setFocusIdx] = useState(0);
  const focusIdxRef = useRef(focusIdx);
  useEffect(() => { focusIdxRef.current = focusIdx; }, [focusIdx]);
  const okRef = useRef<HTMLButtonElement>(null);
  const expired = days < 0;

  const handleDismiss = () => {
    try { trackEvent('alert_popup_action', 'alerts', { alert: 'player_expiration', action: 'ok', expired, days }); } catch { void 0; }
    onDismiss();
  };

  const openRenew = () => {
    if (!DEMO) {
      try { trackEvent('renew_qr_shown', 'player', { server: serverLabel, days_left: days }); } catch { /* ignore */ }
    }
    setView('qr');
  };

  useEffect(() => {
    if (open) {
      setView('notice');
      setFocusIdx(0);
      setTimeout(() => { if (!showRenew) okRef.current?.focus(); }, 50);
    }
  }, [open, showRenew]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (view === 'qr') return; // RenewQR owns the keyboard
      const isNav = ['ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape', 'Backspace'].includes(e.key)
        || e.keyCode === 4 || e.keyCode === 13 || e.keyCode === 23;
      if (!isNav) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowLeft') setFocusIdx(i => (i - 1 + BTN_COUNT) % BTN_COUNT);
      else if (e.key === 'ArrowRight') setFocusIdx(i => (i + 1) % BTN_COUNT);
      else if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23) {
        if (showRenew && focusIdxRef.current === 0) openRenew();
        else handleDismiss();
      } else {
        handleDismiss(); // Back / Escape dismisses from the notice view
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, view, BTN_COUNT, showRenew, onDismiss, days, expired, serverLabel, DEMO]);

  const title = expired
    ? `Your ${serverLabel} subscription has EXPIRED`
    : days === 0
      ? `Your ${serverLabel} subscription expires TODAY`
      : `Your ${serverLabel} subscription expires in ${days} day${days === 1 ? '' : 's'}`;

  const body = expired
    ? 'Reach out to Snow Media to renew and restore access. You can renew through the store or by contacting support.'
    : 'Reach out to Snow Media to renew and avoid losing access. You can renew through the store or by contacting support.';

  const Icon = expired ? ShieldAlert : AlertTriangle;
  const focusedCls = 'scale-105 z-10';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleDismiss(); }}>
      <DialogContent
        className="max-w-lg w-full rounded-3xl sm:rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-2 border-brand-gold/60 text-white p-0 gap-0 overflow-hidden flex flex-col"
      >
        <div className={`px-6 py-4 border-b border-brand-gold/40 flex items-center gap-3 ${expired ? 'bg-gradient-to-r from-red-600/40 via-red-500/25 to-red-600/40' : 'bg-gradient-to-r from-brand-gold/30 via-yellow-500/20 to-brand-gold/30'}`}>
          <Icon className={`w-6 h-6 ${expired ? 'text-red-300' : 'text-brand-gold'}`} />
          <h2 className="text-2xl font-quicksand font-bold text-white leading-tight tracking-tight">
            {view === 'qr' ? 'Renew your subscription' : title}
          </h2>
        </div>

        {view === 'qr' && username ? (
          <div className="px-6 py-6">
            <RenewQR username={username} serverLabel={serverLabel} onBack={() => setView('notice')} />
          </div>
        ) : (
          <>
            <p className="px-6 py-6 text-base font-medium text-slate-100 leading-relaxed">
              {body}
            </p>

            <div className="px-6 py-4 border-t border-brand-gold/30 bg-slate-950/60 flex justify-center gap-3">
              {showRenew && (
                <Button
                  variant="gold"
                  onClick={openRenew}
                  data-focused={focusIdx === 0 ? 'true' : 'false'}
                  className={`tv-ring tv-ring-contrast h-12 min-w-[140px] rounded-xl py-3 text-base font-semibold transition-transform duration-150 ease-out ${focusIdx === 0 ? focusedCls : ''}`}
                >
                  <RefreshCw className="w-4 h-4 mr-2" /> Renew now
                </Button>
              )}
              <Button
                ref={okRef}
                variant={showRenew ? 'white' : 'gold'}
                onClick={handleDismiss}
                data-focused={focusIdx === BTN_COUNT - 1 ? 'true' : 'false'}
                className={`tv-ring h-12 min-w-[140px] rounded-xl py-3 text-base font-semibold transition-transform duration-150 ease-out ${focusIdx === BTN_COUNT - 1 ? focusedCls : ''}`}
              >
                OK, got it
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});

ExpirationNoticeDialog.displayName = 'ExpirationNoticeDialog';
export default ExpirationNoticeDialog;
