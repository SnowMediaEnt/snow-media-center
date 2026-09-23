import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Crosshair, Footprints, Music2, Puzzle, Shapes, Snowflake, Star, Trees, Volume2, VolumeX, Wind } from 'lucide-react';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useGameAudio } from '@/components/games/shared/gameAudio';
import { useGameBack } from '@/components/games/shared/gameBack';
import smcLogo from '@/assets/slots/smc.png';
import { emptyProgress, KIDS_GAME_IDS, type KidsGameId } from './progress';
import { useKidsProgress } from './useKidsProgress';
import type { KidsTier } from './types';
import SnowballSplash from './games/SnowballSplash';
import PenguinPath from './games/PenguinPath';
import SledDash from './games/SledDash';
import WinterMatch from './games/WinterMatch';
import BuildSnowWorld from './games/BuildSnowWorld';
import BeatBlizzard from './games/BeatBlizzard';
import './KidsGameLounge.css';

const GAMES = [
  { id: 'snowball-splash', title: 'Snowball Splash', skill: 'SHAPES · LETTERS · NUMBERS', detail: 'Find your target and throw!', Icon: Crosshair },
  { id: 'penguin-path', title: 'Penguin Path', skill: 'COUNTING · PATTERNS', detail: 'Help Pip find the fish.', Icon: Footprints },
  { id: 'sled-dash', title: 'Sled Dash', skill: 'WORDS · MATH', detail: 'Choose the right way downhill.', Icon: Wind },
  { id: 'winter-match', title: 'Winter Match', skill: 'MEMORY · MATCHING', detail: 'Turn over the snowy cards.', Icon: Puzzle },
  { id: 'snow-world', title: 'Build a Snow World', skill: 'CREATE · COUNT', detail: 'Make a world of your own.', Icon: Trees },
  { id: 'beat-blizzard', title: 'Beat the Blizzard', skill: 'MUSIC · PATTERNS', detail: 'Listen and repeat the beat.', Icon: Music2 },
] as const;

type Props = { onBack: () => void };

export default function KidsGameLounge({ onBack }: Props) {
  const { profile } = useActiveProfile();
  const tier: KidsTier = profile.kidsLevel === 'little' ? 'little' : profile.kidsLevel === 'teen' ? 'teens' : 'kids';
  const { book, complete } = useKidsProgress(profile.id);
  const { muted, toggleMuted, play } = useGameAudio();
  const [selected, setSelected] = useState<KidsGameId | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const cards = useRef<Array<HTMLButtonElement | null>>([]);
  const backRef = useRef<HTMLButtonElement>(null);
  const soundRef = useRef<HTMLButtonElement>(null);

  const returnToLounge = useCallback(() => { setSelected(null); setFocusIndex(0); }, []);
  useGameBack({ onExit: selected ? returnToLounge : onBack });

  useEffect(() => {
    if (selected) return;
    const target = focusIndex === 6 ? backRef.current : focusIndex === 7 ? soundRef.current : cards.current[focusIndex];
    target?.focus({ preventScroll: true });
  }, [focusIndex, selected]);

  useEffect(() => {
    if (profile.kidsLevel) return;
    onBack();
  }, [profile.kidsLevel, onBack]);

  const openGame = (gameId: KidsGameId) => {
    if (!KIDS_GAME_IDS.includes(gameId)) return;
    if (!muted) play('select', { volume: 0.55 });
    setSelected(gameId);
  };

  const menuKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if (selected) return;
    const key = event.key;
    if (['Enter', ' ', 'NumpadEnter'].includes(key)) {
      event.preventDefault(); event.stopPropagation();
      (document.activeElement as HTMLElement | null)?.click();
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
    event.preventDefault(); event.stopPropagation();
    setFocusIndex(current => {
      if (current === 6) return key === 'ArrowRight' ? 7 : key === 'ArrowDown' ? 0 : 6;
      if (current === 7) return key === 'ArrowLeft' ? 6 : key === 'ArrowDown' ? 2 : 7;
      const row = Math.floor(current / 3), col = current % 3;
      if (key === 'ArrowLeft') return col === 0 ? current : current - 1;
      if (key === 'ArrowRight') return col === 2 ? current : current + 1;
      if (key === 'ArrowUp') return row === 0 ? (col === 2 ? 7 : 6) : current - 3;
      return row === 0 ? current + 3 : current;
    });
    if (!muted) play('select', { volume: 0.16 });
  };

  if (selected) {
    const gameProps = {
      tier, progress: book[selected] ?? emptyProgress(),
      onComplete: (result: Parameters<typeof complete>[1]) => complete(selected, result),
      onBack: returnToLounge, soundOn: !muted,
    };
    const Game = ({
      'snowball-splash': SnowballSplash,
      'penguin-path': PenguinPath,
      'sled-dash': SledDash,
      'winter-match': WinterMatch,
      'snow-world': BuildSnowWorld,
      'beat-blizzard': BeatBlizzard,
    } satisfies Record<KidsGameId, typeof SnowballSplash>)[selected];
    return <main className="kids-lounge kids-lounge--playing"><Game key={`${profile.id}:${selected}`} {...gameProps} /></main>;
  }

  const totalStars = KIDS_GAME_IDS.reduce((sum, id) => sum + (book[id]?.stars ?? 0), 0);
  const ageLabel = tier === 'little' ? 'LITTLE KIDS' : tier === 'kids' ? 'KIDS' : 'TEENS';
  return <main className="kids-lounge" onKeyDown={menuKey} aria-label="Kids Game Lounge">
    <div className="kids-lounge__shell">
      <header className="kids-lounge__top">
        <button ref={backRef} type="button" className="kids-lounge__back" data-kids-focused={focusIndex === 6} onFocus={() => setFocusIndex(6)} onClick={onBack}><ArrowLeft /> Back</button>
        <div className="kids-lounge__brand"><span className="kids-lounge__brand-icon"><img src={smcLogo} alt="" /></span><span><small>SNOW MEDIA · {ageLabel}</small><h1>Kids Game Lounge</h1><p>Play, learn & explore</p></span></div>
        <div className="kids-lounge__tools"><span className="kids-lounge__star"><Star fill="currentColor" /> {totalStars} stars</span>
          <button ref={soundRef} type="button" className="kids-lounge__sound" data-kids-focused={focusIndex === 7} onFocus={() => setFocusIndex(7)} onClick={event => toggleMuted(event.nativeEvent)} aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>{muted ? <VolumeX /> : <Volume2 />}</button>
        </div>
      </header>
      <div className="kids-lounge__ribbon"><Shapes /><span>Pick an adventure, {profile.name}!</span><span>ARROWS TO MOVE · OK TO PLAY</span></div>
      <div className="kids-lounge__grid">
        {GAMES.map((game, index) => {
          const Icon = game.Icon;
          const record = book[game.id];
          return <button key={game.id} ref={element => { cards.current[index] = element; }} type="button"
            className={`kids-lounge__card kids-lounge__card--${index}`} data-kids-focused={focusIndex === index}
            onFocus={() => setFocusIndex(index)} onClick={() => openGame(game.id)} aria-label={`${game.title}. ${game.detail}. ${record?.stars ?? 0} stars earned.`}>
            <span className="kids-lounge__card-copy"><small>{game.skill}</small><strong>{game.title}</strong><span>{game.detail}</span><em>{record?.plays ? `LEVEL ${record.level} · BEST ${record.bestScore}` : 'NEW ADVENTURE'}</em></span>
            <span className="kids-lounge__card-art" aria-hidden="true"><Snowflake className="kids-lounge__flake" /><Icon className="kids-lounge__art-icon" /><span className="kids-lounge__art-ground" /></span>
            <span className="kids-lounge__card-play">PLAY <span>▶</span></span>
          </button>;
        })}
      </div>
      <footer className="kids-lounge__footer"><span>Every adventure earns stars. Keep trying and have fun!</span><span>Saved for {profile.name}'s profile</span></footer>
    </div>
  </main>;
}
