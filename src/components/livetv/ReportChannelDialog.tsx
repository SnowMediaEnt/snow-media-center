import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle, Star, StarOff, Flag, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { useSupportTickets } from '@/hooks/useSupportTickets';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  channelName: string;
  channelId?: number | string;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onOpenBufferingGuide?: () => void;
  onClose: () => void;
}

type Choice = 'Channel down' | 'Channel buffering' | 'No audio' | 'Other';
const CHOICES: Choice[] = ['Channel down', 'Channel buffering', 'No audio', 'Other'];

type Step = 'menu' | 'reasons' | 'other';

/**
 * D-pad / focus-trapped dialog: Channel Options → Report → reason → submit.
 * Owns its own keyboard while mounted.
 */
const ReportChannelDialog = memo(({
  channelName,
  channelId,
  isFavorite,
  onToggleFavorite,
  onOpenBufferingGuide,
  onClose,
}: Props) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { account } = usePlayerAccount();
  const { createTicket } = useSupportTickets(user);

  const [step, setStep] = useState<Step>('menu');
  // Focus index:
  //   menu:   0 = Report, 1 = Fav toggle, 2 = Cancel
  //   reasons: 0..3 = CHOICES, 4 = Cancel
  //   other:  0 = textarea, 1 = Submit, 2 = Cancel
  const [focusIdx, setFocusIdx] = useState(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const submittedRef = useRef(false);
  // Guard the opening long-press: ignore Enter/Space from key-repeat, and
  // don't accept any activation until the user RELEASES the button once.
  const armedRef = useRef(false);

  const buildMessage = useCallback(
    (choice: Choice, otherNote: string) => {
      const idPart = channelId != null && String(channelId).length ? ` (${channelId})` : '';
      const notePart = otherNote.trim() ? ` Note: ${otherNote.trim()}.` : '';
      const acct = account
        ? ` Player account: ${account.username}${account.serverLabel ? ' @ ' + account.serverLabel : ''}.`
        : '';
      return `Problem: ${choice}. Channel: ${channelName}${idPart}.${notePart}${acct} Reported from the player.`;
    },
    [channelId, channelName, account],
  );

  const submit = useCallback(
    async (choice: Choice, otherNote = '') => {
      if (submittedRef.current || submitting) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        const subject = `Channel issue: ${channelName}`;
        const message = buildMessage(choice, otherNote);
        if (user) {
          await createTicket(subject, message);
        } else {
          const { error } = await supabase.functions.invoke('report-channel', {
            body: {
              subject: `[Channel Report] ${subject}`,
              message,
            },
          });
          if (error) throw error;
        }
        toast({ title: 'Report sent — thanks!' });
        onClose();
      } catch (e) {
        submittedRef.current = false;
        setSubmitting(false);
        toast({
          title: 'Could not send report',
          description: (e as Error)?.message || 'Please try again, or email support@snowmediaent.com.',
          variant: 'destructive',
        });
      }
    },
    [createTicket, buildMessage, channelName, onClose, submitting, toast, user],
  );

  const onPick = useCallback(
    (choice: Choice) => {
      if (choice === 'Channel buffering') {
        onOpenBufferingGuide?.();
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
        if (step === 'reasons' && !submitting) {
          setStep('menu');
          setFocusIdx(0);
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

      // MENU
      if (step === 'menu') {
        const count = 3;
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
          if (focusIdx === 0) {
            setStep('reasons');
            setFocusIdx(0);
          } else if (focusIdx === 1) {
            onToggleFavorite?.();
            onClose();
          } else {
            onClose();
          }
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
  }, [step, focusIdx, note, onPick, onClose, submit, submitting, onToggleFavorite]);

  // Auto-blur textarea so D-pad navigation works again
  useEffect(() => {
    if (step === 'other' && focusIdx !== 0) inputRef.current?.blur();
  }, [step, focusIdx]);

  const title =
    step === 'menu' ? 'Channel Options'
    : step === 'reasons' ? 'Report a problem'
    : 'Describe the problem';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm"
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

        {step === 'menu' && (
          <div className="space-y-2">
            {[
              { label: 'Report Channel', icon: Flag },
              { label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites', icon: isFavorite ? StarOff : Star },
              { label: 'Cancel', icon: X },
            ].map((item, i) => {
              const focused = focusIdx === i;
              const Icon = item.icon;
              const isCancel = i === 2;
              return (
                <button
                  key={item.label}
                  type="button"
                  data-focused={focused ? 'true' : 'false'}
                  onMouseEnter={() => setFocusIdx(i)}
                  onClick={() => {
                    if (i === 0) { setStep('reasons'); setFocusIdx(0); }
                    else if (i === 1) { onToggleFavorite?.(); onClose(); }
                    else onClose();
                  }}
                  className={`tv-focusable w-full text-left px-4 py-3 rounded-xl font-nunito font-semibold transition-transform duration-150 flex items-center gap-3 ${
                    focused
                      ? (isCancel
                          ? 'bg-white/15 ring-2 ring-white/60 scale-[1.02]'
                          : 'bg-brand-gold/25 ring-2 ring-brand-gold scale-[1.02] shadow-[0_0_14px_rgba(245,200,80,0.4)]')
                      : 'bg-white/5 hover:bg-white/10 border border-white/10'
                  }`}
                >
                  <Icon className="w-5 h-5 text-brand-gold" />
                  {item.label}
                </button>
              );
            })}
          </div>
        )}

        {step === 'reasons' && (
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
                  className={`tv-focusable w-full text-left px-4 py-3 rounded-xl font-nunito font-semibold transition-transform duration-150 ${
                    focused
                      ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-[1.02] shadow-[0_0_14px_rgba(245,200,80,0.4)]'
                      : 'bg-white/5 hover:bg-white/10 border border-white/10'
                  }`}
                >
                  {c}
                </button>
              );
            })}

            <button
              type="button"
              data-focused={focusIdx === CHOICES.length ? 'true' : 'false'}
              onMouseEnter={() => setFocusIdx(CHOICES.length)}
              onClick={onClose}
              disabled={submitting}
              className={`tv-focusable w-full mt-3 px-4 py-2.5 rounded-xl font-nunito transition-transform duration-150 ${
                focusIdx === CHOICES.length
                  ? 'bg-white/15 ring-2 ring-white/60 scale-[1.02]'
                  : 'bg-white/5 hover:bg-white/10 border border-white/10'
              }`}
            >
              Cancel
            </button>
          </div>
        )}

        {step === 'other' && (
          <div className="space-y-3">
            <label className="block text-sm text-brand-ice/80 font-nunito">
              Describe the problem (optional)
            </label>
            <textarea
              ref={inputRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="What went wrong?"
              data-focused={focusIdx === 0 ? 'true' : 'false'}
              onFocus={() => setFocusIdx(0)}
              className={`tv-focusable w-full rounded-xl bg-black/40 text-white border px-3 py-2 font-nunito text-sm resize-none focus:outline-none ${
                focusIdx === 0
                  ? 'border-brand-gold ring-2 ring-brand-gold'
                  : 'border-white/20'
              }`}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-focused={focusIdx === 1 ? 'true' : 'false'}
                onMouseEnter={() => setFocusIdx(1)}
                onClick={() => void submit('Other', note)}
                disabled={submitting}
                className={`tv-focusable flex-1 px-4 py-2.5 rounded-xl font-nunito font-semibold transition-transform duration-150 flex items-center justify-center gap-2 ${
                  focusIdx === 1
                    ? 'bg-brand-gold/30 ring-2 ring-brand-gold scale-[1.02] shadow-[0_0_14px_rgba(245,200,80,0.4)]'
                    : 'bg-brand-gold/15 border border-brand-gold/40'
                }`}
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Send
              </button>
              <button
                type="button"
                data-focused={focusIdx === 2 ? 'true' : 'false'}
                onMouseEnter={() => setFocusIdx(2)}
                onClick={onClose}
                disabled={submitting}
                className={`tv-focusable px-4 py-2.5 rounded-xl font-nunito transition-transform duration-150 ${
                  focusIdx === 2
                    ? 'bg-white/15 ring-2 ring-white/60 scale-[1.02]'
                    : 'bg-white/5 border border-white/10'
                }`}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <p className="mt-4 text-[11px] text-brand-ice/50 font-nunito">
          Long-press OK or press the Menu key on a channel to open this.
        </p>
      </div>
    </div>
  );
});

ReportChannelDialog.displayName = 'ReportChannelDialog';
export default ReportChannelDialog;
