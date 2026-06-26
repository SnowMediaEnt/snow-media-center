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
        className="max-w-3xl w-[92vw] bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-2 border-brand-gold/60 text-white ring-4 ring-brand-gold/30 shadow-[0_0_60px_rgba(212,175,55,0.35)] p-0 overflow-hidden"
      >
        <div className="bg-gradient-to-r from-brand-gold/30 via-yellow-500/20 to-brand-gold/30 px-8 py-5 border-b border-brand-gold/40 flex items-center gap-4">
          <Zap className="w-10 h-10 text-brand-gold drop-shadow" />
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight tracking-tight">
            {title}
          </h2>
        </div>

        <ol className="px-10 py-7 space-y-4">
          {PRE_EVENT_STEPS.map((step, i) => (
            <li
              key={i}
              className="flex items-start gap-5 text-2xl sm:text-[1.75rem] font-semibold text-slate-100"
            >
              <span className="flex-shrink-0 w-12 h-12 rounded-full bg-brand-gold text-slate-900 flex items-center justify-center font-extrabold text-2xl shadow-lg">
                {i + 1}
              </span>
              <span className="pt-1">{step}</span>
            </li>
          ))}
        </ol>

        <div className="px-8 py-5 border-t border-brand-gold/30 bg-slate-950/60 flex justify-center">
          <Button
            ref={okRef}
            variant="gold"
            onClick={onDismiss}
            className="min-w-[200px] text-xl font-bold py-6 ring-4 ring-brand-ice/40 scale-100 focus:ring-brand-ice focus:scale-105 transition"
          >
            OK, got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default memo(PreEventStepsDialog);
