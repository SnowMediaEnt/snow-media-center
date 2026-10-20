import { memo, useEffect, useRef, useState } from 'react';
import { LifeBuoy, RotateCw, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { holdMediaKeys } from '@/lib/mediaKeys';
import { BUFFER_HELP_ARM_MS, type BufferHelpStep } from './useBufferingHelp';

interface Props {
  /** The steps, in order (useBufferingHelp leaves out what was done today). */
  steps: BufferHelpStep[];
  /** The last step offers "Report this channel" (not for an outside service's line). */
  canReport: boolean;
  /** "Yes, I did" / "I did it": not asked again today. */
  onRestartDone: () => void;
  /** Open the Buffering Guide; `from` the step it was opened on. */
  onOpenGuide: (from: BufferHelpStep) => void;
  /** Report the channel (the report flow, buffering already picked). */
  onReport: () => void;
  /** Back, or Close: the picture as it was. */
  onClose: () => void;
  track: (step: BufferHelpStep, action: string) => void;
  /** Keys do nothing this long after it (or a new step) shows: a press meant
   *  for the player as it came up never answers it. */
  armMs?: number;
}

const ICON: Record<BufferHelpStep, typeof LifeBuoy> = { restart: RotateCw, vpn: Shield, guide: LifeBuoy };

/**
 * "Still buffering?" over the picture (useBufferingHelp decides when): one
 * step at a time, in order — restart the box and the router, try a VPN, then
 * the Buffering Guide (or report the channel). The show is not playing
 * anyway; if it starts while this is up, this stays until it is answered or
 * closed (no surprise jumps).
 *
 * Owns the remote while open, like ChannelWarningDialog: ◀ ▶ (and ▲ ▼) move
 * between the buttons, OK chooses, Back closes it — only it: full screen,
 * the hidden bar and the channel stay as they were. Every key stops here,
 * and the media buttons do nothing behind it (holdMediaKeys) — the player's
 * own Play/Pause included. Opened in the middle of watching, so a press already on its way does
 * nothing for `armMs`, and a held OK's repeats never walk through the steps.
 */
const BufferingHelpDialog = memo(({ steps, canReport, onRestartDone, onOpenGuide, onReport, onClose, track, armMs = BUFFER_HELP_ARM_MS }: Props) => {
  const { t } = useTranslation();
  const [at, setAt] = useState(0);
  // Restart's "Show me how": the steps on the card, in place of the question.
  const [how, setHow] = useState(false);
  const step: BufferHelpStep = steps[Math.min(at, steps.length - 1)] ?? 'guide';
  // The highlight starts on the safe choice: "Show me how" on the restart
  // question (a habit OK never claims a restart), the first button elsewhere.
  const firstFocus = step === 'restart' && !how ? 1 : 0;
  const [focus, setFocus] = useState(firstFocus);
  const armedAtRef = useRef(Date.now());
  useEffect(() => { armedAtRef.current = Date.now(); setFocus(firstFocus); }, [at, how, firstFocus]);
  // The remote's media buttons (Play/Pause too) do nothing behind it.
  useEffect(() => holdMediaKeys(), []);

  const next = () => {
    if (at < steps.length - 1) { setAt(at + 1); setHow(false); }
  };
  const close = () => { track(step, 'close'); onClose(); };

  const buttons: Array<{ id: string; label: string; run: () => void }> = (() => {
    if (step === 'restart' && !how) return [
      { id: 'yes', label: t('live.bufferHelp.restartYesBtn'), run: () => { track('restart', 'yes'); onRestartDone(); next(); } },
      { id: 'how', label: t('live.bufferHelp.restartHowBtn'), run: () => { track('restart', 'how'); setHow(true); } },
    ];
    if (step === 'restart') return [
      { id: 'done', label: t('live.bufferHelp.howDoneBtn'), run: () => { track('restart', 'how_done'); onRestartDone(); next(); } },
      { id: 'next', label: t('live.bufferHelp.nextTipBtn'), run: () => { track('restart', 'how_next'); next(); } },
    ];
    if (step === 'vpn') return [
      { id: 'guide', label: t('live.bufferHelp.openGuideBtn'), run: () => { track('vpn', 'open_guide'); onOpenGuide('vpn'); } },
      { id: 'notnow', label: t('live.bufferHelp.notNowBtn'), run: () => { track('vpn', 'not_now'); next(); } },
    ];
    return [
      { id: 'guide', label: t('live.bufferHelp.openGuideBtn'), run: () => { track('guide', 'open_guide'); onOpenGuide('guide'); } },
      canReport
        ? { id: 'report', label: t('live.bufferHelp.reportBtn'), run: () => { track('guide', 'report'); onReport(); } }
        : { id: 'close', label: t('common.close'), run: close },
    ];
  })();

  // The (stable) key listener reads the latest of these.
  const live = useRef({ buttons, close, focus, armMs });
  live.current = { buttons, close, focus, armMs };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const ok = e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;
      const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      // Everything is ours while open; nothing reaches the player, the bar or
      // the channel list behind.
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (isBack) (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
      const l = live.current;
      if (Date.now() - armedAtRef.current < l.armMs) return;
      if (isBack) { l.close(); return; }
      const n = l.buttons.length;
      if (back) { setFocus((f) => (f - 1 + n) % n); return; }
      if (fwd) { setFocus((f) => (f + 1) % n); return; }
      if (ok && !e.repeat) l.buttons[Math.min(l.focus, n - 1)]?.run();
    };
    const swallow = (e: KeyboardEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', swallow, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', swallow, true);
    };
  }, []);

  const Icon = ICON[step];
  // Which body shows (named out here: the i18n guard reads a string compared
  // inside JSX as text on screen).
  const asking = step === 'restart' && !how;
  const showingHow = step === 'restart' && how;
  const onVpn = step === 'vpn';
  const onGuide = step === 'guide';
  const title = step === 'restart'
    ? (how ? t('live.bufferHelp.howTitle') : t('live.bufferHelp.restartTitle'))
    : step === 'vpn' ? t('guides.buffering.step4.title') : t('live.bufferHelp.guideTitle');

  return (
    <div
      className="fixed z-[85] flex items-center justify-center bg-black/60 p-4"
      style={{ top: 0, right: 0, bottom: 0, left: 0 }}
      data-buffer-help={step}
      // A tap beside the card closes it (a touch screen's Back); never the
      // picture's own tap (the bar) as well.
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) close(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('live.bufferHelp.label')}
        className="w-[92vw] max-w-[560px] rounded-2xl bg-brand-navy/95 border border-brand-gold/40 p-6 text-white"
      >
        <div className="flex items-start mb-3 min-w-0">
          <Icon className="w-6 h-6 mt-0.5 mr-3 flex-shrink-0 text-brand-gold" aria-hidden="true" />
          <h2 className="font-quicksand font-bold text-xl leading-snug min-w-0">{title}</h2>
        </div>
        {asking && (
          <p className="font-nunito text-brand-ice/90 mb-5">{t('live.bufferHelp.restartBody')}</p>
        )}
        {showingHow && (
          <ol className="font-nunito text-brand-ice/90 mb-5" data-buffer-help-how="">
            {(['how1', 'how2', 'how3', 'how4'] as const).map((k, i) => (
              <li key={k} className="flex items-start mb-2 last:mb-0">
                <span className="mr-3 flex-shrink-0 w-6 h-6 rounded-full bg-brand-gold/20 text-brand-gold text-sm font-bold flex items-center justify-center">{i + 1}</span>
                <span className="min-w-0">{t(`live.bufferHelp.${k}`)}</span>
              </li>
            ))}
          </ol>
        )}
        {onVpn && (
          <div className="font-nunito text-brand-ice/90 mb-5">
            <p>{t('guides.buffering.step4.lead')}</p>
            <p className="mt-2">{t('live.bufferHelp.vpnSetup')}</p>
          </div>
        )}
        {onGuide && (
          <div className="font-nunito text-brand-ice/90 mb-5">
            <p>{t('live.bufferHelp.guideBody')}</p>
            {canReport && <p className="mt-2 text-brand-ice/75">{t('live.bufferHelp.reportBody')}</p>}
          </div>
        )}
        {/* Margins, not flex gap, between the buttons (Chrome 66). */}
        <div className="flex items-stretch">
          {buttons.map((b, i) => (
            <button
              key={`${step}-${how ? 'how' : 'ask'}-${b.id}`}
              type="button"
              data-focused={focus === i ? 'true' : 'false'}
              data-buffer-help-choice={b.id}
              onMouseEnter={() => setFocus(i)}
              onClick={(e) => { e.stopPropagation(); b.run(); }}
              className={`tv-ring flex-1 min-w-0 px-4 py-3 rounded-xl border border-white/10 font-nunito font-semibold transition-transform duration-150 ease-out ${i > 0 ? 'ml-3' : ''} ${
                focus === i ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              {/* A long label (fr, de) wraps rather than being cut off. */}
              <span className="block leading-tight">{b.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

BufferingHelpDialog.displayName = 'BufferingHelpDialog';
export default BufferingHelpDialog;
