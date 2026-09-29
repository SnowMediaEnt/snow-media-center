// "It's on Plex": the titles this box requested that have arrived. Checked on
// the home screen — on launch, on coming back to it, and when the app returns
// to the front — at most every ten minutes, only while this box has requests
// on their way. Never over playback. The native alert
// job covers the app-closed case with a system notification.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { PartyPopper } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { checkRequests, hasPendingRequests, type ReadyRequest } from '@/lib/overseerr';
import { runAfter } from '@/utils/idle';
import { tmdbSized } from '@/lib/tmdbImage';

const RECHECK_MS = 10 * 60_000;
// Module-level: the dialog is mounted with the home screen and remounts each
// time the viewer comes back to it.
let lastCheckAt = 0;
// Arrived titles not shown yet. The check marks what it returns as notified on
// the server, so a result that lands after the dialog went away (the viewer
// left home, the profile screens opened, a Kids profile took over), or one
// still on screen when it did, waits here for the next mount.
let unshown: ReadyRequest[] = [];

interface Props { onWatch: () => void }

const RequestReadyDialog = ({ onWatch }: Props) => {
  const { t } = useTranslation();
  const [ready, setReady] = useState<ReadyRequest[]>([]);
  const [focus, setFocus] = useState<'watch' | 'ok'>('watch');
  const watchRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  // What is on screen, for the unmount below. Cleared at once on an answer:
  // "Watch in Plex" unmounts the dialog in the same render.
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const dismiss = useCallback(() => { readyRef.current = []; setReady([]); }, []);

  useEffect(() => {
    let alive = true;
    if (unshown.length) { const held = unshown; unshown = []; setReady(held); }
    const run = () => {
      if (!hasPendingRequests() || Date.now() - lastCheckAt < RECHECK_MS) return;
      lastCheckAt = Date.now();
      void checkRequests().then((list) => {
        if (!list.length) return;
        if (alive) setReady((r) => [...r, ...list]);
        else unshown = [...unshown, ...list];
      });
    };
    const cancel = runAfter(8000, run);
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      cancel();
      document.removeEventListener('visibilitychange', onVis);
      if (readyRef.current.length) unshown = [...readyRef.current, ...unshown];
    };
  }, []);

  const open = ready.length > 0;
  useEffect(() => {
    if (!open) return;
    setFocus('watch');
    const timer = setTimeout(() => watchRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      if (!isBack && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (isBack) { dismiss(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { setFocus('watch'); watchRef.current?.focus(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { setFocus('ok'); okRef.current?.focus(); }
      else if (!e.repeat) {
        dismiss();
        if (focus === 'watch') onWatch();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, focus, onWatch, dismiss]);

  if (!open) return null;
  const first = ready[0];
  const names = ready.map((r) => r.title);
  const line = names.length === 1
    ? t('plex.ready.one', { title: names[0] })
    : t('plex.ready.many', { titles: t('plex.ready.list', { first: names.slice(0, -1).join(', '), last: names[names.length - 1] }) });
  const ring = (f: 'watch' | 'ok') => (focus === f ? 'ring-4 ring-brand-ice scale-105' : '');

  return (
    <Dialog open onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="max-w-lg bg-slate-900 border-slate-700 text-white ring-2 ring-brand-gold/40 p-7">
        <div className="flex items-start">
          {first?.posterUrl && (
            <img src={tmdbSized(first.posterUrl, 'w185')} alt="" className="w-24 h-36 rounded-xl object-cover mr-5 flex-shrink-0" />
          )}
          <DialogHeader className="text-left">
            <div className="flex items-center gap-2 mb-1">
              <PartyPopper className="w-6 h-6 text-brand-gold" />
              <DialogTitle className="text-2xl text-white">{t('plex.ready.title')}</DialogTitle>
            </div>
            <DialogDescription className="text-slate-300 text-base">{line}</DialogDescription>
          </DialogHeader>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Button ref={watchRef} variant="gold" onClick={() => { dismiss(); onWatch(); }} onFocus={() => setFocus('watch')} className={`h-12 text-base font-semibold ${ring('watch')}`}>
            <span className="min-w-0 truncate">{t('plex.ready.watchBtn')}</span>
          </Button>
          <Button ref={okRef} variant="outline" onClick={dismiss} onFocus={() => setFocus('ok')} className={`h-12 text-base bg-slate-800 border-slate-600 text-white hover:bg-slate-700 ${ring('ok')}`}>
            {t('common.ok')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default memo(RequestReadyDialog);
