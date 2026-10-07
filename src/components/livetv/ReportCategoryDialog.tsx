import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Flag, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { useSupportTickets } from '@/hooks/useSupportTickets';
import { supabase } from '@/integrations/supabase/client';
import { trackEvent } from '@/lib/analytics';
import { withAppInfo } from '@/lib/appInfo';
import { isDemo, demoDialogMsg } from '@/lib/demoMode';
import type { XtreamCreds } from '@/lib/xtream';

interface Props {
  categoryName: string;
  categoryId: string;
  /** The service the category is on ("Vibez"), when the box has more than one: goes into the ticket. */
  serviceLabel?: string;
  /** The line the category is on: its username, service and connections go into the ticket (never its password). */
  line?: XtreamCreds;
  /** The category shows ⚠️ right now: "It's working now" leads. */
  isDown?: boolean;
  /** "Report category down" was chosen: the caller tells the other boxes. */
  onReportedDown: () => void;
  /** "It's working now": the caller clears it for everyone. */
  onClearDown: () => void;
  onClose: () => void;
}

/**
 * Hold OK (or the Menu key) on a category in Live TV: a short menu to report
 * the whole category down. Every channel in it then shows as down on every
 * box, with the same warning before it plays, and the support desk gets a
 * ticket, as with "Channel down". Owns the remote while open: ▲ ▼ move, OK
 * chooses, Back closes. OK is taken only once the press that opened the menu
 * has been let go.
 */
const ReportCategoryDialog = memo(({ categoryName, categoryId, serviceLabel, line, isDown = false, onReportedDown, onClearDown, onClose }: Props) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { account } = usePlayerAccount();
  const { createTicket } = useSupportTickets(user);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);
  const armedRef = useRef(false);

  const report = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      if (isDemo()) {
        toast({ title: t('live.toast.liveDemoTitle'), description: demoDialogMsg() });
        onClose();
        return;
      }
      try { onReportedDown(); } catch { /* ignore */ }
      try { trackEvent('category_report', 'player', { category: categoryName, service: serviceLabel ?? null }); } catch { void 0; }
      // For the support staff: English, the same fields as a channel report.
      const lines = [
        `Category: ${categoryName}`,
        'Channel Name: (whole category)',
        'Issue: Category down',
        '',
      ];
      if (serviceLabel) lines.push(`Service: ${serviceLabel}`);
      lines.push(`Category ID: ${categoryId}`);
      if (account) lines.push(`Player account: ${account.username}${account.serverLabel ? ' @ ' + account.serverLabel : ''}`);
      lines.push('Reported from the player.');
      const message = await withAppInfo(lines.join('\n'), line ? { lines: [line] } : {});
      const subject = `Category down: ${categoryName}`;
      if (user) {
        await createTicket(subject, message, { discordKind: 'channel_report' });
      } else {
        const { error } = await supabase.functions.invoke('report-channel', { body: { subject: `[Channel Report] ${subject}`, message } });
        if (error) throw error;
      }
      try { trackEvent('ticket_create', 'support', { source: 'category_report', has_user: !!user }); } catch { void 0; }
      toast({ title: t('live.report.categorySentTitle'), description: t('live.report.categorySentDesc') });
      onClose();
    } catch (e) {
      // The others were told already; only the ticket failed.
      submittedRef.current = false;
      setSubmitting(false);
      toast({ title: t('live.report.failedTitle'), description: (e as Error)?.message || t('live.report.failedDesc'), variant: 'destructive' });
    }
  }, [account, categoryId, categoryName, createTicket, line, onClose, onReportedDown, serviceLabel, t, toast, user]);

  // Taken once, as in the channel menu: a row appearing under the highlight
  // would move it onto a different row than the viewer picked.
  const [downAtOpen] = useState(isDown);
  const rows: Array<{ id: string; label: string; icon: typeof Flag; run: () => void }> = [
    ...(downAtOpen ? [{
      id: 'clear',
      label: t('live.report.clearWarning'),
      icon: CheckCircle2,
      run: () => {
        onClearDown();
        try { trackEvent('report_clear', 'player', { target: 'category', category: categoryName }); } catch { void 0; }
        toast({ title: t('live.report.thanksTitle'), description: t('live.report.thanksDesc') });
        onClose();
      },
    }] : []),
    { id: 'report', label: t('live.report.reportCategory'), icon: Flag, run: () => { void report(); } },
    { id: 'cancel', label: t('common.cancel'), icon: X, run: onClose },
  ];
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [focus, setFocus] = useState(0);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const ok = e.key === 'Enter' || e.key === ' ';
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (isBack) {
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        if (!submittingRef.current) onClose();
        return;
      }
      const n = rowsRef.current.length;
      if (e.key === 'ArrowDown') { setFocus((i) => (i + 1) % n); return; }
      if (e.key === 'ArrowUp') { setFocus((i) => (i - 1 + n) % n); return; }
      // The hold that opened this: its repeats, and anything before it is let go.
      if (ok && !e.repeat && armedRef.current && !submittingRef.current) rowsRef.current[focusRef.current]?.run();
    };
    const onUp = (e: KeyboardEvent) => { armedRef.current = true; e.stopPropagation(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, [onClose]);

  return (
    <div
      className="fixed z-[80] flex items-center justify-center bg-black/75"
      style={{ top: 0, right: 0, bottom: 0, left: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-category-menu=""
        className="w-[min(92vw,520px)] rounded-2xl bg-brand-navy/95 border border-brand-gold/40 shadow-[0_0_40px_rgba(245,200,80,0.25)] p-6 text-white"
      >
        <div className="flex items-center gap-3 mb-4 min-w-0">
          <AlertTriangle className="w-6 h-6 text-brand-gold flex-shrink-0" />
          <h2 className="font-quicksand font-bold text-xl truncate min-w-0">
            {t('live.report.categoryMenuTitle')} — <span className="text-brand-gold">{categoryName}</span>
          </h2>
        </div>
        <div className="space-y-2">
          {rows.map((row, i) => {
            const focused = focus === i;
            const Icon = row.icon;
            const isCancel = row.id === 'cancel';
            return (
              <button
                key={row.id}
                type="button"
                data-focused={focused ? 'true' : 'false'}
                onMouseEnter={() => setFocus(i)}
                onClick={() => row.run()}
                disabled={submitting}
                className={`tv-ring w-full text-left px-4 py-3 rounded-xl border border-white/10 font-nunito font-semibold transition-transform duration-150 ease-out flex items-center gap-3 ${
                  focused ? (isCancel ? 'bg-white/15 scale-[1.02] z-10' : 'bg-brand-gold/25 scale-[1.02] z-10') : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                {row.id === 'report' && submitting
                  ? <Loader2 className="w-5 h-5 text-brand-gold flex-shrink-0 animate-spin" />
                  : <Icon className="w-5 h-5 text-brand-gold flex-shrink-0" />}
                <span className="min-w-0 truncate">{row.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-brand-ice/70 font-nunito">{t('live.report.categoryBody')}</p>
        <p className="mt-2 text-xs text-brand-ice/60 font-nunito">{t('live.report.categoryFooter')}</p>
      </div>
    </div>
  );
});

ReportCategoryDialog.displayName = 'ReportCategoryDialog';
export default ReportCategoryDialog;
