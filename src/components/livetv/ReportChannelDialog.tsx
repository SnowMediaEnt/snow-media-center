import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle, Star, StarOff, Flag, X, RefreshCw, CheckCircle2, Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { useSupportTickets } from '@/hooks/useSupportTickets';
import { supabase } from '@/integrations/supabase/client';
import { trackEvent } from '@/lib/analytics';
import { withAppInfo } from '@/lib/appInfo';
import { isDemo, demoDialogMsg } from '@/lib/demoMode';

interface Props {
  channelName: string;
  channelId?: number | string;
  categoryName?: string;
  isFavorite?: boolean;
  /** Left out where a channel can't be a favourite from here (Game Day): the row is not shown. */
  onToggleFavorite?: () => void;
  /**
   * Live TV, where recording is offered: a "Record…" row. The caller closes
   * this menu and opens the recording options (RecordDialog).
   */
  onRecord?: () => void;
  /** The channel is recording now: the row says so, and the options offer Stop. */
  recording?: boolean;
  /** The service the channel is on ("Vibez"), when the box has more than one: goes into the ticket. */
  serviceLabel?: string;
  /**
   * Favourite only. Looks the channel up again on the service by name and
   * re-points the favourite at its current stream, for the case where the
   * provider swapped the link behind it. Resolves with what happened so the
   * dialog can say it.
   */
  onRefreshFavorite?: () => Promise<'fixed' | 'same' | 'missing' | 'failed'>;
  onOpenBufferingGuide?: () => void;
  /** Open past the menu with a reason picked (the assistant's report). */
  initialChoice?: Choice;
  initialNote?: string;
  /** "Channel down" was sent: the caller tells the other boxes (⚠️). */
  onReportedDown?: () => void;
  /** The channel shows ⚠️ right now … */
  isDown?: boolean;
  /** … and the viewer says it works: clear it for everyone. */
  onClearDown?: () => void;
  onClose: () => void;
}

// The choices are values the ticket text and the logic use, so they stay English;
// the buttons show t(CHOICE_KEY[choice]).
type Choice = 'Channel down' | 'Channel buffering' | 'No audio' | 'Other';
const CHOICES: Choice[] = ['Channel down', 'Channel buffering', 'No audio', 'Other'];
const CHOICE_KEY: Record<Choice, string> = {
  'Channel down': 'live.report.choiceDown',
  'Channel buffering': 'live.report.choiceBuffering',
  'No audio': 'live.report.choiceNoAudio',
  'Other': 'live.report.choiceOther',
};

// Buffering is the one reason with two answers: most of the time the guide
// fixes it on the spot, and when it does not, the report still has to reach
// us. Both are offered; neither is assumed.
const BUFFERING_OPTIONS = ['live.report.openGuide', 'live.report.submitTicket'] as const;

type Step = 'menu' | 'reasons' | 'buffering' | 'other';

/**
 * D-pad / focus-trapped dialog: Channel Options → Report → reason → submit.
 * Owns its own keyboard while mounted.
 */
const ReportChannelDialog = memo(({
  channelName,
  channelId,
  categoryName,
  isFavorite,
  onToggleFavorite,
  onRecord,
  recording = false,
  serviceLabel,
  onRefreshFavorite,
  onOpenBufferingGuide,
  initialChoice,
  initialNote,
  onReportedDown,
  isDown = false,
  onClearDown,
  onClose,
}: Props) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const canRefresh = !!isFavorite && !!onRefreshFavorite;
  const refreshNow = useCallback(async () => {
    if (!onRefreshFavorite || refreshing) return;
    setRefreshing(true);
    try {
      const r = await onRefreshFavorite();
      toast(r === 'fixed'
        ? { title: t('live.report.refreshedTitle'), description: t('live.report.refreshedDesc') }
        : r === 'same'
          ? { title: t('live.report.alreadyCurrentTitle'), description: t('live.report.alreadyCurrentDesc') }
          : r === 'missing'
            ? { title: t('live.report.missingTitle'), description: t('live.report.missingDesc') }
            : { title: t('live.report.refreshFailedTitle'), description: t('live.report.refreshFailedDesc') });
    } finally {
      setRefreshing(false);
      onClose();
    }
  }, [onRefreshFavorite, refreshing, toast, onClose, t]);
  const { user } = useAuth();
  const { account } = usePlayerAccount();
  const { createTicket } = useSupportTickets(user);

  const [step, setStep] = useState<Step>(initialChoice === 'Other' ? 'other' : initialChoice ? 'reasons' : 'menu');
  const atStep = (s: Step) => step === s;
  // Focus index:
  //   menu:   the row in menuItems, top to bottom
  //   reasons: 0..3 = CHOICES, 4 = Cancel
  //   other:  0 = textarea, 1 = Submit, 2 = Cancel
  const [focusIdx, setFocusIdx] = useState(initialChoice && initialChoice !== 'Other' ? Math.max(0, CHOICES.indexOf(initialChoice)) : initialChoice === 'Other' ? 1 : 0);
  const [note, setNote] = useState(initialNote ?? '');
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const submittedRef = useRef(false);
  // Guard the opening long-press: ignore Enter/Space from key-repeat, and
  // don't accept any activation until the user RELEASES the button once.
  const armedRef = useRef(false);

  // The ticket text below is for the support staff, so it stays in English.
  const buildMessage = useCallback(
    (choice: Choice, otherNote: string) => {
      const trimmedNote = otherNote.trim();
      const issue = choice === 'Other'
        ? (trimmedNote || 'Other')
        : (trimmedNote ? `${choice} — ${trimmedNote}` : choice);
      const lines = [
        `Category: ${categoryName || 'Unknown'}`,
        `Channel Name: ${channelName}`,
        `Issue: ${issue}`,
        '',
      ];
      if (serviceLabel) lines.push(`Service: ${serviceLabel}`);
      if (channelId != null && String(channelId).length) lines.push(`Channel ID: ${channelId}`);
      if (account) {
        lines.push(`Player account: ${account.username}${account.serverLabel ? ' @ ' + account.serverLabel : ''}`);
      }
      lines.push('Reported from the player.');
      return lines.join('\n');
    },
    [channelId, channelName, categoryName, account, serviceLabel],
  );

  // The Channel Options rows. "It's working now" leads when the channel
  // showed ⚠️ as the dialog opened: anyone watching it can clear it for
  // everyone. Taken once: the live flag changes under the open dialog (a
  // refresh, a box that played it fine), and a row appearing or vanishing
  // would move the highlight onto a different row than the viewer picked.
  const [downAtOpen] = useState(isDown);
  const menuItems: Array<{ id: string; label: string; icon: typeof Flag; run: () => void }> = [
    ...(downAtOpen && onClearDown ? [{
      id: 'clear',
      label: t('live.report.clearWarning'),
      icon: CheckCircle2,
      run: () => { onClearDown(); toast({ title: t('live.report.thanksTitle'), description: t('live.report.thanksDesc') }); onClose(); },
    }] : []),
    { id: 'report', label: t('live.report.reportChannel'), icon: Flag, run: () => { setStep('reasons'); setFocusIdx(0); } },
    ...(onToggleFavorite ? [{ id: 'fav', label: isFavorite ? t('live.report.removeFavorite') : t('live.report.addFavorite'), icon: isFavorite ? StarOff : Star, run: () => { onToggleFavorite(); onClose(); } }] : []),
    ...(onRecord ? [{ id: 'record', label: recording ? t('live.report.stopRecording') : t('live.report.recordChannel'), icon: Circle, run: () => { onRecord(); } }] : []),
    ...(canRefresh ? [{ id: 'refresh', label: refreshing ? t('live.report.refreshing') : t('live.report.refreshLink'), icon: RefreshCw, run: () => { void refreshNow(); } }] : []),
    { id: 'cancel', label: t('common.cancel'), icon: X, run: onClose },
  ];
  const menuItemsRef = useRef(menuItems);
  menuItemsRef.current = menuItems;

  const submit = useCallback(
    async (choice: Choice, otherNote = '') => {
      if (submittedRef.current || submitting) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        // Demo mode: acknowledge, but never file a real report/ticket.
        if (isDemo()) {
          toast({ title: t('live.toast.liveDemoTitle'), description: demoDialogMsg() });
          onClose();
          return;
        }
        if (choice === 'Channel down') { try { onReportedDown?.(); } catch { /* ignore */ } }
        const subject = `Channel issue: ${channelName}`;
        // App version, build and device lead the message; the report's own fields follow as they were.
        const message = await withAppInfo(buildMessage(choice, otherNote));
        if (user) {
          await createTicket(subject, message, { discordKind: 'channel_report' });
        } else {
          const { error } = await supabase.functions.invoke('report-channel', {
            body: {
              subject: `[Channel Report] ${subject}`,
              message,
            },
          });
          if (error) throw error;
        }
        try { trackEvent('ticket_create', 'support', { source: 'player_report', has_user: !!user }); } catch { void 0; }
        toast({ title: t('live.report.sentTitle') });
        onClose();
      } catch (e) {
        submittedRef.current = false;
        setSubmitting(false);
        toast({
          title: t('live.report.failedTitle'),
          description: (e as Error)?.message || t('live.report.failedDesc'),
          variant: 'destructive',
        });
      }
    },
    [createTicket, buildMessage, channelName, onClose, onReportedDown, submitting, toast, user, t],
  );

  const onPick = useCallback(
    (choice: Choice) => {
      if (choice === 'Channel buffering') {
        setStep('buffering');
        setFocusIdx(0);
        return;
      }
      if (choice === 'Other') {
        setStep('other');
        setFocusIdx(0);
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      void submit(choice);
    },
    [submit, onOpenBufferingGuide],
  );

  // Owns the keyboard while open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      if (isBack) {
        e.preventDefault();
        e.stopPropagation();
        if (step === 'other' && !submitting) {
          setStep('reasons');
          setFocusIdx(CHOICES.length); // land on Cancel of reasons
          setNote('');
          return;
        }
        if (step === 'buffering' && !submitting) {
          setStep('reasons');
          setFocusIdx(CHOICES.indexOf('Channel buffering'));
          return;
        }
        if (step === 'reasons' && !submitting) {
          // Back to the row this came from.
          setStep('menu');
          setFocusIdx(Math.max(0, menuItemsRef.current.findIndex((m) => m.id === 'report')));
          return;
        }
        onClose();
        return;
      }

      // Ignore Enter/Space from the opening hold (repeat) or before first release.
      if ((e.key === 'Enter' || e.key === ' ') && (e.repeat || !armedRef.current)) {
        e.preventDefault(); e.stopPropagation();
        return;
      }


      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      // MENU (menuItemsRef: the rows on screen, top to bottom)
      if (step === 'menu') {
        const items = menuItemsRef.current;
        const count = items.length;
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i + 1) % count);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i - 1 + count) % count);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation();
          items[focusIdx]?.run();
          return;
        }
        e.stopPropagation();
        return;
      }

      // BUFFERING: guide, ticket, or back to the reasons
      if (step === 'buffering') {
        const count = BUFFERING_OPTIONS.length + 1;
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i + 1) % count);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i - 1 + count) % count);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation();
          if (focusIdx === 0) onOpenBufferingGuide?.();
          else if (focusIdx === 1) void submit('Channel buffering');
          else { setStep('reasons'); setFocusIdx(CHOICES.indexOf('Channel buffering')); }
          return;
        }
        e.stopPropagation();
        return;
      }

      // REASONS
      if (step === 'reasons') {
        const count = CHOICES.length + 1;
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i + 1) % count);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i - 1 + count) % count);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation();
          if (focusIdx < CHOICES.length) onPick(CHOICES[focusIdx]);
          else onClose();
          return;
        }
        e.stopPropagation();
        return;
      }

      // OTHER (free text)
      if (e.key === 'ArrowDown' && !typing) {
        e.preventDefault(); e.stopPropagation();
        setFocusIdx(i => Math.min(2, i + 1));
        return;
      }
      if (e.key === 'ArrowUp' && !typing) {
        e.preventDefault(); e.stopPropagation();
        setFocusIdx(i => Math.max(0, i - 1));
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && !typing) {
        e.preventDefault(); e.stopPropagation();
        if (focusIdx === 0) {
          inputRef.current?.focus();
        } else if (focusIdx === 1) {
          void submit('Other', note);
        } else if (focusIdx === 2) {
          onClose();
        }
        return;
      }
      if (typing) e.stopPropagation();
    };
    const onKeyUp = () => { armedRef.current = true; };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [step, focusIdx, note, onPick, onClose, submit, submitting, onToggleFavorite, onOpenBufferingGuide, canRefresh, refreshNow]);

  // Auto-blur textarea so D-pad navigation works again
  useEffect(() => {
    if (step === 'other' && focusIdx !== 0) inputRef.current?.blur();
  }, [step, focusIdx]);

  const title =
    step === 'menu' ? t('live.report.menuTitle')
    : step === 'reasons' ? t('live.report.reasonsTitle')
    : step === 'buffering' ? t('live.report.bufferingTitle')
    : t('live.report.otherTitle');

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-[min(92vw,520px)] rounded-2xl bg-brand-navy/95 border border-brand-gold/40 shadow-[0_0_40px_rgba(245,200,80,0.25)] p-6 text-white"
      >
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-brand-gold flex-shrink-0" />
          <h2 className="font-quicksand font-bold text-xl truncate">
            {title} — <span className="text-brand-gold">{channelName}</span>
          </h2>
        </div>

        {atStep('menu') && (
          <div className="space-y-2">
            {menuItems.map((item, i, all) => {
              const focused = focusIdx === i;
              const Icon = item.icon;
              const isCancel = i === all.length - 1;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-focused={focused ? 'true' : 'false'}
                  onMouseEnter={() => setFocusIdx(i)}
                  onClick={() => item.run()}
                  className={`tv-ring w-full text-left px-4 py-3 rounded-xl border border-white/10 font-nunito font-semibold transition-transform duration-150 ease-out flex items-center gap-3 ${
                    focused
                      ? (isCancel
                          ? 'bg-white/15 scale-[1.02] z-10'
                          : 'bg-brand-gold/25 scale-[1.02] z-10')
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <Icon className="w-5 h-5 text-brand-gold flex-shrink-0" />
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {atStep('reasons') && (
          <div className="space-y-2">
            {CHOICES.map((c, i) => {
              const focused = focusIdx === i;
              return (
                <button
                  key={c}
                  type="button"
                  data-focused={focused ? 'true' : 'false'}
                  onMouseEnter={() => setFocusIdx(i)}
                  onClick={() => onPick(c)}
                  disabled={submitting}
                  className={`tv-ring w-full text-left px-4 py-3 rounded-xl border border-white/10 font-nunito font-semibold transition-transform duration-150 ease-out ${
                    focused
                      ? 'bg-brand-gold/25 scale-[1.02] z-10'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {t(CHOICE_KEY[c])}
                </button>
              );
            })}

            <button
              type="button"
              data-focused={focusIdx === CHOICES.length ? 'true' : 'false'}
              onMouseEnter={() => setFocusIdx(CHOICES.length)}
              onClick={onClose}
              disabled={submitting}
              className={`tv-ring w-full px-4 py-3 rounded-xl border border-white/10 font-nunito transition-transform duration-150 ease-out ${
                focusIdx === CHOICES.length
                  ? 'bg-white/15 scale-[1.02] z-10'
                  : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              {t('common.cancel')}
            </button>
          </div>
        )}

        {atStep('buffering') && (
          <div className="space-y-2">
            <p className="text-sm text-brand-ice/80 font-nunito mb-3">
              {t('live.report.bufferingBody')}
            </p>
            {BUFFERING_OPTIONS.map((labelKey, i) => {
              const focused = focusIdx === i;
              return (
                <button
                  key={labelKey}
                  type="button"
                  data-focused={focused ? 'true' : 'false'}
                  onMouseEnter={() => setFocusIdx(i)}
                  onClick={() => { if (i === 0) onOpenBufferingGuide?.(); else void submit('Channel buffering'); }}
                  disabled={submitting}
                  className={`tv-ring w-full text-left px-4 py-3 rounded-xl border border-white/10 font-nunito font-semibold transition-transform duration-150 ease-out flex items-center gap-2 ${
                    focused
                      ? 'bg-brand-gold/25 scale-[1.02] z-10'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {i === 1 && submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t(labelKey)}
                </button>
              );
            })}
            <button
              type="button"
              data-focused={focusIdx === BUFFERING_OPTIONS.length ? 'true' : 'false'}
              onMouseEnter={() => setFocusIdx(BUFFERING_OPTIONS.length)}
              onClick={() => { setStep('reasons'); setFocusIdx(CHOICES.indexOf('Channel buffering')); }}
              disabled={submitting}
              className={`tv-ring w-full px-4 py-3 rounded-xl border border-white/10 font-nunito transition-transform duration-150 ease-out ${
                focusIdx === BUFFERING_OPTIONS.length
                  ? 'bg-white/15 scale-[1.02] z-10'
                  : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              {t('common.back')}
            </button>
          </div>
        )}

        {atStep('other') && (
          <div className="space-y-3">
            <label className="block text-sm text-brand-ice/80 font-nunito">
              {t('live.report.describeLabel')}
            </label>
            <textarea
              ref={inputRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t('live.report.placeholder')}
              data-focused={focusIdx === 0 ? 'true' : 'false'}
              onFocus={() => setFocusIdx(0)}
              className="tv-ring w-full rounded-xl bg-black/40 text-white border border-white/20 px-3 py-2 font-nunito text-sm resize-none focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-focused={focusIdx === 1 ? 'true' : 'false'}
                onMouseEnter={() => setFocusIdx(1)}
                onClick={() => void submit('Other', note)}
                disabled={submitting}
                className={`tv-ring tv-ring-contrast flex-1 px-4 py-3 rounded-xl border border-brand-gold/40 font-nunito font-semibold transition-transform duration-150 ease-out flex items-center justify-center gap-2 ${
                  focusIdx === 1
                    ? 'bg-brand-gold/30 scale-[1.02] z-10'
                    : 'bg-brand-gold/15'
                }`}
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('live.report.sendBtn')}
              </button>
              <button
                type="button"
                data-focused={focusIdx === 2 ? 'true' : 'false'}
                onMouseEnter={() => setFocusIdx(2)}
                onClick={onClose}
                disabled={submitting}
                className={`tv-ring px-4 py-3 rounded-xl border border-white/10 font-nunito transition-transform duration-150 ease-out ${
                  focusIdx === 2
                    ? 'bg-white/15 scale-105 z-10'
                    : 'bg-white/5'
                }`}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        <p className="mt-4 text-xs text-brand-ice/60 font-nunito">
          {t('live.report.footer')}
        </p>
      </div>
    </div>
  );
});

ReportChannelDialog.displayName = 'ReportChannelDialog';
export default ReportChannelDialog;
