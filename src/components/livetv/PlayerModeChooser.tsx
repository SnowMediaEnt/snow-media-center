import { memo, useEffect, useRef, useState } from 'react';
import { Tv, Film } from 'lucide-react';

interface Props {
  onPick: (mode: 'live' | 'movies') => void;
  onBack: () => void;
}

const CARDS = [
  { id: 'live' as const,   label: 'Live TV',        desc: 'Live channels & guide', icon: Tv },
  { id: 'movies' as const, label: 'Movies & Shows', desc: 'Plex + on-demand',       icon: Film },
];

const PlayerModeChooser = memo(({ onPick, onBack }: Props) => {
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(idx);
  useEffect(() => { idxRef.current = idx; }, [idx]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const isBack = e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace';
      if (isBack) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); onBack(); return; }
      const keys = ['ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setIdx((i) => Math.min(CARDS.length - 1, i + 1));
      else if (e.key === 'Enter' || e.key === ' ') onPick(CARDS[idxRef.current].id);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onPick, onBack]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-white p-8 bg-black/70">
      <div className="flex items-center gap-2 mb-8">
        <Tv className="w-8 h-8 text-brand-gold" />
        <h1 className="text-3xl font-quicksand font-bold">Player</h1>
      </div>
      <div className="grid grid-cols-2 gap-6 w-full max-w-3xl">
        {CARDS.map((c, i) => {
          const Icon = c.icon;
          const focused = idx === i;
          return (
            <div key={c.id} data-focused={focused ? 'true' : 'false'}
              onClick={() => { setIdx(i); onPick(c.id); }}
              className={`tv-focusable home-focus-surface cursor-pointer rounded-3xl p-8 flex flex-col items-center gap-4 text-center border transition-transform duration-150 ${focused ? 'bg-brand-gold/20 border-brand-gold ring-2 ring-brand-gold scale-105 shadow-[0_0_30px_rgba(245,200,80,0.3)]' : 'bg-slate-900/70 border-white/10'}`}>
              <div className="w-20 h-20 rounded-2xl bg-brand-gold/20 flex items-center justify-center">
                <Icon className="w-11 h-11 text-brand-gold" />
              </div>
              <div>
                <div className="text-2xl font-quicksand font-bold">{c.label}</div>
                <div className="text-brand-ice/70 font-nunito text-sm mt-1">{c.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-8 text-brand-ice/50 font-nunito text-sm">◀ ▶ choose · OK to open · Back to exit</p>
    </div>
  );
});

PlayerModeChooser.displayName = 'PlayerModeChooser';
export default PlayerModeChooser;
