// Hold OK on a Plex poster: its menu, "Recommend to others"
// (PlexRecommendMenu, plexRecommend.ts).
//
// A short OK still opens the title, as it always did. On a title that has
// the menu it opens when OK is let go rather than when it goes down: that is
// the only way to tell a press from a hold, and it is how Live TV's list and
// the Guide do it. A held OK is one action: the menu opens at HOLD_MS and the
// key's repeats (a Fire TV sends them while OK is held) do nothing. A title
// without the menu (a Kids profile, the demo, an episode whose show is not
// known) still opens on the press, exactly as before.
//
// Touch: a finger held still on a poster (or a right click) opens the same
// menu, and the lift that follows is not also a tap.
//
// While the menu is up it owns the remote: it takes the key owner 'menu'
// synchronously as it opens, so every Plex panel's handler (and the title
// page's) bails on its first line, and gives the owner back as it closes.
import i18n from '@/i18n';
import { toast } from '@/hooks/use-toast';
import type { PlexItem } from '@/lib/plex';
import { canRecommend, type RecommendResult } from '@/lib/plexRecommend';
import { getPlexKeyOwner, setPlexKeyOwner, type PlexKeyOwner } from './plexKeyOwner';

/** Hold OK (or a finger) this long on a poster for its menu. */
export const PLEX_HOLD_MS = 600;
/** A tap this soon after a finger's hold opened the menu is that finger's lift. */
const LIFT_CLICK_MS = 700;

// ── the menu ───────────────────────────────────────────────────────────────
// PlexSection draws the menu; the panels and the title page only ask for it.
type Opener = (item: PlexItem) => void;
let opener: Opener | null = null;
let ownerBefore: PlexKeyOwner = 'browse';

/** PlexSection: draw the menu for the item asked for. Returns an unsubscribe. */
export function onPlexHoldMenu(fn: Opener): () => void {
  opener = fn;
  return () => { if (opener === fn) opener = null; };
}

/** Open the menu for a poster, taking the remote first. False when the
 *  title has no menu or nothing can draw it. */
export function openPlexHoldMenu(item: PlexItem): boolean {
  if (!opener || !canRecommend(item)) return false;
  const now = getPlexKeyOwner();
  if (now !== 'menu') ownerBefore = now;
  setPlexKeyOwner('menu');
  opener(item);
  return true;
}

/** The menu closed: the remote goes back to whoever had it (the rails, the
 *  title page). Safe to call twice, and a no-op once another layer took it. */
export function releasePlexHoldMenu(): void {
  if (getPlexKeyOwner() === 'menu') setPlexKeyOwner(ownerBefore);
}

/** The menu is up: it holds the remote. openPlexHoldMenu already took it;
 *  this takes it again after a development remount gave it back. */
export function claimPlexHoldMenu(): void {
  const now = getPlexKeyOwner();
  if (now === 'menu') return;
  ownerBefore = now;
  setPlexKeyOwner('menu');
}

// Whether OK is down right now on a poster that has the menu (from the press
// to the release). The menu takes OK at once when it is not: it was opened by
// a right click or an air mouse, or the release came before the menu was up
// (a slow stick). Otherwise it waits for that release.
let okHeld = false;
export const plexOkHeld = (): boolean => okHeld;
// Every release is heard here, before any panel's listener and whichever
// panel has the remote by then.
if (typeof window !== 'undefined') {
  window.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') okHeld = false; }, true);
}

// ── OK on the remote ───────────────────────────────────────────────────────
export interface PlexHoldOk {
  /** OK went down on `item`. `open` is what a short press does (open the
   *  title); it runs when OK is let go, or now for a title with no menu. */
  press(e: KeyboardEvent, item: PlexItem | null | undefined, open: (it: PlexItem) => void): void;
  /** Any key let go: OK let go before the hold time is a press. */
  release(e: KeyboardEvent): void;
  /** The panel lost the remote: a hold under way comes to nothing. */
  cancel(): void;
}

/** One per key handler (a rail browser, a grid). */
export function createPlexHoldOk(): PlexHoldOk {
  let timer: number | null = null;
  let held: { item: PlexItem; open: (it: PlexItem) => void } | null = null;
  const clear = () => {
    if (timer != null) window.clearTimeout(timer);
    timer = null;
    held = null;
  };
  return {
    press(e, item, open) {
      // A held key's repeats, and a second press while one is timed.
      if (e.repeat || timer != null || !item) return;
      if (!canRecommend(item)) { open(item); return; }
      held = { item, open };
      okHeld = true;
      timer = window.setTimeout(() => {
        const h = held;
        timer = null;
        held = null;
        // Plex closed meanwhile and nothing can draw the menu: the hold was
        // a press after all.
        if (h && !openPlexHoldMenu(h.item)) h.open(h.item);
      }, PLEX_HOLD_MS) as unknown as number;
    },
    release(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      okHeld = false;
      const h = held;
      clear();
      if (h) h.open(h.item);
    },
    cancel: () => { okHeld = false; clear(); },
  };
}

// ── a finger on a poster ───────────────────────────────────────────────────
let touchTimer: number | null = null;
let heldAt = 0;

const cancelTouchHold = (): void => {
  if (touchTimer != null) { window.clearTimeout(touchTimer); touchTimer = null; }
};

/** A tap that is really the lift of the finger whose hold just opened the menu. */
export const tapIsHoldLift = (): boolean => Date.now() - heldAt < LIFT_CLICK_MS;

/** The touch and right-click handlers for a poster. A finger that moves is
 *  scrolling the rail and cancels the hold. */
export function tileHoldProps(item: PlexItem) {
  return {
    onTouchStart: () => {
      cancelTouchHold();
      if (!canRecommend(item)) return;
      touchTimer = window.setTimeout(() => {
        touchTimer = null;
        if (openPlexHoldMenu(item)) heldAt = Date.now();
      }, PLEX_HOLD_MS) as unknown as number;
    },
    onTouchMove: cancelTouchHold,
    onTouchEnd: cancelTouchHold,
    onTouchCancel: cancelTouchHold,
    onContextMenu: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      // The system's own long press of the finger that just opened it: once.
      if (tapIsHoldLift()) return;
      const touching = touchTimer != null;
      cancelTouchHold();
      if (openPlexHoldMenu(item) && touching) heldAt = Date.now();
    },
  };
}

// ── what happened ──────────────────────────────────────────────────────────
/** The toast after a recommend (`adding`) or a take-back. i18n.t, not a
 *  hook: the menu that asked may be gone by the time the answer lands. */
export function toastRecommendResult(result: RecommendResult, adding: boolean, title: string): void {
  try {
    if (result === 'ok') {
      toast({ title: i18n.t(adding ? 'plex.recommend.toast.added' : 'plex.recommend.toast.removed'), description: title });
    } else if (result === 'limit') {
      toast({ title: i18n.t('plex.recommend.toast.limitTitle'), description: i18n.t('plex.recommend.toast.limitDesc') });
    } else if (result === 'signed_out') {
      toast({ title: i18n.t('plex.recommend.toast.signInTitle'), description: i18n.t('plex.recommend.signIn') });
    } else {
      toast({ title: i18n.t('plex.recommend.toast.failedTitle'), description: i18n.t('plex.recommend.toast.failedDesc'), variant: 'destructive' });
    }
  } catch { /* ignore */ }
}

/** Tests only. */
export function __resetPlexHoldForTests(okDown = false): void {
  opener = null; ownerBefore = 'browse'; cancelTouchHold(); heldAt = 0; okHeld = okDown;
}
