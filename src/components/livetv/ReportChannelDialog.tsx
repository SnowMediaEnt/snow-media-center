import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { useSupportTickets } from '@/hooks/useSupportTickets';

interface Props {
  channelName: string;
  channelId?: number | string;
  onClose: () => void;
}

type Choice = 'Buffering' | 'No audio' | 'Other';
const CHOICES: Choice[] = ['Buffering', 'No audio', 'Other'];

/**
 * D-pad / focus-trapped dialog to file a "Report a problem" ticket
 * about a Live TV channel. Owns its own keyboard while mounted.
 */
const ReportChannelDialog = memo(({ channelName, channelId, onClose }: Props) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { account } = usePlayerAccount();
  const { createTicket } = useSupportTickets(user);

  // Step 0: choose problem. Step 1: "Other" note + Submit.
  const [step, setStep] = useState<0 | 1>(0);
  // Focus index. Step 0: 0..2 = choices, 3 = Cancel. Step 1: 0 = input, 1 = Submit, 2 = Cancel.
  const [focusIdx, setFocusIdx] = useState(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const submittedRef = useRef(false);

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
        await createTicket(
          `Channel issue: ${channelName}`,
          buildMessage(choice, otherNote),
        );
        toast({ title: 'Report sent — thanks!' });
        onClose();
      } catch {
        // useSupportTickets already shows an error toast
        submittedRef.current = false;
        setSubmitting(false);
      }
    },
    [createTicket, buildMessage, channelName, onClose, submitting, toast],
  );

  const onPick = useCallback(
    (choice: Choice) => {
      if (choice === 'Other') {
        setStep(1);
        setFocusIdx(0);
        // focus the textarea after it mounts
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      void submit(choice);
    },
    [submit],
  );

  // Owns the keyboard while open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      if (isBack) {
        e.preventDefault();
        e.stopPropagation();
        if (step === 1 && !submitting) {
          // back from "Other" → return to choices
          setStep(0);
          setFocusIdx(2);
          setNote('');
          return;
        }
        onClose();
        return;
      }

      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      // Step 0 — choice list + Cancel
      if (step === 0) {
        const count = CHOICES.length + 1; // +Cancel
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          setFocusIdx(i => (i + 1) % count);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          setFocusIdx(i => (i - 1 + count) % count);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          if (focusIdx < CHOICES.length) onPick(CHOICES[focusIdx]);
          else onClose();
          return;
        }
        // Block stray keys from leaking to LiveSection
        e.stopPropagation();
        return;
      }

      // Step 1 — Other note: [textarea, Submit, Cancel]
      if (e.key === 'ArrowDown' && !typing) {
        e.preventDefault();
        e.stopPropagation();
        setFocusIdx(i => Math.min(2, i + 1));
        return;
      }
      if (e.key === 'ArrowUp' && !typing) {
        e.preventDefault();
        e.stopPropagation();
        setFocusIdx(i => Math.max(0, i - 1));
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && !typing) {
        e.preventDefault();
        e.stopPropagation();
        if (focusIdx === 0) {
          inputRef.current?.focus();
        } else if (focusIdx === 1) {
          void submit('Other', note);
        } else if (focusIdx === 2) {
          onClose();
        }
        return;
      }
      // While typing, let the textarea consume the key (don't leak).
      if (typing) e.stopPropagation();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [step, focusIdx, note, onPick, onClose, submit, submitting]);

  // Auto-blur textarea so D-pad navigation works again
  useEffect(() => {
    if (step === 1 && focusIdx !== 0) inputRef.current?.blur();
  }, [step, focusIdx]);

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
            Report a problem with <span className="text-brand-gold">{channelName}</span>
          </h2>
        </div>

        {step === 0 && (
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

        {step === 1 && (
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
                Submit
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
          Long-press OK or press the Menu key on a channel to report.
        </p>
      </div>
    </div>
  );
});

ReportChannelDialog.displayName = 'ReportChannelDialog';
export default ReportChannelDialog;
