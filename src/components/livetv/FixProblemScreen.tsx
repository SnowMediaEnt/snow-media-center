// Live TV › Settings › Fix a problem (owner, 2026-10-20): where to start when
// the picture stops and starts. The Buffering Guide, the Speed test and
// Submit a Ticket open in Support (as from Live TV's Report dialog), and a
// short "restart your box and router" tip sits under them.
//
// The remote: Up / Down walk the three, OK opens one; Back (or Left) returns
// to the Settings menu. Chrome 66: margins and space-y, no flex gap.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, LifeBuoy, Power, Ticket } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** A Support tool this page opens. */
export type SupportTool = 'speedtest' | 'tickets';

interface Props {
  /** Back from the page: the remote returns to the Settings menu. */
  onBack: () => void;
  /** Whether the remote is on this page (false while it is on the Settings menu). */
  active?: boolean;
  /** Support's Buffering Guide (absent: not offered). */
  onOpenBufferingGuide?: () => void;
  /** Support, on one of its tools (absent: those are not offered). */
  onOpenSupportTool?: (tool: SupportTool) => void;
}

type RowId = 'guide' | SupportTool;

const ROW_TEXT: Record<RowId, { icon: typeof Gauge; title: string; desc: string }> = {
  guide: { icon: LifeBuoy, title: 'support.cards.guide.title', desc: 'support.cards.guide.desc' },
  speedtest: { icon: Gauge, title: 'support.cards.speedTest.title', desc: 'support.cards.speedTest.desc' },
  tickets: { icon: Ticket, title: 'support.cards.tickets.title', desc: 'support.cards.tickets.desc' },
};

const isBackKey = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
const isOkKey = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23;
const swallow = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

const FixProblemScreen = memo(({ onBack, active = true, onOpenBufferingGuide, onOpenSupportTool }: Props) => {
  const { t } = useTranslation();
  const rows = useMemo<RowId[]>(() => [
    ...(onOpenBufferingGuide ? ['guide' as const] : []),
    ...(onOpenSupportTool ? ['speedtest' as const, 'tickets' as const] : []),
  ], [onOpenBufferingGuide, onOpenSupportTool]);
  const [focus, setFocus] = useState<RowId>('guide');
  const stateRef = useRef({ rows, focus });
  stateRef.current = { rows, focus };

  const activate = useCallback((id: RowId) => {
    if (id === 'guide') onOpenBufferingGuide?.();
    else onOpenSupportTool?.(id);
  }, [onOpenBufferingGuide, onOpenSupportTool]);

  useEffect(() => {
    if (!active) return; // the remote is on the Settings menu
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (isBackKey(e) || e.key === 'ArrowLeft') { swallow(e); onBack(); return; }
      const ok = isOkKey(e);
      if (!ok && e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowRight') return;
      swallow(e);
      const { rows: list, focus: cur } = stateRef.current;
      if (!list.length) return;
      const i = Math.max(0, list.indexOf(cur));
      if (e.key === 'ArrowDown') setFocus(list[Math.min(list.length - 1, i + 1)]);
      else if (e.key === 'ArrowUp') setFocus(list[Math.max(0, i - 1)]);
      else if (ok && !e.repeat) activate(list[i]);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, onBack, activate]);

  const shownFocus = rows.includes(focus) ? focus : rows[0];

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col text-white" data-fix-screen>
      <div className="flex-1 overflow-auto p-1">
        <div className="w-full max-w-3xl">
          <p className="text-brand-ice/85 font-nunito mb-3">{t('liveAccount.help.intro')}</p>
          <div className="space-y-3">
            {rows.map((id) => {
              const { icon: Icon, title, desc } = ROW_TEXT[id];
              const focused = active && shownFocus === id;
              return (
                <div
                  key={id}
                  data-row={id}
                  data-focused={focused ? 'true' : 'false'}
                  onClick={() => { setFocus(id); activate(id); }}
                  className={`tv-ring flex items-center rounded-2xl px-4 py-3 border cursor-pointer bg-slate-900/60 border-white/10 ${focused ? 'scale-[1.02] z-10' : ''}`}
                >
                  <Icon className="w-5 h-5 mr-3 text-brand-gold shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-quicksand font-bold">{t(title)}</p>
                    <p className="text-xs font-nunito text-brand-ice/70 mt-1">{t(desc)}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Not a row the remote lands on: the first thing to try, before any of these. */}
          <div data-fix-tip className="mt-4 flex items-start rounded-2xl px-4 py-3 border border-white/10 bg-black/30">
            <Power className="w-5 h-5 mr-3 mt-0.5 text-brand-ice shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-quicksand font-bold">{t('liveAccount.help.restartTitle')}</p>
              <p className="text-xs font-nunito text-brand-ice/70 mt-1">{t('liveAccount.help.restartTip')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

FixProblemScreen.displayName = 'FixProblemScreen';
export default FixProblemScreen;
