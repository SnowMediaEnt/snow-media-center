import type { CSSProperties } from 'react';

// The favourite being moved (useFavoritesMove), drawn OVER its row: a gold
// wash, a shadow that lifts it off the list, and the arrows that carry it.
// Laid over the row rather than wrapped round it, so the row itself
// (ChannelRow) is never drawn anew when it is lifted or put down (its logo
// would load and fade in again). The list gives the place (`style`): the
// row's box in its slot. The arrows sit where a row draws nothing that
// matters: in a list, over the left end (the channel number's corner), never
// over the right end, which carries the row's times; on a logo tile, at the
// top of the card between the LIVE tag and the star. No flex/grid gap and
// no `inset` (Chromium 66).
const ARROWS = 'absolute flex items-center justify-center rounded-md bg-brand-gold text-black font-bold leading-none';

const MovingFavoriteMark = ({ grid, style, channelId }: { grid: boolean; style: CSSProperties; channelId: number }) => (
  <div
    data-fav-moving={channelId}
    aria-hidden="true"
    className="pointer-events-none absolute z-20 rounded-xl bg-brand-gold/15 shadow-[0_8px_22px_rgba(0,0,0,0.6)]"
    style={style}
  >
    {grid ? (
      // The logo wall: ◀▶ one place, ▲▼ a row.
      <span className={`${ARROWS} top-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[11px] whitespace-nowrap`}>◀ ▲▼ ▶</span>
    ) : (
      <span className={`${ARROWS} left-0.5 top-1/2 -translate-y-1/2 w-4 py-1 flex-col text-[10px]`}>
        <span>▲</span>
        <span className="mt-1">▼</span>
      </span>
    )}
  </div>
);

export default MovingFavoriteMark;
