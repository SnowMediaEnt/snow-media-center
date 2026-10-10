// Shared by the Player's phone section chips (PlayerPhoneTabs.tsx), the
// Player shell (LiveTV.tsx) and Live TV's upright layout (LiveUpright.tsx).
// Ported from Tronix (4369a23).
import { createContext, type ReactNode } from 'react';

/** The section chips, handed from the Player shell to Live TV's upright
 *  layout, which draws them under its video (null anywhere else). */
export const PlayerTabsSlot = createContext<ReactNode>(null);

/** Scroll a row of chips (only the row: scrollIntoView could move the page
 *  behind it too) so `el` is in view. */
export function keepChipInView(row: HTMLElement, el: HTMLElement, pad = 12): void {
  const left = el.offsetLeft - pad;
  const right = el.offsetLeft + el.offsetWidth + pad;
  const sl = row.scrollLeft;
  if (left < sl) row.scrollLeft = Math.max(0, left);
  else if (right > sl + row.clientWidth) row.scrollLeft = right - row.clientWidth;
}

/** A chip of an upright row (sections, categories): the open one gold. */
export const chipClass = (on: boolean): string =>
  `flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm font-quicksand font-semibold border ${on
    ? 'bg-brand-gold text-brand-navy border-brand-gold'
    : 'bg-white/10 text-brand-ice border-white/10'}`;
