import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { BetChip, GAME_ACTION_CLASS, GamePanel, GameShell, GameTopBar, ResultBanner } from './shared/GameUI';
import { PlayingCard, PlayingCardSlot } from './shared/PlayingCard';
import { GameFxCanvas } from './shared/GameFxCanvas';
import { useGameLifecycle } from './shared/gameLifecycle';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { useGameBack } from './shared/gameBack';
import { isGlobalModalOpen, isTerminalRoundError, visualArrowDir } from './shared/gameInput';
import { useGameAudio } from './shared/gameAudio';
import type { GameCardValue } from './shared/gameTypes';
import { TV_BETS, readSavedBet, saveSelectedBet } from './shared/gameBets';
import '@/styles/games-machines.css';

interface VideoPokerProps {
  onBack: () => void;
}

const BETS = [...TV_BETS];
const BET_STORAGE_KEY = 'snow-video-poker-bet-v1';

const DEFAULT_PAYOUTS: Record<string, number> = {
  'Royal Flush': 800,
  'Straight Flush': 50,
  'Four of a Kind': 25,
  'Full House': 9,
  'Flush': 6,
  'Straight': 4,
  'Three of a Kind': 3,
  'Two Pair': 2,
  'Jacks or Better': 1,
};
const PAY_ORDER = Object.keys(DEFAULT_PAYOUTS);

const HAND_KEY: Record<string, string> = {
  'Royal Flush': 'games.videoPoker.hand.royalFlush',
  'Straight Flush': 'games.videoPoker.hand.straightFlush',
  'Four of a Kind': 'games.videoPoker.hand.fourOfAKind',
  'Full House': 'games.videoPoker.hand.fullHouse',
  'Flush': 'games.videoPoker.hand.flush',
  'Straight': 'games.videoPoker.hand.straight',
  'Three of a Kind': 'games.videoPoker.hand.threeOfAKind',
  'Two Pair': 'games.videoPoker.hand.twoPair',
  'Jacks or Better': 'games.videoPoker.hand.jacksOrBetter',
};

type Phase = 'idle' | 'dealt' | 'settled';
type FocusZone = 'back' | 'fx' | 'bet' | 'card' | 'primary';

const VideoPoker = ({ onBack }: VideoPokerProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { balance, status } = useGameSocket();
  const life = useGameLifecycle();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  const { play } = useGameAudio();
  useTvActivate(activateFocused);

  const [phase, setPhase] = useState<Phase>('idle');
  const [bet, setBet] = useState<number>(() => readSavedBet(BET_STORAGE_KEY));
  useEffect(() => saveSelectedBet(BET_STORAGE_KEY, bet), [bet]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const [hand, setHand] = useState<GameCardValue[]>([]);
  const [holds, setHolds] = useState<boolean[]>([false, false, false, false, false]);
  const [payouts, setPayouts] = useState<Record<string, number>>(DEFAULT_PAYOUTS);
  const [resultRank, setResultRank] = useState<string | null>(null);
  const [resultPayout, setResultPayout] = useState(0);
  const [resultNet, setResultNet] = useState(0);
  const [resultWin, setResultWin] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const [zone, setZone] = useState<FocusZone>('primary');
  const [cardIdx, setCardIdx] = useState(0);
  const [betIdx, setBetIdx] = useState(0);

  const backRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const betRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const payoutRef = useRef<HTMLDivElement>(null);
  /** Bumped per deal so a late ack cannot mutate a newer hand. */
  const roundEpoch = useRef(0);

  useEffect(() => {
    if (zone === 'back') backRef.current?.focus();
    else if (zone === 'fx') fxRef.current?.focus();
    else if (zone === 'primary') primaryRef.current?.focus();
    else if (zone === 'bet') betRefs.current[betIdx]?.focus();
    else if (zone === 'card') cardRefs.current[cardIdx]?.focus();
  }, [zone, cardIdx, betIdx]);

  const handleErr = (err: string) => {
    if (err === 'insufficient_balance') setError(t('games.videoPoker.error.insufficientBalance'));
    else if (err === 'invalid_bet') setError(t('games.videoPoker.error.invalidBet'));
    else if (err === 'game_disabled') setError(t('games.videoPoker.error.gameDisabled'));
    else if (err === 'round_in_progress') setError(t('games.videoPoker.error.roundInProgress'));
    else if (err === 'no_active_round') setError(t('games.videoPoker.error.noActiveRound'));
    else setError(t('games.videoPoker.error.generic'));
    // A CONFIRMED dead round would otherwise leave the machine in `dealt` with
    // the Back guard refusing to let the player leave. Reconcile to a safe,
    // fully usable betting state. Transport failures are never treated this way.
    if (isTerminalRoundError(err)) {
      setPhase('idle');
      setHolds([false, false, false, false, false]);
      setCelebrate(false);
      setZone('primary');
    }
    life.timeout(() => setError(null), 3500);
  };

  const doDeal = useCallback(async () => {
    if (inFlight.current || busy) return;
    if (!user) { setError(t('games.videoPoker.error.signIn')); return; }
    if (balance === null) { setError(t('games.videoPoker.error.loadingChips')); return; }
    if (balance < bet) { setError(t('games.videoPoker.error.insufficientBalance')); return; }
    inFlight.current = true;
    const epoch = roundEpoch.current + 1;
    roundEpoch.current = epoch;
    setBusy(true);
    setError(null);
    setResultRank(null);
    setResultPayout(0);
    setResultNet(0);
    setResultWin(false);
    setHolds([false, false, false, false, false]);
    try {
      const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.dealVideoPoker(bet, seed);
      if (!life.isMounted() || epoch !== roundEpoch.current) return;
      if (resp?.ok && Array.isArray(resp.hand)) {
        play('card');
        setHand(resp.hand);
        setPhase('dealt');
        setZone('card');
        setCardIdx(0);
      } else {
        handleErr(resp?.error ?? 'error');
      }
    } catch {
      if (!life.isMounted() || epoch !== roundEpoch.current) return;
      setError(t('games.videoPoker.error.dealFailed'));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, user, balance, bet, life, play]);

  const doDraw = useCallback(async () => {
    if (inFlight.current || busy || phase !== 'dealt') return;
    inFlight.current = true;
    const epoch = roundEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const resp = await gameSocket.drawVideoPoker(holds);
      if (!life.isMounted() || epoch !== roundEpoch.current) return;
      if (resp?.ok && Array.isArray(resp.hand)) {
        play('card');
        if (resp.win && resp.rank === 'Royal Flush') play('bonus');
        else play(resp.win ? 'win' : 'lose');
        setHand(resp.hand);
        if (resp.payouts && typeof resp.payouts === 'object') setPayouts({ ...DEFAULT_PAYOUTS, ...resp.payouts });
        setResultRank(resp.rank ?? null);
        setResultPayout(resp.payout ?? 0);
        setResultNet(typeof resp.net === 'number' ? resp.net : 0);
        setResultWin(!!resp.win);
        setPhase('settled');
        if (resp.win && resp.payout > 0) {
          setCelebrate(true);
          // Count-up written straight to the DOM: no state update per frame.
          const target = resp.payout as number;
          const dur = reducedFx ? 550 : 1100;
          let start = 0;
          const tick = (now: number) => {
            if (!start) start = now;
            const p = Math.min(1, (now - start) / dur);
            const value = Math.round(target * (1 - Math.pow(1 - p, 3)));
            if (payoutRef.current) {
              payoutRef.current.textContent = t('games.videoPoker.payoutChips', { amount: value.toLocaleString() });
            }
            if (p < 1 && !life.isHidden()) {
              life.raf(tick);
            } else {
              // If Android backgrounds the WebView during the count-up, land
              // on the authoritative payout before retiring the animation.
              if (payoutRef.current) {
                payoutRef.current.textContent = t('games.videoPoker.payoutChips', { amount: target.toLocaleString() });
              }
              life.timeout(() => setCelebrate(false), reducedFx ? 600 : 1200);
            }
          };
          life.raf(tick);
        }
        setZone('primary');
      } else {
        handleErr(resp?.error ?? 'error');
      }
    } catch {
      if (!life.isMounted() || epoch !== roundEpoch.current) return;
      setError(t('games.videoPoker.error.drawFailed'));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, phase, holds, reducedFx, life, play]);

  const primaryAction = useCallback(() => {
    if (phase === 'dealt') doDraw();
    else doDeal();
  }, [phase, doDeal, doDraw]);

  const toggleHold = useCallback((idx: number) => {
    if (phase !== 'dealt') return;
    setHolds((h) => { const next = [...h]; next[idx] = !next[idx]; return next; });
  }, [phase]);

  const betsLocked = phase === 'dealt' || busy;
  /** Chip indexes the remote may land on: locked or unaffordable chips are skipped. */
  const usableBets = BETS
    .map((amount, i) => (betsLocked || (balance ?? 0) < amount ? -1 : i))
    .filter((i) => i >= 0);

  // Re-home a bet chip that just became unaffordable or locked.
  useEffect(() => {
    if (zone !== 'bet') return;
    if (!usableBets.includes(betIdx)) {
      if (usableBets.length) setBetIdx(usableBets[0]);
      else setZone('primary');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, betIdx, usableBets.join(',')]);

  const [backNote, setBackNote] = useState<string | null>(null);
  const { requestBack } = useGameBack({
    // A dealt hand holds a committed bet; a running payout count-up is a settle
    // animation. Neither may be abandoned by a single Back press.
    isBusy: () => busy || inFlight.current || phase === 'dealt' || celebrate,
    onBlocked: () => {
      setBackNote(t('games.shared.finishRoundFirst'));
      life.timeout(() => setBackNote(null), 2600);
    },
    onExit: onBack,
  });

  /**
   * The primary button belongs to the graph only while it can actually do
   * something (a dealt hand can always draw; a fresh deal needs a signed-in
   * player with enough chips). `busy` is deliberately ignored so a pending
   * transaction keeps its focus instead of the marker jumping away.
   */
  const primaryUsable = !!user && (phase === 'dealt' || (balance ?? 0) >= bet);

  /**
   * D-pad focus movement only. Every arrow is consumed while the machine is on
   * screen so the native WebView cannot spatially navigate away from the single
   * data-tv-focused marker, and no zone can trap the player away from Back/FX.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isGlobalModalOpen()) return;
      const dir = visualArrowDir(e);
      if (!dir) return;
      e.preventDefault();
      const gotoBets = () => {
        if (usableBets.length) { setZone('bet'); setBetIdx(usableBets[0]); }
        else if (primaryUsable) setZone('primary');
        else setZone('back');
      };
      const belowBets = () => {
        if (phase === 'dealt') { setZone('card'); setCardIdx(0); }
        else if (primaryUsable) setZone('primary');
        else setZone('back');
      };
      if (zone === 'back') {
        if (dir === 'right') setZone('fx');
        else if (dir === 'down') gotoBets();
      } else if (zone === 'fx') {
        if (dir === 'left') setZone('back');
        else if (dir === 'down') gotoBets();
      } else if (zone === 'bet') {
        const pos = usableBets.indexOf(betIdx);
        if (dir === 'left') { if (pos > 0) setBetIdx(usableBets[pos - 1]); else setZone('back'); }
        else if (dir === 'right') {
          if (pos >= 0 && pos < usableBets.length - 1) setBetIdx(usableBets[pos + 1]);
          else if (primaryUsable) setZone('primary');
        }
        else if (dir === 'down') belowBets();
        else setZone('back');
      } else if (zone === 'card') {
        if (dir === 'left') { if (cardIdx > 0) setCardIdx(cardIdx - 1); else setZone('back'); }
        else if (dir === 'right') { if (cardIdx < 4) setCardIdx(cardIdx + 1); }
        else if (dir === 'down') { if (primaryUsable) setZone('primary'); else setZone('back'); }
        else gotoBets();
      } else if (zone === 'primary') {
        if (dir === 'up') { if (phase === 'dealt') { setZone('card'); setCardIdx(0); } else gotoBets(); }
        else setZone('back');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, cardIdx, betIdx, phase, primaryUsable, usableBets.join(',')]);

  const orderedPayouts = useMemo(
    () => PAY_ORDER.filter((k) => k in payouts).map((k) => ({ name: k, mult: payouts[k] })),
    [payouts],
  );

  return (
    <GameShell accent="sapphire" className="snow-machine-game snow-video-poker-game">
      <GameTopBar
        ref={backRef}
        onBack={requestBack}
        backLabel={t('games.videoPoker.back')}
        balance={balance}
        status={status}
        title={t('games.videoPoker.gameTag')}
        phase={t('games.videoPoker.title')}
        backFocused={zone === 'back'}
        onBackFocus={() => setZone('back')}
        reducedFx={reducedFx}
        onToggleFx={toggleReducedFx}
        fxRef={fxRef}
        fxFocused={zone === 'fx'}
        onFxFocus={() => setZone('fx')}
      />

      <div className="snow-machine-stage snow-vp-stage">
        <section className="snow-vp-console" aria-label={t('games.videoPoker.title')}>
          <div className="snow-vp-marquee">
            <span className="snow-vp-marquee__suits snow-vp-marquee__suits--red" aria-hidden="true">♥</span>
            <div>
              <small>{t('games.videoPoker.gameTag')}</small>
              <strong>{t('games.videoPoker.title')}</strong>
            </div>
            <span className="snow-vp-marquee__suits" aria-hidden="true">♠</span>
          </div>

          <div className="snow-vp-paytable" aria-label={t('games.videoPoker.paytable')}>
            {orderedPayouts.map((p, index) => (
              <div key={p.name} className={index === 0 ? 'is-jackpot' : undefined}>
                <span>{HAND_KEY[p.name] ? t(HAND_KEY[p.name]) : p.name}</span>
                <b>{p.mult}×</b>
              </div>
            ))}
          </div>

          <div className="snow-vp-screen">
            <span className="snow-vp-screen__accent" aria-hidden="true">♣</span>
            <span className="snow-vp-screen__accent snow-vp-screen__accent--right" aria-hidden="true">♦</span>
            <div className="snow-vp-hand">
              {[0, 1, 2, 3, 4].map((i) => {
                const card = hand[i];
                return (
                  <button
                    key={i}
                    ref={(el) => { cardRefs.current[i] = el; }}
                    type="button"
                    className="snow-vp-slot"
                    onFocus={() => { setZone('card'); setCardIdx(i); }}
                    onClick={() => toggleHold(i)}
                    aria-disabled={phase !== 'dealt' ? 'true' : undefined}
                    data-tv-focused={zone === 'card' && cardIdx === i ? 'true' : 'false'}
                    aria-label={holds[i]
                      ? t('games.videoPoker.cardAriaLabelHeld', { number: i + 1 })
                      : t('games.videoPoker.cardAriaLabel', { number: i + 1 })}
                  >
                    <span className={`snow-vp-hold${phase === 'dealt' && holds[i] ? '' : ' is-off'}`} aria-hidden={phase !== 'dealt'}>
                      {phase === 'dealt' ? t('games.videoPoker.hold') : `${i + 1}`}
                    </span>
                    {card
                      ? <PlayingCard card={card} delay={i * 80} held={holds[i]} focused={zone === 'card' && cardIdx === i} />
                      : <PlayingCardSlot />}
                  </button>
                );
              })}
            </div>

            <div className="snow-vp-result-slot">
              {phase === 'settled' && resultRank ? (
                <div className="snow-vp-result">
                  <ResultBanner
                    tone={resultWin ? 'win' : 'lose'}
                    title={resultWin ? (HAND_KEY[resultRank] ? t(HAND_KEY[resultRank]) : resultRank) : t('games.videoPoker.noWin')}
                  >
                    {resultWin
                      ? <div ref={payoutRef}>{t('games.videoPoker.payoutChips', { amount: resultPayout.toLocaleString() })}</div>
                      : resultNet !== 0 ? t('games.videoPoker.netChips', { amount: resultNet.toLocaleString() }) : null}
                  </ResultBanner>
                  <GameFxCanvas burstKey={celebrate ? resultPayout : null} reduced={reducedFx} />
                </div>
              ) : (
                <span>{phase === 'dealt' ? t('games.videoPoker.holdHint') : t('games.videoPoker.subtitle')}</span>
              )}
            </div>
          </div>

          <GamePanel className="snow-vp-control-deck">
            <div className="snow-vp-bet-label">
              <small>{t('games.videoPoker.bet')}</small>
              <strong>{bet}</strong>
            </div>
            <div className="snow-bet-row">
              {BETS.map((amount, i) => {
                const unaffordable = (balance ?? 0) < amount && !betsLocked;
                return (
                  <BetChip
                    key={amount}
                    ref={(el) => { betRefs.current[i] = el; }}
                    selected={bet === amount}
                    focused={zone === 'bet' && betIdx === i}
                    onFocus={() => { setZone('bet'); setBetIdx(i); }}
                    onClick={() => { if (!(betsLocked || unaffordable)) setBet(amount); }}
                    aria-disabled={betsLocked || unaffordable ? 'true' : undefined}
                  >
                    {amount}
                  </BetChip>
                );
              })}
            </div>
            <Button
              ref={primaryRef}
              type="button"
              onFocus={() => setZone('primary')}
              onClick={() => { if (!(busy || !user || (phase !== 'dealt' && (balance ?? 0) < bet))) primaryAction(); }}
              aria-disabled={busy || !user || (phase !== 'dealt' && (balance ?? 0) < bet) ? 'true' : undefined}
              data-busy={busy ? 'true' : undefined}
              data-tv-focused={zone === 'primary' ? 'true' : 'false'}
              className={`${GAME_ACTION_CLASS} snow-vp-primary`}
            >
              <span className="snow-vp-primary__icon" aria-hidden="true">♦</span>
              <span>{busy
                ? <><Loader2 className="animate-spin" /> {phase === 'dealt' ? t('games.videoPoker.drawingEllipsis') : t('games.videoPoker.dealingEllipsis')}</>
                : phase === 'dealt' ? t('games.videoPoker.draw') : t('games.videoPoker.dealWithBet', { bet })}</span>
            </Button>
          </GamePanel>

          <div className="snow-vp-message-line">
            {error && <p className="snow-game-error">{error}</p>}
            {backNote && <p className="snow-game-note" role="status">{backNote}</p>}
          </div>
        </section>
      </div>
    </GameShell>
  );
};

export default VideoPoker;
