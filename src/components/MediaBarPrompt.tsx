import { memo, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';
import { useMediaBarEnabled } from '@/hooks/useMediaBarEnabled';

const PROMPT_KEY = 'smc-media-bar-prompt-seen';
const WELCOME_KEY = 'smc-welcome-shown-version';

/**
 * One-time first-run popup that offers to enable the home content bar.
 * Gated on:
 *  - localStorage `smc-media-bar-prompt-seen` !== '1'
 *  - content bar currently OFF
 *  - welcome popup already dismissed (its storage key is set)
 *  - no other modal in the DOM
 */
const MediaBarPrompt = () => {
  const [enabled, setEnabled] = useMediaBarEnabled();
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0); // 0 = Turn it on, 1 = Not now
  const focusIdxRef = useRef(focusIdx);
  useEffect(() => { focusIdxRef.current = focusIdx; }, [focusIdx]);

  // Decide whether to open. Poll briefly so we wait until the welcome popup
  // is dismissed (its storage key is written on dismiss).
  useEffect(() => {
    let cancelled = false;
    const tryOpen = () => {
      if (cancelled) return false;
      try {
        if (localStorage.getItem(PROMPT_KEY) === '1') return true; // done, stop
        if (enabled) return true; // already on, stop
        if (!localStorage.getItem(WELCOME_KEY)) return false; // wait for welcome
        // Ensure no other modal is currently open
        const otherModal = document.querySelector('[role="dialog"][aria-modal="true"]');
        if (otherModal) return false;
        setOpen(true);
        return true;
      } catch {
        return true;
      }
    };
    if (tryOpen()) return;
    const id = window.setInterval(() => { if (tryOpen()) window.clearInterval(id); }, 800);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [enabled]);

  const markSeen = () => {
    try { localStorage.setItem(PROMPT_KEY, '1'); } catch { /* ignore */ }
  };

  const onTurnOn = () => {
    setEnabled(true);
    markSeen();
    setOpen(false);
  };
  const onNotNow = () => {
    markSeen();
    setOpen(false);
  };

  // Trap keyboard while open
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const key = e.key;
      const code = (e as { keyCode?: number }).keyCode;
      if (key === 'Escape' || key === 'Backspace' || key === 'GoBack' || code === 4 || code === 27) {
        e.preventDefault(); e.stopPropagation();
        onNotNow();
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Tab' || key === 'ArrowUp' || key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        if (key === 'ArrowLeft' || (key === 'Tab' && e.shiftKey)) setFocusIdx(0);
        else if (key === 'ArrowRight' || key === 'Tab') setFocusIdx(i => (i === 0 ? 1 : 1));
        // Up/Down stay
        return;
      }
      if (key === 'Enter' || key === ' ' || code === 13 || code === 23 || code === 66) {
        e.preventDefault(); e.stopPropagation();
        if (focusIdxRef.current === 0) onTurnOn(); else onNotNow();
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Toggle focus simply: Left → 0, Right → 1
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const sel = focusIdxRef.current === 0
        ? '[data-mbp-btn="on"]'
        : '[data-mbp-btn="off"]';
      document.querySelector<HTMLButtonElement>(sel)?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [open, focusIdx]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/85 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-full max-w-lg bg-gradient-to-br from-blue-900 to-slate-900 border-blue-500/40 p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-6 h-6 text-yellow-300" />
          <h2 className="text-2xl font-bold text-white">Show the live content bar?</h2>
        </div>
        <p className="text-sm text-white/85 mb-4">
          It shows trending titles &amp; live sports at the top of the home screen.
        </p>

        {/* Mini preview of the content bar — realistic compact cards */}
        <div className="bg-black/40 border border-white/10 rounded-xl p-3 mb-4">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">Preview</div>
          <div className="flex gap-2 overflow-hidden">
            {/* LIVE 1 */}
            <div className="flex-1 min-w-0 aspect-[2/3] rounded-lg overflow-hidden ring-1 ring-white/10 shadow-md bg-gradient-to-br from-emerald-600 via-teal-700 to-slate-900 relative">
              <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-red-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-sm">
                <span className="w-1 h-1 rounded-full bg-white animate-pulse" />LIVE
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/90 to-transparent">
                <div className="text-[9px] font-bold text-white leading-tight truncate">Mariners @ Rays</div>
                <div className="text-[7px] text-white/70 leading-tight truncate">MLB · Live</div>
              </div>
            </div>
            {/* LIVE 2 */}
            <div className="flex-1 min-w-0 aspect-[2/3] rounded-lg overflow-hidden ring-1 ring-white/10 shadow-md bg-gradient-to-br from-orange-600 via-rose-700 to-slate-900 relative">
              <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-red-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-sm">
                <span className="w-1 h-1 rounded-full bg-white animate-pulse" />LIVE
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/90 to-transparent">
                <div className="text-[9px] font-bold text-white leading-tight truncate">Lakers @ Celtics</div>
                <div className="text-[7px] text-white/70 leading-tight truncate">NBA · Live</div>
              </div>
            </div>
            {/* LIVE 3 */}
            <div className="flex-1 min-w-0 aspect-[2/3] rounded-lg overflow-hidden ring-1 ring-white/10 shadow-md bg-gradient-to-br from-indigo-600 via-purple-800 to-slate-900 relative">
              <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-red-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-sm">
                <span className="w-1 h-1 rounded-full bg-white animate-pulse" />LIVE
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/90 to-transparent">
                <div className="text-[9px] font-bold text-white leading-tight truncate">Chiefs @ 49ers</div>
                <div className="text-[7px] text-white/70 leading-tight truncate">NFL · Live</div>
              </div>
            </div>
            {/* SHOW 1 */}
            <div className="flex-1 min-w-0 aspect-[2/3] rounded-lg overflow-hidden ring-1 ring-white/10 shadow-md bg-gradient-to-br from-slate-700 via-slate-800 to-black relative">
              <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/95 to-transparent">
                <div className="text-[9px] font-bold text-white leading-tight truncate">Moving On</div>
                <div className="text-[7px] text-white/70 leading-tight truncate">Continue · S03E12</div>
              </div>
            </div>
            {/* SHOW 2 */}
            <div className="flex-1 min-w-0 aspect-[2/3] rounded-lg overflow-hidden ring-1 ring-white/10 shadow-md bg-gradient-to-br from-zinc-700 via-zinc-900 to-black relative">
              <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/95 to-transparent">
                <div className="text-[9px] font-bold text-white leading-tight truncate">Northern Lights</div>
                <div className="text-[7px] text-white/70 leading-tight truncate">Continue · S01E04</div>
              </div>
            </div>
          </div>
        </div>


        <p className="text-xs text-yellow-300/90 mb-5">
          On older or less powerful devices this may make things a little laggy.
        </p>

        <div className="flex items-center justify-end gap-3">
          <Button
            data-mbp-btn="off"
            variant="white"
            onClick={onNotNow}
            className={`tv-focusable transition-transform duration-150 ${
              focusIdx === 1 ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_14px_rgba(245,200,80,0.45)]' : ''
            }`}
          >
            Not now
          </Button>
          <Button
            data-mbp-btn="on"
            onClick={onTurnOn}
            className={`bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 tv-focusable transition-transform duration-150 ${
              focusIdx === 0 ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_14px_rgba(245,200,80,0.45)]' : ''
            }`}
          >
            Turn it on
          </Button>
        </div>

        <p className="mt-4 text-[11px] text-white/55">
          You can change this any time in Settings.
        </p>
      </Card>
    </div>
  );
};

export default memo(MediaBarPrompt);
