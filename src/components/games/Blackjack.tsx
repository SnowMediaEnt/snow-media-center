import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { BetChip, FairnessPanel, GAME_ACTION_CLASS, GamePanel, GameShell, GameTopBar, ResultBanner } from './shared/GameUI';
import { PlayingCard } from './shared/PlayingCard';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { useGameLifecycle } from './shared/gameLifecycle';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useGameBack } from './shared/gameBack';
import { isGlobalModalOpen, isTerminalRoundError, visualArrowDir } from './shared/gameInput';
import { moveInRows, rehome, type FocusRows } from './shared/focusRows';
import type { GameCardValue, GameFairInfo } from './shared/gameTypes';
import '@/styles/games-blackjack.css';

interface BlackjackProps {
  onBack: () => void;
}

const BETS = [10, 25, 50, 100];

type Phase = 'bet' | 'playing' | 'settled';
type FocusId = 'back' | 'fx' | 'deal' | 'hit' | 'stand' | 'double' | 'again' | 'fair' | `chip-${number}`;

const computeBjTotal = (cards: GameCardValue[]): number => {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') { total += 11; aces++; }
    else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J' || c.rank === '10') total += 10;
    else total += parseInt(c.rank, 10) || 0;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
};

interface BlackjackAck {
  bet?: number;
  status?: string;
  playerHand?: GameCardValue[];
  dealerHand?: GameCardValue[];
  dealerUp?: GameCardValue[];
  playerTotal?: number;
  dealerUpTotal?: number;
  dealerTotal?: number;
  serverSeedHash?: string;
  canHit?: boolean;
  canStand?: boolean;
  canDouble?: boolean;
  net?: number;
  fair?: GameFairInfo;
}

type BlackjackActionIconName = 'deal' | 'hit' | 'stand' | 'double' | 'again';

/** Small, dependency-free table icons that stay crisp on 720p TV panels. */
const BlackjackActionIcon = ({ name }: { name: BlackjackActionIconName }) => {
  if (name === 'hit') {
    return (
      <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <rect x="4.5" y="6" width="12" height="16" rx="2" />
        <rect x="11.5" y="3" width="12" height="16" rx="2" />
        <path d="M17.5 7.5v7M14 11h7" />
      </svg>
    );
  }
  if (name === 'stand') {
    return (
      <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <path d="M8.5 13V7.5a2 2 0 0 1 4 0V12" />
        <path d="M12.5 11V5.5a2 2 0 0 1 4 0V12" />
        <path d="M16.5 11V7a2 2 0 0 1 4 0v7" />
        <path d="M8.5 11.5 6.8 10a2.1 2.1 0 0 0-3.1 2.8l5.1 8.1c1.1 1.8 3.1 2.8 5.2 2.8h2.4c4.2 0 7.1-3.2 7.1-7.2V12a2 2 0 0 0-3-1.7" />
      </svg>
    );
  }
  if (name === 'double') {
    return (
      <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <ellipse cx="10" cy="9" rx="6" ry="3" />
        <path d="M4 9v4c0 1.7 2.7 3 6 3 1 0 2-.1 2.8-.4M4 13v4c0 1.7 2.7 3 6 3 1.1 0 2.1-.1 3-.4" />
        <circle cx="19" cy="17" r="6" />
        <path d="M19 13.5v7M15.5 17h7" />
      </svg>
    );
  }
  if (name === 'again') {
    return (
      <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <path d="M22.5 8.5V3.8l-3.2 3.1A9 9 0 1 0 23 14" />
        <path d="M19.3 6.9h-4.6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect x="5" y="7" width="13" height="17" rx="2" />
      <rect x="10" y="4" width="13" height="17" rx="2" />
      <path d="m16.5 9 1.8 2.2-1.8 2.2-1.8-2.2L16.5 9Z" />
      <path d="M4 3.5h4M6 1.5v4" />
    </svg>
  );
};

const SnowMedallion = () => (
  <div className="snow-bj-medallion" aria-hidden="true">
    <svg viewBox="0 0 64 64" focusable="false">
      <path d="M32 8v48M11.2 20l41.6 24M11.2 44l41.6-24" />
      <path d="m26 13 6 5 6-5M26 51l6-5 6 5M14 26l7-2-1-7M50 38l-7 2 1 7M14 38l7 2-1 7M50 26l-7-2 1-7" />
    </svg>
    <strong>21</strong>
  </div>
);

const DealerShoe = () => (
  <div className="snow-bj-shoe" aria-hidden="true">
    <span className="snow-bj-shoe__card snow-bj-shoe__card--one" />
    <span className="snow-bj-shoe__card snow-bj-shoe__card--two" />
    <span className="snow-bj-shoe__card snow-bj-shoe__card--three" />
    <span className="snow-bj-shoe__mouth" />
  </div>
);

const EmptyHand = () => (
  <div className="snow-bj-empty-hand" aria-hidden="true">
    <span />
    <span />
  </div>
);

/** A hand that can hold 7+ cards fans instead of overflowing the rail. */
const Hand = ({ cards, faceDownAfter, highlight, compact }: {
  cards: GameCardValue[];
  faceDownAfter?: number;
  highlight?: boolean;
  compact?: boolean;
}) => (
  <div className={`snow-hand${cards.length > 5 ? ' snow-hand--fan' : ''}${cards.length > 7 ? ' is-wide' : ''}`}>
    {cards.map((card, i) => (
      <PlayingCard
        key={`${card.rank}${card.suit}-${i}`}
        card={card}
        faceDown={faceDownAfter !== undefined && i >= faceDownAfter}
        delay={Math.min(i, 4) * 90}
        highlighted={highlight}
        compact={compact || cards.length > 5}
      />
    ))}
  </div>
);

const Blackjack = ({ onBack }: BlackjackProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { balance, status } = useGameSocket();
  const life = useGameLifecycle();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  useTvActivate(activateFocused);

  const [phase, setPhase] = useState<Phase>('bet');
  const [bet, setBet] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const [playerHand, setPlayerHand] = useState<GameCardValue[]>([]);
  const [dealerHand, setDealerHand] = useState<GameCardValue[]>([]);
  const [dealerUp, setDealerUp] = useState<GameCardValue[]>([]);
  const [playerTotal, setPlayerTotal] = useState(0);
  const [dealerUpTotal, setDealerUpTotal] = useState(0);
  const [dealerTotal, setDealerTotal] = useState(0);
  const [serverSeedHash, setServerSeedHash] = useState('');
  const [canHit, setCanHit] = useState(false);
  const [canStand, setCanStand] = useState(false);
  const [canDouble, setCanDouble] = useState(false);

  const [settleStatus, setSettleStatus] = useState<string | null>(null);
  const [net, setNet] = useState(0);
  const [fair, setFair] = useState<GameFairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  const [revealedDealer, setRevealedDealer] = useState(0);

  // Never let the first paint claim that Deal is focused while auth or the
  // balance is still loading (or when the selected wager cannot be covered).
  const [focus, setFocus] = useState<FocusId>(() => (
    user && balance !== null && balance >= bet ? 'deal' : 'back'
  ));

  const backRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<HTMLButtonElement>(null);
  const dealRef = useRef<HTMLButtonElement>(null);
  const hitRef = useRef<HTMLButtonElement>(null);
  const standRef = useRef<HTMLButtonElement>(null);
  const doubleRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const fairRef = useRef<HTMLButtonElement>(null);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** Bumped per hand: an ack from an older hand can never mutate a newer one. */
  const roundEpoch = useRef(0);

  const revealComplete = phase === 'settled' && revealedDealer >= dealerHand.length;
  const dealUsable = !!user && balance !== null && balance >= bet;

  /**
   * The focus graph holds ONLY targets the player can use right now: Back and
   * Reduced FX are always reachable, chips only while affordable, actions only
   * while the server says they are legal, Play Again only once the dealer
   * reveal has finished, Fairness only when there is something to show.
   * Capability (not the in-flight flag) decides membership, so the focused
   * transaction button is retained while its ack is pending instead of the
   * remote jumping away mid-hand.
   */
  const focusRows = useMemo<FocusRows>(() => {
    const top = ['back', 'fx'];
    if (phase === 'bet') {
      const chips = user && balance !== null
        ? BETS
          .map((amount, i) => (balance >= amount ? `chip-${i}` : null))
          .filter((id): id is string => id !== null)
        : [];
      return [top, [...chips, ...(dealUsable ? ['deal'] : [])]];
    }
    if (phase === 'playing') {
      return [top, [
        ...(canHit ? ['hit'] : []),
        ...(canStand ? ['stand'] : []),
        ...(canDouble ? ['double'] : []),
      ]];
    }
    return [
      top,
      revealComplete ? ['again'] : [],
      fair || serverSeedHash ? ['fair'] : [],
    ];
  }, [phase, balance, user, dealUsable, canHit, canStand, canDouble, revealComplete, fair, serverSeedHash]);

  // Render from the availability-filtered graph too, so a balance/auth change
  // cannot leave a one-frame visual ring on Deal before state is re-homed.
  const visibleFocus = (rehome(focusRows, focus) as FocusId) ?? 'back';

  // A phase or capability change must always leave managed focus on something
  // usable rather than stranding the remote on a disabled control.
  useEffect(() => {
    setFocus((current) => (rehome(focusRows, current) as FocusId) ?? 'back');
  }, [focusRows]);

  useEffect(() => {
    // Availability can change between renders (auth/balance/socket acks). Use
    // the safe graph target for real DOM focus immediately; do not spend one
    // effect cycle focusing a control that has just become unavailable.
    const target = visibleFocus === 'back' ? backRef.current
      : visibleFocus === 'fx' ? fxRef.current
        : visibleFocus === 'deal' ? dealRef.current
          : visibleFocus === 'hit' ? hitRef.current
            : visibleFocus === 'stand' ? standRef.current
              : visibleFocus === 'double' ? doubleRef.current
                : visibleFocus === 'again' ? againRef.current
                  : visibleFocus === 'fair' ? fairRef.current
                    : chipRefs.current[Number(visibleFocus.split('-')[1])];
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [visibleFocus, phase]);

  const applyAck = useCallback((resp: BlackjackAck) => {
    if (typeof resp?.bet === 'number') setBet(resp.bet);
    if (resp?.status === 'player_turn') {
      setPhase('playing');
      setPlayerHand(resp.playerHand ?? []);
      setDealerUp(resp.dealerUp ?? []);
      setDealerHand([]);
      setPlayerTotal(resp.playerTotal ?? 0);
      setDealerUpTotal(resp.dealerUpTotal ?? 0);
      setCanHit(!!resp.canHit);
      setCanStand(!!resp.canStand);
      setCanDouble(!!resp.canDouble);
      if (resp.serverSeedHash) setServerSeedHash(resp.serverSeedHash);
      setSettleStatus(null);
      setNet(0);
      setFair(null);
      setFocus(resp.canHit ? 'hit' : resp.canStand ? 'stand' : 'hit');
    } else if (resp?.status) {
      setPhase('settled');
      setPlayerHand(resp.playerHand ?? []);
      const dHand = resp.dealerHand ?? [];
      setDealerHand(dHand);
      setPlayerTotal(resp.playerTotal ?? 0);
      setDealerTotal(resp.dealerTotal ?? 0);
      setSettleStatus(resp.status);
      setNet(typeof resp.net === 'number' ? resp.net : 0);
      setCanHit(false);
      setCanStand(false);
      setCanDouble(false);
      if (resp.fair) setFair(resp.fair);
      setFocus('again');
      setRevealedDealer(Math.min(1, dHand.length));
    }
  }, []);

  /**
   * A CONFIRMED terminal answer (the server says this round no longer exists,
   * or the table was switched off) must never leave the local phase in
   * `playing`, because the Back guard would then block the player forever. Drop
   * back to a safe betting state with a clear note. A transport timeout is NOT
   * terminal — the hand may still be live — so it is left untouched.
   */
  const reconcileTerminalRound = useCallback(() => {
    setPhase('bet');
    setPlayerHand([]);
    setDealerHand([]);
    setDealerUp([]);
    setSettleStatus(null);
    setNet(0);
    setCanHit(false);
    setCanStand(false);
    setCanDouble(false);
    setShowFair(false);
    setRevealedDealer(0);
    setFocus(dealUsable ? 'deal' : 'back');
  }, [dealUsable]);

  const handleErrorAck = (err: string) => {
    if (err === 'game_disabled') setError(t('games.blackjack.errorGameDisabled'));
    else if (err === 'invalid_bet') setError(t('games.blackjack.errorInvalidBet'));
    else if (err === 'insufficient_balance') setError(t('games.blackjack.errorInsufficientBalance'));
    else if (err === 'round_in_progress') setError(t('games.blackjack.errorRoundInProgress'));
    else if (err === 'no_active_round') setError(t('games.blackjack.errorNoActiveRound'));
    else if (err === 'cannot_double') setError(t('games.blackjack.errorCannotDouble'));
    else setError(t('games.blackjack.errorGeneric'));
    if (isTerminalRoundError(err)) reconcileTerminalRound();
    life.timeout(() => setError(null), 3500);
  };

  const deal = useCallback(async () => {
    if (inFlight.current || busy) return;
    if (!user) { setError(t('games.blackjack.errorSignIn')); return; }
    if (balance === null) { setError(t('games.blackjack.errorLoadingChips')); return; }
    if (balance < bet) { setError(t('games.blackjack.errorInsufficientBalance')); return; }
    inFlight.current = true;
    const epoch = ++roundEpoch.current;
    setError(null);
    setBusy(true);
    try {
      const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.dealBlackjack(bet, seed);
      // An ack that lands after unmount, or after a newer hand started, must
      // not touch state or schedule timers.
      if (!life.isMounted() || epoch !== roundEpoch.current) return;
      if (resp?.ok) applyAck(resp);
      else handleErrorAck(resp?.error ?? 'error');
    } catch {
      if (life.isMounted() && epoch === roundEpoch.current) setError(t('games.blackjack.errorDealFailed'));
    } finally {
      if (life.isMounted() && epoch === roundEpoch.current) setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, user, balance, bet, applyAck, life]);

  const action = useCallback(async (which: 'hit' | 'stand' | 'double') => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    const epoch = roundEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const resp =
        which === 'hit' ? await gameSocket.hit() :
        which === 'stand' ? await gameSocket.stand() :
        await gameSocket.double();
      if (!life.isMounted() || epoch !== roundEpoch.current) return;
      if (resp?.ok) applyAck(resp);
      else handleErrorAck(resp?.error ?? 'error');
    } catch {
      if (life.isMounted() && epoch === roundEpoch.current) setError(t('games.blackjack.errorTableUnreachable'));
    } finally {
      if (life.isMounted() && epoch === roundEpoch.current) setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, applyAck, life]);

  const playAgain = () => {
    setPhase('bet');
    setPlayerHand([]);
    setDealerHand([]);
    setDealerUp([]);
    setSettleStatus(null);
    setNet(0);
    setFair(null);
    setShowFair(false);
    setRevealedDealer(0);
    setFocus(dealUsable ? 'deal' : 'back');
  };

  // Staggered dealer reveal — purely visual, cancelled on unmount/Back.
  useEffect(() => {
    if (phase !== 'settled') return;
    if (revealedDealer >= dealerHand.length) return;
    const base = revealedDealer === 0 ? 250 : 550;
    const id = life.timeout(() => setRevealedDealer((n) => n + 1), reducedFx ? Math.max(120, Math.round(base / 2)) : base);
    return () => life.clearTimer(id);
  }, [phase, revealedDealer, dealerHand.length, reducedFx, life]);

  /**
   * D-pad focus movement only. Every arrow is consumed while the table is on
   * screen — even at a graph boundary — so the native TV WebView cannot run its
   * own spatial navigation and drift off the single data-tv-focused marker.
   * While a global modal is open the game yields the arrows untouched.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isGlobalModalOpen()) return;
      const dir = visualArrowDir(e);
      if (!dir) return;
      e.preventDefault();
      setFocus((current) => (moveInRows(focusRows, current, dir) as FocusId) ?? current);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusRows]);

  const shownDealerTotal = phase === 'settled'
    ? (revealComplete ? dealerTotal : computeBjTotal(dealerHand.slice(0, revealedDealer)))
    : dealerUpTotal;

  const [backNote, setBackNote] = useState<string | null>(null);
  const { requestBack } = useGameBack({
    isDetailsOpen: () => showFair,
    closeDetails: () => setShowFair(false),
    // A live hand, an ack in flight, or a dealer reveal still running keeps the
    // player on the table: the wager is already committed.
    isBusy: () => busy || inFlight.current || phase === 'playing' || (phase === 'settled' && !revealComplete),
    onBlocked: () => {
      setBackNote(t('games.shared.finishRoundFirst'));
      life.timeout(() => setBackNote(null), 2600);
    },
    onExit: onBack,
  });

  const banner = (() => {
    if (!settleStatus || !revealComplete) return null;
    const map: Record<string, { text: string; tone: 'win' | 'lose' | 'push' }> = {
      blackjack: { text: t('games.blackjack.bannerBlackjack'), tone: 'win' },
      win: { text: t('games.blackjack.bannerWin'), tone: 'win' },
      dealer_bust: { text: t('games.blackjack.bannerDealerBust'), tone: 'win' },
      lose: { text: t('games.blackjack.bannerLose'), tone: 'lose' },
      bust: { text: t('games.blackjack.bannerBust'), tone: 'lose' },
      push: { text: t('games.blackjack.bannerPush'), tone: 'push' },
    };
    const m = map[settleStatus] ?? { text: settleStatus.toUpperCase(), tone: 'push' as const };
    return (
      <ResultBanner tone={m.tone} title={m.text}>
        {net > 0 ? t('games.blackjack.netWin', { net: net.toLocaleString() })
          : net < 0 ? t('games.blackjack.netLoss', { net: net.toLocaleString() })
          : t('games.blackjack.netZero')}
      </ResultBanner>
    );
  })();

  const dealerCards = phase === 'playing'
    ? [...dealerUp, ...(dealerUp.length ? [dealerUp[0]] : [])]
    : dealerHand;
  const dealerFaceDownAfter = phase === 'playing' ? dealerUp.length : revealedDealer;

  return (
    <GameShell accent="emerald" className={`snow-blackjack snow-blackjack--${phase}`}>
      <GameTopBar
        ref={backRef}
        onBack={requestBack}
        backLabel={t('games.blackjack.back')}
        balance={balance}
        status={status}
        title={t('games.blackjack.title')}
        phase={t('games.blackjack.subheading')}
        backFocused={visibleFocus === 'back'}
        onBackFocus={() => setFocus('back')}
        reducedFx={reducedFx}
        onToggleFx={toggleReducedFx}
        fxRef={fxRef}
        fxFocused={visibleFocus === 'fx'}
        onFxFocus={() => setFocus('fx')}
      />

      <div className="snow-bj-stage">
        <div className="snow-bj-table">
          <div className="snow-bj-table__rail" aria-hidden="true">
            <span /><span /><span /><span /><span />
          </div>
          <div className="snow-bj-table__felt">
            <div className="snow-bj-zone snow-bj-zone--dealer">
              <div className="snow-bj-zone__equipment">
                <DealerShoe />
                <span className="snow-bj-shoe-label" aria-hidden="true">❄</span>
              </div>
              <div className="snow-bj-seat">
                <div className="snow-bj-seat__heading">
                  <span className="snow-bj-seat__label"><i aria-hidden="true" />{t('games.blackjack.dealer')}</span>
                  {phase !== 'bet' && (
                    <span className={`snow-bj-total${shownDealerTotal > 21 ? ' is-bust' : ''}`}>
                      {shownDealerTotal}
                    </span>
                  )}
                </div>
                <div className="snow-bj-hand-well">
                  {phase === 'bet'
                    ? <><EmptyHand /><p className="snow-bj-hint">{t('games.blackjack.placeBetPrompt')}</p></>
                    : <Hand cards={dealerCards} faceDownAfter={dealerFaceDownAfter} />}
                </div>
              </div>
              <div className="snow-bj-zone__ornament" aria-hidden="true">
                <span>♠</span><span>♥</span><span>♦</span><span>♣</span>
              </div>
            </div>

            <div className="snow-bj-centerline">
              <span className="snow-bj-centerline__rule" aria-hidden="true" />
              <SnowMedallion />
              <div className="snow-bj-stake" aria-label={t('games.blackjack.dealWithBet', { bet })}>
                <span className="snow-bj-stake__chip">{bet}</span>
              </div>
              <span className="snow-bj-centerline__rule" aria-hidden="true" />
              {banner && <div className="snow-bj-result">{banner}</div>}
            </div>

            <div className="snow-bj-zone snow-bj-zone--player">
              <div className="snow-bj-zone__equipment snow-bj-zone__equipment--player" aria-hidden="true">
                <span className="snow-bj-seat-marker">◆</span>
              </div>
              <div className="snow-bj-seat">
                <div className="snow-bj-seat__heading">
                  <span className="snow-bj-seat__label"><i aria-hidden="true" />{t('games.blackjack.you')}</span>
                  {phase !== 'bet' && (
                    <span className={`snow-bj-total${playerTotal > 21 ? ' is-bust' : ''}`}>
                      {playerTotal}
                    </span>
                  )}
                </div>
                <div className="snow-bj-hand-well">
                  {phase === 'bet'
                    ? <><EmptyHand /><p className="snow-bj-hint">{t('games.blackjack.cardsAppearHere')}</p></>
                    : <Hand cards={playerHand} highlight={phase === 'settled' && settleStatus === 'blackjack'} />}
                </div>
              </div>
              <div className="snow-bj-zone__ornament snow-bj-zone__ornament--player" aria-hidden="true">
                <svg viewBox="0 0 48 48" focusable="false">
                  <circle cx="24" cy="24" r="17" />
                  <path d="M24 13v22M13 24h22" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <GamePanel className="snow-bj-controls">
        {phase === 'bet' && (
          <div className="snow-bj-controls__row snow-bj-controls__row--bet">
            <div className="snow-bj-controls__label">
              <span className="snow-bj-controls__chip" aria-hidden="true">◆</span>
              <strong>{t('games.blackjack.chooseBet')}</strong>
            </div>
            <div className="snow-bet-row">
              {BETS.map((amount, i) => (
                <BetChip
                  key={amount}
                  ref={(el) => { chipRefs.current[i] = el; }}
                  selected={bet === amount}
                  focused={visibleFocus === `chip-${i}`}
                  onFocus={() => {
                    if (user && balance !== null && balance >= amount) setFocus(`chip-${i}`);
                    else backRef.current?.focus({ preventScroll: true });
                  }}
                  onClick={() => { if (user && balance !== null && balance >= amount) setBet(amount); }}
                  aria-disabled={!user || balance === null || balance < amount ? 'true' : undefined}
                >
                  {amount}
                </BetChip>
              ))}
              <Button
                ref={dealRef}
                type="button"
                onFocus={() => {
                  if (dealUsable) setFocus('deal');
                  else backRef.current?.focus({ preventScroll: true });
                }}
                onClick={() => { if (!busy && dealUsable) deal(); }}
                aria-disabled={busy || !dealUsable ? 'true' : undefined}
                data-busy={busy ? 'true' : undefined}
                data-tv-focused={visibleFocus === 'deal' && dealUsable ? 'true' : 'false'}
                className={`${GAME_ACTION_CLASS} snow-bj-action snow-bj-action--deal`}
              >
                {busy
                  ? <><Loader2 className="animate-spin" /> <span>{t('games.blackjack.dealing')}</span></>
                  : <><BlackjackActionIcon name="deal" /><span>{t('games.blackjack.dealWithBet', { bet })}</span></>}
              </Button>
            </div>
          </div>
        )}

        {phase === 'playing' && (
          <div className="snow-bj-controls__row">
            <div className="snow-bj-controls__stake">
              <span>{bet}</span>
              <small>{t('games.shared.playChips')}</small>
            </div>
            <div className="snow-game-actions">
              <Button
                ref={hitRef}
                type="button"
                onFocus={() => setFocus('hit')}
                onClick={() => { if (canHit && !busy) action('hit'); }}
                aria-disabled={!canHit || busy ? 'true' : undefined}
                data-busy={busy ? 'true' : undefined}
                data-tv-focused={visibleFocus === 'hit' ? 'true' : 'false'}
                className={`${GAME_ACTION_CLASS} snow-bj-action snow-bj-action--hit`}
              >
                <BlackjackActionIcon name="hit" /><span>{t('games.blackjack.hit')}</span>
              </Button>
              <Button
                ref={standRef}
                type="button"
                variant="navy"
                onFocus={() => setFocus('stand')}
                onClick={() => { if (canStand && !busy) action('stand'); }}
                aria-disabled={!canStand || busy ? 'true' : undefined}
                data-busy={busy ? 'true' : undefined}
                data-tv-focused={visibleFocus === 'stand' ? 'true' : 'false'}
                className={`${GAME_ACTION_CLASS} snow-bj-action snow-bj-action--stand`}
              >
                <BlackjackActionIcon name="stand" /><span>{t('games.blackjack.stand')}</span>
              </Button>
              {canDouble && (
                <Button
                  ref={doubleRef}
                  type="button"
                  variant="navy"
                  onFocus={() => setFocus('double')}
                  onClick={() => { if (!busy) action('double'); }}
                  aria-disabled={busy ? 'true' : undefined}
                  data-busy={busy ? 'true' : undefined}
                  data-tv-focused={visibleFocus === 'double' ? 'true' : 'false'}
                  className={`${GAME_ACTION_CLASS} snow-bj-action snow-bj-action--double`}
                >
                  <BlackjackActionIcon name="double" /><span>{t('games.blackjack.double')}</span>
                </Button>
              )}
            </div>
            {busy && <span className="snow-game-note snow-bj-working"><Loader2 className="inline h-4 w-4 animate-spin" /> {t('games.blackjack.working')}</span>}
          </div>
        )}

        {phase === 'settled' && (
          <div className="snow-bj-controls__row snow-bj-controls__row--settled">
            <div className="snow-bj-controls__stake">
              <span>{bet}</span>
              <small>{t('games.shared.playChips')}</small>
            </div>
            <div className="snow-game-actions">
              <Button
                ref={againRef}
                type="button"
                onFocus={() => setFocus('again')}
                onClick={() => { if (revealComplete) playAgain(); }}
                aria-disabled={revealComplete ? undefined : 'true'}
                data-tv-focused={visibleFocus === 'again' ? 'true' : 'false'}
                className={`${GAME_ACTION_CLASS} snow-bj-action snow-bj-action--again`}
              >
                <BlackjackActionIcon name="again" /><span>{t('games.blackjack.playAgain')}</span>
              </Button>
            </div>
          </div>
        )}

        <div className="snow-bj-controls__note">
          {error && <p className="snow-game-error">{error}</p>}
          {backNote && <p className="snow-game-note" role="status">{backNote}</p>}
          {phase === 'bet' && !error && <p className="snow-game-note">{t('games.blackjack.freshSeedNote')}</p>}
        </div>
      </GamePanel>

      <FairnessPanel
        ref={fairRef}
        fair={fair}
        hash={serverSeedHash}
        open={showFair}
        onToggle={() => setShowFair((s) => !s)}
        focused={visibleFocus === 'fair'}
        onFocus={() => setFocus('fair')}
        labels={{
          title: t('games.blackjack.provablyFair'),
          hash: t('games.blackjack.fairServerSeedHash'),
          server: t('games.blackjack.fairServerSeed'),
          client: t('games.blackjack.fairClientSeed'),
          nonce: t('games.blackjack.fairNonce'),
          note: t('games.blackjack.fairVerifyNote'),
        }}
      />
    </GameShell>
  );
};

export default Blackjack;
