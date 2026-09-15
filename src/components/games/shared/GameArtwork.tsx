import type { GameAccent } from './gameTypes';

export const GameArtwork = ({ game, accent }: { game: string; accent: GameAccent }) => {
  const common = { viewBox: '0 0 220 120', role: 'img', 'aria-label': `${game} artwork` } as const;
  if (game === 'daily-spin') return <svg {...common} className={`snow-game-art snow-game-art--${accent}`}><circle cx="110" cy="60" r="46"/><path d="M110 14v92M64 60h92M77 27l66 66M143 27L77 93"/><circle cx="110" cy="60" r="9"/><path d="M110 5l-9 17h18z"/></svg>;
  if (game === 'slots') return <svg {...common} className={`snow-game-art snow-game-art--${accent}`}><path d="M44 22h132v78H44z"/><path d="M58 35h104v46H58z"/><circle cx="78" cy="58" r="13"/><path d="M110 42l5 10 11 1-8 8 2 11-10-5-10 5 2-11-8-8 11-1z"/><path d="M142 45v27M135 58h14"/><path d="M176 40h15v42h-15"/></svg>;
  if (game === 'roulette') return <svg {...common} className={`snow-game-art snow-game-art--${accent}`}><circle cx="110" cy="61" r="45"/><circle cx="110" cy="61" r="25"/><path d="M110 16v90M65 61h90M78 29l64 64M142 29L78 93"/><circle cx="137" cy="31" r="6"/></svg>;
  const isPoker = game === 'video-poker' || game === 'casino-holdem';
  return <svg {...common} className={`snow-game-art snow-game-art--${accent}`}><g transform="rotate(-10 90 60)"><rect x="54" y="20" width="64" height="88" rx="7"/><path d={isPoker ? 'M86 44c-13-15-29 6 0 31 29-25 13-46 0-31z' : 'M86 38l17 27-17 27-17-27z'}/></g><g transform="rotate(10 132 60)"><rect x="102" y="20" width="64" height="88" rx="7"/><path d={game === 'blackjack' ? 'M134 38c-14 18-21 23 0 45 21-22 14-27 0-45z' : 'M134 39c-15 16-22 25 0 45 22-20 15-29 0-45z'}/></g></svg>;
};
