import type { ReactNode } from 'react';

// The favourite being moved (useFavoritesMove): lifted out of the list — a
// shadow under it, a gold wash over it — with the arrows that carry it, so
// it reads differently from the plain highlight. Drawn AROUND the row, so
// the row itself (ChannelRow) is exactly as ever. No flex/grid gap and no
// `inset` (Chromium 66): the arrows are stacked spans, placed by top/left.
const MovingFavoriteFrame = ({ grid, children }: { grid: boolean; children: ReactNode }) => (
  <div
    data-fav-moving=""
    className={`relative z-20 rounded-xl shadow-[0_8px_22px_rgba(0,0,0,0.6)] ${grid ? 'h-full' : ''}`}
  >
    {children}
    <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 right-0 bottom-0 rounded-xl bg-brand-gold/15" />
    {grid ? (
      // The logo wall: ◀▶ one place, ▲▼ a row. Over the top of the tile.
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-brand-gold text-black font-nunito font-bold text-[11px] leading-4 whitespace-nowrap"
      >
        ◀ ▲▼ ▶
      </span>
    ) : (
      // A list row: ▲ over ▼ at its right end, clear of the name.
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-6 py-0.5 flex flex-col items-center rounded-md bg-brand-gold text-black font-bold text-[11px] leading-[14px]"
      >
        <span>▲</span>
        <span>▼</span>
      </span>
    )}
  </div>
);

export default MovingFavoriteFrame;
