import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Apple, ArrowLeft, Circle, Music2, RotateCcw, Snowflake, Star, Tv } from 'lucide-react';
import { useGameAudio } from '@/components/games/shared/gameAudio';
import smcLogo from '@/assets/slots/smc.png';
import type { KidsGameProps } from '../types';
import './creativeGames.css';

type Direction = 'up' | 'right' | 'down' | 'left';
const DIRECTIONS: Direction[] = ['up', 'right', 'down', 'left'];
const DIRECTION_KEY: Record<string, Direction> = { ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left' };
const SYMBOLS = {
  up: { label: 'Snowflake', Icon: Snowflake, cue: 'select' },
  right: { label: 'Snowball', Icon: Circle, cue: 'plinkoPeg' },
  down: { label: 'Apple', Icon: Apple, cue: 'card' },
  left: { label: 'TV', Icon: Tv, cue: 'triviaCorrect' },
} as const;
const lengthFor = (tier: KidsGameProps['tier'], level: number) => tier === 'little' ? Math.min(3, 2 + Math.floor(level / 4)) : tier === 'kids' ? Math.min(5, 3 + Math.floor(level / 3)) : Math.min(6, 4 + Math.floor(level / 3));
const PATTERN_STEPS = [0, 1, 3, 2, 0, 3];
export const patternFor = (level: number, round: number, count: number): Direction[] =>
  Array.from({ length: count }, (_, index) => DIRECTIONS[(level * 7 + round * 5 + PATTERN_STEPS[index]) % 4]);

export default function BeatBlizzard({ tier, progress, onComplete, onBack, soundOn }: KidsGameProps) {
  const [level, setLevel] = useState(progress.level);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<'watch' | 'repeat' | 'finished'>('watch');
  const [lit, setLit] = useState<Direction | null>(null);
  const [input, setInput] = useState<Direction[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [message, setMessage] = useState('Watch the colorful symbols, then repeat their pattern.');
  const { play } = useGameAudio();
  const timerRef = useRef<number[]>([]);
  const completedRef = useRef(false);
  const padRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const pattern = useMemo(() => patternFor(level, round, lengthFor(tier, level)), [tier, level, round]);

  const clearTimers = useCallback(() => {
    timerRef.current.forEach(window.clearTimeout);
    timerRef.current = [];
  }, []);

  const showPattern = useCallback(() => {
    clearTimers(); setPhase('watch'); setInput([]); setLit(null);
    setMessage('Watch the glowing Snow Media symbols.');
    const beatMs = tier === 'little' ? 800 : 650;
    pattern.forEach((direction, index) => {
      timerRef.current.push(window.setTimeout(() => {
        setLit(direction);
        if (soundOn) play(SYMBOLS[direction].cue, { volume: 0.32 });
      }, 350 + index * beatMs));
      timerRef.current.push(window.setTimeout(() => setLit(null), 350 + index * beatMs + 420));
    });
    timerRef.current.push(window.setTimeout(() => {
      setPhase('repeat'); setMessage('Your turn! Press the arrows in the same order.');
      padRef.current?.focus({ preventScroll: true });
    }, 450 + pattern.length * beatMs));
  }, [clearTimers, pattern, play, soundOn, tier]);

  useEffect(() => { showPattern(); return clearTimers; }, [showPattern, clearTimers]);
  useEffect(() => { if (phase === 'finished') nextRef.current?.focus({ preventScroll: true }); }, [phase]);

  const choose = (direction: Direction) => {
    if (phase !== 'repeat') return;
    const correct = pattern[input.length] === direction;
    if (!correct) {
      setMistakes(value => value + 1); setInput([]);
      setMessage('Good try! Watch the pattern once more.');
      if (soundOn) play('triviaWrong', { volume: 0.35 });
      timerRef.current.push(window.setTimeout(showPattern, 900));
      setPhase('watch');
      return;
    }
    if (soundOn) play(SYMBOLS[direction].cue, { volume: 0.35 });
    setLit(direction);
    timerRef.current.push(window.setTimeout(() => setLit(null), 220));
    const next = [...input, direction];
    setInput(next);
    if (next.length < pattern.length) {
      setMessage(`${next.length} of ${pattern.length} beats! Keep going.`);
      return;
    }
    if (round < 2) {
      setMessage('Beautiful rhythm! Next pattern coming up.');
      setPhase('watch');
      timerRef.current.push(window.setTimeout(() => { setRound(value => value + 1); setInput([]); }, 900));
      return;
    }
    if (completedRef.current) return;
    completedRef.current = true;
    setPhase('finished'); setMessage('You played through the blizzard!');
    const stars = mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1;
    if (soundOn) play('win', { volume: 0.6 });
    onComplete({ score: Math.max(100, 300 + level * 40 - mistakes * 35), stars, level: level + 1 });
  };

  const startNext = () => {
    completedRef.current = false;
    clearTimers(); setLevel(value => value + 1); setRound(0); setMistakes(0);
    setPhase('watch'); setInput([]);
  };

  const handleKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === padRef.current && phase === 'repeat') {
      event.preventDefault(); event.stopPropagation();
      showPattern();
      return;
    }
    if (phase === 'finished' || !DIRECTION_KEY[event.key]) return;
    if (event.target instanceof HTMLElement && event.target.closest('.kids-creative__back')) return;
    event.preventDefault(); event.stopPropagation();
    choose(DIRECTION_KEY[event.key]);
  };

  return <section className="kids-creative kids-beat" aria-label="Beat the Blizzard" onKeyDown={handleKey}>
    <div className="kids-creative__header">
      <button type="button" className="kids-creative__back" onClick={onBack}><ArrowLeft /> Lounge</button>
      <div><span className="kids-creative__eyebrow">MUSIC & PATTERNS · LEVEL {level}</span><h2>Beat the Blizzard</h2></div>
      <span className="kids-creative__badge"><Star /> {progress.stars} stars</span>
    </div>
    <div className="kids-creative__instruction"><span className="kids-creative__instruction-icon"><Music2 /></span>
      <div><small>{phase === 'watch' ? 'WATCH & LISTEN' : phase === 'repeat' ? 'YOUR TURN' : 'WELL DONE!'}</small>
        <strong>{message}</strong></div><span className="kids-creative__counter">PATTERN {Math.min(round + 1, 3)} / 3</span>
    </div>
    <div className="kids-beat__stage">
      <div className="kids-beat__storm" aria-hidden="true"><Snowflake /><Snowflake /><Snowflake /></div>
      <div className="kids-beat__pad" tabIndex={0} ref={padRef} aria-label="Use the remote arrows to repeat the colored symbol pattern">
        {DIRECTIONS.map(direction => {
          const { Icon, label } = SYMBOLS[direction];
          return <button key={direction} type="button" tabIndex={-1} data-direction={direction}
            data-lit={lit === direction} disabled={phase !== 'repeat'}
            aria-label={`${label} symbol`} onClick={() => choose(direction)}><Icon /><span>{label}</span></button>;
        })}
        <div className="kids-beat__center" aria-hidden="true"><img src={smcLogo} alt="" /></div>
      </div>
      <div className="kids-beat__progress" aria-label={`${input.length} of ${pattern.length} steps entered`}>
        {pattern.map((_, index) => <span key={index} data-active={index < input.length} />)}
      </div>
    </div>
    <div className="kids-creative__footer"><div className="kids-creative__hint">{phase === 'finished' ? `${mistakes === 0 ? 'Perfect pattern!' : 'You kept trying and made it!'} Earned ${mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1} stars.` : 'Use the arrow buttons on your remote.'}</div>
      <div className="kids-creative__controls">
        {phase === 'finished' ? <button ref={nextRef} type="button" onClick={startNext}><RotateCcw /> Next level</button> : <button type="button" onClick={showPattern} disabled={phase === 'watch'}><RotateCcw /> Replay pattern (OK)</button>}
      </div>
    </div>
  </section>;
}
