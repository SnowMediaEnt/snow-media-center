import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { BetChip, GAME_ACTION_CLASS, GamePanel, GameShell, GameTopBar, ResultBanner } from './shared/GameUI';
import { PlayingCard, PlayingCardSlot } from './shared/PlayingCard';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { useGameLifecycle } from './shared/gameLifecycle';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useGameBack } from './shared/gameBack';
import { isGlobalModalOpen, isTerminalRoundError, visualArrowDir } from './shared/gameInput';
import { useGameAudio } from './shared/gameAudio';
import type { GameCardValue } from './shared/gameTypes';
import { TV_BETS, readSavedBet, saveSelectedBet } from './shared/gameBets';
import '@/styles/games-holdem.css';

interface CasinoHoldemProps {
  onBack: () => void;
}

type Phase = 'bet' | 'decision' | 'reveal' | 'settled';
type FocusBet = `chip-${number}` | 'deal' | 'back' | 'fx';
type FocusDecision = `opt-${number}` | 'fold' | 'back' | 'fx';
type FocusSettle = 'again' | 'back' | 'fx';

interface RaiseOption { multiplier: number; cost: number }

interface HoldemAck {
  status?: string;
  /** Authoritative balance AFTER the ante was taken. */
  balance?: number;
  playerHole?: GameCardValue[];
  dealerHole?: GameCardValue[];
  community?: GameCardValue[];
  flop?: GameCardValue[];
  callCost?: number;
  raiseOptions?: RaiseOption[];
  playerRank?: string;
  dealerRank?: string;
  dealerQualified?: boolean;
  anteBonus?: number;
  payout?: number;
  net?: number;
}

const ANTES = [...TV_BETS];
const BET_STORAGE_KEY = 'snow-casino-holdem-bet-v1';

type HoldemActionIconName = 'deal' | 'call' | 'raise' | 'fold' | 'again';

/** Crisp, dependency-free table icons for older Android TV WebViews. */
const HoldemActionIcon = ({ name }: { name: HoldemActionIconName }) => {
  if (name === 'call') {
    return (
      <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <ellipse cx="14" cy="8" rx="8" ry="3.5" />
        <path d="M6 8v5c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5V8" />
        <path d="M6 13v5c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5v-5" />
      </svg>
    );
  }
  if (name === 'raise') {
    return (
      <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <ellipse cx="10" cy="17" rx="6" ry="3" />
        <path d="M4 17v4c0 1.7 2.7 3 6 3s6-1.3 6-3v-4" />
        <path d="M19 18V5M14.5 9.5 19 5l4.5 4.5" />
      </svg>
    );
  }
  if (name === 'fold') {
    return (
      <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <rect x="4.5" y="7" width="12" height="16" rx="2" />
        <rect x="11.5" y="4" width="12" height="16" rx="2" />
        <path d="m7 4 14 20" />
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
      <rect x="4.5" y="7" width="13" height="17" rx="2" />
      <rect x="10.5" y="4" width="13" height="17" rx="2" />
      <path d="M17 9.5v6M14 12.5h6" />
    </svg>
  );
};

const RANK_KEY: Record<string, string> = {
  royal_flush: 'games.casinoHoldem.handName.royalFlush',
  straight_flush: 'games.casinoHoldem.handName.straightFlush',
  four_of_a_kind: 'games.casinoHoldem.handName.fourOfAKind',
  full_house: 'games.casinoHoldem.handName.fullHouse',
  flush: 'games.casinoHoldem.handName.flush',
  straight: 'games.casinoHoldem.handName.straight',
  three_of_a_kind: 'games.casinoHoldem.handName.threeOfAKind',
  two_pair: 'games.casinoHoldem.handName.twoPair',
  one_pair: 'games.casinoHoldem.handName.pair',
  high_card: 'games.casinoHoldem.handName.highCard',
};

const CasinoHoldem = ({ onBack }: CasinoHoldemProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { balance, status } = useGameSocket();
  const life = useGameLifecycle();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  const { play } = useGameAudio();
  useTvActivate(activateFocused);

  const labelRank = (k?: string) => (k ? (RANK_KEY[k] ? t(RANK_KEY[k]) : k.replace(/_/g, ' ')) : '');

  const [phase, setPhase] = useState<Phase>('bet');
  const [ante, setAnte] = useState<number>(() => readSavedBet(BET_STORAGE_KEY));
  useEffect(() => saveSelectedBet(BET_STORAGE_KEY, ante), [ante]);
  const [raiseOptions, setRaiseOptions] = useState<RaiseOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const [playerHole, setPlayerHole] = useState<GameCardValue[]>([]);
  const [dealerHole, setDealerHole] = useState<GameCardValue[]>([]);
  const [community, setCommunity] = useState<GameCardValue[]>([]);
  const [revealedCommunity, setRevealedCommunity] = useState(0);
  const [dealerRevealed, setDealerRevealed] = useState(false);

  const [settleStatus, setSettleStatus] = useState<string | null>(null);
  const [playerRank, setPlayerRank] = useState('');
  const [dealerRank, setDealerRank] = useState('');
  const [dealerQualified, setDealerQualified] = useState(true);
  const [anteBonus, setAnteBonus] = useState(0);
  const [net, setNet] = useState(0);

  // Auth and balance often arrive after the first TV paint. Start on the Deal
  // control only when it is genuinely usable; Back is always a safe target.
  const [focusBet, setFocusBet] = useState<FocusBet>(() => (
    user && balance !== null && balance >= ante ? 'deal' : 'back'
  ));
  const [focusDecision, setFocusDecision] = useState<FocusDecision>('fold');
  const [focusSettle, setFocusSettle] = useState<FocusSettle>('again');

  const backRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<HTMLButtonElement>(null);
  const dealRef = useRef<HTMLButtonElement>(null);
  const foldRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** Bumped on every deal so an old ack or reveal timer cannot touch a new hand. */
  const handEpoch = useRef(0);

  /**
   * Decision affordability is measured against the balance the SERVER reported
   * once the ante was taken — never the live balance, which may not have caught
   * up, and only falling back to a local estimate when the ack omits it.
   */
  const [decisionBalance, setDecisionBalance] = useState<number | null>(null);
  const affordable = useCallback((cost: number) => {
    const pool = phase === 'bet' ? (balance ?? 0) : (decisionBalance ?? Math.max(0, (balance ?? 0) - ante));
    return pool >= cost;
  }, [phase, balance, decisionBalance, ante]);

  const dealUsable = !!user && balance !== null && balance >= ante;
  /** Ante chips that are meaningful navigation targets in the betting phase. */
  const usableChips = useMemo(() => (
    user && balance !== null
      ? ANTES.map((amount, i) => (balance >= amount ? i : -1)).filter((i) => i >= 0)
      : []
  ), [user, balance]);
  const visibleFocusBet: FocusBet = (() => {
    const chipIndex = focusBet.startsWith('chip-') ? Number(focusBet.split('-')[1]) : -1;
    return (focusBet === 'deal' && !dealUsable) || (chipIndex >= 0 && !usableChips.includes(chipIndex))
      ? 'back'
      : focusBet;
  })();

  useEffect(() => {
    if (phase === 'bet') {
      const safeFocus = visibleFocusBet;
      if (safeFocus !== focusBet) setFocusBet(safeFocus);
      if (safeFocus === 'back') backRef.current?.focus({ preventScroll: true });
      else if (safeFocus === 'fx') fxRef.current?.focus({ preventScroll: true });
      else if (safeFocus === 'deal') dealRef.current?.focus({ preventScroll: true });
      else chipRefs.current[Number(safeFocus.split('-')[1])]?.focus({ preventScroll: true });
    } else if (phase === 'decision') {
      if (focusDecision === 'back') backRef.current?.focus({ preventScroll: true });
      else if (focusDecision === 'fx') fxRef.current?.focus({ preventScroll: true });
      else if (focusDecision === 'fold') foldRef.current?.focus({ preventScroll: true });
      else optionRefs.current[Number(focusDecision.split('-')[1])]?.focus({ preventScroll: true });
    } else if (phase === 'reveal') {
      // Decision buttons unmount during the runout. Back and FX persist, so
      // they carry both the visual marker and actual DOM focus throughout it.
      const safeFocus: FocusSettle = focusSettle === 'fx' ? 'fx' : 'back';
      if (safeFocus !== focusSettle) setFocusSettle(safeFocus);
      if (safeFocus === 'fx') fxRef.current?.focus({ preventScroll: true });
      else backRef.current?.focus({ preventScroll: true });
    } else if (phase === 'settled') {
      if (focusSettle === 'back') backRef.current?.focus({ preventScroll: true });
      else if (focusSettle === 'fx') fxRef.current?.focus({ preventScroll: true });
      else if (focusSettle === 'again') againRef.current?.focus({ preventScroll: true });
    }
  }, [phase, focusBet, focusDecision, focusSettle, visibleFocusBet]);

  /** Indexes of raise/call options the player can actually pay for. */
  const affordableOptions = raiseOptions.map((o, i) => (affordable(o.cost) ? i : -1)).filter((i) => i >= 0);

  // Re-home focus if an option the remote is sitting on becomes unaffordable.
  useEffect(() => {
    if (phase !== 'decision' || !focusDecision.startsWith('opt-')) return;
    const idx = Number(focusDecision.split('-')[1]);
    if (!affordableOptions.includes(idx)) {
      setFocusDecision(affordableOptions.length ? (`opt-${affordableOptions[0]}` as FocusDecision) : 'fold');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, focusDecision, affordableOptions.join(',')]);

  const handleErrorAck = (err: string) => {
    if (err === 'game_disabled') setError(t('games.casinoHoldem.error.gameDisabled'));
    else if (err === 'invalid_bet') setError(t('games.casinoHoldem.error.invalidBet'));
    else if (err === 'insufficient_balance') setError(t('games.casinoHoldem.error.insufficientBalance'));
    else if (err === 'round_in_progress') setError(t('games.casinoHoldem.error.roundInProgress'));
    else if (err === 'no_active_round') setError(t('games.casinoHoldem.error.noActiveRound'));
    else setError(t('games.casinoHoldem.error.generic'));
    // A CONFIRMED dead round must not leave the table in `decision` with Back
    // blocked forever. Reconcile to a safe, usable betting state; a transport
    // failure is never treated as confirmation.
    if (isTerminalRoundError(err)) {
      handEpoch.current += 1;
      setPhase('bet');
      setPlayerHole([]);
      setDealerHole([]);
      setCommunity([]);
      setRevealedCommunity(0);
      setDealerRevealed(false);
      setSettleStatus(null);
      setRaiseOptions([]);
      setFocusBet(dealUsable ? 'deal' : 'back');
    }
    life.timeout(() => setError(null), 3500);
  };

  const deal = useCallback(async () => {
    if (inFlight.current || busy) return;
    if (!user) { setError(t('games.casinoHoldem.error.signIn')); return; }
    if (balance === null) { setError(t('games.casinoHoldem.error.loadingChips')); return; }
    if (balance < ante) { setError(t('games.casinoHoldem.error.insufficientBalance')); return; }
    inFlight.current = true;
    const epoch = handEpoch.current + 1;
    handEpoch.current = epoch;
    setError(null);
    setBusy(true);
    try {
      const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.dealCasinoHoldem(ante, seed);
      if (!life.isMounted() || epoch !== handEpoch.current) return;
      if (resp?.ok && resp.status === 'decision') {
        play('card');
        setPlayerHole(resp.playerHole ?? []);
        setCommunity(resp.flop ?? []);
        setRevealedCommunity(3);
        setDealerHole([]);
        setDealerRevealed(false);
        const cc = resp.callCost ?? ante * 2;
        const opts: RaiseOption[] = Array.isArray(resp.raiseOptions) && resp.raiseOptions.length
          ? resp.raiseOptions
          : [{ multiplier: 2, cost: cc }];
        setRaiseOptions(opts);
        setSettleStatus(null);
        setNet(0); setAnteBonus(0);
        setPlayerRank(''); setDealerRank(''); setDealerQualified(true);
        setPhase('decision');
        // The ante is already committed: take the post-ante balance straight
        // from the ack and only estimate it when the server omits it.
        const remaining = typeof resp.balance === 'number'
          ? resp.balance
          : Math.max(0, (balance ?? 0) - ante);
        setDecisionBalance(remaining);
        const firstAffordable = opts.findIndex((o) => o.cost <= remaining);
        setFocusDecision(firstAffordable >= 0 ? (`opt-${firstAffordable}` as FocusDecision) : 'fold');
      } else {
        handleErrorAck(resp?.error ?? 'error');
      }
    } catch {
      if (!life.isMounted() || epoch !== handEpoch.current) return;
      setError(t('games.casinoHoldem.error.dealFailed'));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, user, balance, ante, life, play]);

  const finishSettle = useCallback((resp: HoldemAck, folded: boolean) => {
    const epoch = handEpoch.current;
    const alive = () => life.isMounted() && epoch === handEpoch.current;
    const settledBonus = typeof resp.anteBonus === 'number' ? resp.anteBonus : 0;
    const settledNet = typeof resp.net === 'number' ? resp.net : 0;
    const playOutcome = () => {
      if (settledBonus > 0) play('bonus');
      else if (settledNet > 0) play('win');
      else if (settledNet < 0 || resp.status === 'folded' || resp.status === 'lose') play('lose');
    };
    setPlayerHole(resp.playerHole ?? []);
    setDealerHole(resp.dealerHole ?? []);
    setCommunity(resp.community ?? []);
    setSettleStatus(resp.status ?? null);
    setPlayerRank(resp.playerRank ?? '');
    setDealerRank(resp.dealerRank ?? '');
    setDealerQualified(resp.dealerQualified !== false);
    setAnteBonus(settledBonus);
    setNet(settledNet);

    if (folded) {
      play('card');
      playOutcome();
      setRevealedCommunity(5);
      setDealerRevealed(true);
      setPhase('settled');
      setFocusSettle('again');
      return;
    }
    // Tracked timers, guarded by hand epoch: Back, unmount or a newer hand
    // cancels the whole reveal.
    const scale = reducedFx ? 0.5 : 1;
    // Move real focus before the decision controls unmount. The top-bar Back
    // button exists in every phase, preventing a transient focus drop to body.
    backRef.current?.focus({ preventScroll: true });
    setFocusSettle('back');
    setPhase('reveal');
    play('card');
    life.timeout(() => {
      if (!alive()) return;
      setRevealedCommunity((n) => Math.max(n, 4));
      play('card', { volume: 0.75 });
    }, 350 * scale);
    life.timeout(() => {
      if (!alive()) return;
      setRevealedCommunity((n) => Math.max(n, 5));
      play('card', { volume: 0.75 });
    }, 700 * scale);
    life.timeout(() => {
      if (!alive()) return;
      setDealerRevealed(true);
      play('card', { volume: 0.85 });
    }, 1100 * scale);
    life.timeout(() => {
      if (!alive()) return;
      setPhase('settled');
      setFocusSettle('again');
      playOutcome();
    }, 1500 * scale);
  }, [life, play, reducedFx]);

  const doCall = useCallback(async (multiplier: number) => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    const epoch = handEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const resp = await gameSocket.callCasinoHoldem(multiplier);
      // An ack from an older hand, or one landing after unmount, must not
      // reveal cards or schedule reveal timers.
      if (!life.isMounted() || epoch !== handEpoch.current) return;
      if (resp?.ok) finishSettle(resp, false);
      else handleErrorAck(resp?.error ?? 'error');
    } catch {
      if (life.isMounted() && epoch === handEpoch.current) setError(t('games.casinoHoldem.error.tableUnreachable'));
    } finally {
      if (life.isMounted()) setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, finishSettle, life]);

  const doFold = useCallback(async () => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    const epoch = handEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const resp = await gameSocket.foldCasinoHoldem();
      if (!life.isMounted() || epoch !== handEpoch.current) return;
      if (resp?.ok) finishSettle(resp, true);
      else handleErrorAck(resp?.error ?? 'error');
    } catch {
      if (life.isMounted() && epoch === handEpoch.current) setError(t('games.casinoHoldem.error.tableUnreachable'));
    } finally {
      if (life.isMounted()) setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, finishSettle, life]);

  const playAgain = () => {
    setPhase('bet');
    setPlayerHole([]);
    setDealerHole([]);
    setCommunity([]);
    setRevealedCommunity(0);
    setDealerRevealed(false);
    setSettleStatus(null);
    setNet(0); setAnteBonus(0);
    setPlayerRank(''); setDealerRank('');
    setDecisionBalance(null);
    setFocusBet(dealUsable ? 'deal' : 'back');
  };

  const [backNote, setBackNote] = useState<string | null>(null);
  const { requestBack } = useGameBack({
    // A dealt hand awaiting a decision, a reveal in progress, or an ack in
    // flight all hold a committed ante: Back stays on the table.
    isBusy: () => busy || inFlight.current || phase === 'decision' || phase === 'reveal',
    onBlocked: () => {
      setBackNote(t('games.shared.finishRoundFirst'));
      life.timeout(() => setBackNote(null), 2600);
    },
    onExit: onBack,
  });

  /**
   * D-pad focus movement only. Only AFFORDABLE options are ever navigable, and
   * every arrow is consumed while the table is on screen so the native WebView
   * cannot spatially navigate away from the single data-tv-focused marker.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isGlobalModalOpen()) return;
      const dir = visualArrowDir(e);
      if (!dir) return;
      e.preventDefault();
      const topRow = (current: string, set: (v: never) => void): boolean => {
        if (current === 'back' && dir === 'right') { set('fx' as never); return true; }
        if (current === 'fx' && dir === 'left') { set('back' as never); return true; }
        return false;
      };
      if (phase === 'bet') {
        if (topRow(focusBet, setFocusBet as (v: never) => void)) return;
        const chipIdx = focusBet.startsWith('chip-') ? Number(focusBet.split('-')[1]) : -1;
        const pos = usableChips.indexOf(chipIdx);
        const firstChip = (): void => {
          if (usableChips.length) setFocusBet(`chip-${usableChips[0]}`);
          else setFocusBet('back');
        };
        if (dir === 'left') {
          if (pos > 0) setFocusBet(`chip-${usableChips[pos - 1]}`);
          else if (focusBet === 'deal' && usableChips.length) setFocusBet(`chip-${usableChips[usableChips.length - 1]}`);
        } else if (dir === 'right') {
          if (pos >= 0 && pos < usableChips.length - 1) setFocusBet(`chip-${usableChips[pos + 1]}`);
          else if (pos === usableChips.length - 1 && dealUsable) setFocusBet('deal');
        } else if (dir === 'up') {
          if (focusBet !== 'back' && focusBet !== 'fx') setFocusBet('back');
        } else if (focusBet === 'back' || focusBet === 'fx') {
          firstChip();
        }
      } else if (phase === 'decision') {
        if (topRow(focusDecision, setFocusDecision as (v: never) => void)) return;
        const firstDecision = (): FocusDecision =>
          (affordableOptions.length ? (`opt-${affordableOptions[0]}` as FocusDecision) : 'fold');
        const order: FocusDecision[] = [
          ...affordableOptions.map((i) => `opt-${i}` as FocusDecision),
          'fold',
        ];
        const idx = order.indexOf(focusDecision);
        if (dir === 'left' && idx > 0) setFocusDecision(order[idx - 1]);
        else if (dir === 'right' && idx >= 0 && idx < order.length - 1) setFocusDecision(order[idx + 1]);
        else if (dir === 'up') setFocusDecision('back');
        else if (dir === 'down' && (focusDecision === 'back' || focusDecision === 'fx')) {
          setFocusDecision(firstDecision());
        }
      } else if (phase === 'reveal') {
        // Nothing is actionable while the board runs out: keep a REAL managed
        // target (Back / Reduced FX) instead of an empty marker.
        if (dir === 'right') setFocusSettle('fx');
        else if (dir === 'left') setFocusSettle('back');
        else if (focusSettle !== 'back' && focusSettle !== 'fx') setFocusSettle('back');
      } else if (phase === 'settled') {
        if (topRow(focusSettle, setFocusSettle as (v: never) => void)) return;
        if (dir === 'up') setFocusSettle('back');
        else if (dir === 'down' && (focusSettle === 'back' || focusSettle === 'fx')) setFocusSettle('again');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, focusBet, focusDecision, focusSettle, dealUsable, affordableOptions.join(','), usableChips.join(',')]);

  const banner = (() => {
    if (phase !== 'settled' || !settleStatus) return null;
    const tone: 'win' | 'lose' | 'push' = net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
    const text =
      settleStatus === 'win' ? t('games.casinoHoldem.banner.youWin') :
      settleStatus === 'lose' ? t('games.casinoHoldem.banner.dealerWins') :
      settleStatus === 'push' ? t('games.casinoHoldem.banner.push') :
      settleStatus === 'dealer_no_qualify' ? t('games.casinoHoldem.banner.dealerNoQualify') :
      settleStatus === 'folded' ? t('games.casinoHoldem.banner.folded') :
      settleStatus.toUpperCase();
    return (
      <ResultBanner tone={tone} title={text}>
        {anteBonus > 0 && <div>{t('games.casinoHoldem.result.anteBonus', { amount: anteBonus.toLocaleString() })}</div>}
        <div>
          {net > 0 ? t('games.casinoHoldem.result.netWin', { amount: net.toLocaleString() })
            : net < 0 ? t('games.casinoHoldem.result.netLose', { amount: net.toLocaleString() })
            : t('games.casinoHoldem.result.netZero')}
        </div>
      </ResultBanner>
    );
  })();

  const backFocused =
    (phase === 'bet' && visibleFocusBet === 'back') ||
    (phase === 'decision' && focusDecision === 'back') ||
    (phase === 'reveal' && focusSettle === 'back') ||
    (phase === 'settled' && focusSettle === 'back');
  const fxFocused =
    (phase === 'bet' && visibleFocusBet === 'fx') ||
    (phase === 'decision' && focusDecision === 'fx') ||
    (phase === 'reveal' && focusSettle === 'fx') ||
    (phase === 'settled' && focusSettle === 'fx');

  return (
    <GameShell accent="teal" className="snow-holdem">
      <GameTopBar
        ref={backRef}
        onBack={requestBack}
        backLabel={t('games.casinoHoldem.back')}
        balance={balance}
        status={status}
        title={t('games.casinoHoldem.title')}
        phase={t('games.casinoHoldem.subheading')}
        backFocused={backFocused}
        onBackFocus={() => {
          if (phase === 'bet') setFocusBet('back');
          else if (phase === 'decision') setFocusDecision('back');
          else setFocusSettle('back');
        }}
        reducedFx={reducedFx}
        onToggleFx={toggleReducedFx}
        fxRef={fxRef}
        fxFocused={fxFocused}
        onFxFocus={() => {
          if (phase === 'bet') setFocusBet('fx');
          else if (phase === 'decision') setFocusDecision('fx');
          else setFocusSettle('fx');
        }}
      />

      <div className="snow-holdem-stage">
        <div className="snow-holdem-table" data-phase={phase}>
          <div className="snow-holdem-table__rail" aria-hidden="true">
            <i /><i /><i /><i /><i /><i /><i />
          </div>
          <div className="snow-holdem-table__felt">
            <svg className="snow-holdem-crest" viewBox="0 0 180 120" aria-hidden="true" focusable="false">
              <path d="M90 16C72 39 49 55 49 76c0 13 10 23 23 23 7 0 13-3 18-8 5 5 11 8 18 8 13 0 23-10 23-23 0-21-23-37-41-60Z" />
              <path d="M90 87c-1 12-7 19-18 24h36c-11-5-17-12-18-24Z" />
              <path d="M27 61c16-18 33-29 48-34M153 61c-16-18-33-29-48-34" />
            </svg>

            <div className="snow-holdem-dealer-button" aria-hidden="true">D</div>
            <div className="snow-holdem-ante-marker" aria-hidden="true">
              <span className="snow-holdem-mini-chips"><i /><i /><i /></span>
              <span><small>ANTE</small><strong>{ante.toLocaleString()}</strong></span>
            </div>

            <section className="snow-holdem-zone snow-holdem-zone--dealer" aria-label={t('games.casinoHoldem.label.dealer')}>
              <div className="snow-holdem-zone__tag">
                <span className="snow-holdem-zone__pip" aria-hidden="true">◆</span>
                {t('games.casinoHoldem.label.dealer')}
              </div>
              <div className="snow-ch-row snow-holdem-hand">
                {[0, 1].map((i) => (dealerHole[i]
                  ? <PlayingCard key={`d-${i}`} card={dealerHole[i]} faceDown={!dealerRevealed} delay={i * 80} compact />
                  : <PlayingCardSlot key={`d-${i}`} compact />))}
              </div>
              {phase === 'settled' && dealerRank && (
                <span className="snow-holdem-rank">{labelRank(dealerRank)}</span>
              )}
            </section>

            <section className="snow-holdem-runway" aria-label={t('games.casinoHoldem.label.community')}>
              <div className="snow-holdem-runway__heading">
                <span>{t('games.casinoHoldem.label.community')}</span>
                <span className="snow-holdem-runway__line" aria-hidden="true" />
                <span className="snow-holdem-pot" aria-hidden="true">
                  <span className="snow-holdem-pot__chip">$</span>
                  <b>POT</b>
                </span>
              </div>
              <div className="snow-ch-row snow-holdem-board">
                {[0, 1, 2, 3, 4].map((i) => (community[i] && i < revealedCommunity
                  ? <PlayingCard key={`c-${i}`} card={community[i]} delay={Math.max(0, i - 2) * 80} />
                  : <PlayingCardSlot key={`c-${i}`} />))}
              </div>
            </section>

            <section className="snow-holdem-zone snow-holdem-zone--player" aria-label={t('games.casinoHoldem.label.you')}>
              <div className="snow-holdem-zone__tag">
                <span className="snow-holdem-zone__pip" aria-hidden="true">♠</span>
                {t('games.casinoHoldem.label.you')}
              </div>
              <div className="snow-ch-row snow-holdem-hand">
                {[0, 1].map((i) => (playerHole[i]
                  ? <PlayingCard key={`p-${i}`} card={playerHole[i]} delay={i * 80} compact />
                  : <PlayingCardSlot key={`p-${i}`} compact />))}
              </div>
              {phase === 'settled' && playerRank && (
                <span className="snow-holdem-rank">{labelRank(playerRank)}</span>
              )}
            </section>

            {phase === 'settled' && (playerRank || dealerRank) && (
              <div className="snow-holdem-showdown">
                {playerRank && <span>{t('games.casinoHoldem.result.youLabel')} <em>{labelRank(playerRank)}</em></span>}
                {playerRank && dealerRank && <b>{t('games.casinoHoldem.result.versus')}</b>}
                {dealerRank && (
                  <span>
                    {t('games.casinoHoldem.result.dealerLabel')} <em>{labelRank(dealerRank)}</em>
                    {!dealerQualified && ` · ${t('games.casinoHoldem.dealerDidntQualify')}`}
                  </span>
                )}
              </div>
            )}
            {banner && <div className="snow-holdem-result">{banner}</div>}
          </div>
        </div>
      </div>

      <GamePanel className={`snow-holdem-dock snow-holdem-dock--${phase}`}>
        <div className="snow-holdem-dock__prompt">
          <span className="snow-holdem-dock__signal" aria-hidden="true">♠</span>
          <span>
            <small>{t('games.casinoHoldem.title')}</small>
            <strong>
              {phase === 'bet' && t('games.casinoHoldem.chooseAnte')}
              {phase === 'decision' && t('games.casinoHoldem.chooseMove')}
              {phase === 'reveal' && t('games.casinoHoldem.revealing')}
              {phase === 'settled' && t('games.casinoHoldem.newHand')}
            </strong>
          </span>
          {(error || backNote) && <p role="status">{error || backNote}</p>}
        </div>

        <div className="snow-holdem-dock__controls">
        {phase === 'bet' && (
          <div className="snow-bet-row snow-holdem-bet-row">
            <div className="snow-holdem-chip-rack">
              {ANTES.map((amt, idx) => (
                <BetChip
                  key={amt}
                  ref={(el) => { chipRefs.current[idx] = el; }}
                  selected={ante === amt}
                  focused={visibleFocusBet === `chip-${idx}` && usableChips.includes(idx)}
                  onFocus={() => {
                    if (usableChips.includes(idx)) setFocusBet(`chip-${idx}`);
                    else backRef.current?.focus({ preventScroll: true });
                  }}
                  onClick={() => { if (usableChips.includes(idx)) setAnte(amt); }}
                  aria-disabled={usableChips.includes(idx) ? undefined : 'true'}
                  className="snow-holdem-chip"
                >
                  <span>{amt}</span>
                </BetChip>
              ))}
            </div>
            <Button
              ref={dealRef}
              type="button"
              onFocus={() => {
                if (dealUsable) setFocusBet('deal');
                else backRef.current?.focus({ preventScroll: true });
              }}
              onClick={() => { if (!busy && dealUsable) deal(); }}
              aria-disabled={busy || !dealUsable ? 'true' : undefined}
              data-busy={busy ? 'true' : undefined}
              data-tv-focused={visibleFocusBet === 'deal' && dealUsable ? 'true' : 'false'}
              className={`${GAME_ACTION_CLASS} snow-holdem-action snow-holdem-action--primary`}
            >
              <span className="snow-holdem-action__icon">
                {busy ? <Loader2 className="animate-spin" /> : <HoldemActionIcon name="deal" />}
              </span>
              <span>{balance === null
                ? t('games.casinoHoldem.loadingChips')
                : t('games.casinoHoldem.dealButton', { ante })}</span>
            </Button>
          </div>
        )}

        {phase === 'decision' && (
          <div className="snow-game-actions">
            {raiseOptions.map((opt, i) => {
              const canAfford = affordable(opt.cost);
              const isCall = opt.multiplier === 2;
              return (
                <Button
                  key={`${opt.multiplier}-${opt.cost}`}
                  ref={(el) => { optionRefs.current[i] = el; }}
                  type="button"
                  variant={isCall ? 'default' : 'navy'}
                  onFocus={() => setFocusDecision(`opt-${i}`)}
                  onClick={() => { if (canAfford && !busy) doCall(opt.multiplier); }}
                  aria-disabled={!canAfford || busy ? 'true' : undefined}
                  data-busy={busy ? 'true' : undefined}
                  data-tv-focused={focusDecision === `opt-${i}` ? 'true' : 'false'}
                  className={`${GAME_ACTION_CLASS} snow-holdem-action ${isCall ? 'snow-holdem-action--primary' : ''}`}
                >
                  <span className="snow-holdem-action__icon"><HoldemActionIcon name={isCall ? 'call' : 'raise'} /></span>
                  <span>{isCall
                    ? t('games.casinoHoldem.callOption', { multiplier: opt.multiplier, cost: opt.cost })
                    : t('games.casinoHoldem.raiseOption', { multiplier: opt.multiplier, cost: opt.cost })}</span>
                </Button>
              );
            })}
            <Button
              ref={foldRef}
              type="button"
              variant="destructive"
              onFocus={() => setFocusDecision('fold')}
              onClick={() => { if (!busy) doFold(); }}
              aria-disabled={busy ? 'true' : undefined}
              data-busy={busy ? 'true' : undefined}
              data-tv-focused={focusDecision === 'fold' ? 'true' : 'false'}
              className="snow-game-action tv-ring min-h-12 border-2 font-black snow-holdem-action snow-holdem-action--fold"
            >
              <span className="snow-holdem-action__icon"><HoldemActionIcon name="fold" /></span>
              <span>{t('games.casinoHoldem.fold')}</span>
            </Button>
          </div>
        )}

        {phase === 'reveal' && (
          <div className="snow-holdem-reveal" role="status">
            <span aria-hidden="true"><i /><i /><i /></span>
            {t('games.casinoHoldem.revealing')}
          </div>
        )}

        {phase === 'settled' && (
          <div className="snow-game-actions">
            <Button
              ref={againRef}
              type="button"
              onFocus={() => setFocusSettle('again')}
              onClick={playAgain}
              data-tv-focused={focusSettle === 'again' ? 'true' : 'false'}
              className={`${GAME_ACTION_CLASS} snow-holdem-action snow-holdem-action--primary snow-holdem-action--again`}
            >
              <span className="snow-holdem-action__icon"><HoldemActionIcon name="again" /></span>
              <span>{t('games.casinoHoldem.newHand')}</span>
            </Button>
          </div>
        )}
        </div>

        <div className="snow-holdem-dock__ante" aria-hidden="true">
          <small>ANTE</small>
          <strong>{ante.toLocaleString()}</strong>
        </div>
      </GamePanel>
    </GameShell>
  );
};

export default CasinoHoldem;
