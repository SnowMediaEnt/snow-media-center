/**
 * Shared input gating for every casino game.
 *
 * Two things every game must agree on:
 *
 * 1. While a GLOBAL modal is open (auto-update dialog, download progress, any
 *    aria-modal overlay), the game yields completely: it must not consume Back,
 *    OK/Select or arrows, and it must not move focus behind the overlay. The
 *    selector list is deliberately identical to the one useNavigation uses, so
 *    the app has exactly one definition of "a modal owns input right now".
 *
 * 2. Arrow keys belong to the managed focus graph. A game consumes every arrow
 *    while it is on screen — even at a graph boundary — because a native TV
 *    WebView would otherwise apply its own spatial navigation and drift away
 *    from the single `data-tv-focused` marker.
 */
export const GLOBAL_MODAL_SELECTOR =
  '[data-autoupdate-dialog="true"], [data-download-progress="true"], [aria-modal="true"]';

export const isGlobalModalOpen = (): boolean => {
  if (typeof document === 'undefined') return false;
  return document.querySelector(GLOBAL_MODAL_SELECTOR) !== null;
};

export type ArrowDir = 'left' | 'right' | 'up' | 'down';

/** Arrow direction for both key names and legacy TV keyCodes (37-40). */
export const arrowDir = (event: KeyboardEvent): ArrowDir | null => {
  switch (event.key) {
    case 'ArrowLeft': case 'Left': return 'left';
    case 'ArrowRight': case 'Right': return 'right';
    case 'ArrowUp': case 'Up': return 'up';
    case 'ArrowDown': case 'Down': return 'down';
    default: break;
  }
  const code = event.keyCode || (event as KeyboardEvent & { which?: number }).which || 0;
  if (code === 37) return 'left';
  if (code === 39) return 'right';
  if (code === 38) return 'up';
  if (code === 40) return 'down';
  return null;
};

/**
 * Arrow direction in the document's visual order. RTL layouts reverse the
 * horizontal placement of grid/flex children, so a physical Left press must
 * advance through source-order controls instead of moving backward through
 * them. Up and Down are unchanged.
 */
export const visualArrowDir = (event: KeyboardEvent): ArrowDir | null => {
  const direction = arrowDir(event);
  if (direction !== 'left' && direction !== 'right') return direction;
  if (typeof document === 'undefined' || document.documentElement.dir !== 'rtl') return direction;
  return direction === 'left' ? 'right' : 'left';
};

/**
 * Terminal round outcomes: the server has CONFIRMED there is no live round any
 * more, so keeping a local playing/dealt/decision phase would trap the player
 * behind a Back guard forever. A transport timeout or an unknown failure is
 * never terminal — the round may still be live on the server.
 */
const TERMINAL_ROUND_ERRORS = new Set(['no_active_round', 'game_disabled', 'round_not_found']);

export const isTerminalRoundError = (error?: string | null): boolean =>
  typeof error === 'string' && TERMINAL_ROUND_ERRORS.has(error);
