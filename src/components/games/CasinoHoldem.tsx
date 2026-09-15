import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { BetChip, FairnessPanel, GAME_ACTION_CLASS, GamePanel, GameShell, GameTopBar, ResultBanner } from './shared/GameUI';
import { PlayingCard, PlayingCardSlot } from './shared/PlayingCard';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { useGameLifecycle } from './shared/gameLifecycle';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import type { GameCardValue, GameFairInfo } from './shared/gameTypes';

interface CasinoHoldemProps {
  onBack: () => void;
}

type Phase = 'bet' | 'decision' | 'reveal' | 'settled';
type FocusBet = `chip-${number}` | 'deal' | 'back';
type FocusDecision = `opt-${number}` | 'fold' | 'back' | 'fair';
type FocusSettle = 'again' | 'back' | 'fair';

interface RaiseOption { multiplier: number; cost: number }

interface HoldemAck {
  status?: string;
  playerHole?: GameCardValue[];
  dealerHole?: GameCardValue[];
  community?: GameCardValue[];
  flop?: GameCardValue[];
  callCost?: number;
  raiseOptions?: RaiseOption[];
  serverSeedHash?: string;
  playerRank?: string;
  dealerRank?: string;
  dealerQualified?: boolean;
  anteBonus?: number;
  payout?: number;
  net?: number;
  fair?: GameFairInfo;
}

const ANTES = [10, 25, 50, 100];

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
  useTvActivate(activateFocused);

  const labelRank = (k?: string) => (k ? (RANK_KEY[k] ? t(RANK_KEY[k]) : k.replace(/_/g, ' ')) : '');

  const [phase, setPhase] = useState<Phase>('bet');
  const [ante, setAnte] = useState<number>(10);
  const [raiseOptions, setRaiseOptions] = useState<RaiseOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const [playerHole, setPlayerHole] = useState<GameCardValue[]>([]);
  const [dealerHole, setDealerHole] = useState<GameCardValue[]>([]);
  const [community, setCommunity] = useState<GameCardValue[]>([]);
  const [revealedCommunity, setRevealedCommunity] = useState(0);
  const [dealerRevealed, setDealerRevealed] = useState(false);

  const [serverSeedHash, setServerSeedHash] = useState('');
  const [settleStatus, setSettleStatus] = useState<string | null>(null);
  const [playerRank, setPlayerRank] = useState('');
  const [dealerRank, setDealerRank] = useState('');
  const [dealerQualified, setDealerQualified] = useState(true);
  const [anteBonus, setAnteBonus] = useState(0);
  const [net, setNet] = useState(0);
  const [fair, setFair] = useState<GameFairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);

  const [focusBet, setFocusBet] = useState<FocusBet>('deal');
  const [focusDecision, setFocusDecision] = useState<FocusDecision>('fold');
  const [focusSettle, setFocusSettle] = useState<FocusSettle>('again');

  const backRef = useRef<HTMLButtonElement>(null);
  const dealRef = useRef<HTMLButtonElement>(null);
  const foldRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const fairRef = useRef<HTMLButtonElement>(null);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const affordable = useCallback((cost: number) => (balance ?? 0) >= cost, [balance]);

  useEffect(() => {
    if (phase === 'bet') {
      if (focusBet === 'back') backRef.current?.focus();
      else if (focusBet === 'deal') dealRef.current?.focus();
      else chipRefs.current[Number(focusBet.split('-')[1])]?.focus();
    } else if (phase === 'decision') {
      if (focusDecision === 'back') backRef.current?.focus();
      else if (focusDecision === 'fold') foldRef.current?.focus();
      else if (focusDecision === 'fair') fairRef.current?.focus();
      else optionRefs.current[Number(focusDecision.split('-')[1])]?.focus();
    } else if (phase === 'settled') {
      if (focusSettle === 'back') backRef.current?.focus();
      else if (focusSettle === 'again') againRef.current?.focus();
      else if (focusSettle === 'fair') fairRef.current?.focus();
    }
  }, [phase, focusBet, focusDecision, focusSettle]);

  const handleErrorAck = (err: string) => {
    if (err === 'game_disabled') setError(t('games.casinoHoldem.error.gameDisabled'));
    else if (err === 'invalid_bet') setError(t('games.casinoHoldem.error.invalidBet'));
    else if (err === 'insufficient_balance') setError(t('games.casinoHoldem.error.insufficientBalance'));
    else if (err === 'round_in_progress') setError(t('games.casinoHoldem.error.roundInProgress'));
    else if (err === 'no_active_round') setError(t('games.casinoHoldem.error.noActiveRound'));
    else setError(t('games.casinoHoldem.error.generic'));
    life.timeout(() => setError(null), 3500);
  };

  const deal = useCallback(async () => {
    if (inFlight.current || busy) return;
    if (!user) { setError(t('games.casinoHoldem.error.signIn')); return; }
    if (balance === null) { setError(t('games.casinoHoldem.error.loadingChips')); return; }
    if (balance < ante) { setError(t('games.casinoHoldem.error.insufficientBalance')); return; }
    inFlight.current = true;
    setError(null);
    setBusy(true);
    try {
      const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.dealCasinoHoldem(ante, seed);
      if (resp?.ok && resp.status === 'decision') {
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
        if (resp.serverSeedHash) setServerSeedHash(resp.serverSeedHash);
        setSettleStatus(null);
        setFair(null);
        setNet(0); setAnteBonus(0);
        setPlayerRank(''); setDealerRank(''); setDealerQualified(true);
        setPhase('decision');
        // The ante is already committed, so affordability is measured against
        // the balance the server just left us with.
        const remaining = Math.max(0, (balance ?? 0) - ante);
        const firstAffordable = opts.findIndex((o) => o.cost <= remaining);
        setFocusDecision(firstAffordable >= 0 ? (`opt-${firstAffordable}` as FocusDecision) : 'fold');
      } else {
        handleErrorAck(resp?.error ?? 'error');
      }
    } catch {
      setError(t('games.casinoHoldem.error.dealFailed'));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, user, balance, ante]);

  const finishSettle = useCallback((resp: HoldemAck, folded: boolean) => {
    setPlayerHole(resp.playerHole ?? []);
    setDealerHole(resp.dealerHole ?? []);
    setCommunity(resp.community ?? []);
    setSettleStatus(resp.status ?? null);
    setPlayerRank(resp.playerRank ?? '');
    setDealerRank(resp.dealerRank ?? '');
    setDealerQualified(resp.dealerQualified !== false);
    setAnteBonus(typeof resp.anteBonus === 'number' ? resp.anteBonus : 0);
    setNet(typeof resp.net === 'number' ? resp.net : 0);
    if (resp.fair) setFair(resp.fair);

    if (folded) {
      setRevealedCommunity(5);
      setDealerRevealed(true);
      setPhase('settled');
      setFocusSettle('again');
      return;
    }
    // Tracked timers: Back or unmount cancels the whole reveal.
    const scale = reducedFx ? 0.5 : 1;
    setPhase('reveal');
    life.timeout(() => setRevealedCommunity((n) => Math.max(n, 4)), 350 * scale);
    life.timeout(() => setRevealedCommunity((n) => Math.max(n, 5)), 700 * scale);
    life.timeout(() => setDealerRevealed(true), 1100 * scale);
    life.timeout(() => { setPhase('settled'); setFocusSettle('again'); }, 1500 * scale);
  }, [life, reducedFx]);

  const doCall = useCallback(async (multiplier: number) => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const resp = await gameSocket.callCasinoHoldem(multiplier);
      if (resp?.ok) finishSettle(resp, false);
      else handleErrorAck(resp?.error ?? 'error');
    } catch {
      setError(t('games.casinoHoldem.error.tableUnreachable'));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, finishSettle]);

  const doFold = useCallback(async () => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const resp = await gameSocket.foldCasinoHoldem();
      if (resp?.ok) finishSettle(resp, true);
      else handleErrorAck(resp?.error ?? 'error');
    } catch {
      setError(t('games.casinoHoldem.error.tableUnreachable'));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, finishSettle]);

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
    setFair(null);
    setShowFair(false);
    setFocusBet('deal');
  };

  // D-pad focus movement only. Affordable raise options stay reachable.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase === 'bet') {
        const chipIdx = focusBet.startsWith('chip-') ? Number(focusBet.split('-')[1]) : -1;
        if (e.key === 'ArrowLeft') {
          if (chipIdx > 0) { e.preventDefault(); setFocusBet(`chip-${chipIdx - 1}`); }
          else if (focusBet === 'deal') { e.preventDefault(); setFocusBet(`chip-${ANTES.length - 1}`); }
        } else if (e.key === 'ArrowRight') {
          if (chipIdx >= 0 && chipIdx < ANTES.length - 1) { e.preventDefault(); setFocusBet(`chip-${chipIdx + 1}`); }
          else if (chipIdx === ANTES.length - 1) { e.preventDefault(); setFocusBet('deal'); }
        } else if (e.key === 'ArrowUp') {
          if (focusBet !== 'back') { e.preventDefault(); setFocusBet('back'); }
        } else if (e.key === 'ArrowDown' && focusBet === 'back') {
          e.preventDefault(); setFocusBet('chip-0');
        }
      } else if (phase === 'decision') {
        const order: FocusDecision[] = [
          ...raiseOptions.map((_, i) => `opt-${i}` as FocusDecision),
          'fold',
          'fair',
        ];
        const idx = order.indexOf(focusDecision);
        if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); setFocusDecision(order[idx - 1]); }
        else if (e.key === 'ArrowRight' && idx >= 0 && idx < order.length - 1) { e.preventDefault(); setFocusDecision(order[idx + 1]); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusDecision('back'); }
        else if (e.key === 'ArrowDown' && focusDecision === 'back') {
          e.preventDefault();
          const firstAff = raiseOptions.findIndex((o) => affordable(o.cost));
          setFocusDecision(firstAff >= 0 ? (`opt-${firstAff}` as FocusDecision) : 'fold');
        }
      } else if (phase === 'settled') {
        const order: FocusSettle[] = ['again', 'fair'];
        const idx = order.indexOf(focusSettle);
        if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); setFocusSettle(order[idx - 1]); }
        else if (e.key === 'ArrowRight' && idx >= 0 && idx < order.length - 1) { e.preventDefault(); setFocusSettle(order[idx + 1]); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusSettle('back'); }
        else if (e.key === 'ArrowDown' && focusSettle === 'back') { e.preventDefault(); setFocusSettle('again'); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, focusBet, focusDecision, focusSettle, raiseOptions, affordable]);

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
    (phase === 'bet' && focusBet === 'back') ||
    (phase === 'decision' && focusDecision === 'back') ||
    (phase === 'settled' && focusSettle === 'back');

  return (
    <GameShell accent="teal">
      <GameTopBar
        ref={backRef}
        onBack={onBack}
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
      />

      <div className="snow-ch-table">
        <div className="snow-ch-zone">
          <span className="snow-ch-zone__label">{t('games.casinoHoldem.label.dealer')}</span>
          <div className="snow-ch-row">
            {[0, 1].map((i) => (dealerHole[i]
              ? <PlayingCard key={`d-${i}`} card={dealerHole[i]} faceDown={!dealerRevealed} delay={i * 80} compact />
              : <PlayingCardSlot key={`d-${i}`} compact />))}
          </div>
          <span className="snow-ch-zone__label" style={{ textAlign: 'right' }}>
            {phase === 'settled' && dealerRank ? labelRank(dealerRank) : ''}
          </span>
        </div>

        <div className="snow-ch-runway">
          <span className="snow-ch-zone__label" style={{ display: 'block', textAlign: 'center', width: 'auto' }}>
            {t('games.casinoHoldem.label.community')}
          </span>
          <div className="snow-ch-row">
            {[0, 1, 2, 3, 4].map((i) => (community[i] && i < revealedCommunity
              ? <PlayingCard key={`c-${i}`} card={community[i]} delay={Math.max(0, i - 2) * 80} />
              : <PlayingCardSlot key={`c-${i}`} />))}
          </div>
        </div>

        <div className="snow-ch-zone">
          <span className="snow-ch-zone__label">{t('games.casinoHoldem.label.you')}</span>
          <div className="snow-ch-row">
            {[0, 1].map((i) => (playerHole[i]
              ? <PlayingCard key={`p-${i}`} card={playerHole[i]} delay={i * 80} compact />
              : <PlayingCardSlot key={`p-${i}`} compact />))}
          </div>
          <span className="snow-ch-zone__label" style={{ textAlign: 'right' }}>
            {phase === 'settled' && playerRank ? labelRank(playerRank) : ''}
          </span>
        </div>

        {phase === 'settled' && (playerRank || dealerRank) && (
          <div className="snow-ch-versus">
            {playerRank && <span className="snow-ch-rank">{t('games.casinoHoldem.result.youLabel')} <em>{labelRank(playerRank)}</em></span>}
            {playerRank && dealerRank && <span className="snow-ch-zone__label" style={{ width: 'auto' }}>{t('games.casinoHoldem.result.versus')}</span>}
            {dealerRank && (
              <span className="snow-ch-rank">
                {t('games.casinoHoldem.result.dealerLabel')} <em>{labelRank(dealerRank)}</em>
                {!dealerQualified && ` · ${t('games.casinoHoldem.dealerDidntQualify')}`}
              </span>
            )}
          </div>
        )}
        {banner && <div className="snow-ch-versus">{banner}</div>}
      </div>

      <GamePanel className="p-3">
        {phase === 'bet' && (
          <div className="snow-bet-row">
            {ANTES.map((amt, idx) => (
              <BetChip
                key={amt}
                ref={(el) => { chipRefs.current[idx] = el; }}
                selected={ante === amt}
                focused={focusBet === `chip-${idx}`}
                onFocus={() => setFocusBet(`chip-${idx}`)}
                onClick={() => { if (affordable(amt)) setAnte(amt); }}
                aria-disabled={affordable(amt) ? undefined : 'true'}
              >
                {amt}
              </BetChip>
            ))}
            <Button
              ref={dealRef}
              type="button"
              onFocus={() => setFocusBet('deal')}
              onClick={() => { if (!(busy || !user || balance === null || balance < ante)) deal(); }}
              aria-disabled={busy || !user || balance === null || balance < ante ? 'true' : undefined}
              data-busy={busy ? 'true' : undefined}
              data-tv-focused={focusBet === 'deal' ? 'true' : 'false'}
              className={`${GAME_ACTION_CLASS} ml-3 px-8`}
            >
              {balance === null
                ? t('games.casinoHoldem.loadingChips')
                : busy
                  ? <><Loader2 className="animate-spin" /> {t('games.casinoHoldem.dealButton', { ante })}</>
                  : t('games.casinoHoldem.dealButton', { ante })}
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
                  className={`${GAME_ACTION_CLASS} px-6`}
                >
                  {isCall
                    ? t('games.casinoHoldem.callOption', { multiplier: opt.multiplier, cost: opt.cost })
                    : t('games.casinoHoldem.raiseOption', { multiplier: opt.multiplier, cost: opt.cost })}
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
              className="snow-game-action tv-ring min-h-12 border-2 px-6 font-black"
            >
              {t('games.casinoHoldem.fold')}
            </Button>
          </div>
        )}

        {phase === 'reveal' && <p className="snow-game-note">{t('games.casinoHoldem.revealing')}</p>}

        {phase === 'settled' && (
          <div className="snow-game-actions">
            <Button
              ref={againRef}
              type="button"
              onFocus={() => setFocusSettle('again')}
              onClick={playAgain}
              data-tv-focused={focusSettle === 'again' ? 'true' : 'false'}
              className={`${GAME_ACTION_CLASS} px-10`}
            >
              {t('games.casinoHoldem.newHand')}
            </Button>
          </div>
        )}

        {error && <p className="snow-game-error">{error}</p>}
        {phase === 'bet' && !error && <p className="snow-game-note">{t('games.casinoHoldem.chooseAnte')}</p>}
      </GamePanel>

      <FairnessPanel
        ref={fairRef}
        fair={fair}
        hash={serverSeedHash}
        open={showFair}
        onToggle={() => setShowFair((v) => !v)}
        focused={(phase === 'decision' && focusDecision === 'fair') || (phase === 'settled' && focusSettle === 'fair')}
        onFocus={() => {
          if (phase === 'decision') setFocusDecision('fair');
          else if (phase === 'settled') setFocusSettle('fair');
        }}
        labels={{
          title: t('games.casinoHoldem.fair.toggle'),
          hash: t('games.casinoHoldem.fair.serverSeedHash'),
          server: t('games.casinoHoldem.fair.serverSeed'),
          client: t('games.casinoHoldem.fair.clientSeed'),
          nonce: t('games.casinoHoldem.fair.nonce'),
          note: t('games.casinoHoldem.fair.verifyHint'),
        }}
      />
    </GameShell>
  );
};

export default CasinoHoldem;
