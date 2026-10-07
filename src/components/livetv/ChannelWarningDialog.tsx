import { memo, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChannelReport } from '@/lib/channelStatus';

interface Props {
  channelName: string;
  /** What the others reported (never null here: the caller only opens it then). */
  report: Exclude<ChannelReport, null>;
  /** The channel's category, for "its category was reported down". */
  categoryName?: string;
  /** Play it all the same. */
  onWatch: () => void;
  /** Back to the list, on the same channel. Back on the remote does this too. */
  onPickAnother: () => void;
}

/** Title and body keys per report. */
const TEXT: Record<Exclude<ChannelReport, null>, { title: string; body: string }> = {
  down: { title: 'live.warn.downTitle', body: 'live.warn.downBody' },
  category: { title: 'live.warn.categoryTitle', body: 'live.warn.categoryBody' },
  buffering: { title: 'live.warn.bufferingTitle', body: 'live.warn.bufferingBody' },
};

/**
 * Asked before a channel others reported plays: down (its own report or its
 * category's) or buffering. Two buttons, "Watch anyway" and "Pick another";
 * the highlight starts on Pick another, so a second OK out of habit does not
 * start a channel that is likely broken. Owns the remote while open: ◀ ▶ ▲ ▼
 * move, OK chooses, Back is Pick another.
 *
 * Opened on the release of the OK that chose the channel (Live TV, Game Day),
 * so the next press is a fresh one; a held OK's repeats are ignored.
 */
const ChannelWarningDialog = memo(({ channelName, report, categoryName, onWatch, onPickAnother }: Props) => {
  const { t } = useTranslation();
  // 0 = Watch anyway, 1 = Pick another.
  const [focus, setFocus] = useState(1);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const actions = useRef({ onWatch, onPickAnother });
  actions.current = { onWatch, onPickAnother };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const ok = e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;
      const arrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
      // Everything is ours while open; nothing reaches the list behind.
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (isBack) {
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        actions.current.onPickAnother();
        return;
      }
      if (arrow) { setFocus((f) => (f === 0 ? 1 : 0)); return; }
      if (ok && !e.repeat) {
        if (focusRef.current === 0) actions.current.onWatch();
        else actions.current.onPickAnother();
      }
    };
    const swallow = (e: KeyboardEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', swallow, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', swallow, true);
    };
  }, []);

  const text = TEXT[report];
  const red = report !== 'buffering';
  const button = (i: number, label: string, onClick: () => void) => (
    <button
      type="button"
      data-focused={focus === i ? 'true' : 'false'}
      data-warn-choice={i === 0 ? 'watch' : 'pick'}
      onMouseEnter={() => setFocus(i)}
      onClick={onClick}
      className={`tv-ring flex-1 min-w-0 px-4 py-3 rounded-xl border border-white/10 font-nunito font-semibold transition-transform duration-150 ease-out ${
        focus === i ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-white/5 hover:bg-white/10'
      }`}
    >
      <span className="block truncate">{label}</span>
    </button>
  );

  return (
    <div
      className="fixed z-[85] flex items-center justify-center bg-black/75"
      style={{ top: 0, right: 0, bottom: 0, left: 0 }}
      data-channel-warning={report}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className={`w-[min(92vw,520px)] rounded-2xl bg-brand-navy/95 border p-6 text-white ${red ? 'border-red-400/50' : 'border-amber-400/50'}`}
      >
        <div className="flex items-center gap-3 mb-3 min-w-0">
          <AlertTriangle className={`w-6 h-6 flex-shrink-0 ${red ? 'text-red-400' : 'text-amber-400'}`} />
          <h2 className="font-quicksand font-bold text-xl truncate min-w-0">
            {t(text.title)} — <span className="text-brand-gold">{channelName}</span>
          </h2>
        </div>
        <p className="font-nunito text-brand-ice/90 mb-5">
          {report === 'category' && !categoryName ? t('live.warn.categoryBodyNoName') : t(text.body, { category: categoryName })}
        </p>
        <div className="flex items-center gap-3">
          {button(0, t('live.warn.watchBtn'), onWatch)}
          {button(1, t('live.warn.pickBtn'), onPickAnother)}
        </div>
      </div>
    </div>
  );
});

ChannelWarningDialog.displayName = 'ChannelWarningDialog';
export default ChannelWarningDialog;
