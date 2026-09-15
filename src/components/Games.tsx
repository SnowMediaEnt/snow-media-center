import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, LogIn, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/ui/BackButton';
import { GameArtwork } from '@/components/games/shared/GameArtwork';
import { useReducedGameFx } from '@/components/games/shared/useReducedGameFx';
import type { GameAccent } from '@/components/games/shared/gameTypes';

interface GamesProps { onBack: () => void; onOpenGame: (view: string) => void }
type GameTile = { id: string; view: string; nameKey: string; taglineKey: string; accent: GameAccent };

const GAMES: GameTile[] = [
  { id: 'daily-spin', view: 'game-daily-spin', nameKey: 'games.hub.gameDailySpinName', taglineKey: 'games.hub.gameDailySpinTagline', accent: 'ice' },
  { id: 'slots', view: 'game-slots', nameKey: 'games.hub.gameSlotsName', taglineKey: 'games.hub.gameSlotsTagline', accent: 'plum' },
  { id: 'blackjack', view: 'game-blackjack', nameKey: 'games.hub.gameBlackjackName', taglineKey: 'games.hub.gameBlackjackTagline', accent: 'emerald' },
  { id: 'video-poker', view: 'game-video-poker', nameKey: 'games.hub.gameVideoPokerName', taglineKey: 'games.hub.gameVideoPokerTagline', accent: 'sapphire' },
  { id: 'roulette', view: 'game-roulette', nameKey: 'games.hub.gameRouletteName', taglineKey: 'games.hub.gameRouletteTagline', accent: 'ruby' },
  { id: 'casino-holdem', view: 'game-casino-holdem', nameKey: 'games.hub.gameCasinoHoldemName', taglineKey: 'games.hub.gameCasinoHoldemTagline', accent: 'teal' },
];

const FOCUS_KEY = 'snow-games-last-focus-v1';

const Games = ({ onBack, onOpenGame }: GamesProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { status, balance, errorMessage } = useGameSocket();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  const initial = Number(sessionStorage.getItem(FOCUS_KEY) ?? 1);
  const [focusIndex, setFocusIndex] = useState(Number.isInteger(initial) && initial >= 0 && initial <= 7 ? initial : 1);
  const openingRef = useRef(false);

  const focusAt = useCallback((next: number) => {
    setFocusIndex(next);
    const el = document.querySelector<HTMLElement>(`[data-game-focus="${next}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  const open = useCallback((index: number) => {
    if (openingRef.current || index < 1 || index > 6) return;
    const tile = GAMES[index - 1];
    openingRef.current = true;
    sessionStorage.setItem(FOCUS_KEY, String(index));
    onOpenGame(tile.view);
    window.setTimeout(() => { openingRef.current = false; }, 400);
  }, [onOpenGame]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => focusAt(focusIndex));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const ok = event.key === 'Enter' || event.key === 'Select' || event.key === ' ' || event.keyCode === 23;
      const back = event.key === 'Escape' || event.keyCode === 4 || event.code === 'GoBack';
      if (back) { event.preventDefault(); onBack(); return; }
      if (ok) {
        event.preventDefault();
        if (event.repeat) return;
        if (focusIndex === 0) onBack();
        else if (focusIndex === 7) toggleReducedFx();
        else open(focusIndex);
        return;
      }
      let next = focusIndex;
      if (event.key === 'ArrowLeft') next = focusIndex === 7 ? 6 : focusIndex <= 1 ? 0 : focusIndex - 1;
      if (event.key === 'ArrowRight') next = focusIndex === 0 ? 1 : focusIndex < 6 ? focusIndex + 1 : 7;
      if (event.key === 'ArrowDown') next = focusIndex === 0 ? 1 : focusIndex <= 3 ? focusIndex + 3 : focusIndex <= 6 ? 7 : 7;
      if (event.key === 'ArrowUp') next = focusIndex === 7 ? 4 : focusIndex <= 3 ? 0 : focusIndex - 3;
      if (next !== focusIndex) { event.preventDefault(); focusAt(next); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusAt, focusIndex, onBack, open, toggleReducedFx]);

  return (
    <main className="snow-casino snow-lobby snow-casino--ice">
      <div className="snow-casino__aurora" aria-hidden="true" /><div className="snow-casino__vignette" aria-hidden="true" />
      <header className="snow-game-topbar relative z-10">
        <BackButton data-game-focus={0} onFocus={() => setFocusIndex(0)} onClick={onBack} label={t('games.hub.back')} focused={focusIndex === 0} />
        <div className="text-center"><h1 className="snow-lobby__title">{t('games.hub.heroTitle')}</h1><p className="snow-lobby__subtitle">Aurora After Dark · six premium tables</p></div>
        <div className="snow-chip-badge"><span><small>PLAY CHIPS</small><strong>{balance === null ? '—' : balance.toLocaleString()}</strong></span></div>
      </header>
      <section className="snow-lobby__grid relative z-10" aria-label="Games">
        {GAMES.map((game, index) => {
          const position = index + 1;
          return <Button key={game.id} type="button" variant="navy" data-game-focus={position} data-tv-focused={focusIndex === position ? 'true' : 'false'} onFocus={() => setFocusIndex(position)} onClick={() => open(position)} className={`snow-lobby-tile snow-lobby-tile--${game.accent}`}>
            <h2>{t(game.nameKey)}</h2><p>{t(game.taglineKey)}</p><span className="snow-lobby-tile__status">Play now</span><GameArtwork game={game.id} accent={game.accent} />
          </Button>;
        })}
      </section>
      <footer className="snow-lobby__footer relative z-10">
        <div>{!user ? <span className="inline-flex items-center"><LogIn className="mr-2 h-4 w-4" />{t('games.hub.signInBanner')}</span> : status === 'error' || status === 'reconnecting' ? t('games.hub.serverError', { errorMessage: errorMessage ?? '' }) : 'Free entertainment chips · no purchase required'}</div>
        <div className="snow-lobby__coming"><Trophy className="mr-2 inline h-4 w-4" />Leaderboard · Coming soon</div>
        <Button type="button" variant="navy" size="sm" data-game-focus={7} data-tv-focused={focusIndex === 7 ? 'true' : 'false'} onFocus={() => setFocusIndex(7)} onClick={toggleReducedFx}>{reducedFx ? 'Reduced FX: On' : 'Reduced FX: Off'}</Button>
      </footer>
    </main>
  );
};

export default Games;