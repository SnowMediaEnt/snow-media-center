import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Coins, Loader2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';

interface BlackjackProps {
  onBack: () => void;
}

const BETS = [10, 25, 50, 100];

type BjCard = { rank: string; suit: 'S' | 'H' | 'D' | 'C' };
interface FairInfo {
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

type Phase = 'bet' | 'playing' | 'settled';
type FocusBet = `chip-${number}` | 'deal' | 'back';
type FocusAction = 'hit' | 'stand' | 'double' | 'back';
type FocusSettle = 'again' | 'back' | 'fair';

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H', 'D']);

const computeBjTotal = (cards: BjCard[]): number => {
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

function PlayingCard({
  card,
  faceDown,
  delay = 0,
  highlight = false,
}: { card?: BjCard; faceDown?: boolean; delay?: number; highlight?: boolean }) {
  const isRed = card && RED_SUITS.has(card.suit);
  return (
    <div
      className="tv-game-card"
      style={{
        perspective: '800px',
        animation: `bj-deal-in 420ms ease-out ${delay}ms both`,
      }}
    >
      <div
        className="absolute inset-0 rounded-lg shadow-[0_10px_24px_-8px_rgba(0,0,0,0.7)]"
        style={{
          transform: 'rotateX(8deg) rotateY(-2deg)',
          transformStyle: 'preserve-3d',
          background: faceDown
            ? 'repeating-linear-gradient(45deg, #1e3a8a 0 8px, #1e40af 8px 16px)'
            : 'linear-gradient(180deg, #fafafa, #e5e7eb)',
          border: faceDown ? '2px solid #fbbf24' : '2px solid rgba(15,23,42,0.85)',
          outline: highlight ? '3px solid rgba(251,191,36,0.9)' : 'none',
          outlineOffset: 2,
        }}
      >
        {!faceDown && card && (
          <>
            <div
              className="absolute top-1 left-2 font-black leading-none"
              style={{ color: isRed ? '#dc2626' : '#0f172a', fontSize: 'clamp(11px, 2.6cqh, 18px)' }}
            >
              {card.rank}
              <div style={{ fontSize: 'clamp(10px, 2.2cqh, 16px)', marginTop: 2 }}>{SUIT_GLYPH[card.suit]}</div>
            </div>
            <div
              className="absolute inset-0 flex items-center justify-center font-black"
              style={{ color: isRed ? '#dc2626' : '#0f172a', fontSize: 'clamp(22px, 6cqh, 40px)' }}
            >
              {SUIT_GLYPH[card.suit]}
            </div>
            <div
              className="absolute bottom-1 right-2 font-black leading-none"
              style={{ color: isRed ? '#dc2626' : '#0f172a', fontSize: 'clamp(11px, 2.6cqh, 18px)', transform: 'rotate(180deg)' }}
            >
              {card.rank}
              <div style={{ fontSize: 'clamp(10px, 2.2cqh, 16px)', marginTop: 2 }}>{SUIT_GLYPH[card.suit]}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const Blackjack = ({ onBack }: BlackjackProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { balance, status } = useGameSocket();

  const [phase, setPhase] = useState<Phase>('bet');
  const [bet, setBet] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const [playerHand, setPlayerHand] = useState<BjCard[]>([]);
  const [dealerHand, setDealerHand] = useState<BjCard[]>([]);
  const [dealerUp, setDealerUp] = useState<BjCard[]>([]);
  const [playerTotal, setPlayerTotal] = useState<number>(0);
  const [dealerUpTotal, setDealerUpTotal] = useState<number>(0);
  const [dealerTotal, setDealerTotal] = useState<number>(0);
  const [serverSeedHash, setServerSeedHash] = useState<string>('');
  const [canHit, setCanHit] = useState(false);
  const [canStand, setCanStand] = useState(false);
  const [canDouble, setCanDouble] = useState(false);

  const [settleStatus, setSettleStatus] = useState<string | null>(null);
  const [net, setNet] = useState<number>(0);
  const [fair, setFair] = useState<FairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  // Staggered dealer reveal on settle: number of dealer cards currently shown face-up
  const [revealedDealer, setRevealedDealer] = useState<number>(0);

  const [focusBet, setFocusBet] = useState<FocusBet>('deal');
  const [focusAction, setFocusAction] = useState<FocusAction>('hit');
  const [focusSettle, setFocusSettle] = useState<FocusSettle>('again');

  const refs = {
    back: useRef<HTMLButtonElement>(null),
    deal: useRef<HTMLButtonElement>(null),
    hit: useRef<HTMLButtonElement>(null),
    stand: useRef<HTMLButtonElement>(null),
    double: useRef<HTMLButtonElement>(null),
    again: useRef<HTMLButtonElement>(null),
    fair: useRef<HTMLButtonElement>(null),
    chips: BETS.map(() => useRef<HTMLButtonElement>(null)),
  };
  // strip old seed ref line

  // Focus management
  useEffect(() => {
    if (phase === 'bet') {
      if (focusBet === 'back') refs.back.current?.focus();
      else if (focusBet === 'deal') refs.deal.current?.focus();
      else if (focusBet.startsWith('chip-')) {
        const i = Number(focusBet.split('-')[1]);
        refs.chips[i]?.current?.focus();
      }
    } else if (phase === 'playing') {
      if (focusAction === 'back') refs.back.current?.focus();
      else if (focusAction === 'hit') refs.hit.current?.focus();
      else if (focusAction === 'stand') refs.stand.current?.focus();
      else if (focusAction === 'double') refs.double.current?.focus();
    } else if (phase === 'settled') {
      if (focusSettle === 'back') refs.back.current?.focus();
      else if (focusSettle === 'again') refs.again.current?.focus();
      else if (focusSettle === 'fair') refs.fair.current?.focus();
    }
  }, [phase, focusBet, focusAction, focusSettle]);

  // Apply an in-progress / settled ack to local state
  const applyAck = useCallback((resp: any) => {
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
      // Choose a sensible default action focus
      setFocusAction((prev) => {
        if (prev === 'hit' && resp.canHit) return 'hit';
        if (resp.canHit) return 'hit';
        if (resp.canStand) return 'stand';
        return 'hit';
      });
    } else if (resp?.status) {
      // Settled — keep dealer total/banner hidden until the staggered reveal completes
      setPhase('settled');
      setPlayerHand(resp.playerHand ?? []);
      const dHand: BjCard[] = resp.dealerHand ?? [];
      setDealerHand(dHand);
      setPlayerTotal(resp.playerTotal ?? 0);
      setDealerTotal(resp.dealerTotal ?? 0);
      setSettleStatus(resp.status);
      setNet(typeof resp.net === 'number' ? resp.net : 0);
      setCanHit(false);
      setCanStand(false);
      setCanDouble(false);
      if (resp.fair) setFair(resp.fair);
      setFocusSettle('again');
      // Start the staggered reveal: only the up-card is showing right now.
      setRevealedDealer(Math.min(1, dHand.length));
    }
  }, []);

  const handleErrorAck = (err: string) => {
    if (err === 'game_disabled') setError(t('games.blackjack.errorGameDisabled'));
    else if (err === 'invalid_bet') setError(t('games.blackjack.errorInvalidBet'));
    else if (err === 'insufficient_balance') setError(t('games.blackjack.errorInsufficientBalance'));
    else if (err === 'round_in_progress') setError(t('games.blackjack.errorRoundInProgress'));
    else if (err === 'no_active_round') setError(t('games.blackjack.errorNoActiveRound'));
    else if (err === 'cannot_double') setError(t('games.blackjack.errorCannotDouble'));
    else setError(t('games.blackjack.errorGeneric'));
    setTimeout(() => setError(null), 3500);
  };

  const deal = useCallback(async () => {
    if (inFlight.current) return;
    if (busy) return;
    if (!user) { setError(t('games.blackjack.errorSignIn')); return; }
    if (balance === null) { setError(t('games.blackjack.errorLoadingChips')); return; }
    if (balance < bet) { setError(t('games.blackjack.errorInsufficientBalance')); return; }
    inFlight.current = true;
    setError(null);
    setBusy(true);
    try {
      const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.dealBlackjack(bet, seed);
      if (resp?.ok) applyAck(resp);
      else handleErrorAck(resp?.error ?? 'error');
    } catch {
      setError(t('games.blackjack.errorDealFailed'));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }, [busy, user, balance, bet, applyAck]);

  const action = useCallback(async (which: 'hit' | 'stand' | 'double') => {
    if (inFlight.current) return;
    if (busy) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const resp =
        which === 'hit' ? await gameSocket.hit() :
        which === 'stand' ? await gameSocket.stand() :
        await gameSocket.double();
      if (resp?.ok) applyAck(resp);
      else handleErrorAck(resp?.error ?? 'error');
    } catch {
      setError(t('games.blackjack.errorTableUnreachable'));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }, [busy, applyAck]);

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
    setFocusBet('deal');
  };

  // Staggered dealer reveal during settle phase: ~550ms between cards.
  useEffect(() => {
    if (phase !== 'settled') return;
    if (revealedDealer >= dealerHand.length) return;
    const delay = revealedDealer === 0 ? 250 : 550;
    const t = setTimeout(() => setRevealedDealer((n) => n + 1), delay);
    return () => clearTimeout(t);
  }, [phase, revealedDealer, dealerHand.length]);


  // D-pad
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase === 'bet') {
        const chipIdx = focusBet.startsWith('chip-') ? Number(focusBet.split('-')[1]) : -1;
        if (e.key === 'ArrowLeft') {
          if (chipIdx > 0) { e.preventDefault(); setFocusBet(`chip-${chipIdx - 1}` as FocusBet); }
          else if (focusBet === 'deal') { e.preventDefault(); setFocusBet(`chip-${BETS.length - 1}` as FocusBet); }
        } else if (e.key === 'ArrowRight') {
          if (chipIdx >= 0 && chipIdx < BETS.length - 1) { e.preventDefault(); setFocusBet(`chip-${chipIdx + 1}` as FocusBet); }
          else if (chipIdx === BETS.length - 1) { e.preventDefault(); setFocusBet('deal'); }
        } else if (e.key === 'ArrowUp') {
          if (chipIdx >= 0 || focusBet === 'deal') { e.preventDefault(); setFocusBet('back'); }
        } else if (e.key === 'ArrowDown') {
          if (focusBet === 'back') { e.preventDefault(); setFocusBet('chip-0' as FocusBet); }
        }
      } else if (phase === 'playing') {
        const order: FocusAction[] = ['hit', 'stand', ...(canDouble ? ['double' as FocusAction] : [])];
        const idx = order.indexOf(focusAction);
        if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); setFocusAction(order[idx - 1]); }
        else if (e.key === 'ArrowRight' && idx >= 0 && idx < order.length - 1) { e.preventDefault(); setFocusAction(order[idx + 1]); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusAction('back'); }
        else if (e.key === 'ArrowDown' && focusAction === 'back') { e.preventDefault(); setFocusAction('hit'); }
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
  }, [phase, focusBet, focusAction, focusSettle, canDouble, onBack]);

  const focusRing = (active: boolean) =>
    active ? 'ring-4 ring-amber-300/80 scale-110 shadow-[0_0_24px_rgba(252,211,77,0.6)]' : '';

  const revealComplete = phase === 'settled' && revealedDealer >= dealerHand.length;

  const settleBanner = (() => {
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
    const toneClasses =
      m.tone === 'win' ? 'from-emerald-500/30 to-emerald-700/30 border-emerald-300/60 text-emerald-100' :
      m.tone === 'lose' ? 'from-rose-600/25 to-rose-900/25 border-rose-400/50 text-rose-100' :
      'from-slate-700/40 to-slate-900/40 border-slate-400/40 text-slate-100';
    return (
      <div className={`mt-6 p-5 rounded-xl border bg-gradient-to-br ${toneClasses} text-center`}>
        <div className="text-3xl font-black tracking-wider">{m.text}</div>
        <div className="mt-1 text-lg font-bold">
          {net > 0 ? (
            <span className="text-emerald-300">{t('games.blackjack.netWin', { net: net.toLocaleString() })}</span>
          ) : net < 0 ? (
            <span className="text-rose-300">{t('games.blackjack.netLoss', { net: net.toLocaleString() })}</span>
          ) : (
            <span className="text-slate-200">{t('games.blackjack.netZero')}</span>
          )}
        </div>
        <div className="text-xs text-slate-300 mt-1">{t('games.blackjack.balanceLine', { balance: balance?.toLocaleString() ?? '—' })}</div>
      </div>
    );
  })();

  return (
    <div
      className="tv-game-shell text-white relative"
      style={{
        background:
          'radial-gradient(1200px 600px at 20% -10%, rgba(34,197,94,0.18), transparent 60%),' +
          'radial-gradient(900px 500px at 90% 10%, rgba(56,189,248,0.12), transparent 60%),' +
          'linear-gradient(135deg, #0a1628 0%, #0b1f1a 50%, #07111c 100%)',
      }}
    >
      <style>{`
        @keyframes bj-deal-in {
          0% { opacity: 0; transform: translateY(-40px) rotate(-12deg) scale(0.8); }
          100% { opacity: 1; transform: translateY(0) rotate(0) scale(1); }
        }
      `}</style>

      <div className="max-w-5xl mx-auto pb-16 px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <Button
            ref={refs.back}
            onClick={onBack}
            onFocus={() => {
              if (phase === 'bet') setFocusBet('back');
              else if (phase === 'playing') setFocusAction('back');
              else setFocusSettle('back');
            }}
            variant="gold"
            size="lg"
            className={`transition-all duration-200 ${focusRing(
              (phase === 'bet' && focusBet === 'back') ||
              (phase === 'playing' && focusAction === 'back') ||
              (phase === 'settled' && focusSettle === 'back')
            )}`}
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            {t('games.blackjack.back')}
          </Button>
          <div className="flex items-center gap-3 rounded-xl border border-emerald-300/50 bg-gradient-to-br from-emerald-500/25 to-emerald-700/25 px-5 py-3 shadow-[0_8px_28px_-12px_rgba(16,185,129,0.6)]">
            <Coins className="w-6 h-6 text-amber-300" />
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] uppercase tracking-wider text-emerald-200/90 font-semibold">{t('games.blackjack.playChips')}</span>
              <span className="text-2xl font-extrabold text-white tabular-nums">
                {balance !== null ? balance.toLocaleString() : t('games.blackjack.loadingChips')}
              </span>
            </div>
          </div>
        </div>

        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-emerald-500/15 border border-emerald-300/30 text-emerald-200 text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" /> {t('games.blackjack.title')}
          </div>
          <h1 className="text-4xl md:text-5xl font-black drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
            {t('games.blackjack.heading')}
          </h1>
          <p className="text-slate-200/90 mt-2">{t('games.blackjack.subheading')}</p>
        </div>

        {/* Felt Table */}
        <div
          className="relative rounded-[2rem] p-6 md:p-8 mb-6"
          style={{
            background:
              'radial-gradient(ellipse at top, #0f5132 0%, #064e3b 45%, #022c22 100%)',
            border: '3px solid rgba(251,191,36,0.55)',
            boxShadow:
              '0 30px 60px -20px rgba(0,0,0,0.85), inset 0 0 80px rgba(0,0,0,0.5), inset 0 2px 0 rgba(255,255,255,0.08)',
            transform: 'rotateX(4deg)',
            transformStyle: 'preserve-3d',
            perspective: '1400px',
          }}
        >
          {/* Dealer row */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wider text-amber-200 font-bold">{t('games.blackjack.dealer')}</div>
              {(phase === 'playing' || phase === 'settled') && (
                <span className="px-3 py-1 rounded-full bg-slate-900/70 border border-amber-300/40 text-amber-100 text-sm font-bold tabular-nums transition-all">
                  {phase === 'settled'
                    ? (revealComplete ? dealerTotal : computeBjTotal(dealerHand.slice(0, revealedDealer)))
                    : dealerUpTotal}
                </span>
              )}
            </div>
            <div className="flex items-end gap-2 min-h-[128px]">
              {phase === 'bet' && (
                <div className="text-slate-300/70 italic">{t('games.blackjack.placeBetPrompt')}</div>
              )}
              {phase === 'playing' && (
                <>
                  {dealerUp.map((c, i) => (
                    <PlayingCard key={`du-${i}`} card={c} delay={i * 120} />
                  ))}
                  <PlayingCard faceDown delay={dealerUp.length * 120} />
                </>
              )}
              {phase === 'settled' && (
                <>
                  {dealerHand.slice(0, revealedDealer).map((c, i) => (
                    <PlayingCard key={`dh-${i}`} card={c} delay={i === revealedDealer - 1 ? 0 : 0} />
                  ))}
                  {revealedDealer < dealerHand.length && revealedDealer < 2 && (
                    <PlayingCard faceDown />
                  )}
                </>
              )}
            </div>
          </div>

          {/* Player row */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wider text-amber-200 font-bold">{t('games.blackjack.you')}</div>
              {(phase === 'playing' || phase === 'settled') && (
                <span className="px-3 py-1 rounded-full bg-slate-900/70 border border-amber-300/40 text-amber-100 text-sm font-bold tabular-nums">
                  {playerTotal}
                </span>
              )}
            </div>
            <div className="flex items-end gap-2 min-h-[128px]">
              {phase === 'bet' && (
                <div className="text-slate-300/70 italic">{t('games.blackjack.cardsAppearHere')}</div>
              )}
              {playerHand.map((c, i) => (
                <PlayingCard key={`p-${i}`} card={c} delay={i * 120} highlight={phase === 'settled' && settleStatus === 'blackjack'} />
              ))}
            </div>
          </div>
        </div>

        {/* Bet selector */}
        {phase === 'bet' && (
          <Card className="p-5 bg-slate-900/70 border-emerald-400/30">
            <div className="text-xs uppercase tracking-wider text-emerald-200 font-bold mb-3">{t('games.blackjack.chooseBet')}</div>
            <div className="flex flex-wrap gap-3 mb-4">
              {BETS.map((amount, i) => {
                const selected = bet === amount;
                const unaffordable = (balance ?? 0) < amount;
                return (
                  <Button
                    key={amount}
                    ref={refs.chips[i]}
                    onFocus={() => setFocusBet(`chip-${i}` as FocusBet)}
                    onClick={() => setBet(amount)}
                    disabled={unaffordable}
                    className={`relative w-20 h-20 rounded-full font-black text-xl border-4 transition-all
                      ${selected
                        ? 'bg-gradient-to-br from-amber-300 to-amber-600 text-slate-900 border-amber-200'
                        : 'bg-gradient-to-br from-slate-700 to-slate-900 text-amber-100 border-amber-400/40'}
                      ${unaffordable ? 'opacity-40' : ''}
                      ${focusRing(focusBet === `chip-${i}`)}
                    `}
                  >
                    {amount}
                  </Button>
                );
              })}
              <Button
                ref={refs.deal}
                onFocus={() => setFocusBet('deal')}
                onClick={deal}
                disabled={busy || !user || (balance ?? 0) < bet}
                className={`ml-auto text-xl font-black px-8 py-6 bg-gradient-to-br from-emerald-400 to-emerald-600 text-slate-900 border-2 border-emerald-200 transition-all shadow-[0_10px_30px_-8px_rgba(16,185,129,0.6)] ${focusRing(focusBet === 'deal')}`}
              >
                {busy ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> {t('games.blackjack.dealing')}</span>
                ) : t('games.blackjack.dealWithBet', { bet })}
              </Button>
            </div>
            <p className="text-[11px] text-slate-400">
              {t('games.blackjack.freshSeedNote')}
            </p>
          </Card>
        )}

        {/* Action bar */}
        {phase === 'playing' && (
          <Card className="p-5 bg-slate-900/70 border-emerald-400/30">
            <div className="flex flex-wrap gap-3 justify-center">
              <Button
                ref={refs.hit}
                onFocus={() => setFocusAction('hit')}
                onClick={() => action('hit')}
                disabled={!canHit || busy}
                className={`text-lg font-black px-8 py-6 bg-gradient-to-br from-sky-400 to-sky-600 text-slate-900 border-2 border-sky-200 transition-all ${focusRing(focusAction === 'hit')}`}
              >
                {t('games.blackjack.hit')}
              </Button>
              <Button
                ref={refs.stand}
                onFocus={() => setFocusAction('stand')}
                onClick={() => action('stand')}
                disabled={!canStand || busy}
                className={`text-lg font-black px-8 py-6 bg-gradient-to-br from-amber-400 to-amber-600 text-slate-900 border-2 border-amber-200 transition-all ${focusRing(focusAction === 'stand')}`}
              >
                {t('games.blackjack.stand')}
              </Button>
              {canDouble && (
                <Button
                  ref={refs.double}
                  onFocus={() => setFocusAction('double')}
                  onClick={() => action('double')}
                  disabled={busy}
                  className={`text-lg font-black px-8 py-6 bg-gradient-to-br from-fuchsia-400 to-fuchsia-600 text-slate-900 border-2 border-fuchsia-200 transition-all ${focusRing(focusAction === 'double')}`}
                >
                  {t('games.blackjack.double')}
                </Button>
              )}
            </div>
            {busy && (
              <div className="flex items-center justify-center gap-2 mt-3 text-slate-300 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> {t('games.blackjack.working')}
              </div>
            )}
          </Card>
        )}

        {/* Settle */}
        {phase === 'settled' && (
          <Card className="p-5 bg-slate-900/70 border-emerald-400/30">
            {settleBanner}
            <div className="flex justify-center mt-5">
              <Button
                ref={refs.again}
                onFocus={() => setFocusSettle('again')}
                onClick={playAgain}
                className={`text-xl font-black px-10 py-6 bg-gradient-to-br from-emerald-400 to-emerald-600 text-slate-900 border-2 border-emerald-200 transition-all shadow-[0_10px_30px_-8px_rgba(16,185,129,0.6)] ${focusRing(focusSettle === 'again')}`}
              >
                {t('games.blackjack.playAgain')}
              </Button>
            </div>

            {fair && (
              <div className="mt-6">
                <button
                  ref={refs.fair}
                  onFocus={() => setFocusSettle('fair')}
                  onClick={() => setShowFair((s) => !s)}
                  className={`text-xs text-slate-100 bg-slate-800 border border-slate-500/60 px-2 py-1 rounded inline-flex items-center gap-1 ${focusSettle === 'fair' ? 'ring-2 ring-amber-300/80' : ''}`}
                >
                  {t('games.blackjack.provablyFair')} {showFair ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {showFair && (
                  <div className="mt-2 p-3 rounded-lg bg-slate-950/70 border border-slate-700/60 text-[11px] text-slate-300 font-mono break-all space-y-1">
                    <div><span className="text-slate-400">{t('games.blackjack.fairServerSeedHash')}</span> {fair.serverSeedHash}</div>
                    <div><span className="text-slate-400">{t('games.blackjack.fairServerSeed')}</span> {fair.serverSeed}</div>
                    <div><span className="text-slate-400">{t('games.blackjack.fairClientSeed')}</span> {fair.clientSeed}</div>
                    <div><span className="text-slate-400">{t('games.blackjack.fairNonce')}</span> {fair.nonce}</div>
                    <div className="text-slate-400 pt-1">{t('games.blackjack.fairVerifyNote')}</div>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        {error && (
          <div className="mt-4 mx-auto max-w-md px-4 py-3 rounded-lg bg-rose-950/70 border border-rose-400/50 text-rose-100 text-sm text-center font-semibold">
            {error}
          </div>
        )}

        {phase === 'playing' && serverSeedHash && (
          <p className="mt-3 text-center text-[11px] text-slate-400 font-mono break-all">
            {t('games.blackjack.seedHashLine', { serverSeedHash })}
          </p>
        )}
      </div>
    </div>
  );
};

export default Blackjack;
