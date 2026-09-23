import { useEffect, useRef, useState } from 'react';
import { Snowflake, Star } from 'lucide-react';
import { useGameAudio } from '../../games/shared/gameAudio';
import type { KidsGameProps } from '../types';
import './KidsPuzzleGames.css';

type Card = { pair: number; label: string; spoken: string; kind: 'shape' | 'picture' };
const SHAPES = ['●', '▲', '■', '♥', '★', '◆'];
const PICTURES = [
  { label: '🐧', spoken: 'penguin' }, { label: '🌲', spoken: 'pine tree' },
  { label: '⭐', spoken: 'star' }, { label: '❄️', spoken: 'snowflake' },
  { label: '🌙', spoken: 'moon' }, { label: '🎁', spoken: 'gift' },
  { label: '⛄', spoken: 'snowman' }, { label: '🐻', spoken: 'bear' },
  { label: '🍎', spoken: 'apple' }, { label: '📺', spoken: 'TV' },
  { label: '🧤', spoken: 'mitten' }, { label: '🐟', spoken: 'fish' },
];
export function createWinterCards(tier: KidsGameProps['tier'], level: number): Card[] {
  const pairs = tier === 'little' ? 3 : tier === 'kids' ? 4 : 6;
  const cards: Card[] = [];
  for (let pair = 0; pair < pairs; pair++) {
    const picture = PICTURES[(Math.max(1, level) - 1 + pair) % PICTURES.length];
    const card: Card = tier === 'little'
      ? { pair, label: SHAPES[pair], spoken: ['circle', 'triangle', 'square'][pair], kind: 'shape' }
      : { pair, label: picture.label, spoken: picture.spoken, kind: 'picture' };
    cards.push({ ...card }, { ...card });
  }
  for (let index = cards.length - 1; index > 0; index--) { const other = Math.floor(Math.random() * (index + 1)); [cards[index], cards[other]] = [cards[other], cards[index]]; }
  return cards;
}

export default function WinterMatch({ tier, progress, onComplete, onBack, soundOn }: KidsGameProps) {
  const [level, setLevel] = useState(Math.max(1, progress.level));
  const [cards, setCards] = useState(() => createWinterCards(tier, Math.max(1, progress.level)));
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [turns, setTurns] = useState(0);
  const [focus, setFocus] = useState(0);
  const [message, setMessage] = useState('Choose two cards. Take your time!');
  const [finished, setFinished] = useState(false);
  const [finishChoice, setFinishChoice] = useState(0);
  const locked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const playAgain = useRef<HTMLButtonElement>(null);
  const leave = useRef<HTMLButtonElement>(null);
  const audio = useGameAudio();
  const columns = tier === 'little' ? 3 : 4;
  const cue = (name: Parameters<typeof audio.play>[0]) => { if (soundOn) audio.play(name); };
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  useEffect(() => { if (finished) (finishChoice ? leave : playAgain).current?.focus(); else buttons.current[focus]?.focus(); }, [focus, finished, finishChoice]);
  const reveal = (index: number) => {
    if (locked.current || finished || open.includes(index) || matched.includes(cards[index].pair)) return;
    cue('card'); const next = [...open, index]; setOpen(next);
    if (next.length !== 2) return;
    setTurns(value => value + 1); locked.current = true;
    const isMatch = cards[next[0]].pair === cards[next[1]].pair;
    if (isMatch) {
      cue('triviaCorrect'); const nextMatched = [...matched, cards[index].pair]; setMatched(nextMatched);
      setMessage(`Two ${cards[index].spoken} cards! Great memory!`);
      timer.current = setTimeout(() => {
        setOpen([]); locked.current = false;
        if (nextMatched.length === cards.length / 2) {
          setFinished(true); cue('win');
          const stars = turns + 1 <= cards.length ? 3 : turns + 1 <= cards.length * 2 ? 2 : 1;
          onComplete({ score: Math.max(100, cards.length * 100 - (turns + 1) * 20), stars, level: level + 1 });
        }
      }, 650);
    } else {
      setMessage('Remember these two. Try another pair!');
      timer.current = setTimeout(() => { setOpen([]); locked.current = false; }, tier === 'little' ? 1700 : 1300);
    }
  };
  const restart = () => { const next = level + 1; clearTimeout(timer.current); locked.current = false; setLevel(next); setCards(createWinterCards(tier, next)); setMatched([]); setOpen([]); setTurns(0); setFocus(0); setFinished(false); setMessage('A fresh set of cards. Find the pairs!'); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (finished) {
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { if (finishChoice) onBack(); else { setFinishChoice(0); restart(); } }
        else if (event.key.startsWith('Arrow')) setFinishChoice(event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') { if (!event.repeat) reveal(focus); return; }
      const row = Math.floor(focus / columns); const col = focus % columns;
      const next = event.key === 'ArrowLeft' ? row * columns + Math.max(0, col - 1) : event.key === 'ArrowRight' ? Math.min(cards.length - 1, row * columns + Math.min(columns - 1, col + 1)) : event.key === 'ArrowUp' ? Math.max(col, focus - columns) : Math.min(cards.length - 1, focus + columns);
      if (next !== focus) { setFocus(next); cue('select'); }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  });
  return <section className="kp-game kp-match" aria-label="Winter Match"><header className="kp-heading"><div><span className="kp-eyebrow">LOOK • REMEMBER • MATCH</span><h2>Winter Match</h2></div><span className="kp-level">Round {level}</span></header>
    <div className="kp-match-info"><p>{tier === 'little' ? 'Find the same shapes.' : 'Remember where each picture is hiding.'}</p><span>{matched.length} / {cards.length / 2} pairs • {turns} turns</span></div>
    <div className="kp-cards" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>{cards.map((card, index) => { const revealed = open.includes(index) || matched.includes(card.pair); const found = matched.includes(card.pair); return <button key={index} ref={element => { buttons.current[index] = element; }} tabIndex={focus === index ? 0 : -1} onFocus={() => setFocus(index)} onClick={() => reveal(index)} className={`kp-card ${revealed ? 'is-open' : ''} ${found ? 'is-matched' : ''} ${focus === index ? 'is-focused' : ''}`} aria-label={revealed ? `${card.spoken}${found ? ', matched' : ''}` : `Hidden card ${index + 1}`} aria-disabled={found}><span className={card.kind === 'shape' && revealed ? `kp-shape kp-shape-${card.pair}` : ''}>{revealed ? card.label : <Snowflake />}</span>{found && <span className="kp-card-check">✓</span>}</button>; })}</div>
    <p className="kp-match-message" aria-live="polite">{message}</p><footer className="kp-footer"><span>↑ ↓ ← → Choose • OK Flip</span><span>Back returns to lounge</span></footer>
    {finished && <div className="kp-finish" role="dialog" aria-modal="true" aria-label="All pairs found"><div><div className="kp-stars">{Array.from({ length: turns <= cards.length ? 3 : turns <= cards.length * 2 ? 2 : 1 }, (_, index) => <Star key={index}/>)}</div><h2>All pairs found!</h2><p>{cards.length / 2} pairs in {turns} turns. Wonderful work.</p><button ref={playAgain} onFocus={() => setFinishChoice(0)} onClick={restart}>Play another round →</button><button ref={leave} onFocus={() => setFinishChoice(1)} onClick={onBack}>Back to lounge</button></div></div>}
  </section>;
}
