import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, House, RotateCcw, Snowflake, Star, TreePine, Volume2 } from 'lucide-react';
import { useGameAudio } from '@/components/games/shared/gameAudio';
import type { KidsGameProps } from '../types';
import './creativeGames.css';

type Piece = 'empty' | 'pine' | 'cabin' | 'star';
const PIECES: Piece[] = ['empty', 'pine', 'cabin', 'star'];
const icon = (piece: Piece) => piece === 'pine' ? <TreePine /> : piece === 'cabin' ? <House /> : piece === 'star' ? <Star /> : <Snowflake />;
const name = (piece: Piece) => piece === 'pine' ? 'pine tree' : piece === 'cabin' ? 'cozy cabin' : 'shining star';

function goalFor(tier: KidsGameProps['tier'], level: number): { theme: string; pieces: Piece[] } {
  const scenes: Array<{ theme: string; pieces: Piece[] }> = [
    { theme: 'winter forest', pieces: ['pine', 'cabin', 'star'] },
    { theme: 'snowy village', pieces: ['cabin', 'pine', 'star'] },
    { theme: 'starlit meadow', pieces: ['star', 'pine', 'cabin'] },
  ];
  const scene = scenes[(Math.max(1, level) - 1) % scenes.length];
  return { theme: scene.theme, pieces: scene.pieces.slice(0, tier === 'little' ? 1 : tier === 'kids' ? 2 : 3) };
}

export default function BuildSnowWorld({ tier, progress, onComplete, onBack, soundOn }: KidsGameProps) {
  const [level, setLevel] = useState(progress.level);
  const [cells, setCells] = useState<Piece[]>(() => Array(15).fill('empty'));
  const [cursor, setCursor] = useState(7);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState('Use the arrows to move, then OK to decorate.');
  const finishedAt = useRef(0);
  const cellsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const finishRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const { play } = useGameAudio();
  const goal = useMemo(() => goalFor(tier, level), [tier, level]);
  const ready = goal.pieces.every(piece => cells.includes(piece));

  useEffect(() => { cellsRef.current[cursor]?.focus({ preventScroll: true }); }, [cursor]);
  useEffect(() => { if (done) finishRef.current?.focus({ preventScroll: true }); }, [done]);

  const decorate = (index: number) => {
    if (done) return;
    const next = [...cells];
    next[index] = PIECES[(PIECES.indexOf(next[index]) + 1) % PIECES.length];
    setCells(next);
    setMessage(next[index] === 'empty' ? 'Spot cleared. Make it your own!' : `${name(next[index])} placed!`);
    if (soundOn) play('select', { volume: 0.5 });
  };

  const keyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 };
    if (!(event.key in delta)) return;
    const target = event.target as HTMLElement;
    if (target === finishRef.current) {
      if (event.key !== 'ArrowUp') return;
      event.preventDefault(); event.stopPropagation();
      cellsRef.current[cursor]?.focus({ preventScroll: true });
      return;
    }
    if (target === backRef.current) {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault(); event.stopPropagation();
      cellsRef.current[0]?.focus({ preventScroll: true });
      return;
    }
    if (!target.classList.contains('kids-world__cell')) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'ArrowDown' && cursor >= 10 && ready) {
      finishRef.current?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'ArrowUp' && cursor < 5) {
      backRef.current?.focus({ preventScroll: true });
      return;
    }
    setCursor(current => {
      const col = current % 5;
      const row = Math.floor(current / 5);
      const nextCol = Math.max(0, Math.min(4, col + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)));
      const nextRow = Math.max(0, Math.min(2, row + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)));
      return nextRow * 5 + nextCol;
    });
    if (soundOn) play('select', { volume: 0.18 });
  };

  const finish = () => {
    if (!ready || done) return;
    finishedAt.current = Date.now();
    setDone(true);
    setMessage('Your snow world is glowing!');
    if (soundOn) play('win', { volume: 0.55 });
    onComplete({ score: goal.pieces.length * 150, stars: 3, level: level + 1 });
  };

  const next = () => {
    if (Date.now() - finishedAt.current < 500) return;
    setCells(Array(15).fill('empty')); setCursor(7); setDone(false);
    setLevel(level + 1); setMessage('A new snowy scene is ready!');
    if (soundOn) play('select');
  };

  return <section className="kids-creative kids-world" aria-label="Build a Snow World" onKeyDown={keyDown}>
    <div className="kids-creative__header">
      <button ref={backRef} type="button" className="kids-creative__back" onClick={onBack}><ArrowLeft /> Lounge</button>
      <div><span className="kids-creative__eyebrow">CREATE & EXPLORE · LEVEL {level}</span><h2>Build a Snow World</h2></div>
      <span className="kids-creative__badge"><Star /> {progress.stars} stars</span>
    </div>
    <div className="kids-creative__instruction"><span className="kids-creative__instruction-icon">{icon(goal.pieces[0])}</span>
      <div><small>YOUR DESIGN MISSION</small><strong>Make a {goal.theme} with {goal.pieces.map(piece => `a ${name(piece)}`).join(' and ')}.</strong></div>
      <span className="kids-creative__counter kids-world__requirements" aria-label={goal.pieces.map(piece => `${name(piece)} ${cells.includes(piece) ? 'placed' : 'needed'}`).join(', ')}>{goal.pieces.map(piece => <span key={piece} data-found={cells.includes(piece)} title={name(piece)}>{icon(piece)}</span>)}</span>
    </div>
    <div className="kids-world__scene">
      <div className="kids-world__sky"><span className="kids-world__moon" /><span className="kids-world__mountains" /></div>
      <div className="kids-world__grid" role="grid" aria-label="Snow world decorating board">
        {cells.map((piece, index) => <button key={index} type="button" role="gridcell" ref={el => { cellsRef.current[index] = el; }}
          className={`kids-world__cell kids-world__cell--${piece}`} data-focused={cursor === index}
          aria-label={`Spot ${index + 1}: ${piece === 'empty' ? 'empty' : name(piece)}. Press OK to change.`}
          onFocus={() => setCursor(index)} onClick={() => decorate(index)}>
          <span>{piece === 'empty' ? <Snowflake /> : icon(piece)}</span>
        </button>)}
      </div>
    </div>
    <div className="kids-creative__footer">
      <div className="kids-creative__hint"><Volume2 /> {message}</div>
      <div className="kids-creative__controls"><span>← ↑ ↓ → move · OK changes a spot</span>
        {done ? <button ref={finishRef} type="button" onClick={next}><RotateCcw /> New world</button> : <button ref={finishRef} type="button" disabled={!ready} onClick={finish}><Star /> Finish world</button>}
      </div>
    </div>
  </section>;
}
