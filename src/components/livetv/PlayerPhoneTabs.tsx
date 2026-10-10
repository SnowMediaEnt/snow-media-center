// The Player's sections on a phone held upright: one row of chips that
// scrolls sideways (Live TV, Guide, Game Day, VOD, Multi-Screen, Snow Media
// originals, Backups) in place of the TV's side menu. A tap opens the
// section.
//
// Live TV draws the row itself, under its video (LiveUpright reads it from
// PlayerTabsSlot, ./playerTabs); every other section gets it at the top from
// the Player shell (LiveTV.tsx). Phones only: a modern WebView, so flex gap
// is fine. Ported from Tronix (4369a23).
import { memo, useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { chipClass, keepChipInView } from './playerTabs';

export interface PlayerTab {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface Props {
  tabs: PlayerTab[];
  active: string;
  onPick: (id: string) => void;
}

const PlayerPhoneTabs = memo(({ tabs, active, onPick }: Props) => {
  const rowRef = useRef<HTMLDivElement>(null);
  // The open section's chip stays in view.
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>(`[data-player-tab="${active}"]`);
    if (row && el) keepChipInView(row, el);
  }, [active]);
  return (
    <div
      ref={rowRef}
      data-player-phone-tabs
      data-touch-scroll-x
      role="tablist"
      className="flex-shrink-0 flex items-center gap-2 px-3 py-2 overflow-x-auto whitespace-nowrap"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            data-player-tab={tab.id}
            data-active={on ? 'true' : 'false'}
            onClick={() => onPick(tab.id)}
            className={chipClass(on)}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
});
PlayerPhoneTabs.displayName = 'PlayerPhoneTabs';

export default PlayerPhoneTabs;
