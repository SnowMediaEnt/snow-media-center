// "Rate Snow Media Center": five stars, an optional written review, and on a
// device with a working microphone an optional voice review.
//
// Remote first. The highlight starts on the stars: Left/Right sets them, OK
// confirms and moves on to the text box. The text box is a plain free-text
// field (no autocomplete/autocorrect/spellcheck/inputmode/enterkeyhint), so
// the keyboard's speak key can show (voiceInputFields.guard.test.ts). The
// voice button exists only where canRecordVoice() says recording works:
// Android boxes and phones with a mic, never a Fire TV (its remote's mic is
// not given to apps).
//
// Back = Not now (or, while recording, stops the recording first). After
// Send a short "Thank you" shows and the screen closes on its own.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, LifeBuoy, Mic, Square, Star, Trash2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { gridNavigation, useTVFocus } from '@/hooks/useTVFocus';
import { useOwnHardwareBack } from '@/hooks/useOwnHardwareBack';
import { useAttachmentComposer } from '@/components/support/useAttachmentComposer';
import { keepInView } from '@/utils/keepInView';
import { trackEvent } from '@/lib/analytics';
import { MAX_REVIEW_COMMENT, submitReview, type ReviewSource } from '@/lib/appReview';

export type ReviewResult = 'sent' | 'dismissed';

interface ReviewDialogProps {
  source: ReviewSource;
  onClose: (result: ReviewResult) => void;
  /** The "Need help?" line under a low rating opens the ticket screen. Left
   *  out, the line is not shown. */
  onOpenSupport?: () => void;
}

/** How long "Thank you" stays up. */
export const THANKS_MS = 2500;
const STARS = [1, 2, 3, 4, 5] as const;
const RATING_WORD_KEYS = ['', 'review.dialog.rating1', 'review.dialog.rating2', 'review.dialog.rating3', 'review.dialog.rating4', 'review.dialog.rating5'];

const clock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const s = total % 60;
  return `${Math.floor(total / 60)}:${s < 10 ? '0' : ''}${s}`;
};

const ReviewDialog = ({ source, onClose, onOpenSupport }: ReviewDialogProps) => {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [phase, setPhase] = useState<'form' | 'sending' | 'thanks'>('form');
  const [error, setError] = useState<string | null>(null);
  const voice = useAttachmentComposer();
  const recording = voice.recordingMs !== null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const closedRef = useRef(false);
  const lowRating = rating >= 1 && rating <= 3;
  const showHelp = lowRating && !!onOpenSupport;

  const close = useCallback((result: ReviewResult, reason?: string) => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (result === 'dismissed') {
      try { trackEvent('review_dismissed', 'review', { source, reason: reason ?? 'not_now' }); } catch { /* never blocks */ }
    }
    onClose(result);
  }, [onClose, source]);

  // Thank you, then gone.
  useEffect(() => {
    if (phase !== 'thanks') return;
    const id = window.setTimeout(() => close('sent'), THANKS_MS);
    return () => window.clearTimeout(id);
  }, [phase, close]);

  const handleBack = useCallback(() => {
    if (phase === 'thanks') { close('sent'); return; }
    if (phase === 'sending') return;
    if (recording) { voice.cancelRecording(); return; }
    close('dismissed', 'back');
  }, [phase, recording, voice, close]);

  const setStars = useCallback((step: number) => {
    setRating((r) => Math.max(1, Math.min(5, (r || 0) + step)));
    setError(null);
  }, []);

  const navigation = useMemo(() => {
    const rows: string[][] = [
      ['review-stars'],
      ['review-text'],
      voice.canRecord ? (voice.draft && !recording ? ['review-voice', 'review-voice-remove'] : ['review-voice']) : [],
      ['review-send', 'review-later'],
      showHelp ? ['review-help'] : [],
    ];
    const map = gridNavigation(rows);
    // The stars are one control: Left/Right set them, they never leave the row.
    map['review-stars'] = {
      ...map['review-stars'],
      up: null,
      left: () => { setStars(-1); return null; },
      right: () => { setStars(1); return null; },
    };
    return map;
  }, [voice.canRecord, voice.draft, recording, showHelp, setStars]);

  // Kept in a ref: the hardware-Back listener is added once, not per render.
  const backRef = useRef(handleBack);
  backRef.current = handleBack;
  const onBack = useCallback(() => backRef.current(), []);

  // The card scrolls on its own (a short screen, a phone): only the card, never the page.
  const onFocusChange = useCallback((id: string) => {
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-tv-focus-id="${id}"]`);
    if (box && el) keepInView(box, el, 12);
  }, []);

  const tv = useTVFocus({
    enabled: phase !== 'thanks',
    initialFocusId: 'review-stars',
    navigation,
    onBack,
    onFocusChange,
  });
  useOwnHardwareBack(true, onBack);

  // "Thank you" has nothing to focus: OK or Back closes it early.
  useEffect(() => {
    if (phase !== 'thanks') return;
    const onKey = (e: KeyboardEvent) => {
      const back = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const ok = e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;
      if (!back && !ok) return;
      e.preventDefault();
      e.stopPropagation();
      close('sent');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase, close]);

  const focused = (id: string) => (tv.currentFocusId === id ? 'true' : 'false');

  const onStarsClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // A tap on one star (phone) picks it; OK on the row confirms.
    const star = (e.target as HTMLElement).closest<HTMLElement>('[data-star]');
    if (star) {
      setRating(Number(star.dataset.star) || 0);
      setError(null);
      return;
    }
    if (rating < 1) { setError(t('review.dialog.pickStarsFirst')); return; }
    tv.focusById('review-text');
  };

  const onVoice = () => {
    if (recording) void voice.stopRecording();
    else void voice.startRecording();
  };

  const onRemoveVoice = () => {
    voice.clearDraft();
    tv.focusById('review-voice');
  };

  const onSend = async () => {
    if (phase !== 'form' || recording) return;
    if (rating < 1) {
      setError(t('review.dialog.pickStarsFirst'));
      tv.focusById('review-stars');
      return;
    }
    setError(null);
    setPhase('sending');
    try {
      await submitReview({ rating, comment, voice: voice.draft, source });
      voice.clearDraft();
      setPhase('thanks');
    } catch (e) {
      setError((e as Error).message || t('review.errors.sendFailed'));
      setPhase('form');
    }
  };

  const onHelp = () => {
    close('dismissed', 'support');
    onOpenSupport?.();
  };

  const btn = (id: string, extra = '') =>
    `tv-ring rounded-xl px-5 py-2.5 text-lg font-semibold ${tv.currentFocusId === id ? 'bg-white text-black' : 'bg-white/10 text-white'} ${extra}`;

  return (
    <div
      className="fixed top-0 left-0 right-0 bottom-0 z-[130] bg-black/85 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      data-state="open"
      data-review-dialog="true"
      aria-label={t('review.dialog.dialogLabel')}
    >
      <div
        ref={(node) => { scrollRef.current = node; (tv.containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
        className="w-full max-w-2xl max-h-full overflow-y-auto rounded-2xl border border-blue-500/40 bg-gradient-to-br from-blue-900 to-slate-900 p-5 text-white shadow-2xl"
      >
        {phase === 'thanks' ? (
          <div className="flex flex-col items-center text-center py-8" role="status">
            <CheckCircle2 className="w-16 h-16 text-brand-gold mb-3" />
            <h2 className="text-3xl font-bold mb-2">{t('review.dialog.thanksTitle')}</h2>
            <p className="text-lg text-white/80">{t('review.dialog.thanksText')}</p>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-bold leading-tight">{t('review.dialog.title')}</h2>
            <p className="text-base text-white/75 mb-3">{t('review.dialog.subtitle')}</p>

            <div className="flex items-center mb-1">
              <div
                data-tv-focus-id="review-stars"
                data-focused={focused('review-stars')}
                tabIndex={0}
                role="slider"
                aria-label={t('review.dialog.starsLabel')}
                aria-valuemin={0}
                aria-valuemax={5}
                aria-valuenow={rating}
                aria-valuetext={t('review.dialog.starsValue', { rating })}
                onClick={onStarsClick}
                className="tv-ring inline-flex items-center rounded-2xl px-3 py-2 bg-black/20"
              >
                {STARS.map((n) => (
                  <span key={n} data-star={n} className="px-1" aria-hidden="true">
                    <Star
                      className={`w-12 h-12 ${n <= rating ? 'text-brand-gold' : 'text-white/35'}`}
                      fill={n <= rating ? 'currentColor' : 'none'}
                      strokeWidth={1.75}
                    />
                  </span>
                ))}
              </div>
              <span className="ml-4 text-xl font-semibold text-brand-gold" data-testid="review-rating-word">
                {rating > 0 ? t(RATING_WORD_KEYS[rating]) : ''}
              </span>
            </div>
            <p className="text-sm text-white/60 mb-3">{t('review.dialog.starsHint')}</p>

            <label className="block text-sm font-medium text-white/80 mb-1" htmlFor="review-comment">
              {t('review.dialog.commentLabel')}
            </label>
            <Textarea
              id="review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, MAX_REVIEW_COMMENT))}
              placeholder={t('review.dialog.commentPlaceholder')}
              maxLength={MAX_REVIEW_COMMENT}
              rows={3}
              data-tv-focus-id="review-text"
              data-focused={focused('review-text')}
              className="tv-ring min-h-[72px] bg-slate-800 border-slate-600 text-white text-base mb-3"
            />

            {voice.canRecord && (
              <div className="flex items-center mb-3">
                <button
                  type="button"
                  data-tv-focus-id="review-voice"
                  data-focused={focused('review-voice')}
                  onClick={onVoice}
                  disabled={phase !== 'form'}
                  className={btn('review-voice', 'inline-flex items-center shrink-0')}
                >
                  {recording ? <Square className="w-5 h-5 mr-2" /> : <Mic className="w-5 h-5 mr-2" />}
                  {recording ? t('review.dialog.stopBtn') : t('review.dialog.recordBtn')}
                </button>
                <span className="ml-3 text-base text-white/80 min-w-0">
                  {recording
                    ? t('review.dialog.recording', { time: clock(voice.recordingMs ?? 0), max: clock(voice.maxRecordingMs) })
                    : voice.draft
                      ? t('review.dialog.voiceReady', { time: clock(voice.draft.durationMs ?? 0) })
                      : t('review.dialog.voiceHint')}
                </span>
                {voice.draft && !recording && (
                  <button
                    type="button"
                    data-tv-focus-id="review-voice-remove"
                    data-focused={focused('review-voice-remove')}
                    onClick={onRemoveVoice}
                    className={btn('review-voice-remove', 'inline-flex items-center ml-auto shrink-0')}
                  >
                    <Trash2 className="w-5 h-5 mr-2" />
                    {t('review.dialog.removeVoiceBtn')}
                  </button>
                )}
              </div>
            )}

            {error && <p className="text-base text-amber-300 mb-2" role="alert">{error}</p>}

            <div className="flex items-center">
              <button
                type="button"
                data-tv-focus-id="review-send"
                data-focused={focused('review-send')}
                onClick={() => { void onSend(); }}
                disabled={phase !== 'form' || recording}
                className={btn('review-send', 'mr-3')}
              >
                {phase === 'sending' ? t('review.dialog.sendingBtn') : t('review.dialog.sendBtn')}
              </button>
              <button
                type="button"
                data-tv-focus-id="review-later"
                data-focused={focused('review-later')}
                onClick={() => close('dismissed', 'not_now')}
                disabled={phase === 'sending'}
                className={btn('review-later')}
              >
                {t('review.dialog.notNowBtn')}
              </button>
            </div>

            {showHelp && (
              <button
                type="button"
                data-tv-focus-id="review-help"
                data-focused={focused('review-help')}
                onClick={onHelp}
                disabled={phase === 'sending'}
                className="tv-ring mt-3 inline-flex items-center rounded-lg px-3 py-1.5 text-base text-sky-200 underline"
              >
                <LifeBuoy className="w-5 h-5 mr-2 shrink-0" />
                {t('review.dialog.helpLine')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ReviewDialog;
