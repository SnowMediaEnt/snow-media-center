import { memo, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { trackEvent } from '@/lib/analytics';
import type { BroadcastAlert } from '@/hooks/useBroadcastAlert';

const WELCOME_KEY = 'smc-welcome-shown-version';
// Extra settle time so we queue behind Welcome / pre-event / update popups.
const MIN_DELAY_MS = 3000;

const severityStyles: Record<
  BroadcastAlert['severity'],
  { Icon: typeof AlertTriangle; color: string; ring: string }
> = {
  info: { Icon: Info, color: 'text-blue-400', ring: 'ring-blue-500/40' },
  warning: { Icon: AlertTriangle, color: 'text-yellow-400', ring: 'ring-yellow-500/40' },
  critical: { Icon: AlertOctagon, color: 'text-red-400', ring: 'ring-red-500/40' },
};

interface Props {
  alert: BroadcastAlert;
  onDismiss: () => void;
}

const BroadcastAlertPopup = ({ alert, onDismiss }: Props) => {
  const okRef = useRef<HTMLButtonElement>(null);
  const mountedAtRef = useRef(Date.now());
  const [open, setOpen] = useState(false);

  // Sequence behind any other boot popup rather than stacking on top.
  useEffect(() => {
    let cancelled = false;
    const tryOpen = (): boolean => {
      if (cancelled) return true;
      if (Date.now() - mountedAtRef.current < MIN_DELAY_MS) return false;
      try { if (!localStorage.getItem(WELCOME_KEY)) return false; } catch { return false; }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return false;
      setOpen(true);
      try { trackEvent('broadcast_alert_popup_shown', 'alerts', { alert_id: alert.id, severity: alert.severity }); } catch { void 0; }
      return true;
    };
    if (tryOpen()) return;
    const id = window.setInterval(() => { if (tryOpen()) window.clearInterval(id); }, 800);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [alert.id]);

  const handleDismiss = () => {
    try { trackEvent('alert_popup_action', 'alerts', { alert: 'broadcast', action: 'ok', title: alert.title, severity: alert.severity }); } catch { void 0; }
    setOpen(false);
    onDismiss();
  };

  useEffect(() => {
    if (open) setTimeout(() => okRef.current?.focus(), 50);
  }, [open]);

  // D-pad: Enter / OK / Back / Escape all dismiss (capture phase).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'Escape', 'Backspace'].includes(e.key) || e.keyCode === 4) {
        e.preventDefault();
        e.stopPropagation();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const style = severityStyles[alert.severity] || severityStyles.warning;
  const { Icon } = style;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleDismiss(); }}>
      <DialogContent className={`max-w-lg w-full bg-slate-900 border-slate-700 text-white ring-2 ${style.ring}`}>
        <div className="flex items-center gap-3 mb-1">
          <Icon className={`w-7 h-7 ${style.color}`} />
          <h2 className="text-2xl font-bold text-white leading-tight">{alert.title}</h2>
        </div>
        <p className="text-slate-300 text-base whitespace-pre-wrap">{alert.message}</p>
        <div className="flex justify-center pt-2">
          <Button
            ref={okRef}
            variant="gold"
            onClick={handleDismiss}
            className="min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 focus:ring-brand-ice focus:scale-105 transition"
          >
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default memo(BroadcastAlertPopup);
