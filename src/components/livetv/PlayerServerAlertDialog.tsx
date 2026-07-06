import { memo, useEffect } from 'react';
import { AlertTriangle, Info, AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlayerServerAlert } from '@/hooks/usePlayerServerAlert';

interface Props {
  alert: PlayerServerAlert;
  serverLabel: string;
  onDismiss: () => void;
}

const sevStyle = (s: PlayerServerAlert['severity']) =>
  s === 'critical'
    ? { Icon: AlertOctagon, ring: 'border-red-500/60', glow: 'shadow-[0_0_40px_rgba(239,68,68,0.25)]', color: 'text-red-300' }
    : s === 'warning'
    ? { Icon: AlertTriangle, ring: 'border-yellow-500/60', glow: 'shadow-[0_0_40px_rgba(234,179,8,0.2)]', color: 'text-yellow-200' }
    : { Icon: Info, ring: 'border-blue-500/60', glow: 'shadow-[0_0_40px_rgba(59,130,246,0.2)]', color: 'text-blue-200' };

const PlayerServerAlertDialog = memo(({ alert, serverLabel, onDismiss }: Props) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;
      if (e.keyCode === 4 || e.keyCode === 13 || e.keyCode === 23 || ['Enter', ' ', 'Escape', 'Backspace'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onDismiss]);

  const { Icon, ring, glow, color } = sevStyle(alert.severity);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
      <div className={`w-full max-w-lg rounded-3xl bg-slate-900/95 border-2 ${ring} ${glow} p-7 text-center`}>
        <div className="flex justify-center mb-4"><Icon className={`w-14 h-14 ${color}`} /></div>
        <div className="text-xs uppercase tracking-wide text-brand-ice/60 font-nunito mb-2">
          {serverLabel} • Service notice
        </div>
        <h2 className="text-2xl font-quicksand font-bold text-white mb-3">{alert.title}</h2>
        <p className="text-brand-ice/90 font-nunito whitespace-pre-wrap mb-6">{alert.message}</p>
        <Button
          variant="gold"
          onClick={onDismiss}
          autoFocus
          data-focused="true"
          className="tv-focusable home-focus-surface px-8"
        >
          Got it
        </Button>
      </div>
    </div>
  );
});

PlayerServerAlertDialog.displayName = 'PlayerServerAlertDialog';
export default PlayerServerAlertDialog;
