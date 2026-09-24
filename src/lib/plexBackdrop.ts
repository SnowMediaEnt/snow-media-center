// The focus bus and art choice for PlexBackdrop (the highlighted title's art
// behind the Plex rails). The rails call focusBackdrop after every move; all
// it does is restart one timer, so a held D-pad costs nothing here. Only once
// the highlight has rested BACKDROP_SETTLE_MS is the mounted backdrop told.
import type { PlexItem } from '@/lib/plex';

/** The one switch. False: no backdrop anywhere, no work on focus. */
export const PLEX_BACKDROP = true;

/** How long the highlight must rest on a title before its art loads. */
export const BACKDROP_SETTLE_MS = 450;

// One listener: the mounted backdrop.
let listener: ((it: PlexItem) => void) | null = null;
let timer: number | null = null;

/** Where the highlight is now (null: nowhere — the menu, a title page). The
 *  art follows once it has rested BACKDROP_SETTLE_MS. */
export function focusBackdrop(it: PlexItem | null): void {
  if (!PLEX_BACKDROP) return;
  if (timer != null) { window.clearTimeout(timer); timer = null; }
  // The listener is looked up when the timer fires: a backdrop mounting in
  // the same commit as the rails (back from the player) still hears it.
  if (!it) return;
  timer = window.setTimeout(() => {
    timer = null;
    listener?.(it);
  }, BACKDROP_SETTLE_MS);
}

/** The mounted backdrop listens here. Returns the unsubscribe. */
export function onBackdropFocus(cb: (it: PlexItem) => void): () => void {
  listener = cb;
  return () => {
    if (listener !== cb) return;
    listener = null;
    if (timer != null) { window.clearTimeout(timer); timer = null; }
  };
}

/** Tests only. */
export function __resetBackdropForTests(): void {
  if (timer != null) window.clearTimeout(timer);
  timer = null; listener = null;
}

/** The art to show for a title, best first: its own (a list payload's `art`;
 *  an episode's is its show's), else the server's art path for it (an
 *  episode's show, from its poster path), then its poster. */
export function backdropPaths(it: PlexItem): string[] {
  const out: string[] = [];
  if (it.art) out.push(it.art);
  const show = it.type === 'episode' ? /^\/library\/metadata\/(\d+)\/thumb/.exec(it.thumb ?? '')?.[1] : undefined;
  const key = show ?? (/^\d+$/.test(it.ratingKey) ? it.ratingKey : undefined);
  if (key && !it.art) out.push(`/library/metadata/${key}/art`);
  if (it.thumb) out.push(it.thumb);
  return out;
}
