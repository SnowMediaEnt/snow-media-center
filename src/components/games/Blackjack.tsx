import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { BetChip, GAME_ACTION_CLASS, GamePanel, GameShell, GameTopBar, ResultBanner } from './shared/GameUI';
import { PlayingCard } from './shared/PlayingCard';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { useGameLifecycle } from './shared/gameLifecycle';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useGameBack } from './shared/gameBack';
import { isGlobalModalOpen, isTerminalRoundError, visualArrowDir } from './shared/gameInput';
import { moveInRows, rehome, type FocusRows } from './shared/focusRows';
import type { GameCardValue } from './shared/gameTypes';
import { useGameAudio } from './shared/gameAudio';
import { TV_BETS, readSavedBet, saveSelectedBet } from './shared/gameBets';
import '@/styles/games-blackjack.css';

interface BlackjackProps {
  onBack: () => void;
}

const BETS: number[] = [...TV_BETS];
const BET_STORAGE_KEY = 'snow-blackjack-bet-v1';

type Phase = 'bet' | 'playing' | 'settled';
type BlackjackVariantId = 'classic' | 'single_deck' | 'double_reveal';
type FocusId = 'back' | 'fx' | 'deal' | 'hit' | 'stand' | 'double' | 'split' | 'again' | `side-${number}` | `variant-${number}` | `chip-${number}`;

const SIDE_OPTIONS = [0, 10, 25, 50, 100];
const SIDE_GAMES = [
  { key: 'pairs', label: 'Perfect Pairs', rule: 'Pair 6:1 · same color 12:1 · identical 25:1' },
  { key: 'three', label: '21+3', rule: 'Flush 5:1 · straight 10:1 · trips 30:1 · straight flush 40:1 · suited trips 100:1' },
  { key: 'ladies', label: 'Lucky Ladies', rule: '20 pays 4:1 · suited 10:1 · matched 25:1 · two heart queens 200:1 (dealer blackjack 1000:1)' },
];

const BLACKJACK_VARIANTS: ReadonlyArray<{
  id: BlackjackVariantId;
  label: string;
  kicker: string;
  rules: string;
}> = [
  {
    id: 'classic',
    label: 'Classic 21',
    kicker: 'Six-deck lounge table',
    rules: 'Finite shoe · dealer stands soft 17 · blackjack pays 3:2',
  },
  {
    id: 'single_deck',
    label: 'Single Deck',
    kicker: 'One deck until the cut card',
    rules: 'Finite deck · dealer stands soft 17 · blackjack pays 3:2',
  },
  {
    id: 'double_reveal',
    label: 'Double Reveal',
    kicker: 'Your double card stays sealed',
    rules: 'Dealer finishes first · your last card flips at settlement',
  },
];

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
  canSplit?: boolean;
  activeHand?: number;
  hands?: Array<{ cards: GameCardValue[]; bet: number; outcome?: string }>;
  sideResults?: Array<{ key: string; bet: number; payout: number }>;
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
  variant?: BlackjackVariantId;
  rules?: {
    label?: string;
    deckCount?: number;
    penetration?: number;
    dealerStandsSoft17?: boolean;
    blackjackPayout?: string;
    doubleRule?: string;
    faceDownDouble?: boolean;
  };
  shoe?: {
    id?: string;
    cardsRemaining?: number;
    shuffleAt?: number;
    shufflePending?: boolean;
  };
  doubled?: boolean;
  doubleCardFaceDown?: boolean;
  doubleCardIndex?: number | null;
  preDoublePlayerTotal?: number | null;
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
  const { play } = useGameAudio();
  useTvActivate(activateFocused);

  const [phase, setPhase] = useState<Phase>('bet');
  const fittedTableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const table = fittedTableRef.current;
    if (!table) return;
    const fit = () => {
      const seats = Array.from(table.querySelectorAll<HTMLElement>('.snow-bj-seat'));
      const available = Math.min(...seats.map(seat => seat.clientHeight - (seat.querySelector<HTMLElement>('.snow-bj-seat__heading')?.offsetHeight ?? 28)));
      if (!Number.isFinite(available) || available <= 0) return;
      const height = Math.max(32, Math.floor(available - (table.querySelector('.snow-bj-split-hands') ? 65 : 16)));
      table.style.setProperty('--fitted-card-height', `${height}px`);
      table.style.setProperty('--fitted-card-width', `${Math.floor(height * 2 / 3)}px`);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(table);
    const contentObserver = new MutationObserver(fit);
    contentObserver.observe(table, { childList: true, subtree: true });
    fit();
    window.addEventListener('resize', fit);
    return () => { observer?.disconnect(); contentObserver.disconnect(); window.removeEventListener('resize', fit); };
  }, [phase]);
  const [bet, setBet] = useState<number>(() => readSavedBet(BET_STORAGE_KEY));
  const [variant, setVariant] = useState<BlackjackVariantId>(() => {
    if (typeof window === 'undefined') return 'classic';
    try {
      const saved = window.localStorage.getItem('snow-blackjack-variant-v1');
      return BLACKJACK_VARIANTS.some((table) => table.id === saved)
        ? saved as BlackjackVariantId
        : 'classic';
    } catch {
      return 'classic';
    }
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => saveSelectedBet(BET_STORAGE_KEY, bet), [bet]);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const [playerHand, setPlayerHand] = useState<GameCardValue[]>([]);
  const [dealerHand, setDealerHand] = useState<GameCardValue[]>([]);
  const [dealerUp, setDealerUp] = useState<GameCardValue[]>([]);
  const [playerTotal, setPlayerTotal] = useState(0);
  const [preDoublePlayerTotal, setPreDoublePlayerTotal] = useState<number | null>(null);
  const [dealerUpTotal, setDealerUpTotal] = useState(0);
  const [dealerTotal, setDealerTotal] = useState(0);
  const [canHit, setCanHit] = useState(false);
  const [canStand, setCanStand] = useState(false);
  const [canDouble, setCanDouble] = useState(false);
  const [canSplit, setCanSplit] = useState(false);
  const [splitHands, setSplitHands] = useState<BlackjackAck['hands']>([]);
  const [activeHand, setActiveHand] = useState(0);
  const [sideBets, setSideBets] = useState<Record<string, number>>({ pairs: 0, three: 0, ladies: 0 });
  const [sideResults, setSideResults] = useState<NonNullable<BlackjackAck['sideResults']>>([]);
  const sideStake = Object.values(sideBets).reduce((sum, amount) => sum + amount, 0);
  const splitRef = useRef<HTMLButtonElement>(null);
  const sideRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [settleStatus, setSettleStatus] = useState<string | null>(null);
  const [net, setNet] = useState(0);
  const [revealedDealer, setRevealedDealer] = useState(0);
  const [doubleCardIndex, setDoubleCardIndex] = useState<number | null>(null);
  const [doubleCardRevealed, setDoubleCardRevealed] = useState(true);
  const [shoe, setShoe] = useState<BlackjackAck['shoe'] | null>(null);
  const [serverRules, setServerRules] = useState<BlackjackAck['rules'] | null>(null);

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
  const variantRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** Bumped per hand: an ack from an older hand can never mutate a newer one. */
  const roundEpoch = useRef(0);
  /** Carries the intended post-reveal action without making it focusable early. */
  const focusAgainAfterReveal = useRef(false);
  const soundedRoundEpoch = useRef(-1);

  const dealerRevealComplete = phase === 'settled' && revealedDealer >= dealerHand.length;
  const revealComplete = dealerRevealComplete && doubleCardRevealed;
  const dealUsable = !!user && balance !== null && balance >= bet + sideStake;
  const selectedVariant = BLACKJACK_VARIANTS.find((table) => table.id === variant) ?? BLACKJACK_VARIANTS[0];

  /**
   * The focus graph holds ONLY targets the player can use right now: Back and
   * Reduced FX are always reachable, chips only while affordable, actions only
   * while the server says they are legal, Play Again only once the dealer
   * reveal has finished.
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
      return [
        top,
        BLACKJACK_VARIANTS.map((_, index) => `variant-${index}`),
        SIDE_GAMES.map((_, index) => `side-${index}`),
        [...chips, ...(dealUsable ? ['deal'] : [])],
      ];
    }
    if (phase === 'playing') {
      return [top, [
        ...(canSplit ? ['split'] : []),
        ...(canHit ? ['hit'] : []),
        ...(canStand ? ['stand'] : []),
        ...(canDouble ? ['double'] : []),
      ]];
    }
    return [top, revealComplete ? ['again'] : []];
  }, [phase, balance, user, dealUsable, canHit, canStand, canDouble, canSplit, revealComplete]);

  // Render from the availability-filtered graph too, so a balance/auth change
  // cannot leave a one-frame visual ring on Deal before state is re-homed.
  const visibleFocus = (rehome(focusRows, focus) as FocusId) ?? 'back';

  // A phase or capability change must always leave managed focus on something
  // usable rather than stranding the remote on a disabled control.
  useEffect(() => {
    setFocus((current) => (rehome(focusRows, current) as FocusId) ?? 'back');
  }, [focusRows]);

  // A terminal ack precedes the dealer reveal, so Play Again is intentionally
  // unavailable for a moment. Remember that destination outside the active
  // focus graph, then transfer both cursors when the reveal is actually done.
  useEffect(() => {
    if (phase !== 'settled' || !revealComplete || !focusAgainAfterReveal.current) return;
    focusAgainAfterReveal.current = false;
    setFocus('again');
  }, [phase, revealComplete]);

  useEffect(() => {
    // Availability can change between renders (auth/balance/socket acks). Use
    // the safe graph target for real DOM focus immediately; do not spend one
    // effect cycle focusing a control that has just become unavailable.
    const target = visibleFocus === 'split' ? splitRef.current
      : visibleFocus.startsWith('side-') ? sideRefs.current[Number(visibleFocus.slice(5))]
      : visibleFocus === 'back' ? backRef.current
      : visibleFocus === 'fx' ? fxRef.current
        : visibleFocus === 'deal' ? dealRef.current
          : visibleFocus === 'hit' ? hitRef.current
            : visibleFocus === 'stand' ? standRef.current
              : visibleFocus === 'double' ? doubleRef.current
                : visibleFocus === 'again' ? againRef.current
                  : visibleFocus.startsWith('variant-')
                    ? variantRefs.current[Number(visibleFocus.split('-')[1])]
                    : chipRefs.current[Number(visibleFocus.split('-')[1])];
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [visibleFocus, phase]);

  const applyAck = useCallback((resp: BlackjackAck) => {
    setCanSplit(!!resp.canSplit);
    setSplitHands(resp.hands ?? []);
    setActiveHand(resp.activeHand ?? 0);
    setSideResults(resp.sideResults ?? []);
    // A double-down ack reports the total committed stake. Keep the player's
    // chosen base wager selected for the next hand instead of replacing it.
    if (typeof resp?.bet === 'number' && !resp.doubled && !resp.hands?.length && BETS.includes(resp.bet)) setBet(resp.bet);
    if (resp.variant && BLACKJACK_VARIANTS.some((table) => table.id === resp.variant)) {
      setVariant(resp.variant);
    }
    if (resp.rules) setServerRules(resp.rules);
    if (resp.shoe) setShoe(resp.shoe);
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
      setSettleStatus(null);
      setNet(0);
      setDoubleCardIndex(null);
      setDoubleCardRevealed(true);
      setPreDoublePlayerTotal(null);
      setFocus(resp.canHit ? 'hit' : resp.canStand ? 'stand' : 'hit');
    } else if (resp?.status) {
      focusAgainAfterReveal.current = true;
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
      const finalPlayer = resp.playerHand ?? [];
      const requestedIndex = typeof resp.doubleCardIndex === 'number'
        ? resp.doubleCardIndex
        : finalPlayer.length - 1;
      const hasSealedDouble = !!resp.doubleCardFaceDown
        && requestedIndex >= 0
        && requestedIndex < finalPlayer.length;
      setDoubleCardIndex(hasSealedDouble ? requestedIndex : null);
      setDoubleCardRevealed(!hasSealedDouble);
      setPreDoublePlayerTotal(typeof resp.preDoublePlayerTotal === 'number'
        ? resp.preDoublePlayerTotal
        : null);
      setFocus('back');
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
    focusAgainAfterReveal.current = false;
    setPhase('bet');
    setPlayerHand([]);
    setDealerHand([]);
    setDealerUp([]);
    setSettleStatus(null);
    setNet(0);
    setCanHit(false);
    setCanStand(false);
    setCanDouble(false);
    setRevealedDealer(0);
    setDoubleCardIndex(null);
    setDoubleCardRevealed(true);
    setPreDoublePlayerTotal(null);
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
    if (balance < bet + sideStake) { setError(t('games.blackjack.errorInsufficientBalance')); return; }
    inFlight.current = true;
    const epoch = ++roundEpoch.current;
    setError(null);
    setBusy(true);
    try {
      const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = sideStake > 0
        ? await gameSocket.dealBlackjack(bet, seed, variant, sideBets)
        : await gameSocket.dealBlackjack(bet, seed, variant);
      // An ack that lands after unmount, or after a newer hand started, must
      // not touch state or schedule timers.
      if (!life.isMounted() || epoch !== roundEpoch.current) return;
      if (resp?.ok) {
        play('card');
        applyAck(resp);
      }
      else handleErrorAck(resp?.error ?? 'error');
    } catch {
      if (life.isMounted() && epoch === roundEpoch.current) setError(t('games.blackjack.errorDealFailed'));
    } finally {
      if (life.isMounted() && epoch === roundEpoch.current) setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, user, balance, bet, variant, sideBets, sideStake, applyAck, life, play]);

  const action = useCallback(async (which: 'hit' | 'stand' | 'double' | 'split') => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    const epoch = roundEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const resp =
        which === 'split' ? await gameSocket.split() :
        which === 'hit' ? await gameSocket.hit() :
        which === 'stand' ? await gameSocket.stand() :
        await gameSocket.double();
      if (!life.isMounted() || epoch !== roundEpoch.current) return;
      if (resp?.ok) {
        if (which === 'hit' || which === 'double') play('card');
        applyAck(resp);
      }
      else handleErrorAck(resp?.error ?? 'error');
    } catch {
      if (life.isMounted() && epoch === roundEpoch.current) setError(t('games.blackjack.errorTableUnreachable'));
    } finally {
      if (life.isMounted() && epoch === roundEpoch.current) setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, applyAck, life, play]);

  const playAgain = () => {
    focusAgainAfterReveal.current = false;
    setPhase('bet');
    setPlayerHand([]);
    setDealerHand([]);
    setDealerUp([]);
    setSettleStatus(null);
    setNet(0);
    setRevealedDealer(0);
    setDoubleCardIndex(null);
    setDoubleCardRevealed(true);
    setPreDoublePlayerTotal(null);
    setFocus(dealUsable ? 'deal' : 'back');
  };

  // Staggered dealer reveal — purely visual, cancelled on unmount/Back.
  useEffect(() => {
    if (phase !== 'settled') return;
    if (revealedDealer >= dealerHand.length) return;
    const base = revealedDealer === 0 ? 250 : 550;
    const id = life.timeout(() => {
      setRevealedDealer((n) => n + 1);
      play('card', { volume: 0.7 });
    }, reducedFx ? Math.max(120, Math.round(base / 2)) : base);
    return () => life.clearTimer(id);
  }, [phase, revealedDealer, dealerHand.length, reducedFx, life, play]);

  // Double Reveal deliberately waits until the dealer has completed every
  // draw, then turns the player's one final card. The result and chips are
  // already authoritative; this timer controls presentation only.
  useEffect(() => {
    if (!dealerRevealComplete || doubleCardIndex === null || doubleCardRevealed) return;
    const id = life.timeout(
      () => {
        setDoubleCardRevealed(true);
        play('card', { volume: 0.85 });
      },
      reducedFx ? 180 : 650,
    );
    return () => life.clearTimer(id);
  }, [dealerRevealComplete, doubleCardIndex, doubleCardRevealed, reducedFx, life, play]);

  useEffect(() => {
    if (phase !== 'settled' || !revealComplete || !settleStatus) return;
    if (soundedRoundEpoch.current === roundEpoch.current) return;
    soundedRoundEpoch.current = roundEpoch.current;
    if (settleStatus === 'blackjack') play('bonus');
    else if (settleStatus === 'win' || settleStatus === 'dealer_bust') play('win');
    else if (settleStatus === 'lose' || settleStatus === 'bust') play('lose');
  }, [phase, play, revealComplete, settleStatus]);

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
      const next = moveInRows(focusRows, focus, dir) as FocusId | undefined;
      // A boundary press during the reveal must not cancel the pending
      // handoff to Play Again; only an actual navigation choice does.
      if (next && next !== focus) {
        focusAgainAfterReveal.current = false;
        setFocus(next);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusRows, focus]);

  const shownDealerTotal = phase === 'settled'
    ? (dealerRevealComplete ? dealerTotal : computeBjTotal(dealerHand.slice(0, revealedDealer)))
    : dealerUpTotal;
  const shownPlayerTotal = phase === 'settled' && !doubleCardRevealed
    ? (preDoublePlayerTotal ?? computeBjTotal(playerHand.slice(0, doubleCardIndex ?? playerHand.length)))
    : playerTotal;

  const [backNote, setBackNote] = useState<string | null>(null);
  const { requestBack } = useGameBack({
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
        phase={`${selectedVariant.label} · ${selectedVariant.kicker}`}
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
          <div className="snow-bj-table__felt" ref={fittedTableRef}>
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
              {phase === 'settled' && !doubleCardRevealed && (
                <div className="snow-bj-sealed-note" role="status">
                  <span aria-hidden="true">◆</span>
                  Dealer finishes first — your double card is sealed
                </div>
              )}
            </div>

            <div className="snow-bj-zone snow-bj-zone--player">
              <div className="snow-bj-zone__equipment snow-bj-zone__equipment--player" aria-hidden="true">
                <span className="snow-bj-seat-marker">◆</span>
              </div>
              <div className="snow-bj-seat">
                <div className="snow-bj-seat__heading">
                  <span className="snow-bj-seat__label"><i aria-hidden="true" />{t('games.blackjack.you')}</span>
                  {phase !== 'bet' && (
                    <span className={`snow-bj-total${shownPlayerTotal > 21 ? ' is-bust' : ''}`}>
                      {doubleCardRevealed ? shownPlayerTotal : `${shownPlayerTotal}+?`}
                    </span>
                  )}
                </div>
                <div className="snow-bj-hand-well">
                  {phase === 'bet'
                    ? <><EmptyHand /><p className="snow-bj-hint">{t('games.blackjack.cardsAppearHere')}</p></>
                    : splitHands && splitHands.length > 0 ? <div className="snow-bj-split-hands">
                      {splitHands.map((hand, index) => <div key={index} className={phase === 'playing' && activeHand === index ? 'is-active' : ''}>
                        <strong>Hand {index + 1} · {hand.bet} coins{phase === 'settled' && revealComplete ? ` · ${hand.outcome}` : ''}</strong>
                        <Hand cards={hand.cards} compact />
                        <span>{computeBjTotal(hand.cards)}</span>
                      </div>)}
                    </div> : <Hand
                      cards={playerHand}
                      faceDownAfter={phase === 'settled' && !doubleCardRevealed && doubleCardIndex !== null
                        ? doubleCardIndex
                        : undefined}
                      highlight={phase === 'settled' && settleStatus === 'blackjack'}
                    />}
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
        {phase !== 'bet' && sideResults.length > 0 && <p className="snow-bj-side-results">Side bets (returned at settlement): {sideResults.map(result => `${SIDE_GAMES.find(game => game.key === result.key)?.label}: ${result.payout} coins`).join(' · ')}</p>}
        {phase === 'bet' && (
          <div className="snow-bj-controls__row snow-bj-controls__row--bet">
            <div className="snow-bj-variants" role="group" aria-label="Blackjack table">
              {BLACKJACK_VARIANTS.map((table, index) => (
                <Button
                  key={table.id}
                  ref={(element) => { variantRefs.current[index] = element; }}
                  type="button"
                  variant="navy"
                  aria-pressed={variant === table.id}
                  data-tv-focused={visibleFocus === `variant-${index}` ? 'true' : 'false'}
                  className={`snow-bj-variant${variant === table.id ? ' is-selected' : ''}`}
                  onFocus={() => setFocus(`variant-${index}`)}
                  onClick={() => {
                    setVariant(table.id);
                    try { window.localStorage.setItem('snow-blackjack-variant-v1', table.id); } catch { /* TV storage can be locked */ }
                  }}
                >
                  <span>{table.label}</span>
                  <small>{table.kicker}</small>
                </Button>
              ))}
            </div>
            <div className="snow-bj-side-options" role="group" aria-label="Optional side bets">
              {SIDE_GAMES.map((game, index) => <Button key={game.key} ref={el => { sideRefs.current[index] = el; }} variant="navy" type="button"
                data-tv-focused={visibleFocus === `side-${index}` ? 'true' : 'false'} onFocus={() => setFocus(`side-${index}`)}
                aria-disabled={busy ? 'true' : undefined}
                onClick={() => { if (!busy) setSideBets(current => ({ ...current, [game.key]: SIDE_OPTIONS[(SIDE_OPTIONS.indexOf(current[game.key]) + 1) % SIDE_OPTIONS.length] })); }}>
                {game.label}: {sideBets[game.key]} coins
              </Button>)}
              <small>{SIDE_GAMES[Number(focus.slice(5))]?.rule ?? 'Split once · split aces get one card · no double after split. Side bets: OK cycles 0 / 10 / 25 / 50 / 100'} · Total deal: {bet + sideStake} coins</small>
            </div>
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
              {canSplit && <Button ref={splitRef} type="button" variant="navy" onFocus={() => setFocus('split')}
                onClick={() => { if (!busy) action('split'); }} aria-disabled={busy ? 'true' : undefined}
                data-tv-focused={visibleFocus === 'split' ? 'true' : 'false'} className={`${GAME_ACTION_CLASS} snow-bj-action`}>Split · +{bet}</Button>}
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
          {phase === 'bet' && !error && <p className="snow-game-note">{selectedVariant.rules}</p>}
          {phase !== 'bet' && !error && (
            <p className="snow-game-note snow-bj-live-rules">
              {serverRules?.deckCount ?? (variant === 'single_deck' ? 1 : 6)}-deck finite shoe
              {' · '}dealer stands soft 17{' · '}blackjack 3:2
              {shoe?.cardsRemaining !== undefined ? ` · ${shoe.cardsRemaining} cards remain` : ''}
              {shoe?.shufflePending ? ' · shuffle after this hand' : ''}
            </p>
          )}
        </div>
      </GamePanel>
    </GameShell>
  );
};

export default Blackjack;
