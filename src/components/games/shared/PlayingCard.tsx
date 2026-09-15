import type { GameCardValue } from './gameTypes';

const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;

export const PlayingCard = ({ card, faceDown, delay = 0, highlighted, held, focused, compact = false }: {
  card?: GameCardValue;
  faceDown?: boolean;
  delay?: number;
  highlighted?: boolean;
  held?: boolean;
  focused?: boolean;
  compact?: boolean;
}) => {
  const red = card?.suit === 'H' || card?.suit === 'D';
  return (
    <div className={`snow-playing-card tv-game-card${compact ? ' is-compact' : ''}${faceDown ? ' is-back' : ''}${highlighted ? ' is-highlighted' : ''}${held ? ' is-held' : ''}${focused ? ' is-focused' : ''}`} style={{ animationDelay: `${delay}ms` }}>
      {!faceDown && card && <><span className={`snow-card-corner${red ? ' is-red' : ''}`}>{card.rank}<i>{SUITS[card.suit]}</i></span><span className={`snow-card-suit${red ? ' is-red' : ''}`}>{SUITS[card.suit]}</span><span className={`snow-card-corner snow-card-corner--bottom${red ? ' is-red' : ''}`}>{card.rank}<i>{SUITS[card.suit]}</i></span></>}
      {held && <span className="snow-card-held">HELD</span>}
    </div>
  );
};

export const PlayingCardSlot = ({ compact = false }: { compact?: boolean }) => <div className={`snow-card-slot tv-game-card${compact ? ' is-compact' : ''}`} aria-hidden="true" />;
