// "Keep this layout?" — shown a few seconds after a Live TV layout is picked
// in Settings → Appearance, over the real Live TV screen in that layout.
// Keep leaves it; Change (or Back) puts the old one back and returns to
// Appearance. Owns the remote while it is up (the Player shell honours the
// same flag as the first-open chooser; the section is made inactive).
import { useEffect, useState } from 'react';
import { LIVE_LAYOUTS, type LiveLayout } from '@/lib/liveLayout';

interface Props {
  layout: LiveLayout;
  onKeep: () => void;
  onChange: () => void;
}

const LayoutTrialPrompt = ({ layout, onKeep, onChange }: Props) => {
  const [focus, setFocus] = useState<'keep' | 'change'>('keep');
  const label = LIVE_LAYOUTS.find((l) => l.id === layout)?.label ?? 'this';

  useEffect(() => {
    const w = window as unknown as { __liveLayoutChooserOpen?: boolean };
    w.__liveLayoutChooserOpen = true;
    return () => { w.__liveLayoutChooserOpen = false; };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const isOk = e.key === 'Enter' || e.key === ' ' || e.keyCode === 23 || e.keyCode === 66;
      if (!isBack && !isOk && !e.key.startsWith('Arrow')) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (isBack) { onChange(); return; }
      if (e.key === 'ArrowLeft') setFocus('keep');
      else if (e.key === 'ArrowRight') setFocus('change');
      else if (isOk && !e.repeat) { if (focus === 'keep') onKeep(); else onChange(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [focus, onKeep, onChange]);

  const btn = (id: 'keep' | 'change') =>
    `h-12 px-8 rounded-xl text-lg font-quicksand font-bold transition-transform ${
      focus === id ? 'ring-4 ring-brand-ice scale-105' : ''
    } ${id === 'keep' ? 'bg-brand-gold text-slate-900' : 'bg-slate-800 border border-slate-600 text-white'}`;

  return (
    <div className="fixed inset-x-0 bottom-[6vh] z-[80] flex justify-center pointer-events-none" role="dialog" aria-label="Keep this layout?">
      <div className="pointer-events-auto rounded-3xl border border-brand-gold/40 bg-[#0b1220] shadow-2xl px-8 py-6 text-center max-w-xl">
        <div className="text-2xl font-quicksand font-bold text-white">Keep the {label} layout?</div>
        <div className="mt-1 text-base text-white/70 font-nunito">This is how Live TV will look. You can change it any time in Appearance.</div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" className={btn('keep')} onClick={onKeep} onMouseEnter={() => setFocus('keep')}>Keep</button>
          <button type="button" className={btn('change')} onClick={onChange} onMouseEnter={() => setFocus('change')}>Change</button>
        </div>
      </div>
    </div>
  );
};

export default LayoutTrialPrompt;
