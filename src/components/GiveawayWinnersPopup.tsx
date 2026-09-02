import { memo, useEffect, useRef, useState } from 'react';
import { PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { trackEvent } from '@/lib/analytics';
import type { AnnouncedGiveaway } from '@/hooks/useGiveawayWinners';

const WELCOME_KEY = 'smc-welcome-shown-version';
// Extra settle time so we queue behind Welcome / pre-event / update popups.
const MIN_DELAY_MS = 3000;

interface Props {
  giveaway: AnnouncedGiveaway;
  onDismiss: () => void;
}

/** Strip the simplest markdown so announcement_md reads cleanly on TV. */
const plainify = (md: string) =>
  md
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`>]/g, '')
    .trim();

const GiveawayWinnersPopup = ({ giveaway, onDismiss }: Props) => {
  const okRef = useRef<HTMLButtonElement>(null);
  const mountedAtRef = useRef(Date.now());
  const [open, setOpen] = useState(false);

  // Sequence behind any other boot popup rather than stacking on top.
  useEffect(() => {
    let cancelled = false;
    const tryOpen = (): boolean => {
      if (cancelled) return true;
      if (Date.now() - mountedAtRef.current < MIN_DELAY_MS) return false;
      try { if (!localStorage.getItem(WELCOME_KEY)) return false; } catch { return false; }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return false;
      setOpen(true);
      try { trackEvent('giveaway_winners_popup_shown', 'giveaway', { giveaway_id: giveaway.giveawayId }); } catch { void 0; }
      return true;
    };
    if (tryOpen()) return;
    const id = window.setInterval(() => { if (tryOpen()) window.clearInterval(id); }, 800);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [giveaway.giveawayId]);

  const handleDismiss = () => {
    try { trackEvent('alert_popup_action', 'alerts', { alert: 'giveaway_winners', action: 'ok', giveaway_id: giveaway.giveawayId }); } catch { void 0; }
    setOpen(false);
    onDismiss();
  };

  useEffect(() => {
    if (open) setTimeout(() => okRef.current?.focus(), 50);
  }, [open]);

  // D-pad: Enter / OK / Back / Escape all dismiss (capture phase).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'Escape', 'Backspace'].includes(e.key) || e.keyCode === 4) {
        e.preventDefault();
        e.stopPropagation();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const announcement = giveaway.announcementMd ? plainify(giveaway.announcementMd) : '';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleDismiss(); }}>
      <DialogContent className="max-w-lg w-full max-h-[85vh] bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-2 border-brand-gold/60 text-white ring-4 ring-brand-gold/30 shadow-[0_0_60px_rgba(212,175,55,0.35)] p-0 overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-brand-gold/30 via-yellow-500/20 to-brand-gold/30 px-6 py-4 border-b border-brand-gold/40 flex items-center gap-3">
          <PartyPopper className="w-6 h-6 text-brand-gold drop-shadow" />
          <h2 className="text-2xl font-bold text-white leading-tight tracking-tight">
            🎉 We have winners!
          </h2>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {giveaway.name && (
            <p className="text-lg font-semibold text-brand-gold">{giveaway.name}</p>
          )}

          <ol className="space-y-3">
            {giveaway.winners.map((w) => (
              <li key={`${w.position}-${w.name}`} className="flex items-start gap-3 text-base font-medium text-slate-100">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-gold text-slate-900 flex items-center justify-center font-bold text-base shadow-lg">
                  {w.position}
                </span>
                <span className="pt-0.5">{w.name}</span>
              </li>
            ))}
          </ol>

          {giveaway.prizeDescription && (
            <p className="text-base text-slate-200">
              <span className="text-slate-400">Prize: </span>
              {giveaway.prizeDescription}
            </p>
          )}

          {announcement && (
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{announcement}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-brand-gold/30 bg-slate-950/60 flex justify-center">
          <Button
            ref={okRef}
            variant="gold"
            onClick={handleDismiss}
            className="min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 scale-100 focus:ring-brand-ice focus:scale-105 transition"
          >
            Dismiss
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default memo(GiveawayWinnersPopup);
