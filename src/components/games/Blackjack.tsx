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
import { arrowDir, isGlobalModalOpen, isTerminalRoundError } from './shared/gameInput';
import { moveInRows, rehome, type FocusRows } from './shared/focusRows';
import type { GameCardValue, GameFairInfo } from './shared/gameTypes';

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

  const [focus, setFocus] = useState<FocusId>('deal');

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
      const chips = BETS
        .map((amount, i) => ((balance ?? 0) >= amount ? `chip-${i}` : null))
        .filter((id): id is string => id !== null);
      const dealUsable = !!user && (balance ?? 0) >= bet;
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
  }, [phase, balance, bet, user, canHit, canStand, canDouble, revealComplete, fair, serverSeedHash]);

  // A phase or capability change must always leave managed focus on something
  // usable rather than stranding the remote on a disabled control.
  useEffect(() => {
    setFocus((current) => (rehome(focusRows, current) as FocusId) ?? 'back');
  }, [focusRows]);

  useEffect(() => {
    const target = focus === 'back' ? backRef.current
      : focus === 'fx' ? fxRef.current
        : focus === 'deal' ? dealRef.current
          : focus === 'hit' ? hitRef.current
            : focus === 'stand' ? standRef.current
              : focus === 'double' ? doubleRef.current
                : focus === 'again' ? againRef.current
                  : focus === 'fair' ? fairRef.current
                    : chipRefs.current[Number(focus.split('-')[1])];
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [focus, phase]);

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
    setFocus('deal');
  }, []);

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
    setFocus('deal');
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
      const dir = arrowDir(e);
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
    <GameShell accent="emerald">
      <GameTopBar
        ref={backRef}
        onBack={requestBack}
        backLabel={t('games.blackjack.back')}
        balance={balance}
        status={status}
        title={t('games.blackjack.title')}
        phase={t('games.blackjack.subheading')}
        backFocused={focus === 'back'}
        onBackFocus={() => setFocus('back')}
        reducedFx={reducedFx}
        onToggleFx={toggleReducedFx}
        fxRef={fxRef}
        fxFocused={focus === 'fx'}
        onFxFocus={() => setFocus('fx')}
      />

      <div className="snow-bj-table">
        <div className="snow-bj-rail">
          <span className="snow-bj-shoe" aria-hidden="true" />
          <div className="snow-bj-seat">
            <span className="snow-bj-seat__label">{t('games.blackjack.dealer')}</span>
            {phase === 'bet'
              ? <p className="snow-bj-hint">{t('games.blackjack.placeBetPrompt')}</p>
              : <>
                  <Hand cards={dealerCards} faceDownAfter={dealerFaceDownAfter} />
                  <span className={`snow-bj-total${shownDealerTotal > 21 ? ' is-bust' : ''}`}>{shownDealerTotal}</span>
                </>}
          </div>
          <span className="snow-bj-shoe" style={{ visibility: 'hidden' }} aria-hidden="true" />
        </div>

        <div className="snow-bj-seat">
          <span className="snow-bj-seat__label">{t('games.blackjack.you')}</span>
          {phase === 'bet'
            ? <p className="snow-bj-hint">{t('games.blackjack.cardsAppearHere')}</p>
            : <>
                <Hand cards={playerHand} highlight={phase === 'settled' && settleStatus === 'blackjack'} />
                <span className={`snow-bj-total${playerTotal > 21 ? ' is-bust' : ''}`}>{playerTotal}</span>
              </>}
        </div>

        {banner && <div className="snow-bj-seat">{banner}</div>}
      </div>

      <GamePanel className="p-3">
        {phase === 'bet' && (
          <div className="snow-bet-row">
            {BETS.map((amount, i) => (
              <BetChip
                key={amount}
                ref={(el) => { chipRefs.current[i] = el; }}
                selected={bet === amount}
                focused={focus === `chip-${i}`}
                onFocus={() => setFocus(`chip-${i}`)}
                onClick={() => { if ((balance ?? 0) >= amount) setBet(amount); }}
                aria-disabled={(balance ?? 0) < amount ? 'true' : undefined}
              >
                {amount}
              </BetChip>
            ))}
            <Button
              ref={dealRef}
              type="button"
              onFocus={() => setFocus('deal')}
              onClick={() => { if (!(busy || !user || (balance ?? 0) < bet)) deal(); }}
              aria-disabled={busy || !user || (balance ?? 0) < bet ? 'true' : undefined}
              data-busy={busy ? 'true' : undefined}
              data-tv-focused={focus === 'deal' ? 'true' : 'false'}
              className={`${GAME_ACTION_CLASS} ml-3 px-8`}
            >
              {busy ? <><Loader2 className="animate-spin" /> {t('games.blackjack.dealing')}</> : t('games.blackjack.dealWithBet', { bet })}
            </Button>
          </div>
        )}

        {phase === 'playing' && (
          <div className="snow-game-actions">
            <Button
              ref={hitRef}
              type="button"
              onFocus={() => setFocus('hit')}
              onClick={() => { if (canHit && !busy) action('hit'); }}
              aria-disabled={!canHit || busy ? 'true' : undefined}
              data-busy={busy ? 'true' : undefined}
              data-tv-focused={focus === 'hit' ? 'true' : 'false'}
              className={`${GAME_ACTION_CLASS} px-8`}
            >
              {t('games.blackjack.hit')}
            </Button>
            <Button
              ref={standRef}
              type="button"
              variant="navy"
              onFocus={() => setFocus('stand')}
              onClick={() => { if (canStand && !busy) action('stand'); }}
              aria-disabled={!canStand || busy ? 'true' : undefined}
              data-busy={busy ? 'true' : undefined}
              data-tv-focused={focus === 'stand' ? 'true' : 'false'}
              className={`${GAME_ACTION_CLASS} px-8`}
            >
              {t('games.blackjack.stand')}
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
                data-tv-focused={focus === 'double' ? 'true' : 'false'}
                className={`${GAME_ACTION_CLASS} px-8`}
              >
                {t('games.blackjack.double')}
              </Button>
            )}
            {busy && <span className="snow-game-note ml-3"><Loader2 className="inline h-4 w-4 animate-spin" /> {t('games.blackjack.working')}</span>}
          </div>
        )}

        {phase === 'settled' && (
          <div className="snow-game-actions">
            <Button
              ref={againRef}
              type="button"
              onFocus={() => setFocus('again')}
              onClick={() => { if (revealComplete) playAgain(); }}
              aria-disabled={revealComplete ? undefined : 'true'}
              data-tv-focused={focus === 'again' ? 'true' : 'false'}
              className={`${GAME_ACTION_CLASS} px-10`}
            >
              {t('games.blackjack.playAgain')}
            </Button>
          </div>
        )}

        {error && <p className="snow-game-error">{error}</p>}
        {backNote && <p className="snow-game-note" role="status">{backNote}</p>}
        {phase === 'bet' && !error && <p className="snow-game-note">{t('games.blackjack.freshSeedNote')}</p>}
      </GamePanel>

      <FairnessPanel
        ref={fairRef}
        fair={fair}
        hash={serverSeedHash}
        open={showFair}
        onToggle={() => setShowFair((s) => !s)}
        focused={focus === 'fair'}
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
