// Asks for a review on its own, on Home, when the time is right (the rule is
// shouldAskForReview in src/lib/reviewPrompt.ts): enough use on enough days,
// not snoozed, never on a Kids profile, in demo mode or signed out, never
// over playback or another dialog, never in the first 20 seconds, and only
// once the viewer has left the remote alone for a moment.
//
// Index mounts this on Home only. It looks every few seconds while it could
// matter and not at all when it can't (flag off, Kids, signed out, already
// sent, asked three times).
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { isDemo } from '@/lib/demoMode';
import { isPlexPlaybackActive } from '@/lib/plex';
import { trackEvent } from '@/lib/analytics';
import {
  appStartedAt, foregroundHours, loadReviewState, markReviewAsked, scheduleVerdict, shouldAskForReview,
} from '@/lib/reviewPrompt';

const ReviewDialog = lazy(() => import('./ReviewDialog'));

/** How often the conditions are looked at while the prompt could be due. */
export const REVIEW_CHECK_MS = 5000;

/** Anything that covers Home: Radix dialogs, our own popups, boot notices, update and download screens. */
const OVERLAY = [
  '[role="dialog"][aria-modal="true"]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[data-notice-layer]',
  '[data-autoupdate-dialog="true"]',
  '[data-download-progress="true"]',
].join(', ');

/** A player is up, or Plex is playing behind the screen. */
function playbackActive(): boolean {
  if (isPlexPlaybackActive()) return true;
  try {
    const cl = document.documentElement.classList;
    return cl.contains('snowplayer-fullscreen') || cl.contains('snowplayer-preview') || cl.contains('streaming-active');
  } catch {
    return false;
  }
}

function overlayOpen(): boolean {
  try {
    if (document.querySelector(OVERLAY)) return true;
    // The content bar's tiles take the keys while one is highlighted.
    return !!document.querySelector('[data-media-bar] [data-focused="true"]');
  } catch {
    return true;
  }
}

interface ReviewPromptHostProps {
  kids: boolean;
  signedIn: boolean;
  /** feature_flags.review_prompt (missing row = on). */
  flagOn: boolean;
  /** Home has something of its own up (pinned-apps row, content bar, a boot popup). */
  busy?: boolean;
  onOpenSupport?: () => void;
}

const ReviewPromptHost = ({ kids, signedIn, flagOn, busy = false, onOpenSupport }: ReviewPromptHostProps) => {
  const [open, setOpen] = useState(false);
  const lastKeyAt = useRef(Date.now());
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Idle = no key pressed for a while. Capture phase, so a screen that
  // swallows its keys still counts as the viewer doing something.
  useEffect(() => {
    const onKey = () => { lastKeyAt.current = Date.now(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const demo = isDemo();
  // Nothing to look at for this viewer or this box: no timer at all.
  const possible = flagOn && !demo && !kids && signedIn && !open;

  useEffect(() => {
    if (!possible) return;
    const firstState = scheduleVerdict(loadReviewState(), Date.now());
    if (firstState === 'submitted' || firstState === 'maxAsks') return;
    const tick = () => {
      const now = Date.now();
      const started = appStartedAt();
      const verdict = shouldAskForReview(loadReviewState(), {
        now,
        kids,
        demo,
        signedIn,
        flagOn,
        onHome: true,
        sinceStartMs: started ? now - started : 0,
        playing: playbackActive(),
        dialogOpen: busyRef.current || overlayOpen(),
        idleMs: now - lastKeyAt.current,
      });
      if (verdict !== 'ask') return;
      const s = markReviewAsked(now);
      setOpen(true);
      try { trackEvent('review_prompt_shown', 'review', { source: 'prompt', ask: s.asks, hours: foregroundHours(s) }); } catch { /* never blocks */ }
    };
    const id = window.setInterval(tick, REVIEW_CHECK_MS);
    return () => window.clearInterval(id);
  }, [possible, kids, demo, signedIn, flagOn]);

  const onClose = useCallback(() => setOpen(false), []);
  const onHelp = useCallback(() => { setOpen(false); onOpenSupport?.(); }, [onOpenSupport]);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ReviewDialog source="prompt" onClose={onClose} onOpenSupport={onOpenSupport ? onHelp : undefined} />
    </Suspense>
  );
};

export default ReviewPromptHost;
