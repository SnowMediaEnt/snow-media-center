// First time in Live TV: pick a look.
//
// Shown once, the first time Live TV opens on a box that has never chosen
// a layout (fresh install or an update from a build without layouts). Three
// cards, each a small wireframe of the real screen. Left/Right move, OK
// keeps the pick, Back keeps the default. Either way the choice is saved so
// this never shows again; Player Settings → Appearance changes it later.
import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { LIVE_LAYOUTS, DEFAULT_LIVE_LAYOUT, saveLiveLayout, type LiveLayout } from '@/lib/liveLayout';
import { trackEvent } from '@/lib/analytics';
import LiveLayoutWire from './LiveLayoutWire';

interface Props {
  onDone: (layout: LiveLayout) => void;
}

const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23 || e.keyCode === 66;
const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;

const LiveLayoutChooser = ({ onDone }: Props) => {
  const [idx, setIdx] = useState(() => Math.max(0, LIVE_LAYOUTS.findIndex((l) => l.id === DEFAULT_LIVE_LAYOUT)));

  const finish = useCallback((layout: LiveLayout, how: 'picked' | 'default') => {
    saveLiveLayout(layout);
    try { trackEvent('live_layout_first_choice', 'livetv', { layout, how }); } catch { void 0; }
    onDone(layout);
  }, [onDone]);

  // Tell the Player shell and the section underneath to leave the remote
  // alone while the chooser is up (their capture listeners run before ours).
  useEffect(() => {
    const w = window as unknown as { __liveLayoutChooserOpen?: boolean };
    w.__liveLayoutChooserOpen = true;
    return () => { w.__liveLayoutChooserOpen = false; };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (isBack(e)) { stop(); finish(DEFAULT_LIVE_LAYOUT, 'default'); return; }
      if (e.key === 'ArrowRight') { stop(); setIdx((i) => Math.min(LIVE_LAYOUTS.length - 1, i + 1)); return; }
      if (e.key === 'ArrowLeft') { stop(); setIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { stop(); return; }
      if (isOk(e)) { stop(); finish(LIVE_LAYOUTS[idx].id, 'picked'); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [idx, finish]);

  return (
    // Fully opaque background, deliberately: at 95% the Player's own section
    // rail and its gold "Live TV" highlight glowed faintly through behind
    // this, which read as something moving behind the cards.
    <div className="fixed inset-0 z-[70] bg-[#070b16] text-white flex flex-col items-center justify-center px-12" data-live-layout-chooser>
      <div className="text-xs uppercase tracking-[0.3em] text-brand-gold font-bold mb-2">Live TV</div>
      <h1 className="text-4xl font-black leading-tight mb-2">Pick the look you like</h1>
      <p className="text-lg text-white/65 mb-8">Three ways to browse channels. Same channels, same guide, your choice of screen.</p>

      <div className="grid grid-cols-3 gap-6 w-full max-w-6xl">
        {LIVE_LAYOUTS.map((l, i) => {
          const picked = i === idx;
          return (
            <div
              key={l.id}
              data-focused={picked ? 'true' : 'false'}
              onClick={() => finish(l.id, 'picked')}
              onMouseEnter={() => setIdx(i)}
              // The one you are on has to be obvious from the couch: it keeps
              // full brightness and carries the ring and the tick, while the
              // other two are dimmed right back. Contrast between the cards
              // does the work — a ring on its own was easy to miss.
              className={`relative rounded-2xl p-4 cursor-pointer transition-all duration-150 ${picked
                ? 'bg-white/[0.10] ring-4 ring-brand-gold scale-[1.04] shadow-[0_0_0_10px_rgba(195,170,114,0.22)]'
                : 'bg-white/[0.03] ring-1 ring-white/10 opacity-50 scale-[0.97]'}`}
            >
              {picked && (
                <div className="absolute -top-3 -right-3 z-10 flex items-center gap-1 rounded-full bg-brand-gold px-3 py-1 text-slate-900 shadow-lg">
                  <Check className="w-4 h-4" strokeWidth={3} />
                  <span className="text-xs font-black uppercase tracking-wider">Selected</span>
                </div>
              )}
              <LiveLayoutWire id={l.id} />
              <div className={`mt-4 text-2xl font-extrabold ${picked ? 'text-brand-gold' : 'text-white/70'}`}>{l.label}</div>
              <div className={`mt-1 text-base leading-snug ${picked ? 'text-white/80' : 'text-white/50'}`}>{l.desc}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 text-base text-white/60 flex gap-8">
        <span>◀ ▶ Choose</span>
        <span>OK Keep it</span>
        <span>Back Keep {LIVE_LAYOUTS.find((l) => l.id === DEFAULT_LIVE_LAYOUT)?.label}</span>
      </div>
      <div className="mt-3 text-sm text-white/45">Change it any time under Player Settings → Appearance.</div>
    </div>
  );
};

export default LiveLayoutChooser;
