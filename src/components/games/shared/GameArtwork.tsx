import type { GameAccent } from './gameTypes';

/**
 * Lightweight per-game lobby artwork. SVG only — no emoji, no bitmaps — so it
 * stays crisp on 4K panels and costs nothing on a legacy TV WebView.
 */
export const GameArtwork = ({ game, accent }: { game: string; accent: GameAccent }) => {
  const common = { className: 'snow-game-art', viewBox: '0 0 100 100', 'aria-hidden': true as const, 'data-accent': accent };
  switch (game) {
    case 'daily-spin':
      return (
        <svg {...common}>
          <circle cx="50" cy="54" r="30" />
          <path d="M50 24v60M20 54h60M29 33l42 42M71 33L29 75" />
          <circle cx="50" cy="54" r="7" />
          <path d="M50 14l7 11H43z" />
        </svg>
      );
    case 'slots':
      return (
        <svg {...common}>
          <rect x="16" y="24" width="68" height="52" rx="7" />
          <path d="M32 24v52M50 24v52M68 24v52" />
          <path d="M22 50h56" />
        </svg>
      );
    case 'blackjack':
      return (
        <svg {...common}>
          <rect x="20" y="30" width="34" height="46" rx="5" transform="rotate(-11 37 53)" />
          <rect x="46" y="26" width="34" height="46" rx="5" transform="rotate(9 63 49)" />
          <path d="M60 40l8 9-8 9-8-9z" />
        </svg>
      );
    case 'video-poker':
      return (
        <svg {...common}>
          <rect x="12" y="34" width="22" height="34" rx="4" />
          <rect x="39" y="30" width="22" height="34" rx="4" />
          <rect x="66" y="34" width="22" height="34" rx="4" />
          <path d="M12 78h76" />
        </svg>
      );
    case 'roulette':
      return (
        <svg {...common}>
          <circle cx="50" cy="52" r="30" />
          <circle cx="50" cy="52" r="17" />
          <path d="M50 22v60M20 52h60" />
          <circle cx="50" cy="28" r="4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="14" y="40" width="24" height="34" rx="4" transform="rotate(-8 26 57)" />
          <rect x="38" y="36" width="24" height="34" rx="4" />
          <rect x="62" y="40" width="24" height="34" rx="4" transform="rotate(8 74 57)" />
          <path d="M30 26h40" />
        </svg>
      );
  }
};
