/* eslint-disable react-refresh/only-export-components -- the chip and its size (used to keep labels off it) live together */
import { useTranslation } from 'react-i18next';
import type { RemoteHint } from '@/data/howtoContract';

// A small chip that says which remote button to use, with the button drawn.
// Literal keys, so a missing translation is found by search.
export const HINT_KEY: Record<RemoteHint, string> = {
  ok: 'guides.howTo.remote.ok',
  holdOk: 'guides.howTo.remote.holdOk',
  back: 'guides.howTo.remote.back',
  upDown: 'guides.howTo.remote.upDown',
  leftRight: 'guides.howTo.remote.leftRight',
};

export const CHIP_HEIGHT_PX = 34;
export const CHIP_ICON_PX = 24;
/** Where the chip sits, in px from the frame's left and bottom edges. */
export const CHIP_OFFSET_PX = 10;

const GOLD = 'hsl(39, 31%, 60%)';

/** The button, 24x24: a circle for OK, a filled circle inside a ring for Hold OK, arrows, a U-turn for Back. */
function HintIcon({ hint }: { hint: RemoteHint }) {
  const stroke = { stroke: GOLD, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  // One drawing per hint, looked up by key.
  const icons: Record<RemoteHint, JSX.Element> = {
    ok: <circle cx="12" cy="12" r="6.5" {...stroke} />,
    holdOk: (
      <>
        <circle cx="12" cy="12" r="10" {...stroke} strokeWidth={1.5} strokeDasharray="3 3" />
        <circle cx="12" cy="12" r="6" fill={GOLD} />
      </>
    ),
    back: <path d="M9 5 L3 11 L9 17 M3 11 H16 A4.5 4.5 0 0 1 16 20 H11" {...stroke} />,
    upDown: (
      <>
        <path d="M12 3 L18 10 H6 Z" fill={GOLD} />
        <path d="M12 21 L18 14 H6 Z" fill={GOLD} />
      </>
    ),
    leftRight: (
      <>
        <path d="M3 12 L10 6 V18 Z" fill={GOLD} />
        <path d="M21 12 L14 6 V18 Z" fill={GOLD} />
      </>
    ),
  };
  return (
    <svg width={CHIP_ICON_PX} height={CHIP_ICON_PX} viewBox="0 0 24 24" className="flex-shrink-0" focusable="false">
      {icons[hint]}
    </svg>
  );
}

/** Chip width in px for a text, a little on the big side (used to keep labels off it). */
export function chipWidthPx(text: string): number {
  return 8 + CHIP_ICON_PX + 8 + text.length * 9.5 + 14 + 4;
}

export default function RemoteHintChip({ hint }: { hint: RemoteHint }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="howto-remote-chip"
      className="absolute flex items-center rounded-full font-bold text-white"
      style={{
        left: CHIP_OFFSET_PX + 'px',
        bottom: CHIP_OFFSET_PX + 'px',
        height: CHIP_HEIGHT_PX + 'px',
        paddingLeft: '8px',
        paddingRight: '14px',
        fontSize: '15px',
        lineHeight: '1.2',
        backgroundColor: 'rgba(6, 13, 30, 0.92)',
        border: '2px solid ' + GOLD,
        boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
        whiteSpace: 'nowrap',
      }}
    >
      <HintIcon hint={hint} />
      <span dir="auto" style={{ marginLeft: '8px' }}>{t(HINT_KEY[hint])}</span>
    </div>
  );
}
