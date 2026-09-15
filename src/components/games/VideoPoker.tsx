import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { BetChip, FairnessPanel, GAME_ACTION_CLASS, GamePanel, GameShell, GameTopBar, ResultBanner } from './shared/GameUI';
import { PlayingCard, PlayingCardSlot } from './shared/PlayingCard';
import { GameFxCanvas } from './shared/GameFxCanvas';
import { useGameLifecycle } from './shared/gameLifecycle';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { useGameBack } from './shared/gameBack';
import type { GameCardValue, GameFairInfo } from './shared/gameTypes';

interface VideoPokerProps {
  onBack: () => void;
}

const BETS = [10, 25, 50, 100];

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
type FocusZone = 'back' | 'fx' | 'bet' | 'card' | 'primary' | 'fair';

const VideoPoker = ({ onBack }: VideoPokerProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { balance, status } = useGameSocket();
  const life = useGameLifecycle();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  useTvActivate(activateFocused);

  const [phase, setPhase] = useState<Phase>('idle');
  const [bet, setBet] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const [hand, setHand] = useState<GameCardValue[]>([]);
  const [holds, setHolds] = useState<boolean[]>([false, false, false, false, false]);
  const [serverSeedHash, setServerSeedHash] = useState('');
  const [payouts, setPayouts] = useState<Record<string, number>>(DEFAULT_PAYOUTS);
  const [resultRank, setResultRank] = useState<string | null>(null);
  const [resultPayout, setResultPayout] = useState(0);
  const [resultNet, setResultNet] = useState(0);
  const [resultWin, setResultWin] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [fair, setFair] = useState<GameFairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  const [verifyOk, setVerifyOk] = useState<boolean | null>(null);

  const [zone, setZone] = useState<FocusZone>('primary');
  const [cardIdx, setCardIdx] = useState(0);
  const [betIdx, setBetIdx] = useState(0);

  const backRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const fairRef = useRef<HTMLButtonElement>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const betRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const payoutRef = useRef<HTMLDivElement>(null);
  /** Bumped per deal so a late ack cannot mutate a newer hand. */
  const roundEpoch = useRef(0);

  useEffect(() => {
    if (zone === 'back') backRef.current?.focus();
    else if (zone === 'fx') fxRef.current?.focus();
    else if (zone === 'primary') primaryRef.current?.focus();
    else if (zone === 'fair') fairRef.current?.focus();
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
    setFair(null);
    setShowFair(false);
    setVerifyOk(null);
    setHolds([false, false, false, false, false]);
    try {
      const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.dealVideoPoker(bet, seed);
      if (!life.isMounted() || epoch !== roundEpoch.current) return;
      if (resp?.ok && Array.isArray(resp.hand)) {
        setHand(resp.hand);
        if (resp.serverSeedHash) setServerSeedHash(resp.serverSeedHash);
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
  }, [busy, user, balance, bet, life]);

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
        setHand(resp.hand);
        if (resp.payouts && typeof resp.payouts === 'object') setPayouts({ ...DEFAULT_PAYOUTS, ...resp.payouts });
        setResultRank(resp.rank ?? null);
        setResultPayout(resp.payout ?? 0);
        setResultNet(typeof resp.net === 'number' ? resp.net : 0);
        setResultWin(!!resp.win);
        if (resp.fair) setFair(resp.fair);
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
            if (p < 1 && !life.isHidden()) life.raf(tick);
            else life.timeout(() => setCelebrate(false), reducedFx ? 600 : 1200);
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
  }, [busy, phase, holds, reducedFx, life]);

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
    isDetailsOpen: () => showFair,
    closeDetails: () => setShowFair(false),
    // A dealt hand holds a committed bet; a running payout count-up is a settle
    // animation. Neither may be abandoned by a single Back press.
    isBusy: () => busy || inFlight.current || phase === 'dealt' || celebrate,
    onBlocked: () => {
      setBackNote(t('games.shared.finishRoundFirst'));
      life.timeout(() => setBackNote(null), 2600);
    },
    onExit: onBack,
  });

  // D-pad focus movement only.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const k = e.key;
      const firstBet = () => { if (usableBets.length) { setZone('bet'); setBetIdx(usableBets[0]); } else setZone('primary'); };
      if (zone === 'back') {
        if (k === 'ArrowRight') { e.preventDefault(); setZone('fx'); }
        else if (k === 'ArrowDown') { e.preventDefault(); firstBet(); }
      } else if (zone === 'fx') {
        if (k === 'ArrowLeft') { e.preventDefault(); setZone('back'); }
        else if (k === 'ArrowDown') { e.preventDefault(); firstBet(); }
      } else if (zone === 'bet') {
        const pos = usableBets.indexOf(betIdx);
        if (k === 'ArrowLeft') {
          e.preventDefault();
          if (pos > 0) setBetIdx(usableBets[pos - 1]); else setZone('back');
        } else if (k === 'ArrowRight' && pos >= 0 && pos < usableBets.length - 1) { e.preventDefault(); setBetIdx(usableBets[pos + 1]); }
        else if (k === 'ArrowDown') { e.preventDefault(); if (phase === 'dealt') { setZone('card'); setCardIdx(0); } else setZone('primary'); }
        else if (k === 'ArrowUp') { e.preventDefault(); setZone('back'); }
      } else if (zone === 'card') {
        if (k === 'ArrowLeft' && cardIdx > 0) { e.preventDefault(); setCardIdx(cardIdx - 1); }
        else if (k === 'ArrowRight' && cardIdx < 4) { e.preventDefault(); setCardIdx(cardIdx + 1); }
        else if (k === 'ArrowDown') { e.preventDefault(); setZone('primary'); }
        else if (k === 'ArrowUp') { e.preventDefault(); firstBet(); }
      } else if (zone === 'primary') {
        if (k === 'ArrowUp') {
          e.preventDefault();
          if (phase === 'dealt') { setZone('card'); setCardIdx(0); } else firstBet();
        } else if (k === 'ArrowDown' && fair) { e.preventDefault(); setZone('fair'); }
      } else if (zone === 'fair' && k === 'ArrowUp') {
        e.preventDefault(); setZone('primary');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, cardIdx, betIdx, phase, fair, usableBets.join(',')]);

  // Verify SHA-256 when the fairness details are open.
  useEffect(() => {
    if (!showFair || !fair?.serverSeed) return;
    let cancelled = false;
    (async () => {
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fair.serverSeed));
        const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
        if (!cancelled) setVerifyOk(hex.toLowerCase() === (fair.serverSeedHash || '').toLowerCase());
      } catch {
        if (!cancelled) setVerifyOk(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showFair, fair]);

  const orderedPayouts = useMemo(
    () => PAY_ORDER.filter((k) => k in payouts).map((k) => ({ name: k, mult: payouts[k] })),
    [payouts],
  );

  return (
    <GameShell accent="sapphire">
      <GameTopBar
        ref={backRef}
        onBack={requestBack}
        backLabel={t('games.videoPoker.back')}
        balance={balance}
        status={status}
        title={t('games.videoPoker.title')}
        phase={t('games.videoPoker.subtitle')}
        backFocused={zone === 'back'}
        onBackFocus={() => setZone('back')}
        reducedFx={reducedFx}
        onToggleFx={toggleReducedFx}
        fxRef={fxRef}
        fxFocused={zone === 'fx'}
        onFxFocus={() => setZone('fx')}
      />

      <div className="snow-vp-console">
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
                {phase === 'dealt' && (
                  <span className={`snow-vp-hold${holds[i] ? '' : ' is-off'}`}>{t('games.videoPoker.hold')}</span>
                )}
                {card
                  ? <PlayingCard card={card} delay={i * 80} held={holds[i]} focused={zone === 'card' && cardIdx === i} />
                  : <PlayingCardSlot />}
              </button>
            );
          })}
        </div>

        {phase === 'settled' && resultRank && (
          <div className="relative mt-2 flex flex-col items-center">
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
        )}

        <div className="snow-vp-paytable">
          {orderedPayouts.map((p) => (
            <div key={p.name}>
              <span>{HAND_KEY[p.name] ? t(HAND_KEY[p.name]) : p.name}</span>
              <b>{p.mult}x</b>
            </div>
          ))}
        </div>
      </div>

      <GamePanel className="p-3">
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
          <Button
            ref={primaryRef}
            type="button"
            onFocus={() => setZone('primary')}
            onClick={() => { if (!(busy || !user || (phase !== 'dealt' && (balance ?? 0) < bet))) primaryAction(); }}
            aria-disabled={busy || !user || (phase !== 'dealt' && (balance ?? 0) < bet) ? 'true' : undefined}
            data-busy={busy ? 'true' : undefined}
            data-tv-focused={zone === 'primary' ? 'true' : 'false'}
            className={`${GAME_ACTION_CLASS} ml-3 px-10`}
          >
            {busy
              ? <><Loader2 className="animate-spin" /> {phase === 'dealt' ? t('games.videoPoker.drawingEllipsis') : t('games.videoPoker.dealingEllipsis')}</>
              : phase === 'dealt' ? t('games.videoPoker.draw') : t('games.videoPoker.dealWithBet', { bet })}
          </Button>
        </div>
        {error
          ? <p className="snow-game-error">{error}</p>
          : phase === 'dealt' && <p className="snow-game-note">{t('games.videoPoker.holdHint')}</p>}
      </GamePanel>

      <FairnessPanel
        ref={fairRef}
        fair={fair}
        hash={serverSeedHash}
        open={showFair}
        onToggle={() => setShowFair((s) => !s)}
        focused={zone === 'fair'}
        onFocus={() => setZone('fair')}
        labels={{
          title: t('games.videoPoker.provablyFair'),
          hash: t('games.videoPoker.fairServerSeedHash'),
          server: t('games.videoPoker.fairServerSeed'),
          client: t('games.videoPoker.fairClientSeed'),
          nonce: t('games.videoPoker.fairNonce'),
        }}
        verification={fair ? (
          <p>
            {t('games.videoPoker.fairVerifyLabel')}{' '}
            {verifyOk === null
              ? t('games.videoPoker.fairChecking')
              : verifyOk
                ? <span className="snow-fairness__ok">{t('games.videoPoker.fairMatches')}</span>
                : t('games.videoPoker.fairMismatch')}
          </p>
        ) : undefined}
      />
    </GameShell>
  );
};

export default VideoPoker;
