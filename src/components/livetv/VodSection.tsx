// Live TV › VOD: first a choice of Movies or Series, then that browser.
//
// The line serves both (get_vod_streams and get_series); VOD used to open
// straight on the films, so a line's series could not be reached from Live
// TV at all. Two big cards, one remote press each. Inside either browser
// Back walks out one screen at a time and, from its category list, comes
// back here; Back here goes to Live TV's side menu, like every section.
//
// The card picked last is highlighted again for the rest of the session.
// Chrome 66: no gap beyond gap-1..4, no aspect-ratio, no inset.
import { Suspense, lazy, memo, useCallback, useEffect, useRef, useState } from 'react';
import { Film, ListVideo, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { XtreamCreds } from '@/lib/xtream';
import { formatCount, readCounts } from '@/lib/catalogCounts';
import { kidsLevel } from '@/lib/kidsFilter';
import { keepInView } from '@/utils/keepInView';

const MoviesSection = lazy(() => import('./MoviesSection'));
const SeriesSection = lazy(() => import('./SeriesSection'));

export type VodKind = 'movies' | 'series';

/** The card picked last this session (sessionStorage: a new launch starts on Movies). */
export const VOD_LAST_KIND_KEY = 'smc-vod-last-kind';
const lastKind = (): VodKind => {
  try { return sessionStorage.getItem(VOD_LAST_KIND_KEY) === 'series' ? 'series' : 'movies'; } catch { return 'movies'; }
};
const rememberKind = (k: VodKind): void => {
  try { sessionStorage.setItem(VOD_LAST_KIND_KEY, k); } catch { /* ignore */ }
};

const CARDS = [
  { id: 'movies' as const, labelKey: 'live.sections.moviesLabel', descKey: 'live.vodChooser.moviesDesc', icon: Film, counts: 'vod' as const },
  { id: 'series' as const, labelKey: 'live.sections.seriesLabel', descKey: 'live.vodChooser.seriesDesc', icon: ListVideo, counts: 'series' as const },
];

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
}

const spinner = <div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>;

const VodSection = memo(({ creds, isActive, onExitLeft, onExitUp }: Props) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState<VodKind | null>(null);
  const [idx, setIdx] = useState(() => (lastKind() === 'series' ? 1 : 0));
  const idxRef = useRef(idx);
  useEffect(() => { idxRef.current = idx; }, [idx]);

  const pick = useCallback((k: VodKind) => {
    rememberKind(k);
    setIdx(k === 'series' ? 1 : 0);
    setOpen(k);
  }, []);
  const backToChooser = useCallback(() => setOpen(null), []);

  // How much each carries, when already known on this box (catalogCounts:
  // never fetched for a number). Not on a Kids profile: the stored totals
  // can be the whole line's.
  const [totals] = useState(() => (kidsLevel() ? null : {
    vod: readCounts(creds, 'vod').total,
    series: readCounts(creds, 'series').total,
  }));

  useEffect(() => {
    if (!isActive || open) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        onExitLeft();
        return;
      }
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft') {
        if (idxRef.current === 0) onExitLeft();
        else setIdx(0);
      } else if (e.key === 'ArrowRight') {
        setIdx(CARDS.length - 1);
      } else if (e.key === 'ArrowUp') {
        onExitUp?.();
      } else if (e.key === 'Enter' || e.key === ' ') {
        // A held OK from the side menu must not also open a card.
        if (e.repeat) return;
        pick(CARDS[idxRef.current].id);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, open, onExitLeft, onExitUp, pick]);

  // A short screen (a big text size) still shows the highlighted card.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = scrollRef.current;
    const el = node?.querySelector<HTMLElement>(`[data-vod-card="${idx}"]`);
    if (node && el) keepInView(node, el, 16);
  }, [idx, open]);

  if (open === 'movies') {
    return (
      <Suspense fallback={spinner}>
        <MoviesSection creds={creds} isActive={isActive} onExitLeft={onExitLeft} onExitUp={onExitUp} onBack={backToChooser} />
      </Suspense>
    );
  }
  if (open === 'series') {
    return (
      <Suspense fallback={spinner}>
        <SeriesSection creds={creds} isActive={isActive} onExitLeft={onExitLeft} onExitUp={onExitUp} onBack={backToChooser} />
      </Suspense>
    );
  }

  return (
    <div ref={scrollRef} data-vod-chooser="" className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-black/30">
      <div className="min-h-full flex flex-col items-center justify-center px-8 py-6">
        <h2 className="text-2xl font-quicksand font-bold text-white mb-6 text-center">{t('live.vodChooser.title')}</h2>
        <div className="grid grid-cols-2 gap-4 w-full max-w-3xl">
          {CARDS.map((c, i) => {
            const Icon = c.icon;
            const focused = isActive && idx === i;
            const total = totals?.[c.counts];
            return (
              <div
                key={c.id}
                data-vod-card={i}
                data-vod-kind={c.id}
                data-focused={focused ? 'true' : 'false'}
                onClick={() => pick(c.id)}
                className={`tv-ring cursor-pointer rounded-3xl px-6 py-8 flex flex-col items-center text-center border transition-transform duration-150 ease-out ${focused ? 'bg-brand-gold/20 border-brand-gold scale-105 z-10' : idx === i ? 'bg-white/10 border-white/20' : 'bg-slate-900/70 border-white/10'}`}
              >
                <div className="w-20 h-20 mb-4 rounded-2xl bg-brand-gold/20 flex items-center justify-center">
                  <Icon className="w-11 h-11 text-brand-gold" />
                </div>
                <div className="text-3xl font-quicksand font-bold text-white">{t(c.labelKey)}</div>
                <div className="text-brand-ice/75 font-nunito text-base mt-2">{t(c.descKey)}</div>
                {total != null && total > 0 && (
                  <div className="mt-3 text-sm tabular-nums px-3 py-1 rounded-lg bg-white/10 text-brand-ice/80 font-nunito">
                    {t('live.vodChooser.titles', { n: formatCount(total) })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p data-remote-hint="" className="mt-6 text-brand-ice/60 font-nunito text-sm text-center">{t('live.vodChooser.hint')}</p>
      </div>
    </div>
  );
});

VodSection.displayName = 'VodSection';
export default VodSection;
