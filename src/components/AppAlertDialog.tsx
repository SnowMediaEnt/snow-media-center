import { AlertTriangle, Info, AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { AppAlert } from '@/hooks/useAppAlerts';

interface AppAlertDialogProps {
  alert: AppAlert | null;
  appName?: string;
  open: boolean;
  onDismiss: () => void;
  onContinue: () => void;
}

const severityStyles: Record<
  AppAlert['severity'],
  { Icon: typeof AlertTriangle; color: string; ring: string }
> = {
  info: { Icon: Info, color: 'text-blue-400', ring: 'ring-blue-500/40' },
  warning: { Icon: AlertTriangle, color: 'text-yellow-400', ring: 'ring-yellow-500/40' },
  critical: { Icon: AlertOctagon, color: 'text-red-400', ring: 'ring-red-500/40' },
};

const AppAlertDialog = ({ alert, appName, open, onDismiss, onContinue }: AppAlertDialogProps) => {
  if (!alert) return null;
  const style = severityStyles[alert.severity] || severityStyles.warning;
  const { Icon } = style;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDismiss(); }}>
      <DialogContent className={`bg-slate-900 border-slate-700 text-white ring-2 ${style.ring}`}>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <Icon className={`w-7 h-7 ${style.color}`} />
            <DialogTitle className="text-2xl text-white">{alert.title}</DialogTitle>
          </div>
          <DialogDescription className="text-slate-300 text-base whitespace-pre-wrap">
            {appName ? <span className="block mb-2 text-slate-400 text-sm">Heads up about <strong>{appName}</strong>:</span> : null}
            {alert.message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onDismiss} className="bg-slate-800 border-slate-600 text-white hover:bg-slate-700">
            Dismiss
          </Button>
          <Button variant="gold" onClick={onContinue}>
            Continue Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AppAlertDialog;
