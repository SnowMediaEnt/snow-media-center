import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Coins, Loader2, ChevronDown, ChevronUp, Sparkles, Check } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';

interface VideoPokerProps {
  onBack: () => void;
}

const BETS = [10, 25, 50, 100];

type VpCard = { rank: string; suit: 'S' | 'H' | 'D' | 'C' };
interface FairInfo {
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED = new Set(['H', 'D']);

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
const PAY_ORDER = [
  'Royal Flush',
  'Straight Flush',
  'Four of a Kind',
  'Full House',
  'Flush',
  'Straight',
  'Three of a Kind',
  'Two Pair',
  'Jacks or Better',
];

// Map canonical English hand name → i18n key under games.videoPoker.hand
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

function PokerCard({
  card,
  held,
  flipping,
  delay = 0,
  focused,
  holdLabel,
}: {
  card?: VpCard;
  held?: boolean;
  flipping?: boolean;
  delay?: number;
  focused?: boolean;
  holdLabel: string;
}) {
  const isRed = card && RED.has(card.suit);
  return (
    <div
      className="tv-game-card"
      style={{
        perspective: '800px',
      }}
    >
      {held && (
        <div
          className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider z-10"
          style={{
            background: 'linear-gradient(180deg, #fde68a, #b45309)',
            color: '#3b1402',
            border: '2px solid #fbbf24',
            boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
            textShadow: '0 1px 0 rgba(255,255,255,0.4)',
          }}
        >
          {holdLabel}
        </div>
      )}
      <div
        className="absolute inset-0 rounded-lg"
        style={{
          transform: `rotateX(6deg) rotateY(-2deg) ${flipping ? 'rotateY(180deg)' : ''}`,
          transition: 'transform 380ms ease',
          transformStyle: 'preserve-3d',
          animation: `vp-deal-in 420ms ease-out ${delay}ms both`,
          background: held
            ? 'linear-gradient(180deg, #fffbeb, #fde68a)'
            : 'linear-gradient(180deg, #fafafa, #e5e7eb)',
          border: focused
            ? '3px solid #fbbf24'
            : held
            ? '3px solid #f59e0b'
            : '2px solid rgba(15,23,42,0.85)',
          boxShadow: focused
            ? '0 0 28px rgba(252,211,77,0.7), 0 12px 26px -8px rgba(0,0,0,0.7)'
            : held
            ? '0 0 18px rgba(251,191,36,0.45), 0 10px 22px -8px rgba(0,0,0,0.7)'
            : '0 10px 22px -8px rgba(0,0,0,0.7)',
        }}
      >
        {card && (
          <>
            <div
              className="absolute top-1 left-2 font-black leading-none"
              style={{ color: isRed ? '#dc2626' : '#0f172a', fontSize: 'clamp(12px, 2.8cqh, 20px)' }}
            >
              {card.rank}
              <div style={{ fontSize: 'clamp(11px, 2.4cqh, 18px)', marginTop: 2 }}>{SUIT_GLYPH[card.suit]}</div>
            </div>
            <div
              className="absolute inset-0 flex items-center justify-center font-black"
              style={{ color: isRed ? '#dc2626' : '#0f172a', fontSize: 'clamp(24px, 6.5cqh, 46px)' }}
            >
              {SUIT_GLYPH[card.suit]}
            </div>
            <div
              className="absolute bottom-1 right-2 font-black leading-none"
              style={{ color: isRed ? '#dc2626' : '#0f172a', fontSize: 'clamp(12px, 2.8cqh, 20px)', transform: 'rotate(180deg)' }}
            >
              {card.rank}
              <div style={{ fontSize: 'clamp(11px, 2.4cqh, 18px)', marginTop: 2 }}>{SUIT_GLYPH[card.suit]}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type Phase = 'idle' | 'dealt' | 'settled';
type FocusZone = 'back' | 'bet' | 'card' | 'primary' | 'fair';

const VideoPoker = ({ onBack }: VideoPokerProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { balance, status } = useGameSocket();

  const [phase, setPhase] = useState<Phase>('idle');
  const [bet, setBet] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const [hand, setHand] = useState<VpCard[]>([]);
  const [holds, setHolds] = useState<boolean[]>([false, false, false, false, false]);
  const [flipping, setFlipping] = useState<boolean[]>([false, false, false, false, false]);
  const [serverSeedHash, setServerSeedHash] = useState<string>('');
  const [payouts, setPayouts] = useState<Record<string, number>>(DEFAULT_PAYOUTS);
  const [resultRank, setResultRank] = useState<string | null>(null);
  const [resultPayout, setResultPayout] = useState<number>(0);
  const [resultNet, setResultNet] = useState<number>(0);
  const [resultWin, setResultWin] = useState<boolean>(false);
  const [animPayout, setAnimPayout] = useState<number>(0);
  const [celebrate, setCelebrate] = useState(false);
  const [fair, setFair] = useState<FairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  const [verifyOk, setVerifyOk] = useState<boolean | null>(null);

  // Focus
  const [zone, setZone] = useState<FocusZone>('primary');
  const [cardIdx, setCardIdx] = useState<number>(0);
  const [betIdx, setBetIdx] = useState<number>(0);

  const backRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const fairRef = useRef<HTMLButtonElement>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const betRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Initial focus
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  useEffect(() => {
    if (zone === 'back') backRef.current?.focus();
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
    setTimeout(() => setError(null), 3500);
  };

  const doDeal = useCallback(async () => {
    if (inFlight.current) return;
    if (busy) return;
    if (!user) { setError(t('games.videoPoker.error.signIn')); return; }
    if (balance === null) { setError(t('games.videoPoker.error.loadingChips')); return; }
    if (balance < bet) { setError(t('games.videoPoker.error.insufficientBalance')); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setResultRank(null);
    setResultPayout(0);
    setResultNet(0);
    setResultWin(false);
    setAnimPayout(0);
    setFair(null);
    setShowFair(false);
    setVerifyOk(null);
    setHolds([false, false, false, false, false]);
    setFlipping([true, true, true, true, true]);
    try {
      const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.dealVideoPoker(bet, seed);
      if (resp?.ok && Array.isArray(resp.hand)) {
        setHand(resp.hand);
        if (resp.serverSeedHash) setServerSeedHash(resp.serverSeedHash);
        setPhase('dealt');
        setTimeout(() => setFlipping([false, false, false, false, false]), 50);
        setZone('card');
        setCardIdx(0);
      } else {
        setFlipping([false, false, false, false, false]);
        handleErr(resp?.error ?? 'error');
      }
    } catch {
      setFlipping([false, false, false, false, false]);
      setError(t('games.videoPoker.error.dealFailed'));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }, [busy, user, balance, bet]);

  const doDraw = useCallback(async () => {
    if (inFlight.current) return;
    if (busy || phase !== 'dealt') return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    // Flip the non-held cards
    setFlipping(holds.map((h) => !h));
    try {
      const resp = await gameSocket.drawVideoPoker(holds);
      if (resp?.ok && Array.isArray(resp.hand)) {
        setTimeout(() => {
          setHand(resp.hand);
          setFlipping([false, false, false, false, false]);
        }, 250);
        if (resp.payouts && typeof resp.payouts === 'object') {
          setPayouts({ ...DEFAULT_PAYOUTS, ...resp.payouts });
        }
        setResultRank(resp.rank ?? null);
        setResultPayout(resp.payout ?? 0);
        setResultNet(typeof resp.net === 'number' ? resp.net : 0);
        setResultWin(!!resp.win);
        if (resp.fair) setFair(resp.fair);
        setPhase('settled');
        if (resp.win && resp.payout > 0) {
          setCelebrate(true);
          const target = resp.payout as number;
          const start = performance.now();
          const dur = 1100;
          const tick = (t: number) => {
            const p = Math.min(1, (t - start) / dur);
            setAnimPayout(Math.round(target * (1 - Math.pow(1 - p, 3))));
            if (p < 1) requestAnimationFrame(tick);
            else setTimeout(() => setCelebrate(false), 1200);
          };
          requestAnimationFrame(tick);
        }
        setZone('primary');
      } else {
        setFlipping([false, false, false, false, false]);
        handleErr(resp?.error ?? 'error');
      }
    } catch {
      setFlipping([false, false, false, false, false]);
      setError(t('games.videoPoker.error.drawFailed'));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }, [busy, phase, holds]);

  const primaryAction = useCallback(() => {
    if (phase === 'dealt') doDraw();
    else doDeal();
  }, [phase, doDeal, doDraw]);

  const toggleHold = useCallback((idx: number) => {
    if (phase !== 'dealt') return;
    setHolds((h) => {
      const next = [...h];
      next[idx] = !next[idx];
      return next;
    });
  }, [phase]);

  // D-pad
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const k = e.key;
      if (zone === 'back') {
        if (k === 'ArrowDown') { e.preventDefault(); setZone('bet'); setBetIdx(0); }
        else if (k === 'ArrowRight') { e.preventDefault(); setZone('bet'); setBetIdx(0); }
      } else if (zone === 'bet') {
        if (k === 'ArrowLeft') {
          if (betIdx > 0) { e.preventDefault(); setBetIdx(betIdx - 1); }
          else { e.preventDefault(); setZone('back'); }
        } else if (k === 'ArrowRight') {
          if (betIdx < BETS.length - 1) { e.preventDefault(); setBetIdx(betIdx + 1); }
        } else if (k === 'ArrowDown') {
          e.preventDefault();
          if (phase === 'dealt') { setZone('card'); setCardIdx(0); }
          else setZone('primary');
        } else if (k === 'ArrowUp') {
          e.preventDefault(); setZone('back');
        } else if (k === 'Enter' || k === ' ') {
          if (phase === 'idle' || phase === 'settled') {
            e.preventDefault();
            setBet(BETS[betIdx]);
          }
        }
      } else if (zone === 'card') {
        if (k === 'ArrowLeft' && cardIdx > 0) { e.preventDefault(); setCardIdx(cardIdx - 1); }
        else if (k === 'ArrowRight' && cardIdx < 4) { e.preventDefault(); setCardIdx(cardIdx + 1); }
        else if (k === 'ArrowDown') { e.preventDefault(); setZone('primary'); }
        else if (k === 'ArrowUp') { e.preventDefault(); setZone('bet'); }
        else if (k === 'Enter' || k === ' ') { e.preventDefault(); toggleHold(cardIdx); }
      } else if (zone === 'primary') {
        if (k === 'ArrowUp') {
          e.preventDefault();
          if (phase === 'dealt') { setZone('card'); setCardIdx(0); }
          else { setZone('bet'); }
        } else if (k === 'ArrowDown' && fair) { e.preventDefault(); setZone('fair'); }
        else if (k === 'Enter' || k === ' ') { e.preventDefault(); primaryAction(); }
      } else if (zone === 'fair') {
        if (k === 'ArrowUp') { e.preventDefault(); setZone('primary'); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zone, cardIdx, betIdx, phase, fair, primaryAction, toggleHold, onBack]);

  // Verify SHA-256 when fair info is shown
  useEffect(() => {
    if (!showFair || !fair) return;
    let cancelled = false;
    (async () => {
      try {
        const enc = new TextEncoder().encode(fair.serverSeed);
        const buf = await crypto.subtle.digest('SHA-256', enc);
        const hex = Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        if (!cancelled) setVerifyOk(hex.toLowerCase() === (fair.serverSeedHash || '').toLowerCase());
      } catch {
        if (!cancelled) setVerifyOk(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showFair, fair]);

  const ring = (active: boolean) =>
    active ? 'ring-4 ring-amber-300/80 scale-110 shadow-[0_0_24px_rgba(252,211,77,0.6)]' : '';

  const primaryLabel = phase === 'dealt' ? t('games.videoPoker.draw') : t('games.videoPoker.deal');
  const betsLocked = phase === 'dealt' || busy;

  const orderedPayouts = useMemo(
    () => PAY_ORDER.filter((k) => k in payouts).map((k) => ({ name: k, mult: payouts[k] })),
    [payouts]
  );

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
        @keyframes vp-deal-in {
          0% { opacity: 0; transform: translateY(-40px) rotate(-10deg) scale(0.8); }
          100% { opacity: 1; transform: translateY(0) rotate(0) scale(1); }
        }
        @keyframes vp-burst {
          0% { opacity: 0; transform: translateY(0) scale(0.6); }
          50% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-60px) scale(1.2); }
        }
      `}</style>

      <div className="max-w-5xl mx-auto pb-16 px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <Button
            ref={backRef}
            onClick={onBack}
            onFocus={() => setZone('back')}
            variant="gold"
            size="lg"
            className={`transition-all duration-200 ${ring(zone === 'back')}`}
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            {t('games.videoPoker.back')}
          </Button>
          <div className="flex items-center gap-3 rounded-xl border border-emerald-300/50 bg-gradient-to-br from-emerald-500/25 to-emerald-700/25 px-5 py-3 shadow-[0_8px_28px_-12px_rgba(16,185,129,0.6)]">
            <Coins className="w-6 h-6 text-amber-300" />
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] uppercase tracking-wider text-emerald-200/90 font-semibold">{t('games.videoPoker.playChips')}</span>
              <span className="text-2xl font-extrabold text-white tabular-nums">
                {balance !== null ? balance.toLocaleString() : t('games.videoPoker.loadingChips')}
              </span>
            </div>
          </div>
        </div>

        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-emerald-500/15 border border-emerald-300/30 text-emerald-200 text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" /> {t('games.videoPoker.gameTag')}
          </div>
          <h1 className="text-4xl md:text-5xl font-black drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
            {t('games.videoPoker.title')}
          </h1>
          <p className="text-slate-200/90 mt-2">{t('games.videoPoker.subtitle')}</p>
        </div>

        {/* Paytable */}
        <Card className="p-4 mb-5 bg-slate-900/70 border-amber-400/30">
          <div className="text-xs uppercase tracking-wider text-amber-200 font-bold mb-2">{t('games.videoPoker.paytable')}</div>
          <div className="grid grid-cols-3 md:grid-cols-3 gap-x-6 gap-y-1">
            {orderedPayouts.map((row) => {
              const winRow = resultWin && resultRank === row.name;
              return (
                <div
                  key={row.name}
                  className={`flex items-center justify-between text-sm px-2 py-1 rounded transition-colors ${
                    winRow
                      ? 'bg-amber-400/25 text-amber-100 font-extrabold ring-1 ring-amber-300/60'
                      : 'text-slate-200'
                  }`}
                >
                  <span>{HAND_KEY[row.name] ? t(HAND_KEY[row.name]) : row.name}</span>
                  <span className="font-black tabular-nums">×{row.mult}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Felt table */}
        <div
          className="relative rounded-[2rem] p-6 md:p-8 mb-5"
          style={{
            background: 'radial-gradient(ellipse at top, #0f5132 0%, #064e3b 45%, #022c22 100%)',
            border: '3px solid rgba(251,191,36,0.55)',
            boxShadow:
              '0 30px 60px -20px rgba(0,0,0,0.85), inset 0 0 80px rgba(0,0,0,0.5), inset 0 2px 0 rgba(255,255,255,0.08)',
            transform: 'rotateX(4deg)',
            transformStyle: 'preserve-3d',
            perspective: '1400px',
          }}
        >
          <div className="flex justify-center items-end gap-3 md:gap-4 min-h-[170px] pt-6">
            {[0, 1, 2, 3, 4].map((i) => {
              const c = hand[i];
              return (
                <button
                  key={i}
                  ref={(el) => (cardRefs.current[i] = el)}
                  onFocus={() => { setZone('card'); setCardIdx(i); }}
                  onClick={() => toggleHold(i)}
                  disabled={phase !== 'dealt'}
                  className="outline-none bg-transparent border-0 p-0 cursor-pointer disabled:cursor-default"
                  aria-label={holds[i] ? t('games.videoPoker.cardAriaLabelHeld', { number: i + 1 }) : t('games.videoPoker.cardAriaLabel', { number: i + 1 })}
                >
                  <PokerCard
                    card={c}
                    held={holds[i]}
                    flipping={flipping[i]}
                    delay={i * 90}
                    focused={zone === 'card' && cardIdx === i}
                    holdLabel={t('games.videoPoker.hold')}
                  />
                </button>
              );
            })}
          </div>

          {phase === 'settled' && resultRank && (
            <div className="mt-6 text-center">
              <div className={`inline-block px-5 py-2 rounded-xl font-black text-xl border ${
                resultWin
                  ? 'bg-gradient-to-br from-amber-400/30 to-amber-700/30 border-amber-300/60 text-amber-100'
                  : 'bg-slate-800/60 border-slate-500/40 text-slate-200'
              }`}>
                {resultWin && resultRank ? (HAND_KEY[resultRank] ? t(HAND_KEY[resultRank]) : resultRank) : t('games.videoPoker.noWin')}
              </div>
              {resultWin && (
                <div className="mt-2 relative">
                  <div className="text-3xl font-black text-emerald-300 tabular-nums">
                    {t('games.videoPoker.payoutChips', { amount: (animPayout || resultPayout).toLocaleString() })}
                  </div>
                  {celebrate && (
                    <>
                      {['🪙', '🪙', '🪙', '✨', '✨'].map((g, i) => (
                        <span
                          key={i}
                          className="absolute left-1/2 -translate-x-1/2 text-2xl pointer-events-none"
                          style={{
                            animation: `vp-burst 1100ms ease-out ${i * 120}ms both`,
                            transform: `translateX(${(i - 2) * 28}px)`,
                          }}
                        >
                          {g}
                        </span>
                      ))}
                    </>
                  )}
                </div>
              )}
              {!resultWin && resultNet !== 0 && (
                <div className="mt-2 text-lg font-bold text-rose-300 tabular-nums">
                  {t('games.videoPoker.netChips', { amount: resultNet.toLocaleString() })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bet selector + primary */}
        <Card className="p-5 bg-slate-900/70 border-emerald-400/30">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-xs uppercase tracking-wider text-amber-200 font-bold mr-1">{t('games.videoPoker.bet')}</div>
            {BETS.map((amount, i) => {
              const selected = bet === amount;
              const unaffordable = (balance ?? 0) < amount && !betsLocked;
              const active = zone === 'bet' && betIdx === i;
              return (
                <Button
                  key={amount}
                  ref={(el) => (betRefs.current[i] = el)}
                  onFocus={() => { setZone('bet'); setBetIdx(i); }}
                  onClick={() => !betsLocked && setBet(amount)}
                  disabled={betsLocked || unaffordable}
                  className={`relative w-16 h-16 rounded-full font-black text-lg border-4 transition-all
                    ${selected
                      ? 'bg-gradient-to-br from-amber-300 to-amber-600 text-slate-900 border-amber-200'
                      : 'bg-gradient-to-br from-slate-700 to-slate-900 text-amber-100 border-amber-400/40'}
                    ${(unaffordable || betsLocked) ? 'opacity-50' : ''}
                    ${ring(active)}
                  `}
                >
                  {amount}
                </Button>
              );
            })}
            <Button
              ref={primaryRef}
              onFocus={() => setZone('primary')}
              onClick={primaryAction}
              disabled={busy || !user || (phase !== 'dealt' && (balance ?? 0) < bet)}
              className={`ml-auto text-xl font-black px-10 py-6 bg-gradient-to-br from-emerald-400 to-emerald-600 text-slate-900 border-2 border-emerald-200 transition-all shadow-[0_10px_30px_-8px_rgba(16,185,129,0.6)] ${ring(zone === 'primary')}`}
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" /> {phase === 'dealt' ? t('games.videoPoker.drawingEllipsis') : t('games.videoPoker.dealingEllipsis')}
                </span>
              ) : phase === 'dealt' ? t('games.videoPoker.draw') : t('games.videoPoker.dealWithBet', { bet })}
            </Button>
          </div>

          {phase === 'dealt' && (
            <p className="mt-3 text-center text-xs text-slate-300">
              {t('games.videoPoker.holdHint')}
            </p>
          )}
        </Card>

        {error && (
          <div className="mt-4 mx-auto max-w-md px-4 py-3 rounded-lg bg-rose-950/70 border border-rose-400/50 text-rose-100 text-sm text-center font-semibold">
            {error}
          </div>
        )}

        {(phase === 'dealt' || phase === 'settled') && serverSeedHash && !fair && (
          <p className="mt-3 text-center text-[11px] text-slate-400 font-mono break-all">
            {t('games.videoPoker.seedHash', { hash: serverSeedHash })}
          </p>
        )}

        {fair && (
          <div className="mt-5">
            <button
              ref={fairRef}
              onFocus={() => setZone('fair')}
              onClick={() => setShowFair((s) => !s)}
              className={`text-xs text-slate-100 bg-slate-800 border border-slate-500/60 px-2 py-1 rounded inline-flex items-center gap-1 ${zone === 'fair' ? 'ring-2 ring-amber-300/80' : ''}`}
            >
              {t('games.videoPoker.provablyFair')} {showFair ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showFair && (
              <div className="mt-2 p-3 rounded-lg bg-slate-950/70 border border-slate-700/60 text-[11px] text-slate-300 font-mono break-all space-y-1">
                <div><span className="text-slate-400">{t('games.videoPoker.fairServerSeedHash')}</span> {fair.serverSeedHash}</div>
                <div><span className="text-slate-400">{t('games.videoPoker.fairServerSeed')}</span> {fair.serverSeed}</div>
                <div><span className="text-slate-400">{t('games.videoPoker.fairClientSeed')}</span> {fair.clientSeed}</div>
                <div><span className="text-slate-400">{t('games.videoPoker.fairNonce')}</span> {fair.nonce}</div>
                <div className="pt-1 flex items-center gap-2">
                  <span className="text-slate-400">{t('games.videoPoker.fairVerifyLabel')}</span>
                  {verifyOk === null ? (
                    <span className="text-slate-400">{t('games.videoPoker.fairChecking')}</span>
                  ) : verifyOk ? (
                    <span className="inline-flex items-center gap-1 text-emerald-300 font-bold">
                      <Check className="w-3 h-3" /> {t('games.videoPoker.fairMatches')}
                    </span>
                  ) : (
                    <span className="text-rose-300 font-bold">{t('games.videoPoker.fairMismatch')}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoPoker;
