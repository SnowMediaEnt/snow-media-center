import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Gift } from 'lucide-react';
import { useActiveGiveaway } from '@/hooks/useActiveGiveaway';
import { trackEvent } from '@/lib/analytics';

const WELCOME_KEY = 'smc-welcome-shown-version';
const seenKey = (id: string) => `smc_giveaway_seen_${id}`;
// Extra settle time after first-frame idle so we never stack on top of the
// WelcomePopup / MediaBarPrompt / pre-event startup dialogs.
const MIN_DELAY_MS = 3000;

/**
 * First-open giveaway promo. Shown once per device PER GIVEAWAY
 * (localStorage key smc_giveaway_seen_<id>). Generic — driven entirely by the
 * active row in public.giveaways, nothing hardcoded to a specific giveaway.
 *
 * Sequencing mirrors MediaBarPrompt: poll until the WelcomePopup storage key
 * exists AND no other aria-modal dialog is in the DOM, then open. The parent
 * only mounts this when the giveaway_enabled flag is on and demo mode is off.
 */
const GiveawayPromoPopup = ({ onViewGiveaway }: { onViewGiveaway: () => void }) => {
  const giveaway = useActiveGiveaway(true);
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0); // 0 = View Giveaway, 1 = Not now
  const [imgFailed, setImgFailed] = useState(false);
  const focusIdxRef = useRef(focusIdx);
  const mountedAtRef = useRef(Date.now());
  useEffect(() => { focusIdxRef.current = focusIdx; }, [focusIdx]);

  const giveawayId = giveaway?.id ?? null;

  // Days-only countdown, computed once when the giveaway loads (no interval —
  // the popup is short-lived and weak boxes don't need the churn).
  const daysLeft = useMemo(() => {
    if (!giveaway?.end_at) return null;
    const end = Date.parse(giveaway.end_at);
    if (Number.isNaN(end)) return null;
    const ms = end - Date.now();
    if (ms <= 0) return 0;
    return Math.max(1, Math.floor(ms / 86400000));
  }, [giveaway?.end_at]);

  // Decide whether to open. Poll briefly so startup dialogs (Welcome "What's
  // New", MediaBar prompt, pre-event steps, app alerts) always go first.
  useEffect(() => {
    if (!giveawayId) return;
    let cancelled = false;
    const tryOpen = (): boolean => {
      if (cancelled) return true;
      try {
        if (localStorage.getItem(seenKey(giveawayId))) return true; // already seen, stop
      } catch {
        return true;
      }
      if (Date.now() - mountedAtRef.current < MIN_DELAY_MS) return false;
      try {
        if (!localStorage.getItem(WELCOME_KEY)) return false; // welcome not dismissed yet
      } catch {
        /* storage unavailable — keep waiting rather than stacking popups */
        return false;
      }
      // Never stack on top of another modal
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return false;
      setOpen(true);
      try { trackEvent('giveaway_popup_shown', 'giveaway', { giveaway_id: giveawayId }); } catch { void 0; }
      return true;
    };
    if (tryOpen()) return;
    const id = window.setInterval(() => {
      if (tryOpen()) window.clearInterval(id);
    }, 800);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [giveawayId]);

  const markSeen = () => {
    if (!giveawayId) return;
    try { localStorage.setItem(seenKey(giveawayId), '1'); } catch { /* ignore */ }
  };

  const onView = () => {
    try { trackEvent('giveaway_popup_view_click', 'giveaway', { giveaway_id: giveawayId }); } catch { void 0; }
    markSeen();
    setOpen(false);
    onViewGiveaway();
  };
  const onNotNow = () => {
    markSeen();
    setOpen(false);
  };

  // Trap keyboard while open (capture phase; D-pad + Android back keyCodes)
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
        if (key === 'ArrowLeft' || (key === 'Tab' && e.shiftKey)) setFocusIdx(1);
        else if (key === 'ArrowRight' || key === 'Tab') setFocusIdx(0);
        return;
      }
      if (key === 'Enter' || key === ' ' || code === 13 || code === 23 || code === 66) {
        e.preventDefault(); e.stopPropagation();
        if (focusIdxRef.current === 0) onView(); else onNotNow();
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep real DOM focus on the active button
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const sel = focusIdxRef.current === 0 ? '[data-gap-btn="view"]' : '[data-gap-btn="dismiss"]';
      document.querySelector<HTMLButtonElement>(sel)?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [open, focusIdx]);

  if (!open || !giveaway) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/85 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-full max-w-lg bg-gradient-to-br from-blue-900 to-slate-900 border-yellow-500/40 p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <Gift className="w-6 h-6 text-yellow-300" />
          <h2 className="text-2xl font-bold text-white">{giveaway.name}</h2>
        </div>

        {giveaway.prize_image_url && !imgFailed ? (
          <img
            src={giveaway.prize_image_url}
            alt=""
            draggable={false}
            onError={() => setImgFailed(true)}
            className="w-full max-h-[32vh] object-contain rounded-xl mb-4 bg-black/30"
          />
        ) : (
          <div className="w-full h-28 rounded-xl mb-4 bg-black/30 border border-yellow-500/20 flex items-center justify-center">
            <Gift className="w-12 h-12 text-yellow-300/80" />
          </div>
        )}

        <p className="text-sm text-white/90 mb-2">
          {giveaway.description || giveaway.prize_description || 'A new giveaway is live!'}
        </p>
        <p className={`text-sm text-yellow-300/90 font-semibold ${daysLeft !== null ? 'mb-1' : 'mb-5'}`}>
          You may already be entered — check your entries!
        </p>
        {daysLeft !== null && (
          <p className="text-sm text-white/80 mb-4">
            ⏳ Ends in {daysLeft} day{daysLeft === 1 ? '' : 's'}
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <Button
            data-gap-btn="dismiss"
            variant="white"
            onClick={onNotNow}
            className={`tv-focusable transition-transform duration-150 ${
              focusIdx === 1 ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_14px_rgba(245,200,80,0.45)]' : ''
            }`}
          >
            Not now
          </Button>
          <Button
            data-gap-btn="view"
            onClick={onView}
            className={`bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 tv-focusable transition-transform duration-150 ${
              focusIdx === 0 ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_14px_rgba(245,200,80,0.45)]' : ''
            }`}
          >
            View Giveaway
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default memo(GiveawayPromoPopup);
