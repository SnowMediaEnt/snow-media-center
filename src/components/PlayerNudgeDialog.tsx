// The "open it in the Player instead" popup for people launching the old
// Dreamstreams / VibezTV / Plex apps (src/lib/playerNudge.ts). Same remote
// handling as RetiredAppDialog: the dialog owns the keys while it is up.
// Focus order: the checkbox on top, then Open Player / Continue side by side.
import { memo, useEffect, useRef, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { RetiredApp } from '@/lib/retiredApps';
import { PLAYER_BENEFITS, setPlayerNudgeOff } from '@/lib/playerNudge';
import { trackEvent } from '@/lib/analytics';

interface PlayerNudgeDialogProps {
  appName: string | null;
  info: RetiredApp | null;
  open: boolean;
  /** "Open Player": go to the section the service lives in now. */
  onOpenPlayer: () => void;
  /** "Continue to <app>": launch the old app as asked. */
  onContinue: () => void;
  /** Back: neither — stay where they were. */
  onDismiss: () => void;
}

type Focus = 'check' | 'player' | 'continue';

const PlayerNudgeDialog = ({ appName, info, open, onOpenPlayer, onContinue, onDismiss }: PlayerNudgeDialogProps) => {
  const checkRef = useRef<HTMLButtonElement>(null);
  const playerRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [focus, setFocus] = useState<Focus>('player');
  const [dontShow, setDontShow] = useState(false);

  const track = (action: string) => {
    try { trackEvent('player_nudge', 'alerts', { app: appName, action, dont_show: dontShow }); } catch { /* ignore */ }
  };
  const remember = () => { if (dontShow) setPlayerNudgeOff(true); };
  const choosePlayer = () => { track('open_player'); remember(); onOpenPlayer(); };
  const chooseContinue = () => { track('continue'); remember(); onContinue(); };
  const dismiss = () => { track('dismiss'); remember(); onDismiss(); };

  useEffect(() => {
    if (!open) return;
    track('shown');
    setDontShow(false);
    setFocus('player');
    const t = setTimeout(() => playerRef.current?.focus(), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const refs: Record<Focus, React.RefObject<HTMLButtonElement>> = { check: checkRef, player: playerRef, continue: continueRef };
    const go = (f: Focus) => { setFocus(f); refs[f].current?.focus(); };
    const onKey = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.code === 'GoBack';
      if (!isBack && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (isBack) { dismiss(); return; }
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) return;
      if (e.key === 'ArrowUp') go('check');
      else if (e.key === 'ArrowDown') { if (focus === 'check') go('player'); }
      else if (e.key === 'ArrowLeft') { if (focus === 'continue') go('player'); }
      else if (e.key === 'ArrowRight') { if (focus === 'player') go('continue'); }
      else if (focus === 'check') setDontShow((v) => !v);
      else if (focus === 'continue') chooseContinue();
      else choosePlayer();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focus, dontShow, onOpenPlayer, onContinue, onDismiss]);

  if (!appName || !info) return null;
  const ring = (f: Focus) => (focus === f ? 'ring-4 ring-brand-ice scale-105' : '');

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="max-w-xl bg-slate-900 border-slate-700 text-white ring-2 ring-brand-gold/40 p-7">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <Sparkles className="w-7 h-7 text-brand-gold flex-shrink-0" />
            <DialogTitle className="text-2xl text-white">{appName} is better in the Player</DialogTitle>
          </div>
          <DialogDescription className="text-slate-300 text-base">
            It's all on the main page under Player → {info.where}:
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 my-1">
          {PLAYER_BENEFITS.map((b) => (
            <li key={b} className="flex items-start text-base text-white/90 leading-snug">
              <Check className="w-5 h-5 mr-3 mt-0.5 text-emerald-300 flex-shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <button
          ref={checkRef}
          type="button"
          role="checkbox"
          aria-checked={dontShow}
          onClick={() => setDontShow((v) => !v)}
          onFocus={() => setFocus('check')}
          className={`self-start flex items-center rounded-xl px-3 py-2 text-base text-slate-200 transition-transform ${focus === 'check' ? 'ring-4 ring-brand-ice bg-white/10' : ''}`}
        >
          <span className={`mr-3 flex h-6 w-6 items-center justify-center rounded-md border-2 ${dontShow ? 'bg-brand-gold border-brand-gold text-slate-900' : 'border-slate-400'}`}>
            {dontShow && <Check className="w-4 h-4" />}
          </span>
          Don't show this again
        </button>

        <div className="grid grid-cols-2 gap-3 mt-1">
          <Button
            ref={playerRef}
            variant="gold"
            onClick={choosePlayer}
            onFocus={() => setFocus('player')}
            className={`h-12 text-base font-semibold ${ring('player')}`}
          >
            Open Player
          </Button>
          <Button
            ref={continueRef}
            variant="outline"
            onClick={chooseContinue}
            onFocus={() => setFocus('continue')}
            className={`h-12 text-base bg-slate-800 border-slate-600 text-white hover:bg-slate-700 ${ring('continue')}`}
          >
            Continue to {appName}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default memo(PlayerNudgeDialog);
