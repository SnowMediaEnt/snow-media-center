import { memo, useEffect, useRef } from 'react';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PRE_EVENT_STEPS, DEFAULT_PRE_EVENT_HEADLINE } from '@/hooks/usePreEventAlert';

interface PreEventStepsDialogProps {
  open: boolean;
  headline?: string;
  onDismiss: () => void;
}

const PreEventStepsDialog = ({ open, headline, onDismiss }: PreEventStepsDialogProps) => {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => okRef.current?.focus(), 50);
  }, [open]);

  // D-pad: Enter / OK / Back / Escape all dismiss. Capture phase so background
  // handlers (player, home grid) don't fight us.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'Escape', 'Backspace'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onDismiss]);

  const title = (headline && headline.trim()) || DEFAULT_PRE_EVENT_HEADLINE;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDismiss(); }}>
      <DialogContent
        className="max-w-lg w-full max-h-[85vh] bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-2 border-brand-gold/60 text-white ring-4 ring-brand-gold/30 shadow-[0_0_60px_rgba(212,175,55,0.35)] p-0 overflow-hidden flex flex-col"
      >
        <div className="bg-gradient-to-r from-brand-gold/30 via-yellow-500/20 to-brand-gold/30 px-6 py-4 border-b border-brand-gold/40 flex items-center gap-3">
          <Zap className="w-6 h-6 text-brand-gold drop-shadow" />
          <h2 className="text-2xl font-bold text-white leading-tight tracking-tight">
            {title}
          </h2>
        </div>

        <ol className="px-6 py-5 space-y-3 overflow-y-auto">
          {PRE_EVENT_STEPS.map((step, i) => (
            <li
              key={i}
              className="flex items-start gap-3 text-base font-medium text-slate-100"
            >
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-gold text-slate-900 flex items-center justify-center font-bold text-base shadow-lg">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

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
};

export default memo(PreEventStepsDialog);
