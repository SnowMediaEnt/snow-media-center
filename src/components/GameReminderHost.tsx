// Kickoff popups for Game Day's "Remind me" (lib/gameReminders). Checks every
// twenty seconds while the app is open; a game starting now (or started in
// the last half hour, if the app was just opened) pops up on the TV with
// Watch (straight to its channel) and Dismiss. Shows over anything, playback
// included — that's the point of a reminder — one at a time.
import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Trophy } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { playChannel, playLiveChannel, type Navigate } from '@/lib/appActions';
import { dueReminders, markFired, type GameReminder } from '@/lib/gameReminders';

const CHECK_MS = 20_000;
const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.keyCode === 4 || e.keyCode === 27;
const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66;

const GameReminderHost = ({ navigate }: { navigate: Navigate }) => {
  const [current, setCurrent] = useState<GameReminder | null>(null);
  const [focus, setFocus] = useState<0 | 1>(0);
  const focusRef = useRef(focus); focusRef.current = focus;
  const currentRef = useRef(current); currentRef.current = current;
  const navigateRef = useRef(navigate); navigateRef.current = navigate;

  useEffect(() => {
    const check = () => {
      if (currentRef.current) return;
      const due = dueReminders()[0];
      if (!due) return;
      markFired(due.id);
      setFocus(0);
      setCurrent(due);
    };
    check();
    const id = window.setInterval(check, CHECK_MS);
    return () => window.clearInterval(id);
  }, []);

  const close = useCallback((watch: boolean) => {
    const r = currentRef.current;
    setCurrent(null);
    if (!watch || !r) return;
    if (r.channel) playLiveChannel(r.channel, navigateRef.current);
    else if (r.networks[0]) playChannel(r.networks[0], navigateRef.current);
  }, []);

  const lastBack = useRef(0);
  useEffect(() => {
    if (!current) return;
    const back = () => {
      const now = Date.now();
      if (now - lastBack.current < 350) return;
      lastBack.current = now;
      (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (isBack(e)) { e.preventDefault(); back(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); setFocus((f) => (f === 0 ? 1 : 0)); return;
      }
      if (isOk(e)) { e.preventDefault(); close(focusRef.current === 0); }
    };
    window.addEventListener('keydown', onKey, true);
    let handle: { remove: () => void } | null = null;
    let cancelled = false;
    void CapApp.addListener('backButton', back).then((h) => { if (cancelled) h.remove(); else handle = h; }).catch(() => { /* web */ });
    return () => { window.removeEventListener('keydown', onKey, true); cancelled = true; handle?.remove(); };
  }, [current, close]);

  if (!current) return null;
  const where = current.channel?.name ?? (current.networks.length ? current.networks.join(', ') : null);
  const btn = (i: 0 | 1) => `tv-ring rounded-xl px-6 py-3 text-lg font-semibold ${focus === i ? 'bg-white text-black' : 'bg-white/10 text-white'}`;
  return (
    <div className="fixed inset-0 z-[170] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" data-state="open" aria-label="Game starting">
      <Card className="w-full max-w-xl bg-gradient-to-br from-blue-900 to-slate-900 border-brand-gold/50 p-7 shadow-2xl text-white">
        <div className="flex items-center mb-3">
          <Trophy className="w-7 h-7 text-brand-gold mr-3" />
          <span className="text-sm uppercase tracking-widest text-brand-ice/80">{current.leagueLabel} · Starting now</span>
        </div>
        <h2 className="text-3xl font-bold mb-2">{current.title}</h2>
        {where && <p className="text-lg text-white/80 mb-6">On {where}</p>}
        <div className="flex">
          <button type="button" data-focused={focus === 0 ? 'true' : 'false'} className={`${btn(0)} mr-3`} onClick={() => close(true)}>Watch</button>
          <button type="button" data-focused={focus === 1 ? 'true' : 'false'} className={btn(1)} onClick={() => close(false)}>Dismiss</button>
        </div>
      </Card>
    </div>
  );
};

export default GameReminderHost;
