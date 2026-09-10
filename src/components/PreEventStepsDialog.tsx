import { memo } from 'react';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import NoticeLayer from '@/components/ui/notice-layer';
import { PRE_EVENT_STEPS, DEFAULT_PRE_EVENT_HEADLINE } from '@/hooks/usePreEventAlert';
import { trackEvent } from '@/lib/analytics';

interface PreEventStepsDialogProps {
  open: boolean;
  headline?: string;
  onDismiss: () => void;
}

/**
 * Pre-event checklist for PPV nights. Driven by a single app_alerts row, which
 * an admin toggles — and by a realtime subscription, so it can appear at any
 * moment on a TV that is already switched on.
 *
 * That is exactly why it must not be a modal. As a Radix dialog it set
 * pointer-events:none on document.body, so switching the row on left every
 * viewer with a dead app: no clicks, no typing, no keyboard. It had no
 * currentView gate either, so it landed over the Player mid-stream.
 */
const PreEventStepsDialog = ({ open, headline, onDismiss }: PreEventStepsDialogProps) => {
  const handleDismiss = () => {
    try { trackEvent('alert_popup_action', 'alerts', { alert: 'pre_event', action: 'ok' }); } catch { void 0; }
    onDismiss();
  };

  const title = (headline && headline.trim()) || DEFAULT_PRE_EVENT_HEADLINE;

  return (
    <NoticeLayer open={open} labelledBy="smc-pre-event-title" onDismiss={handleDismiss}>
      <div className="max-h-[85vh] rounded-lg bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-2 border-brand-gold/60 text-white ring-4 ring-brand-gold/30 shadow-[0_0_60px_rgba(212,175,55,0.35)] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-brand-gold/30 via-yellow-500/20 to-brand-gold/30 px-6 py-4 border-b border-brand-gold/40 flex items-center gap-3">
          <Zap className="w-6 h-6 text-brand-gold drop-shadow" />
          <h2 id="smc-pre-event-title" className="text-2xl font-bold text-white leading-tight tracking-tight">
            {title}
          </h2>
        </div>
        <ol className="px-6 py-5 space-y-3 overflow-y-auto">
          {PRE_EVENT_STEPS.map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-base font-medium text-slate-100">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-gold text-slate-900 flex items-center justify-center font-bold text-base shadow-lg">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <div className="px-6 py-4 border-t border-brand-gold/30 bg-slate-950/60 flex justify-center">
          <Button
            autoFocus
            variant="gold"
            onClick={handleDismiss}
            className="min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 focus:ring-brand-ice focus:scale-105 transition"
          >
            OK, got it
          </Button>
        </div>
      </div>
    </NoticeLayer>
  );
};

export default memo(PreEventStepsDialog);
