// First time in Live TV: pick a look.
//
// Shown once, the first time Live TV opens on a box that has never chosen
// a layout (fresh install or an update from a build without layouts). Three
// cards, each a small wireframe of the real screen. Left/Right move, OK
// keeps the pick, Back keeps the default. Either way the choice is saved so
// this never shows again; Player Settings → Appearance changes it later.
import { useCallback, useEffect, useState } from 'react';
import { LIVE_LAYOUTS, DEFAULT_LIVE_LAYOUT, saveLiveLayout, type LiveLayout } from '@/lib/liveLayout';
import { trackEvent } from '@/lib/analytics';

interface Props {
  onDone: (layout: LiveLayout) => void;
}

const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23 || e.keyCode === 66;
const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;

/** A miniature of each layout, drawn with boxes so it reads from the couch. */
const Wire = ({ id }: { id: LiveLayout }) => {
  const bar = 'rounded-[2px] bg-white/25';
  const hot = 'rounded-[2px] bg-brand-gold';
  if (id === 'classic') {
    return (
      <div className="w-full aspect-video rounded-lg bg-[#0b1020] p-2 flex gap-1.5">
        <div className="w-[24%] flex flex-col gap-1">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`h-[10%] ${i === 1 ? hot : bar}`} />)}
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <div className="h-[38%] rounded-[3px] bg-brand-ice/40" />
          <div className="flex-1 flex flex-col gap-1">
            {[0, 1, 2, 3].map((i) => <div key={i} className={`h-[18%] ${i === 0 ? hot : bar}`} />)}
          </div>
        </div>
      </div>
    );
  }
  if (id === 'grid') {
    return (
      <div className="w-full aspect-video rounded-lg bg-[#0b1020] p-2 flex gap-1.5">
        <div className="w-[24%] flex flex-col gap-1">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`h-[10%] ${i === 1 ? hot : bar}`} />)}
        </div>
        <div className="flex-1 grid grid-cols-4 gap-1 content-start">
          {Array.from({ length: 12 }).map((_, i) => <div key={i} className={`aspect-[4/3] ${i === 0 ? hot : 'rounded-[2px] bg-white/20'}`} />)}
        </div>
      </div>
    );
  }
  return (
    <div className="w-full aspect-video rounded-lg bg-[#0b1020] p-2 flex gap-1.5">
      <div className="w-[42%] flex flex-col gap-1">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className={`h-[9%] ${i === 2 ? hot : bar}`} />)}
      </div>
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="flex-1 rounded-[3px] bg-brand-ice/40" />
        <div className="h-[16%] flex flex-col gap-1">
          <div className={`h-1/2 ${bar}`} />
          <div className="h-1/2 rounded-[2px] bg-white/15" />
        </div>
      </div>
    </div>
  );
};

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
    <div className="fixed inset-0 z-[70] bg-[#070b16]/95 text-white flex flex-col items-center justify-center px-12" data-live-layout-chooser>
      <div className="text-xs uppercase tracking-[0.3em] text-brand-gold font-bold mb-2">Live TV</div>
      <h1 className="text-4xl font-black leading-tight mb-2">Pick the look you like</h1>
      <p className="text-lg text-white/65 mb-8">Three ways to browse channels. Same channels, same guide, your choice of screen.</p>

      <div className="grid grid-cols-3 gap-6 w-full max-w-6xl">
        {LIVE_LAYOUTS.map((l, i) => {
          const picked = i === idx;
          return (
            <div
              key={l.id}
              onClick={() => finish(l.id, 'picked')}
              onMouseEnter={() => setIdx(i)}
              className={`rounded-2xl p-4 cursor-pointer transition-all duration-150 ${picked ? 'bg-white/[0.08] ring-4 ring-brand-gold scale-[1.03] shadow-[0_0_0_8px_rgba(195,170,114,0.2)]' : 'bg-white/[0.04] ring-1 ring-white/15'}`}
            >
              <Wire id={l.id} />
              <div className={`mt-4 text-2xl font-extrabold ${picked ? 'text-brand-gold' : 'text-white'}`}>{l.label}</div>
              <div className="mt-1 text-base text-white/65 leading-snug">{l.desc}</div>
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
