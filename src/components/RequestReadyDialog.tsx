// "It's on Plex": the titles this box requested that have arrived. Checked on
// the home screen — on launch, on coming back to it, and when the app returns
// to the front — at most every ten minutes, only while this box has requests
// on their way. Never over playback. The native alert
// job covers the app-closed case with a system notification.
import { memo, useEffect, useRef, useState } from 'react';
import { PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { checkRequests, hasPendingRequests, type ReadyRequest } from '@/lib/overseerr';
import { runAfter } from '@/utils/idle';
import { tmdbSized } from '@/lib/tmdbImage';

const RECHECK_MS = 10 * 60_000;
// Module-level: the dialog is mounted with the home screen and remounts each
// time the viewer comes back to it.
let lastCheckAt = 0;

interface Props { onWatch: () => void }

const RequestReadyDialog = ({ onWatch }: Props) => {
  const [ready, setReady] = useState<ReadyRequest[]>([]);
  const [focus, setFocus] = useState<'watch' | 'ok'>('watch');
  const watchRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (!hasPendingRequests() || Date.now() - lastCheckAt < RECHECK_MS) return;
      lastCheckAt = Date.now();
      void checkRequests().then((list) => { if (alive && list.length) setReady((r) => [...r, ...list]); });
    };
    const cancel = runAfter(8000, run);
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; cancel(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const open = ready.length > 0;
  useEffect(() => {
    if (!open) return;
    setFocus('watch');
    const t = setTimeout(() => watchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      if (!isBack && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (isBack) { setReady([]); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { setFocus('watch'); watchRef.current?.focus(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { setFocus('ok'); okRef.current?.focus(); }
      else if (!e.repeat) {
        setReady([]);
        if (focus === 'watch') onWatch();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, focus, onWatch]);

  if (!open) return null;
  const first = ready[0];
  const names = ready.map((r) => r.title);
  const line = names.length === 1 ? `${names[0]} is ready to watch.` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are ready to watch.`;
  const ring = (f: 'watch' | 'ok') => (focus === f ? 'ring-4 ring-brand-ice scale-105' : '');

  return (
    <Dialog open onOpenChange={(o) => { if (!o) setReady([]); }}>
      <DialogContent className="max-w-lg bg-slate-900 border-slate-700 text-white ring-2 ring-brand-gold/40 p-7">
        <div className="flex items-start">
          {first?.posterUrl && (
            <img src={tmdbSized(first.posterUrl, 'w185')} alt="" className="w-24 h-36 rounded-xl object-cover mr-5 flex-shrink-0" />
          )}
          <DialogHeader className="text-left">
            <div className="flex items-center gap-2 mb-1">
              <PartyPopper className="w-6 h-6 text-brand-gold" />
              <DialogTitle className="text-2xl text-white">Your request is on Plex</DialogTitle>
            </div>
            <DialogDescription className="text-slate-300 text-base">{line}</DialogDescription>
          </DialogHeader>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Button ref={watchRef} variant="gold" onClick={() => { setReady([]); onWatch(); }} onFocus={() => setFocus('watch')} className={`h-12 text-base font-semibold ${ring('watch')}`}>
            Watch in Plex
          </Button>
          <Button ref={okRef} variant="outline" onClick={() => setReady([])} onFocus={() => setFocus('ok')} className={`h-12 text-base bg-slate-800 border-slate-600 text-white hover:bg-slate-700 ${ring('ok')}`}>
            OK
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default memo(RequestReadyDialog);
