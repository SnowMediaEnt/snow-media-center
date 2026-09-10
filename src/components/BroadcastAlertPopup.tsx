import { memo } from 'react';
import { AlertTriangle, Info, AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import NoticeLayer from '@/components/ui/notice-layer';
import { trackEvent } from '@/lib/analytics';
import type { BroadcastAlert } from '@/hooks/useBroadcastAlert';

const severityStyles: Record<
  BroadcastAlert['severity'],
  { Icon: typeof AlertTriangle; color: string; ring: string }
> = {
  info: { Icon: Info, color: 'text-blue-400', ring: 'ring-blue-500/40' },
  warning: { Icon: AlertTriangle, color: 'text-yellow-400', ring: 'ring-yellow-500/40' },
  critical: { Icon: AlertOctagon, color: 'text-red-400', ring: 'ring-red-500/40' },
};

interface Props {
  open: boolean;
  alert: BroadcastAlert;
  onDismiss: () => void;
}

/**
 * Admin broadcast alert (app_match = 'all'), shown on the home screen.
 *
 * Index decides `open`; this only renders. It used to decide for itself, with
 * a 3s timer and an 800ms poll for "is another modal up" — a second way to be
 * on screen at the wrong moment, and the poll looked for [aria-modal="true"],
 * which Radix dialogs never set, so it was blind to every one of them.
 */
const BroadcastAlertPopup = ({ open, alert, onDismiss }: Props) => {
  const handleDismiss = () => {
    try { trackEvent('alert_popup_action', 'alerts', { alert: 'broadcast', action: 'ok', title: alert.title, severity: alert.severity }); } catch { void 0; }
    onDismiss();
  };

  const style = severityStyles[alert.severity] || severityStyles.warning;
  const { Icon } = style;

  return (
    <NoticeLayer open={open} labelledBy="smc-broadcast-title" onDismiss={handleDismiss}>
      <div className={`rounded-lg border border-slate-700 bg-slate-900 text-white ring-2 ${style.ring} p-6 shadow-xl`}>
        <div className="flex items-center gap-3 mb-1">
          <Icon className={`w-7 h-7 ${style.color}`} />
          <h2 id="smc-broadcast-title" className="text-2xl font-bold text-white leading-tight">{alert.title}</h2>
        </div>
        <p className="text-slate-300 text-base whitespace-pre-wrap">{alert.message}</p>
        <div className="flex justify-center pt-4">
          <Button
            autoFocus
            variant="gold"
            onClick={handleDismiss}
            className="min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 focus:ring-brand-ice focus:scale-105 transition"
          >
            Got it
          </Button>
        </div>
      </div>
    </NoticeLayer>
  );
};

export default memo(BroadcastAlertPopup);
