/* eslint-disable react-refresh/only-export-components -- the drawing and where its buttons are live together */
import type { ShotRect } from '@/data/howtoContract';
import type { Box, Side } from './calloutLayout';

// The remote, drawn in code (no screenshot). Drawn on a 160 x 90 sheet, the
// same shape as the picture frame, so the rects below are plain percents of it.

const W = 160;
const H = 90;
const pct = (x: number, y: number, w: number, h: number): ShotRect => [
  Math.round((x / W) * 10000) / 100,
  Math.round((y / H) * 10000) / 100,
  Math.round((w / W) * 10000) / 100,
  Math.round((h / H) * 10000) / 100,
];

/** Where each lit part of the remote is (the ids of HOWTO_DIAGRAMS.remote). */
export const REMOTE_RECTS: Record<string, ShotRect> = {
  'remote.arrows': pct(68, 24, 24, 24),
  'remote.ok': pct(75, 31, 10, 10),
  'remote.back': pct(67.5, 55.5, 9, 9),
  'remote.home': pct(83.5, 55.5, 9, 9),
  'remote.mic': pct(76, 8, 8, 8),
};

/** Labels go beside the remote, not on it: each one is anchored to the body and
 *  its pointer reaches across to the button. */
export const REMOTE_BODY: Box = { left: (65 / W) * 100, top: (3 / H) * 100, width: (30 / W) * 100, height: (84 / H) * 100 };
export const REMOTE_SIDES: Record<string, Side> = {
  'remote.arrows': 'left',
  'remote.ok': 'right',
  'remote.back': 'left',
  'remote.home': 'right',
  'remote.mic': 'right',
};

const GOLD = 'hsl(39, 31%, 60%)';
const BODY = '#1e293b';
const BUTTON = '#334155';
const EDGE = '#64748b';

export default function RemoteDiagram() {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute top-0 left-0 w-full h-full"
      focusable="false"
      data-testid="howto-remote-diagram"
    >
      <defs>
        <linearGradient id="howto-remote-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f1b33" />
          <stop offset="1" stopColor="#060d1e" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="url(#howto-remote-bg)" />
      <rect x="65" y="3" width="30" height="84" rx="12" fill={BODY} stroke={EDGE} strokeWidth="0.8" />
      {/* mic */}
      <circle cx="80" cy="12" r="4" fill={BUTTON} stroke={EDGE} strokeWidth="0.6" />
      <rect x="78.8" y="9.6" width="2.4" height="3.8" rx="1.2" fill="#cbd5e1" />
      {/* arrows ring with OK in the middle */}
      <circle cx="80" cy="36" r="12" fill={BUTTON} stroke={EDGE} strokeWidth="0.8" />
      <path d="M80 26 L83.4 30 H76.6 Z" fill="#cbd5e1" />
      <path d="M80 46 L83.4 42 H76.6 Z" fill="#cbd5e1" />
      <path d="M70 36 L74 32.6 V39.4 Z" fill="#cbd5e1" />
      <path d="M90 36 L86 32.6 V39.4 Z" fill="#cbd5e1" />
      <circle cx="80" cy="36" r="5" fill={GOLD} />
      {/* back and home */}
      <circle cx="72" cy="60" r="4.5" fill={BUTTON} stroke={EDGE} strokeWidth="0.6" />
      <path d="M73.8 58.6 H71.2 L70 60 L71.2 61.4 H73.8" fill="none" stroke="#cbd5e1" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="88" cy="60" r="4.5" fill={BUTTON} stroke={EDGE} strokeWidth="0.6" />
      <path d="M85.9 60.6 L88 58.5 L90.1 60.6 V62.4 H85.9 Z" fill="none" stroke="#cbd5e1" strokeWidth="0.8" strokeLinejoin="round" />
      {/* the rest of the remote, plain */}
      <rect x="70" y="70" width="8" height="5" rx="2.5" fill={BUTTON} />
      <rect x="82" y="70" width="8" height="5" rx="2.5" fill={BUTTON} />
    </svg>
  );
}
