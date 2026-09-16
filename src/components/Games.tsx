import { useCallback, useEffect, useRef, useState } from 'react';
import { Coins, LogIn, Sparkles, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/ui/BackButton';
import { trackEvent } from '@/lib/analytics';
import { GameArtwork } from '@/components/games/shared/GameArtwork';
import { useReducedGameFx } from '@/components/games/shared/useReducedGameFx';
import { activateFocused, useTvActivate } from '@/components/games/shared/tvActivate';
import { isGlobalModalOpen, visualArrowDir } from '@/components/games/shared/gameInput';
import type { GameAccent } from '@/components/games/shared/gameTypes';
import '@/styles/games-lobby.css';

interface GamesProps { onBack: () => void; onOpenGame: (view: string) => void }
type GameTile = { id: string; view: string; nameKey: string; taglineKey: string; accent: GameAccent };

const GAMES: GameTile[] = [
  { id: 'daily-spin', view: 'game-daily-spin', nameKey: 'games.hub.gameDailySpinName', taglineKey: 'games.hub.gameDailySpinTagline', accent: 'ice' },
  { id: 'slots', view: 'game-slots', nameKey: 'games.hub.gameSlotsName', taglineKey: 'games.hub.gameSlotsTagline', accent: 'plum' },
  { id: 'blackjack', view: 'game-blackjack', nameKey: 'games.hub.gameBlackjackName', taglineKey: 'games.hub.gameBlackjackTagline', accent: 'emerald' },
  { id: 'video-poker', view: 'game-video-poker', nameKey: 'games.hub.gameVideoPokerName', taglineKey: 'games.hub.gameVideoPokerTagline', accent: 'sapphire' },
  { id: 'roulette', view: 'game-roulette', nameKey: 'games.hub.gameRouletteName', taglineKey: 'games.hub.gameRouletteTagline', accent: 'ruby' },
  { id: 'casino-holdem', view: 'game-casino-holdem', nameKey: 'games.hub.gameCasinoHoldemName', taglineKey: 'games.hub.gameCasinoHoldemTagline', accent: 'teal' },
  { id: 'plinko', view: 'game-plinko', nameKey: 'games.hub.gamePlinkoName', taglineKey: 'games.hub.gamePlinkoTagline', accent: 'amber' },
  { id: 'tv-trivia', view: 'game-tv-trivia', nameKey: 'games.hub.gameTvTriviaName', taglineKey: 'games.hub.gameTvTriviaTagline', accent: 'violet' },
  { id: 'dice-lounge', view: 'game-dice-lounge', nameKey: 'games.hub.gameDiceLoungeName', taglineKey: 'games.hub.gameDiceLoungeTagline', accent: 'cobalt' },
];

const FOCUS_KEY = 'snow-games-last-focus-v1';

const Games = ({ onBack, onOpenGame }: GamesProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { status, balance, errorMessage } = useGameSocket();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  const initial = Number(sessionStorage.getItem(FOCUS_KEY) ?? 1);
  const fxIndex = GAMES.length + 1;
  const [focusIndex, setFocusIndex] = useState(Number.isInteger(initial) && initial >= 0 && initial <= fxIndex ? initial : 1);
  const openingRef = useRef(false);

  const focusAt = useCallback((next: number) => {
    setFocusIndex(next);
    const el = document.querySelector<HTMLElement>(`[data-game-focus="${next}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  // Who reaches the games at all, and whether they have chips to play with.
  // Time spent inside each game is timed centrally, keyed on its view.
  useEffect(() => {
    try {
      trackEvent('games_open', 'games', {
        signed_in: !!user,
        has_balance: typeof balance === 'number' ? balance > 0 : null,
      });
    } catch { /* ignore */ }
    // Once per visit: a balance that arrives later must not re-fire it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = useCallback((index: number) => {
    if (openingRef.current || index < 1 || index > GAMES.length) return;
    const tile = GAMES[index - 1];
    openingRef.current = true;
    sessionStorage.setItem(FOCUS_KEY, String(index));
    try { trackEvent('game_open', 'games', { game: tile.id }); } catch { /* ignore */ }
    onOpenGame(tile.view);
    window.setTimeout(() => { openingRef.current = false; }, 400);
  }, [onOpenGame]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => focusAt(focusIndex));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OK/Select activates the one focused control. Back stays owned by Index.
  useTvActivate(activateFocused);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isGlobalModalOpen()) return;
      const direction = visualArrowDir(event);
      if (!direction) return;

      // The lobby owns every D-pad arrow, including moves at a graph edge.
      // Otherwise Android TV's native spatial navigation can move focus away
      // from the single managed target.
      event.preventDefault();
      let next = focusIndex;
      if (focusIndex === 0) {
        if (direction === 'right' || direction === 'down') next = 1;
      } else if (focusIndex === fxIndex) {
        if (direction === 'left' || direction === 'up') next = GAMES.length;
      } else {
        const tileIndex = focusIndex - 1;
        const column = tileIndex % 3;
        const row = Math.floor(tileIndex / 3);
        const lastRow = Math.floor((GAMES.length - 1) / 3);
        if (direction === 'left' && column > 0) next = focusIndex - 1;
        if (direction === 'right' && column < 2 && focusIndex < GAMES.length) next = focusIndex + 1;
        if (direction === 'up') next = row === 0 ? 0 : focusIndex - 3;
        if (direction === 'down') next = row === lastRow ? fxIndex : Math.min(GAMES.length, focusIndex + 3);
      }
      if (next !== focusIndex) focusAt(next);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusAt, focusIndex, fxIndex]);

  return (
    <main className="snow-casino snow-lobby snow-games-lobby snow-casino--ice">
      <div className="snow-casino__aurora" aria-hidden="true" /><div className="snow-casino__vignette" aria-hidden="true" />
      <header className="snow-game-topbar snow-games-lobby__topbar relative z-10">
        <BackButton data-game-focus={0} data-tv-focused={focusIndex === 0 ? 'true' : 'false'} onFocus={() => setFocusIndex(0)} onClick={onBack} label={t('games.hub.back')} focused={focusIndex === 0} />
        <div className="snow-games-lobby__heading text-center">
          <div className="snow-games-lobby__title-row"><Sparkles aria-hidden="true" /><h1 className="snow-lobby__title">{t('games.hub.heroTitle')}</h1><Sparkles aria-hidden="true" /></div>
          <p className="snow-lobby__subtitle">{t('games.hub.heroTagline')}</p>
        </div>
        <div className="snow-chip-badge"><Coins aria-hidden="true" /><span><small>{t('games.shared.playChips')}</small><strong>{balance === null ? '—' : balance.toLocaleString()}</strong></span></div>
      </header>
      <section className="snow-lobby__grid relative z-10" aria-label={t('games.hub.heroTitle')}>
        {GAMES.map((game, index) => {
          const position = index + 1;
          return <Button key={game.id} type="button" variant="navy" data-game={game.id} data-game-focus={position} data-tv-focused={focusIndex === position ? 'true' : 'false'} onFocus={() => setFocusIndex(position)} onClick={() => open(position)} className={`snow-lobby-tile snow-lobby-tile--${game.accent}`}>
            <span className="snow-lobby-tile__number" aria-hidden="true">{String(position).padStart(2, '0')}</span>
            <span className="snow-lobby-tile__content">
              <span className="snow-lobby-tile__title">{t(game.nameKey)}</span>
              <span className="snow-lobby-tile__tagline">{t(game.taglineKey)}</span>
              <span className="snow-lobby-tile__status"><span className="snow-lobby-tile__play" aria-hidden="true" />{t('games.hub.badgePlayNow')}</span>
            </span>
            <GameArtwork game={game.id} accent={game.accent} />
          </Button>;
        })}
      </section>
      <footer className="snow-lobby__footer relative z-10">
        <div>{!user ? <span className="inline-flex items-center"><LogIn className="mr-2 h-4 w-4" />{t('games.hub.signInBanner')}</span> : status === 'error' || status === 'reconnecting' ? t('games.hub.serverError', { errorMessage: errorMessage ?? '' }) : t('games.hub.freeChipsNote')}</div>
        <div className="snow-lobby__coming"><Trophy className="mr-2 inline h-4 w-4" />{t('games.hub.leaderboardComingSoon')}</div>
        <Button type="button" variant="navy" size="sm" data-game-focus={fxIndex} data-tv-focused={focusIndex === fxIndex ? 'true' : 'false'} onFocus={() => setFocusIndex(fxIndex)} onClick={toggleReducedFx}>{reducedFx ? t('games.shared.reducedFxOn') : t('games.shared.reducedFxOff')}</Button>
      </footer>
    </main>
  );
};

export default Games;
