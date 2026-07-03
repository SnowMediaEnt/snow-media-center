import { memo, useEffect, useRef } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  serverLabel: string;
  days: number;          // <0 = expired; 0..7 = warning window (0 = today)
  onDismiss: () => void;
}

const ExpirationNoticeDialog = memo(({ open, serverLabel, days, onDismiss }: Props) => {
  const okRef = useRef<HTMLButtonElement>(null);
  const expired = days < 0;

  useEffect(() => {
    if (open) setTimeout(() => okRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'Escape', 'Backspace'].includes(e.key) || e.keyCode === 4) {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onDismiss]);

  const title = expired
    ? `Your ${serverLabel} subscription has EXPIRED`
    : days === 0
      ? `Your ${serverLabel} subscription expires TODAY`
      : `Your ${serverLabel} subscription expires in ${days} day${days === 1 ? '' : 's'}`;

  const body = expired
    ? 'Reach out to Snow Media to renew and restore access. You can renew through the store or by contacting support.'
    : 'Reach out to Snow Media to renew and avoid losing access. You can renew through the store or by contacting support.';

  const Icon = expired ? ShieldAlert : AlertTriangle;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDismiss(); }}>
      <DialogContent
        className="max-w-lg w-full bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-2 border-brand-gold/60 text-white ring-4 ring-brand-gold/30 shadow-[0_0_60px_rgba(212,175,55,0.35)] p-0 overflow-hidden flex flex-col"
      >
        <div className={`px-6 py-4 border-b border-brand-gold/40 flex items-center gap-3 ${expired ? 'bg-gradient-to-r from-red-600/40 via-red-500/25 to-red-600/40' : 'bg-gradient-to-r from-brand-gold/30 via-yellow-500/20 to-brand-gold/30'}`}>
          <Icon className={`w-6 h-6 drop-shadow ${expired ? 'text-red-300' : 'text-brand-gold'}`} />
          <h2 className="text-2xl font-bold text-white leading-tight tracking-tight">
            {title}
          </h2>
        </div>

        <p className="px-6 py-5 text-base font-medium text-slate-100 leading-relaxed">
          {body}
        </p>

        <div className="px-6 py-4 border-t border-brand-gold/30 bg-slate-950/60 flex justify-center">
          <Button
            ref={okRef}
            variant="gold"
            onClick={onDismiss}
            className="min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 scale-100 focus:ring-brand-ice focus:scale-105 transition"
          >
            OK, got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

ExpirationNoticeDialog.displayName = 'ExpirationNoticeDialog';
export default ExpirationNoticeDialog;
