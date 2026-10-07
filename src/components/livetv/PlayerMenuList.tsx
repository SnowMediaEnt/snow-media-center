import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { keepInView } from '@/utils/keepInView';

/** Rows shown at once; the rest scroll. A row (py-3, text-sm, space-y-1) is 3 rem. */
export const MENU_VISIBLE_ROWS = 5;
const ROW_REM = 3;

/**
 * The rows of a player menu (subtitles, audio…), at most five tall. A long
 * list (a film with 20 subtitle tracks) used to grow upwards past the top of
 * the screen with the highlight out of sight; now it scrolls inside the menu,
 * keeps the highlighted row in view, and says where you are ("3 / 24").
 * `focused` is the highlighted row's position in the list (0-based).
 */
export default function PlayerMenuList({ focused, total, children }: { focused: number; total: number; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const el = box?.querySelector<HTMLElement>('[data-focused="true"]');
    if (box && el) keepInView(box, el, 4);
  }, [focused, total]);
  const scrolls = total > MENU_VISIBLE_ROWS;
  return (
    <>
      <div
        ref={boxRef}
        data-player-menu-list=""
        className={`space-y-1 ${scrolls ? 'overflow-y-auto p-1 -m-1' : ''}`}
        style={scrolls ? { maxHeight: `${MENU_VISIBLE_ROWS * ROW_REM}rem` } : undefined}
      >
        {children}
      </div>
      {scrolls && (
        <p data-player-menu-count="" className="px-2 pt-1 text-right text-xs text-brand-ice/60 font-nunito tabular-nums">
          {Math.min(total, Math.max(1, focused + 1))} / {total}
        </p>
      )}
    </>
  );
}
