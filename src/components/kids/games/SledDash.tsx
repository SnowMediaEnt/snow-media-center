import { useEffect, useMemo, useRef, useState } from 'react';
import { Flag, Mountain, Star } from 'lucide-react';
import type { KidsGameProps } from '../types';
import { useGameAudio } from '../../games/shared/gameAudio';
import { actionKey, sledChallenge } from './actionChallenges';
import './SledDash.css';

export default function SledDash({ tier, progress, soundOn, onComplete, onBack }: KidsGameProps) {
  const [round, setRound] = useState(0);
  const [lane, setLane] = useState(1);
  const [gliding, setGliding] = useState(false);
  const [misses, setMisses] = useState(0);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState('Steer to the answer. Press OK to glide!');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const locked = useRef(false);
  const gates = useRef<(HTMLButtonElement | null)[]>([]);
  const audio = useGameAudio();
  const [level] = useState(() => Math.max(1, progress.level || 1));
  const question = useMemo(() => sledChallenge(tier, level, round), [tier, level, round]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (!done) gates.current[lane]?.focus(); }, [lane, round, done]);
  function glide(nextLane = lane) {
    if (locked.current || done) return;
    setLane(nextLane);
    if (nextLane !== question.correct) {
      setMisses((n) => n + 1);
      setMessage(`Let's look again. ${question.hint}`);
      if (soundOn) audio.play('select', { volume: 0.3 });
      return;
    }
    locked.current = true;
    setGliding(true);
    setMessage('Whoosh! Through the right gate!');
    if (soundOn) audio.play('triviaCorrect', { volume: 0.55 });
    timer.current = setTimeout(() => {
      if (round === 7) {
        setDone(true);
        onComplete({ score: Math.max(80, 800 - misses * 15), stars: misses === 0 ? 3 : misses <= 4 ? 2 : 1, level: level + 1 });
        if (soundOn) audio.play('win', { volume: 0.55 });
      } else {
        setRound((n) => n + 1);
        setMessage('A new trail! Find the next word.');
      }
      setGliding(false);
      locked.current = false;
    }, 1000);
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const key = actionKey(event);
      if (!key || key === 'back') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat && key === 'ok') return;
      if (done) { if (key === 'ok') onBack(); return; }
      if (locked.current) return;
      if (key === 'ok') glide();
      if (key === 'left' || key === 'right') {
        setLane((n) => Math.max(0, Math.min(2, n + (key === 'left' ? -1 : 1))));
        if (soundOn) audio.play('select', { volume: 0.2 });
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  });
  if (done) return <section className="ks-sled ks-sled-finish"><Flag size={60}/><h2>A brilliant downhill run!</h2><p>You cleared all 8 learning gates.</p><strong>{Math.max(80, 800 - misses * 15)} points</strong><p>Level {level + 1} is ready for you.</p><button autoFocus onClick={onBack}>Back to the lounge</button></section>;
  return <section className={`ks-sled ${gliding ? 'is-gliding' : ''}`} aria-label="Sled Dash">
    <div className="ks-sled-top"><span><Mountain size={20}/> SLED DASH</span><span>Level {level} · Gate {round + 1} / 8</span></div>
    <div className="ks-sled-prompt"><h2>{question.prompt}</h2>{question.symbol && <div>{question.symbol}</div>}</div>
    <div className="ks-sled-landscape" aria-hidden="true"><i/><i/><i/><i/></div>
    <div className="ks-sled-trail"><div className="ks-sled-tracks" aria-hidden="true"/>
      <div className="ks-sled-gates">{question.answers.map((answer, index) => <button key={`${round}-${index}`} ref={(el) => { gates.current[index] = el; }} onFocus={() => setLane(index)} onClick={() => glide(index)} className={`ks-sled-gate ${lane === index ? 'is-chosen' : ''}`} aria-label={`Gate ${answer}`}><span>{answer}</span><i/><i/></button>)}</div>
      <div className="ks-sled-rider" style={{ left: `${(lane + .5) * 100 / 3}%` }} aria-hidden="true"><svg viewBox="0 0 100 100"><path d="M20 78L14 90M80 78L86 90M10 90H90Q97 90 96 83" fill="none" stroke="#9b481f" strokeWidth="6" strokeLinecap="round"/><rect x="17" y="62" width="66" height="18" rx="8" fill="#f6b437"/><ellipse cx="50" cy="53" rx="22" ry="27" fill="#23405a"/><ellipse cx="50" cy="59" rx="14" ry="19" fill="#fff"/><circle cx="50" cy="29" r="17" fill="#23405a"/><path d="M35 30Q40 18 50 29Q60 18 65 30L62 40H38Z" fill="#fff"/><circle cx="43" cy="31" r="2" fill="#17334d"/><circle cx="57" cy="31" r="2" fill="#17334d"/><path d="M45 36L55 36L50 42Z" fill="#ffb43b"/><path d="M33 46H68L69 55H35Z" fill="#eb6970"/><path d="M60 51L76 61L69 68L56 53Z" fill="#eb6970"/><path d="M33 21Q36 6 51 7Q66 9 67 22Z" fill="#16a19c"/><circle cx="51" cy="7" r="5" fill="#fff"/></svg></div>
      <div className="ks-sled-distance" aria-label={`${round} of 8 gates completed`}>{Array.from({ length: 8 }, (_, i) => <Star key={i} size={18} fill={i < round ? '#f4b332' : 'transparent'} color={i < round ? '#a56c09' : '#8ca9b4'}/>)}</div>
    </div>
    <div className="ks-sled-footer"><p role="status">{message}</p><div>← → Steer <span>OK Glide</span><span>Back Exit</span></div></div>
  </section>;
}
