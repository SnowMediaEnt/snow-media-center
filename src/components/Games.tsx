import { useCallback, useEffect, useRef, useState } from 'react';
import { Coins, Loader2, LogIn, Music2, Save, Trophy, UserRound, Volume2, VolumeX, X } from 'lucide-react';
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
import { GameMusicSettings } from '@/components/games/shared/GameMusicSettings';
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
const LEADER_GAMES = [{ id: 'overall', nameKey: 'All Games' }, ...GAMES.map(({ id, nameKey }) => ({ id, nameKey }))];
type CoinLeader = { period: 'today' | 'all-time'; game: string; game_name: string; won_coins: number; net_coins: number; rank: number };

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
  const musicIndex = GAMES.length + 4;
  const [focusIndex, setFocusIndex] = useState(Number.isInteger(initial) && initial >= 0 && initial <= musicIndex ? initial : 1);
  const [musicOpen, setMusicOpen] = useState(false);
  const [loungeOpen, setLoungeOpen] = useState(false);
  const [loungeLoading, setLoungeLoading] = useState(false);
  const [loungeError, setLoungeError] = useState<string | null>(null);
  const [gameName, setGameName] = useState('');
  const [coinLeaders, setCoinLeaders] = useState<CoinLeader[]>([]);
  const [leaderPeriod, setLeaderPeriod] = useState<'today' | 'all-time'>('today');
  const [leaderGame, setLeaderGame] = useState('overall');
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
      setCoinLeaders(Array.isArray(response.coinLeaders) ? response.coinLeaders : []);
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
      if (refreshed?.ok) {
        setCoinLeaders(Array.isArray(refreshed.coinLeaders) ? refreshed.coinLeaders : []);
      }
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
        if (direction === 'right') next = musicIndex;
        if (direction === 'up') next = GAMES.length;
      } else if (focusIndex === musicIndex) {
        if (direction === 'left') next = soundIndex;
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
  }, [focusAt, focusIndex, fxIndex, leaderboardIndex, musicIndex, play, soundIndex]);

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
      const periodButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-lounge-period]'));
      const gameButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-lounge-game]'));
      const periodIndex = periodButtons.indexOf(active as HTMLButtonElement);
      const gameIndex = gameButtons.indexOf(active as HTMLButtonElement);
      if (active === gameNameRef.current) {
        // Let Left (and Right within the text) edit the caret. At the end of
        // the name, Right follows the visible row directly to Save.
        if (direction === 'left') return;
        if (direction === 'right') {
          const input = gameNameRef.current;
          if (input && input.selectionStart !== null &&
              (input.selectionStart !== input.selectionEnd || input.selectionEnd < input.value.length)) return;
        }
      }
      event.preventDefault();
      event.stopPropagation();
      if (!user) {
        loungeCloseRef.current?.focus({ preventScroll: true });
      } else if (active === loungeCloseRef.current) {
        if (direction === 'down') periodButtons[0]?.focus({ preventScroll: true });
        if (direction === 'left') loungeSaveRef.current?.focus({ preventScroll: true });
      } else if (active === loungeSaveRef.current) {
        if (direction === 'left') gameNameRef.current?.focus({ preventScroll: true });
        if (direction === 'down') periodButtons[0]?.focus({ preventScroll: true });
        if (direction === 'up' || direction === 'right') loungeCloseRef.current?.focus({ preventScroll: true });
      } else if (periodIndex >= 0) {
        if (direction === 'left' || direction === 'right') periodButtons[1 - periodIndex]?.focus({ preventScroll: true });
        if (direction === 'up') loungeSaveRef.current?.focus({ preventScroll: true });
        if (direction === 'down') gameButtons[0]?.focus({ preventScroll: true });
      } else if (gameIndex >= 0) {
        if (direction === 'left') gameButtons[Math.max(0, gameIndex - 1)]?.focus({ preventScroll: true });
        if (direction === 'right') gameButtons[Math.min(gameButtons.length - 1, gameIndex + 1)]?.focus({ preventScroll: true });
        if (direction === 'up') (gameIndex >= 5 ? gameButtons[gameIndex - 5] : periodButtons[0])?.focus({ preventScroll: true });
        if (direction === 'down') gameButtons[Math.min(gameButtons.length - 1, gameIndex + 5)]?.focus({ preventScroll: true });
      } else if (active === gameNameRef.current) {
        if (direction === 'right') loungeSaveRef.current?.focus({ preventScroll: true });
        if (direction === 'down') loungeSaveRef.current?.focus({ preventScroll: true });
        if (direction === 'up') loungeCloseRef.current?.focus({ preventScroll: true });
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
          <Button type="button" variant="navy" size="sm" data-game-focus={musicIndex} data-tv-focused={focusIndex === musicIndex ? 'true' : 'false'} onFocus={() => setFocusIndex(musicIndex)} onClick={() => setMusicOpen(true)} aria-label="Game music and volume"><Music2 aria-hidden="true" />Music</Button>
        </div>
      </footer>

      {musicOpen && <GameMusicSettings onClose={() => { setMusicOpen(false); requestAnimationFrame(() => focusAt(musicIndex)); }} />}

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
            <div className="snow-lounge-period" role="group" aria-label="Leaderboard period">
              {(['today', 'all-time'] as const).map((period) => <Button key={period} type="button" variant="navy" data-lounge-period={period} aria-pressed={leaderPeriod === period} onFocus={() => setLeaderPeriod(period)} onClick={() => setLeaderPeriod(period)}>{period === 'today' ? 'Today' : 'All time'}</Button>)}
              <small>{leaderPeriod === 'today' ? 'Resets at midnight UTC' : 'Since the Game Lounge opened'}</small>
            </div>
            <div className="snow-lounge-game-tabs" role="group" aria-label="Choose a game leaderboard">
              {LEADER_GAMES.map((game) => <Button key={game.id} type="button" variant="navy" data-lounge-game={game.id} aria-pressed={leaderGame === game.id} onFocus={() => setLeaderGame(game.id)} onClick={() => setLeaderGame(game.id)}>{game.id === 'overall' ? game.nameKey : t(game.nameKey)}</Button>)}
            </div>
            <div className="snow-lounge-leaders">
              <h3>{leaderGame === 'overall' ? 'All Games' : t(LEADER_GAMES.find((game) => game.id === leaderGame)?.nameKey ?? 'All Games')} · {leaderPeriod === 'today' ? 'Today' : 'All time'} winnings</h3>
              <ol>
                {coinLeaders.filter((entry) => entry.game === leaderGame && entry.period === leaderPeriod).slice(0, 5).map((entry) => <li key={`${entry.game}-${entry.game_name}`}><b>#{entry.rank}</b><span>{entry.game_name}</span><strong>+{entry.won_coins.toLocaleString()} <small>Snow Coins</small></strong></li>)}
                {!loungeLoading && coinLeaders.every((entry) => entry.game !== leaderGame || entry.period !== leaderPeriod) && <li className="is-empty">No named players on this board yet. Play a round to join in.</li>}
              </ol>
              <p>Ranked by Snow Coins won in games; starting coins do not count. Set a game name above to appear publicly.</p>
            </div>
          </section>
        </div>
      )}
    </main>
  );
};

export default Games;
