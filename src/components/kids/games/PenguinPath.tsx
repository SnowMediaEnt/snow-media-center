import { useEffect, useRef, useState } from 'react';
import { Fish, Flag, Mountain, Star } from 'lucide-react';
import { useGameAudio } from '../../games/shared/gameAudio';
import type { KidsGameProps } from '../types';
import './KidsPuzzleGames.css';

const FISH_SPOTS = [4, 14, 12, 10, 20];
const ROCKS = [6, 8, 16, 18];
export function penguinSequence(tier: KidsGameProps['tier'], level: number) {
  const step = tier === 'little' ? 1 : tier === 'kids' ? 2 + (level - 1) % 4 : 6 + (level - 1) % 7;
  return Array.from({ length: 5 }, (_, index) => step * (index + 1));
}

function Penguin() {
  return <svg viewBox="0 0 60 70" aria-hidden="true" className="kp-penguin"><ellipse cx="30" cy="36" rx="22" ry="29" fill="#173047"/><ellipse cx="30" cy="42" rx="16" ry="21" fill="#fff"/><circle cx="23" cy="25" r="4" fill="#fff"/><circle cx="37" cy="25" r="4" fill="#fff"/><circle cx="24" cy="25" r="2"/><circle cx="36" cy="25" r="2"/><path d="M24 33h12l-6 7z" fill="#ffb545"/><ellipse cx="19" cy="65" rx="10" ry="4" fill="#ffb545"/><ellipse cx="41" cy="65" rx="10" ry="4" fill="#ffb545"/><path d="M13 43l34-5" stroke="#f67c88" strokeWidth="7" strokeLinecap="round"/></svg>;
}

export default function PenguinPath({ tier, progress, onComplete, onBack, soundOn }: KidsGameProps) {
  const [level, setLevel] = useState(Math.max(1, progress.level));
  const [position, setPosition] = useState(0);
  const [collected, setCollected] = useState(0);
  const [moves, setMoves] = useState(0);
  const [finished, setFinished] = useState(false);
  const [finishChoice, setFinishChoice] = useState(0);
  const [message, setMessage] = useState('Follow the fish trail. Use the arrows to walk!');
  const done = useRef(false);
  const playAgain = useRef<HTMLButtonElement>(null);
  const leave = useRef<HTMLButtonElement>(null);
  const audio = useGameAudio();
  const numbers = penguinSequence(tier, level);
  const cue = (name: Parameters<typeof audio.play>[0]) => { if (soundOn) audio.play(name); };
  const restart = () => { done.current = false; setLevel(value => value + 1); setPosition(0); setCollected(0); setMoves(0); setFinished(false); setMessage('A new trail! Find the first fish.'); };
  const move = (next: number) => {
    if (finished || next < 0 || next > 24 || ROCKS.includes(next)) return;
    const distance = Math.abs(Math.floor(next / 5) - Math.floor(position / 5)) + Math.abs(next % 5 - position % 5);
    if (distance !== 1) return;
    setPosition(next); setMoves(value => value + 1); cue('select');
    const fishIndex = FISH_SPOTS.indexOf(next);
    if (fishIndex === collected && collected < 5) {
      setCollected(value => value + 1); cue('triviaCorrect');
      setMessage(collected === 4 ? 'All five fish! Walk to the flag.' : `${numbers[collected]}! Now find ${numbers[collected + 1]}.`);
    } else if (fishIndex > collected) {
      setMessage(`First find ${numbers[collected]}. You can walk past this fish.`);
    }
    if (next === 24 && collected === 5 && !done.current) {
      done.current = true; setFinished(true); cue('win');
      onComplete({ score: Math.max(100, 500 - Math.max(0, moves + 1 - 20) * 5), stars: 3, level: level + 1 });
    } else if (next === 24 && collected < 5) setMessage(`The flag is waiting. Find ${numbers[collected]} next!`);
  };
  useEffect(() => { if (finished) (finishChoice ? leave : playAgain).current?.focus(); }, [finished, finishChoice]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (finished) {
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { if (finishChoice) onBack(); else { setFinishChoice(0); restart(); } }
        else if (event.key.startsWith('Arrow')) setFinishChoice(event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0);
        return;
      }
      if (event.key === 'ArrowLeft' && position % 5 > 0) move(position - 1);
      if (event.key === 'ArrowRight' && position % 5 < 4) move(position + 1);
      if (event.key === 'ArrowUp') move(position - 5);
      if (event.key === 'ArrowDown') move(position + 5);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  return <section className="kp-game kp-path" aria-label="Penguin Path">
    <header className="kp-heading"><div><span className="kp-eyebrow">COUNT • EXPLORE • DISCOVER</span><h2>Penguin Path</h2></div><span className="kp-level">Trail {level}</span></header>
    <div className="kp-layout"><aside className="kp-mission"><span className="kp-eyebrow">YOUR MISSION</span><h3>{collected < 5 ? `Find ${numbers[collected]}` : 'Find the flag!'}</h3><p>{tier === 'little' ? 'Collect the numbers in order.' : `Count in ${numbers[0]}s to collect the fish.`}</p><div className="kp-sequence">{numbers.map((number, index) => <span key={number} className={index < collected ? 'is-collected' : index === collected ? 'is-next' : ''}>{number}</span>)}</div><p className="kp-message" aria-live="polite">{message}</p><div className="kp-fish-count"><Fish /> {collected} / 5 fish</div></aside>
    <div className="kp-ice-board" aria-label="Ice maze. Arrow keys move your penguin.">{Array.from({ length: 25 }, (_, index) => {
      const fishIndex = FISH_SPOTS.indexOf(index); const hasFish = fishIndex >= collected && fishIndex >= 0;
      return <button key={index} tabIndex={-1} className={`kp-ice ${ROCKS.includes(index) ? 'is-rock' : ''} ${position === index ? 'is-player' : ''} ${fishIndex === collected ? 'is-target' : ''}`} onClick={() => move(index)} aria-label={position === index ? 'Penguin' : ROCKS.includes(index) ? 'Mountain' : hasFish ? `Fish ${numbers[fishIndex]}` : index === 24 ? 'Finish flag' : 'Ice path'}>{position === index ? <Penguin /> : ROCKS.includes(index) ? <Mountain /> : hasFish ? <><Fish /><strong>{numbers[fishIndex]}</strong></> : index === 24 ? <Flag /> : <span className="kp-ice-dot" />}</button>;
    })}</div></div>
    <footer className="kp-footer"><span>↑ ↓ ← → Walk</span><span>Collect in order • Back returns to lounge</span></footer>
    {finished && <div className="kp-finish" role="dialog" aria-modal="true" aria-label="Trail complete"><div><div className="kp-stars"><Star/><Star/><Star/></div><h2>Trail complete!</h2><p>You counted {numbers.join(', ')}.</p><p>Five fish and a happy penguin.</p><button ref={playAgain} onFocus={() => setFinishChoice(0)} onClick={restart}>Next trail →</button><button ref={leave} onFocus={() => setFinishChoice(1)} onClick={onBack}>Back to lounge</button></div></div>}
  </section>;
}
