import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Snowflake, Star } from 'lucide-react';
import { useGameAudio } from '../../games/shared/gameAudio';
import type { KidsGameProps } from '../types';
import { actionChallenge, actionKey } from './actionChallenges';
import './SnowballSplash.css';

export default function SnowballSplash({ tier, progress, onComplete, onBack, soundOn }: KidsGameProps) {
  const [round, setRound] = useState(0);
  const [focus, setFocus] = useState(0);
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [message, setMessage] = useState('Pick your target, then press OK to throw!');
  const [splash, setSplash] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const locked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const audio = useGameAudio();
  const [level] = useState(() => Math.max(1, progress.level || 1));
  const question = useMemo(() => actionChallenge(tier, level, round, 6), [tier, level, round]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (!done) buttons.current[focus]?.focus(); }, [focus, round, done]);
  function choose(index: number) {
    if (locked.current || done) return;
    setFocus(index);
    if (index !== question.correct) {
      setMisses((n) => n + 1);
      setMessage(`Try again! ${question.hint}`);
      if (soundOn) audio.play('select', { volume: 0.3 });
      return;
    }
    locked.current = true;
    setSplash(index);
    setMessage('Splash! You found it!');
    if (soundOn) audio.play('triviaCorrect', { volume: 0.6 });
    const nextScore = score + 100;
    setScore(nextScore);
    timer.current = setTimeout(() => {
      if (round === 7) {
        setDone(true);
        const stars = misses === 0 ? 3 : misses <= 4 ? 2 : 1;
        onComplete({ score: Math.max(80, nextScore - misses * 15), stars, level: level + 1 });
        if (soundOn) audio.play('win', { volume: 0.55 });
      } else {
        setRound((n) => n + 1);
        setMessage('Find your next target!');
      }
      setSplash(null);
      locked.current = false;
    }, 700);
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const key = actionKey(event);
      if (!key || key === 'back') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat && key === 'ok') return;
      if (done) { if (key === 'ok') onBack(); return; }
      if (locked.current) return;
      if (key === 'ok') choose(focus);
      else {
        setFocus((current) => key === 'left' ? (current + 5) % 6 : key === 'right' ? (current + 1) % 6 : (current + 3) % 6);
        if (soundOn) audio.play('select', { volume: 0.2 });
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  });
  if (done) return <div className="ks-snow ks-snow-finish"><Star size={66} fill="currentColor"/><h2>Snow much learning!</h2><p>All 8 targets found · {Math.max(80, score - misses * 15)} points</p><p>Your next adventure is level {level + 1}.</p><button autoFocus onClick={onBack}>Back to the lounge</button></div>;
  return <section className="ks-snow" aria-label="Snowball Splash">
    <div className="ks-snow-top"><span><Snowflake size={20}/> SNOWBALL SPLASH</span><span>Level {level} · {round + 1} / 8</span></div>
    <div className="ks-snow-question"><h2>{question.prompt}</h2>{question.symbol && <div className="ks-snow-example" aria-label="Picture clue">{question.symbol}</div>}</div>
    <div className="ks-snow-board">{question.answers.map((answer, index) => <button key={`${round}-${index}`} ref={(el) => { buttons.current[index] = el; }} className={`ks-snow-target ${focus === index ? 'is-aimed' : ''} ${splash === index ? 'is-splashed' : ''}`} onFocus={() => setFocus(index)} onClick={() => choose(index)} aria-label={`Target ${answer}`}>
      <span className="ks-snow-target-ring"/><span className="ks-snow-answer">{answer}</span>{focus === index && <Crosshair className="ks-snow-crosshair" size={30}/>}<span className="ks-snow-splash" aria-hidden="true">✦</span>
    </button>)}</div>
    <p className="ks-snow-feedback" role="status">{message}</p><div className="ks-snow-help">↑ ↓ ← → Aim <span>OK Throw</span><span>Back Exit</span></div>
  </section>;
}
