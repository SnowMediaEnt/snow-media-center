import { memo, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** One more screen would take the line past its limit. */
export interface LineOver {
  /** Streams on the line with this screen added. */
  total: number;
  /** What the line allows at once. */
  max: number;
  /** The other TVs' streams on the line (null: the panel did not say). */
  others: number | null;
}

interface Props {
  /** The line would go past its limit (null: only the box is the worry). */
  over: LineOver | null;
  /** Five screens at once on a low-memory box (every Fire TV). */
  device: boolean;
  /** Add the screen all the same. */
  onAdd: () => void;
  /** Don't add it (Back does this too). */
  onCancel: () => void;
  /** "Message the other TVs on this line" (Live TV Settings › My Account ›
   *  Devices on this line); absent when there is no one to message or no
   *  way there. */
  onMessage?: () => void;
}

type Choice = 'cancel' | 'add' | 'message';

/**
 * Asked before a Multi-Screen screen is added that would put its line past
 * the plan's limit ("they are aware and they dont do it or else theyll
 * buffer", owner, 2026-10-23), or would be the fifth stream at once on a box
 * that may not keep five going. The viewer can still choose; the highlight
 * starts on Don't add, so an OK out of habit adds nothing. Owns the remote
 * while open: ▲ ▼ (and ◀ ▶) move, OK chooses, Back is Don't add.
 */
const LineLimitDialog = memo(({ over, device, onAdd, onCancel, onMessage }: Props) => {
  const { t } = useTranslation();
  const choices: Choice[] = onMessage ? ['cancel', 'add', 'message'] : ['cancel', 'add'];
  const [focus, setFocus] = useState(0);
  const state = useRef({ focus, choices });
  state.current = { focus, choices };
  const actions = useRef({ onAdd, onCancel, onMessage });
  actions.current = { onAdd, onCancel, onMessage };

  useEffect(() => {
    const run = (c: Choice | undefined) => {
      if (c === 'add') actions.current.onAdd();
      else if (c === 'message') actions.current.onMessage?.();
      else actions.current.onCancel();
    };
    const onKey = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const ok = e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;
      // Everything is ours while open; nothing reaches the screens behind.
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (isBack) {
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        actions.current.onCancel();
        return;
      }
      const n = state.current.choices.length;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { setFocus((f) => Math.max(0, f - 1)); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { setFocus((f) => Math.min(n - 1, f + 1)); return; }
      if (ok && !e.repeat) run(state.current.choices[state.current.focus]);
    };
    const swallow = (e: KeyboardEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', swallow, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', swallow, true);
    };
  }, []);

  const LABEL: Record<Choice, string> = {
    cancel: t('live.multi.conn.dontAddBtn'),
    add: t('live.multi.conn.addAnywayBtn'),
    message: t('live.multi.conn.messageBtn'),
  };
  const red = !!over;
  return (
    <div
      className="fixed z-[85] flex items-center justify-center bg-black/75"
      style={{ top: 0, right: 0, bottom: 0, left: 0 }}
      data-line-limit={over ? 'over' : 'device'}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className={`w-[92vw] max-w-[540px] rounded-2xl bg-brand-navy/95 border p-6 text-white ${red ? 'border-red-400/50' : 'border-amber-400/50'}`}
      >
        <div className="flex items-center mb-3 min-w-0">
          <AlertTriangle className={`w-6 h-6 mr-3 flex-shrink-0 ${red ? 'text-red-400' : 'text-amber-400'}`} />
          <h2 className="font-quicksand font-bold text-xl truncate min-w-0">
            {over ? t('live.multi.conn.overTitle') : t('live.multi.conn.deviceTitle')}
          </h2>
        </div>
        {over && (
          <p className="font-nunito text-brand-ice/90 mb-3" data-line-limit-body="">
            {t('live.multi.conn.overBody', { total: over.total, max: over.max })}
            {over.others != null && over.others > 0 && <> {t('live.multi.conn.othersNote', { others: over.others })}</>}
          </p>
        )}
        {device && <p className="font-nunito text-brand-ice/90 mb-3">{t('live.multi.conn.deviceBody')}</p>}
        <div className="mt-5">
          {choices.map((c, i) => (
            <button
              key={c}
              type="button"
              data-focused={focus === i ? 'true' : 'false'}
              data-line-choice={c}
              onMouseEnter={() => setFocus(i)}
              onClick={() => { if (c === 'add') onAdd(); else if (c === 'message') onMessage?.(); else onCancel(); }}
              className={`tv-ring block w-full min-w-0 px-4 py-3 rounded-xl border border-white/10 font-nunito font-semibold text-left transition-transform duration-150 ease-out ${
                i > 0 ? 'mt-2' : ''
              } ${focus === i ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-white/5 hover:bg-white/10'}`}
            >
              <span className="block truncate">{LABEL[c]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

LineLimitDialog.displayName = 'LineLimitDialog';
export default LineLimitDialog;
