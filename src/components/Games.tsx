import { useCallback, useEffect, useRef, useState } from 'react';
import { Coins, Loader2, LogIn, Save, Trophy, UserRound, Volume2, VolumeX, X } from 'lucide-react';
import smcLogo from '@/assets/slots/smc.png';
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
import { useGameAudio } from '@/components/games/shared/gameAudio';
import { gameSocket } from '@/lib/gameSocket';
import { isBackKey } from '@/components/games/shared/gameBack';
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
  const { muted, play, toggleMuted } = useGameAudio();
  const initial = Number(sessionStorage.getItem(FOCUS_KEY) ?? 1);
  const leaderboardIndex = GAMES.length + 1;
  const fxIndex = GAMES.length + 2;
  const soundIndex = GAMES.length + 3;
  const [focusIndex, setFocusIndex] = useState(Number.isInteger(initial) && initial >= 0 && initial <= soundIndex ? initial : 1);
  const [loungeOpen, setLoungeOpen] = useState(false);
  const [loungeLoading, setLoungeLoading] = useState(false);
  const [loungeError, setLoungeError] = useState<string | null>(null);
  const [gameName, setGameName] = useState('');
  const [leaders, setLeaders] = useState<Array<{ game_name: string; game: string; mode: string; best_score: number; wins: number; plays: number }>>([]);
  const openingRef = useRef(false);
  const gameNameRef = useRef<HTMLInputElement>(null);
  const loungeCloseRef = useRef<HTMLButtonElement>(null);
  const loungeSaveRef = useRef<HTMLButtonElement>(null);

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

  const openLeaderboard = useCallback(async () => {
    if (!user) { setLoungeError('Sign in to create a game name and join the leaderboard.'); setLoungeOpen(true); return; }
    setLoungeOpen(true);
    setLoungeLoading(true);
    setLoungeError(null);
    try {
      const response = await gameSocket.getLoungeState();
      if (!response?.ok) throw new Error(response?.error ?? 'lounge_failed');
      setGameName(response.gameName ?? '');
      setLeaders(Array.isArray(response.leaders) ? response.leaders : []);
      window.setTimeout(() => gameNameRef.current?.focus(), 50);
    } catch {
      setLoungeError('The leaderboard could not load right now.');
    } finally { setLoungeLoading(false); }
  }, [user]);

  const saveGameName = useCallback(async () => {
    if (!user) return;
    setLoungeLoading(true);
    setLoungeError(null);
    try {
      const response = await gameSocket.setGameName(gameName);
      if (!response?.ok) {
        setLoungeError(response?.error === 'name_taken' ? 'That game name is already taken.' : 'Use 3–18 letters, numbers, spaces, _ or -.');
        return;
      }
      setGameName(response.gameName);
      const refreshed = await gameSocket.getLoungeState();
      if (refreshed?.ok) setLeaders(Array.isArray(refreshed.leaders) ? refreshed.leaders : []);
    } catch { setLoungeError('The game name could not be saved.'); }
    finally { setLoungeLoading(false); }
  }, [gameName, user]);

  const closeLounge = useCallback(() => {
    setLoungeOpen(false);
    requestAnimationFrame(() => focusAt(leaderboardIndex));
  }, [focusAt, leaderboardIndex]);

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
      play('select', { volume: 0.38 });
      if (focusIndex === 0) {
        if (direction === 'right' || direction === 'down') next = 1;
      } else if (focusIndex === fxIndex) {
        if (direction === 'left') next = leaderboardIndex;
        if (direction === 'up') next = GAMES.length;
        if (direction === 'right') next = soundIndex;
      } else if (focusIndex === leaderboardIndex) {
        if (direction === 'right') next = fxIndex;
        if (direction === 'up') next = GAMES.length - 1;
      } else if (focusIndex === soundIndex) {
        if (direction === 'left') next = fxIndex;
        if (direction === 'up') next = GAMES.length;
      } else {
        const tileIndex = focusIndex - 1;
        const column = tileIndex % 3;
        const row = Math.floor(tileIndex / 3);
        const lastRow = Math.floor((GAMES.length - 1) / 3);
        if (direction === 'left' && column > 0) next = focusIndex - 1;
        if (direction === 'right' && column < 2 && focusIndex < GAMES.length) next = focusIndex + 1;
        if (direction === 'up') next = row === 0 ? 0 : focusIndex - 3;
        if (direction === 'down') next = row === lastRow
          ? (column === 0 ? leaderboardIndex : column === 2 ? soundIndex : fxIndex)
          : Math.min(GAMES.length, focusIndex + 3);
      }
      if (next !== focusIndex) focusAt(next);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusAt, focusIndex, fxIndex, leaderboardIndex, play, soundIndex]);

  useEffect(() => {
    if (!loungeOpen) return;
    const raf = requestAnimationFrame(() => {
      if (user && !loungeLoading) gameNameRef.current?.focus({ preventScroll: true });
      else loungeCloseRef.current?.focus({ preventScroll: true });
    });
    const onModalKey = (event: KeyboardEvent) => {
      if (isBackKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        closeLounge();
        return;
      }
      const direction = visualArrowDir(event);
      if (!direction) return;
      const active = document.activeElement;
      if (active === gameNameRef.current && (direction === 'left' || direction === 'right')) return;
      event.preventDefault();
      event.stopPropagation();
      if (!user) {
        loungeCloseRef.current?.focus({ preventScroll: true });
      } else if (active === loungeCloseRef.current) {
        if (direction === 'down' || direction === 'left') gameNameRef.current?.focus({ preventScroll: true });
      } else if (active === loungeSaveRef.current) {
        if (direction === 'left' || direction === 'down') gameNameRef.current?.focus({ preventScroll: true });
        if (direction === 'up' || direction === 'right') loungeCloseRef.current?.focus({ preventScroll: true });
      } else if (direction === 'down' || direction === 'right') {
        loungeSaveRef.current?.focus({ preventScroll: true });
      } else if (direction === 'up') {
        loungeCloseRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onModalKey, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onModalKey, true);
    };
  }, [closeLounge, loungeLoading, loungeOpen, user]);

  return (
    <main className="snow-casino snow-lobby snow-games-lobby snow-casino--ice">
      <div className="snow-casino__aurora" aria-hidden="true" /><div className="snow-casino__vignette" aria-hidden="true" />
      <header className="snow-game-topbar snow-games-lobby__topbar relative z-10">
        <BackButton data-game-focus={0} data-tv-focused={focusIndex === 0 ? 'true' : 'false'} onFocus={() => setFocusIndex(0)} onClick={onBack} label={t('games.hub.back')} focused={focusIndex === 0} />
        <div className="snow-games-lobby__heading text-center">
          <div className="snow-games-lobby__title-row"><img className="snow-games-lobby__brand-logo" src={smcLogo} alt="" /><h1 className="snow-lobby__title">{t('games.hub.heroTitle')}</h1></div>
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
        <Button type="button" variant="navy" size="sm" className="snow-lobby__leaderboard" data-game-focus={leaderboardIndex} data-tv-focused={focusIndex === leaderboardIndex ? 'true' : 'false'} onFocus={() => setFocusIndex(leaderboardIndex)} onClick={() => { void openLeaderboard(); }}><Trophy />Leaderboard</Button>
        <div className="snow-lobby__settings">
          <Button type="button" variant="navy" size="sm" data-game-focus={fxIndex} data-tv-focused={focusIndex === fxIndex ? 'true' : 'false'} onFocus={() => setFocusIndex(fxIndex)} onClick={toggleReducedFx}>{reducedFx ? t('games.shared.reducedFxOn') : t('games.shared.reducedFxOff')}</Button>
          <Button
            type="button"
            variant="navy"
            size="sm"
            data-game-focus={soundIndex}
            data-tv-focused={focusIndex === soundIndex ? 'true' : 'false'}
            onFocus={() => setFocusIndex(soundIndex)}
            onClick={(event) => toggleMuted(event.nativeEvent)}
            aria-pressed={muted}
            aria-label={muted ? 'Turn game sound on' : 'Mute game sound'}
          >
            {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
            {muted ? 'Sound Off' : 'Sound On'}
          </Button>
        </div>
      </footer>

      {loungeOpen && (
        <div className="snow-lounge-overlay" role="dialog" aria-modal="true" aria-label="Game Lounge leaderboard">
          <section className="snow-lounge-card">
            <header><span><Trophy /><b>GAME LOUNGE</b></span><Button ref={loungeCloseRef} type="button" variant="navy" size="icon" aria-label="Close leaderboard" onClick={closeLounge}><X /></Button></header>
            {user && (
              <div className="snow-lounge-name">
                <UserRound aria-hidden="true" />
                <label htmlFor="snow-game-name"><small>Your public game name</small><input ref={gameNameRef} id="snow-game-name" value={gameName} maxLength={18} placeholder="Create a game name" onChange={(event) => setGameName(event.target.value)} /></label>
                <Button ref={loungeSaveRef} type="button" variant="gold" onClick={() => { void saveGameName(); }} aria-disabled={loungeLoading ? 'true' : undefined}>{loungeLoading ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>
              </div>
            )}
            {loungeError && <p className="snow-lounge-error" role="status">{loungeError}</p>}
            <div className="snow-lounge-leaders">
              {(['plinko', 'dice', 'trivia'] as const).map((game) => (
                <div key={game}><h3>{game === 'dice' ? 'Dice Lounge' : game === 'trivia' ? 'TV Trivia' : 'Snow Plinko'}</h3><ol>
                  {leaders.filter((entry) => entry.game === game).slice(0, 5).map((entry, index) => <li key={`${entry.game_name}-${entry.mode}`}><b>{index + 1}</b><span>{entry.game_name}<small>{entry.mode} · {entry.plays} plays</small></span><strong>{entry.best_score.toLocaleString()}</strong></li>)}
                  {!loungeLoading && leaders.every((entry) => entry.game !== game) && <li className="is-empty">Be the first on this board</li>}
                </ol></div>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
};

export default Games;
