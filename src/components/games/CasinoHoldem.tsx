import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Coins, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';

interface CasinoHoldemProps {
  onBack: () => void;
}

type ChCard = { rank: string; suit: 'S' | 'H' | 'D' | 'C' };
interface FairInfo {
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

type Phase = 'bet' | 'decision' | 'reveal' | 'settled';
type FocusBet = `chip-${number}` | 'deal' | 'back';
type FocusDecision = `opt-${number}` | 'fold' | 'back' | 'fair';
type FocusSettle = 'again' | 'back' | 'fair';

interface RaiseOption { multiplier: number; cost: number }

const ANTES = [10, 25, 50, 100];
const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H', 'D']);

const RANK_LABEL: Record<string, string> = {
  royal_flush: 'Royal Flush',
  straight_flush: 'Straight Flush',
  four_of_a_kind: 'Four of a Kind',
  full_house: 'Full House',
  flush: 'Flush',
  straight: 'Straight',
  three_of_a_kind: 'Three of a Kind',
  two_pair: 'Two Pair',
  one_pair: 'Pair',
  high_card: 'High Card',
};
const labelRank = (k?: string) => (k ? RANK_LABEL[k] ?? k.replace(/_/g, ' ') : '');

function PlayingCard({
  card,
  faceDown,
  delay = 0,
  highlight = false,
}: { card?: ChCard; faceDown?: boolean; delay?: number; highlight?: boolean }) {
  const isRed = card && RED_SUITS.has(card.suit);
  return (
    <div
      className="relative"
      style={{
        width: 76,
        height: 110,
        perspective: '800px',
        animation: `ch-deal-in 420ms ease-out ${delay}ms both`,
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
              style={{ color: isRed ? '#dc2626' : '#0f172a', fontSize: 16 }}
            >
              {card.rank}
              <div style={{ fontSize: 14, marginTop: 2 }}>{SUIT_GLYPH[card.suit]}</div>
            </div>
            <div
              className="absolute inset-0 flex items-center justify-center font-black"
              style={{ color: isRed ? '#dc2626' : '#0f172a', fontSize: 36 }}
            >
              {SUIT_GLYPH[card.suit]}
            </div>
            <div
              className="absolute bottom-1 right-2 font-black leading-none"
              style={{ color: isRed ? '#dc2626' : '#0f172a', fontSize: 16, transform: 'rotate(180deg)' }}
            >
              {card.rank}
              <div style={{ fontSize: 14, marginTop: 2 }}>{SUIT_GLYPH[card.suit]}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CardSlot() {
  return (
    <div
      style={{ width: 76, height: 110 }}
      className="rounded-lg border-2 border-dashed border-white/15 bg-white/[0.03]"
    />
  );
}

const CasinoHoldem = ({ onBack }: CasinoHoldemProps) => {
  const { user } = useAuth();
  const { balance, status } = useGameSocket();

  const [phase, setPhase] = useState<Phase>('bet');
  const [ante, setAnte] = useState<number>(10);
  const [callCost, setCallCost] = useState<number>(0);
  const [raiseOptions, setRaiseOptions] = useState<RaiseOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const [playerHole, setPlayerHole] = useState<ChCard[]>([]);
  const [dealerHole, setDealerHole] = useState<ChCard[]>([]);
  const [community, setCommunity] = useState<ChCard[]>([]); // up to 5
  const [revealedCommunity, setRevealedCommunity] = useState<number>(0);
  const [dealerRevealed, setDealerRevealed] = useState(false);

  const [serverSeedHash, setServerSeedHash] = useState<string>('');
  const [settleStatus, setSettleStatus] = useState<string | null>(null);
  const [playerRank, setPlayerRank] = useState<string>('');
  const [dealerRank, setDealerRank] = useState<string>('');
  const [dealerQualified, setDealerQualified] = useState<boolean>(true);
  const [anteBonus, setAnteBonus] = useState<number>(0);
  const [payout, setPayout] = useState<number>(0);
  const [net, setNet] = useState<number>(0);
  const [fair, setFair] = useState<FairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);

  const [focusBet, setFocusBet] = useState<FocusBet>('deal');
  const [focusDecision, setFocusDecision] = useState<FocusDecision>('fold');
  const [focusSettle, setFocusSettle] = useState<FocusSettle>('again');

  const backRef = useRef<HTMLButtonElement>(null);
  const dealRef = useRef<HTMLButtonElement>(null);
  const foldRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const fairRef = useRef<HTMLButtonElement>(null);
  const chipsRefs = ANTES.map(() => useRef<HTMLButtonElement>(null));
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const refs = {
    back: backRef,
    deal: dealRef,
    fold: foldRef,
    again: againRef,
    fair: fairRef,
    chips: chipsRefs,
  };

  // Focus management
  useEffect(() => {
    if (phase === 'bet') {
      if (focusBet === 'back') refs.back.current?.focus();
      else if (focusBet === 'deal') refs.deal.current?.focus();
      else if (focusBet.startsWith('chip-')) {
        const i = Number(focusBet.split('-')[1]);
        refs.chips[i]?.current?.focus();
      }
    } else if (phase === 'decision') {
      if (focusDecision === 'back') refs.back.current?.focus();
      else if (focusDecision === 'fold') refs.fold.current?.focus();
      else if (focusDecision === 'fair') refs.fair.current?.focus();
      else if (focusDecision.startsWith('opt-')) {
        const i = Number(focusDecision.split('-')[1]);
        optionRefs.current[i]?.focus();
      }
    } else if (phase === 'settled') {
      if (focusSettle === 'back') refs.back.current?.focus();
      else if (focusSettle === 'again') refs.again.current?.focus();
      else if (focusSettle === 'fair') refs.fair.current?.focus();
    }
  }, [phase, focusBet, focusDecision, focusSettle]);

  const handleErrorAck = (err: string, respBalance?: number) => {
    if (err === 'game_disabled') setError("Casino Hold'em is temporarily disabled.");
    else if (err === 'invalid_bet') setError('Invalid ante.');
    else if (err === 'insufficient_balance') setError('Not enough chips — grab your Daily Spin.');
    else if (err === 'round_in_progress') setError('Finish your current hand first.');
    else if (err === 'no_active_round') setError('No active hand — deal a new one.');
    else setError('Something went wrong — try again.');
    setTimeout(() => setError(null), 3500);
  };

  const deal = useCallback(async () => {
    if (inFlight.current) return;
    if (busy) return;
    if (!user) { setError('Sign in to play.'); return; }
    if (balance === null) { setError('Loading chips… try again in a moment.'); return; }
    if (balance < ante) { setError('Not enough chips — grab your Daily Spin.'); return; }
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
        setCallCost(cc);
        const opts: RaiseOption[] = Array.isArray(resp.raiseOptions) && resp.raiseOptions.length
          ? resp.raiseOptions
          : [{ multiplier: 2, cost: cc }];
        setRaiseOptions(opts);
        if (resp.serverSeedHash) setServerSeedHash(resp.serverSeedHash);
        setSettleStatus(null);
        setFair(null);
        setNet(0); setPayout(0); setAnteBonus(0);
        setPlayerRank(''); setDealerRank(''); setDealerQualified(true);
        setPhase('decision');
        const bal = balance ?? 0;
        const firstAffordable = opts.findIndex((o) => o.cost <= bal);
        setFocusDecision(firstAffordable >= 0 ? (`opt-${firstAffordable}` as FocusDecision) : 'fold');
      } else {
        handleErrorAck(resp?.error ?? 'error', resp?.balance);
      }
    } catch {
      setError("Couldn't deal right now — try again.");
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }, [busy, user, balance, ante]);

  const finishSettle = useCallback((resp: any, folded: boolean) => {
    setPlayerHole(resp.playerHole ?? []);
    setDealerHole(resp.dealerHole ?? []);
    setCommunity(resp.community ?? []);
    setSettleStatus(resp.status);
    setPlayerRank(resp.playerRank ?? '');
    setDealerRank(resp.dealerRank ?? '');
    setDealerQualified(resp.dealerQualified !== false);
    setAnteBonus(typeof resp.anteBonus === 'number' ? resp.anteBonus : 0);
    setPayout(typeof resp.payout === 'number' ? resp.payout : 0);
    setNet(typeof resp.net === 'number' ? resp.net : 0);
    if (resp.fair) setFair(resp.fair);

    if (folded) {
      setRevealedCommunity(5);
      setDealerRevealed(true);
      setPhase('settled');
      setFocusSettle('again');
    } else {
      setPhase('reveal');
      setTimeout(() => setRevealedCommunity((n) => Math.max(n, 4)), 350);
      setTimeout(() => setRevealedCommunity((n) => Math.max(n, 5)), 700);
      setTimeout(() => setDealerRevealed(true), 1100);
      setTimeout(() => {
        setPhase('settled');
        setFocusSettle('again');
      }, 1500);
    }
  }, []);

  const doCall = useCallback(async (multiplier: number) => {
    if (inFlight.current) return;
    if (busy) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const resp = await gameSocket.callCasinoHoldem(multiplier);
      if (resp?.ok) finishSettle(resp, false);
      else handleErrorAck(resp?.error ?? 'error', resp?.balance);
    } catch {
      setError("Couldn't reach the table — try again.");
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }, [busy, finishSettle]);

  const doFold = useCallback(async () => {
    if (inFlight.current) return;
    if (busy) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const resp = await gameSocket.foldCasinoHoldem();
      if (resp?.ok) finishSettle(resp, true);
      else handleErrorAck(resp?.error ?? 'error', resp?.balance);
    } catch {
      setError("Couldn't reach the table — try again.");
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }, [busy, finishSettle]);

  const playAgain = () => {
    setPhase('bet');
    setPlayerHole([]);
    setDealerHole([]);
    setCommunity([]);
    setRevealedCommunity(0);
    setDealerRevealed(false);
    setSettleStatus(null);
    setNet(0); setPayout(0); setAnteBonus(0);
    setPlayerRank(''); setDealerRank('');
    setFair(null);
    setShowFair(false);
    setFocusBet('deal');
  };

  // D-pad
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase === 'bet') {
        const chipIdx = focusBet.startsWith('chip-') ? Number(focusBet.split('-')[1]) : -1;
        if (e.key === 'ArrowLeft') {
          if (chipIdx > 0) { e.preventDefault(); setFocusBet(`chip-${chipIdx - 1}` as FocusBet); }
          else if (focusBet === 'deal') { e.preventDefault(); setFocusBet(`chip-${ANTES.length - 1}` as FocusBet); }
        } else if (e.key === 'ArrowRight') {
          if (chipIdx >= 0 && chipIdx < ANTES.length - 1) { e.preventDefault(); setFocusBet(`chip-${chipIdx + 1}` as FocusBet); }
          else if (chipIdx === ANTES.length - 1) { e.preventDefault(); setFocusBet('deal'); }
        } else if (e.key === 'ArrowUp') {
          if (chipIdx >= 0 || focusBet === 'deal') { e.preventDefault(); setFocusBet('back'); }
        } else if (e.key === 'ArrowDown') {
          if (focusBet === 'back') { e.preventDefault(); setFocusBet('chip-0' as FocusBet); }
        }
      } else if (phase === 'decision') {
        // Build dynamic order: each affordable option, then fold, then fair. Fold always present.
        const bal = balance ?? 0;
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
          const firstAff = raiseOptions.findIndex((o) => o.cost <= bal);
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
  }, [phase, focusBet, focusDecision, focusSettle, onBack]);

  const focusRing = (active: boolean) =>
    active ? 'ring-4 ring-amber-300/80 scale-110 shadow-[0_0_24px_rgba(252,211,77,0.6)]' : '';

  const settleBanner = (() => {
    if (phase !== 'settled' || !settleStatus) return null;
    const winStatuses = new Set(['win']);
    const loseStatuses = new Set(['lose', 'folded']);
    const tone: 'win' | 'lose' | 'push' =
      winStatuses.has(settleStatus) ? 'win'
      : loseStatuses.has(settleStatus) ? 'lose'
      : 'push';
    const text =
      settleStatus === 'win' ? 'YOU WIN' :
      settleStatus === 'lose' ? 'DEALER WINS' :
      settleStatus === 'push' ? 'PUSH' :
      settleStatus === 'dealer_no_qualify' ? "DEALER DIDN'T QUALIFY" :
      settleStatus === 'folded' ? 'FOLDED' :
      settleStatus.toUpperCase();
    const toneClasses =
      tone === 'win' ? 'from-emerald-500/30 to-emerald-700/30 border-emerald-300/60 text-emerald-100' :
      tone === 'lose' ? 'from-rose-600/25 to-rose-900/25 border-rose-400/50 text-rose-100' :
      'from-slate-700/40 to-slate-900/40 border-slate-400/40 text-slate-100';
    return (
      <div className={`mt-6 p-5 rounded-xl border bg-gradient-to-br ${toneClasses} text-center`}>
        <div className="text-3xl font-black tracking-wider">{text}</div>
        {(playerRank || dealerRank) && (
          <div className="mt-2 text-sm text-slate-100/90">
            {playerRank && <span>You: <b>{labelRank(playerRank)}</b></span>}
            {playerRank && dealerRank && <span className="mx-3 opacity-60">vs</span>}
            {dealerRank && <span>Dealer: <b>{labelRank(dealerRank)}</b></span>}
          </div>
        )}
        {anteBonus > 0 && (
          <div className="mt-1 text-sm font-bold text-amber-200">Ante Bonus +{anteBonus.toLocaleString()}</div>
        )}
        <div className="mt-1 text-lg font-bold">
          {net > 0 ? (
            <span className="text-emerald-300">+{net.toLocaleString()} chips</span>
          ) : net < 0 ? (
            <span className="text-rose-300">{net.toLocaleString()} chips</span>
          ) : (
            <span className="text-slate-200">±0 chips</span>
          )}
        </div>
        <div className="text-xs text-slate-300 mt-1">Balance: {balance?.toLocaleString() ?? '—'}</div>
      </div>
    );
  })();

  const renderFair = () => (
    <div className="mt-6">
      <Button
        ref={refs.fair}
        variant="outline"
        size="sm"
        onClick={() => setShowFair((v) => !v)}
        onFocus={() => {
          if (phase === 'decision') setFocusDecision('fair');
          else if (phase === 'settled') setFocusSettle('fair');
        }}
        className={`transition-all ${focusRing(
          (phase === 'decision' && focusDecision === 'fair') ||
          (phase === 'settled' && focusSettle === 'fair')
        )}`}
      >
        {showFair ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
        Provably fair
      </Button>
      {showFair && (
        <div className="mt-3 p-4 rounded-lg bg-slate-900/70 border border-slate-700 text-xs text-slate-200 font-mono break-all space-y-1">
          {serverSeedHash && <div><span className="text-slate-400">serverSeedHash:</span> {serverSeedHash}</div>}
          {fair?.serverSeed && <div><span className="text-slate-400">serverSeed:</span> {fair.serverSeed}</div>}
          {fair?.clientSeed && <div><span className="text-slate-400">clientSeed:</span> {fair.clientSeed}</div>}
          {fair && typeof fair.nonce === 'number' && <div><span className="text-slate-400">nonce:</span> {fair.nonce}</div>}
          <div className="text-slate-400 pt-1">Verify: sha256(serverSeed) should equal the hash shown before the hand.</div>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="tv-scroll-container tv-safe text-white relative min-h-screen"
      style={{
        background:
          'radial-gradient(1200px 600px at 20% -10%, rgba(34,197,94,0.18), transparent 60%),' +
          'radial-gradient(900px 500px at 90% 10%, rgba(56,189,248,0.12), transparent 60%),' +
          'linear-gradient(135deg, #0a1628 0%, #0b1f1a 50%, #07111c 100%)',
      }}
    >
      <style>{`
        @keyframes ch-deal-in {
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
              else if (phase === 'decision') setFocusDecision('back');
              else setFocusSettle('back');
            }}
            variant="gold"
            size="lg"
            className={`transition-all duration-200 ${focusRing(
              (phase === 'bet' && focusBet === 'back') ||
              (phase === 'decision' && focusDecision === 'back') ||
              (phase === 'settled' && focusSettle === 'back')
            )}`}
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-3 rounded-xl border border-emerald-300/50 bg-gradient-to-br from-emerald-500/25 to-emerald-700/25 px-5 py-3 shadow-[0_8px_28px_-12px_rgba(16,185,129,0.6)]">
            <Coins className="w-6 h-6 text-amber-300" />
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] uppercase tracking-wider text-emerald-200/90 font-semibold">Play Chips</span>
              <span className="text-2xl font-extrabold text-white tabular-nums">
                {balance !== null ? balance.toLocaleString() : status === 'connecting' ? '…' : '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-emerald-500/15 border border-emerald-300/30 text-emerald-200 text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" /> Casino Hold'em
          </div>
          <h1 className="text-4xl md:text-5xl font-black drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
            Beat the dealer — five community cards
          </h1>
          <p className="text-slate-200/90 mt-2">Play Chips only — just for fun and bragging rights.</p>
        </div>

        {/* Felt Table */}
        <div
          className="relative rounded-[2rem] p-6 md:p-8 mb-6"
          style={{
            background:
              'radial-gradient(ellipse at top, #0f5132 0%, #064e3b 45%, #022c22 100%)',
            border: '3px solid rgba(251,191,36,0.55)',
            boxShadow:
              'inset 0 0 80px rgba(0,0,0,0.55), 0 25px 60px -20px rgba(0,0,0,0.8)',
          }}
        >
          {/* Dealer */}
          <div className="flex flex-col items-center mb-6">
            <div className="text-xs uppercase tracking-wider text-amber-100/80 mb-2 font-semibold">Dealer</div>
            <div className="flex gap-2">
              {[0, 1].map((i) => {
                const card = dealerHole[i];
                if (!card) return <CardSlot key={`d-${i}`} />;
                return (
                  <PlayingCard
                    key={`d-${i}`}
                    card={card}
                    faceDown={!dealerRevealed}
                    delay={i * 80}
                  />
                );
              })}
            </div>
            {phase === 'settled' && dealerRank && (
              <div className="mt-2 text-sm text-slate-100/90">
                <b>{labelRank(dealerRank)}</b>
                {!dealerQualified && (
                  <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-amber-500/25 border border-amber-300/50 text-amber-100 text-[10px] uppercase tracking-wider font-bold">
                    Didn't qualify
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Community */}
          <div className="flex flex-col items-center mb-6">
            <div className="text-xs uppercase tracking-wider text-amber-100/80 mb-2 font-semibold">Community</div>
            <div className="flex gap-2">
              {[0, 1, 2, 3, 4].map((i) => {
                const card = community[i];
                if (!card || i >= revealedCommunity) return <CardSlot key={`c-${i}`} />;
                return <PlayingCard key={`c-${i}`} card={card} delay={Math.max(0, (i - 2)) * 80} />;
              })}
            </div>
          </div>

          {/* Player */}
          <div className="flex flex-col items-center">
            <div className="text-xs uppercase tracking-wider text-amber-100/80 mb-2 font-semibold">You</div>
            <div className="flex gap-2">
              {[0, 1].map((i) => {
                const card = playerHole[i];
                if (!card) return <CardSlot key={`p-${i}`} />;
                return <PlayingCard key={`p-${i}`} card={card} delay={i * 80} />;
              })}
            </div>
            {phase === 'settled' && playerRank && (
              <div className="mt-2 text-sm text-slate-100/90"><b>{labelRank(playerRank)}</b></div>
            )}
          </div>
        </div>

        {/* Controls */}
        {phase === 'bet' && (
          <div className="rounded-xl border border-emerald-400/20 bg-slate-900/70 p-5">
            <div className="text-center text-sm uppercase tracking-wider text-emerald-200/90 mb-3 font-semibold">
              Choose your ante
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
              {ANTES.map((amt, idx) => {
                const active = ante === amt;
                const focused = focusBet === `chip-${idx}`;
                return (
                  <button
                    key={amt}
                    ref={refs.chips[idx]}
                    onClick={() => { setAnte(amt); setFocusBet(`chip-${idx}` as FocusBet); }}
                    onFocus={() => setFocusBet(`chip-${idx}` as FocusBet)}
                    className={`w-16 h-16 rounded-full border-2 font-extrabold text-white text-sm transition-all duration-200
                      ${active
                        ? 'bg-gradient-to-br from-amber-400 to-amber-600 border-amber-200'
                        : 'bg-gradient-to-br from-emerald-600 to-emerald-800 border-emerald-300/60'}
                      ${focusRing(focused)}`}
                  >
                    {amt}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-center">
              <Button
                ref={refs.deal}
                onClick={deal}
                onFocus={() => setFocusBet('deal')}
                disabled={busy || !user}
                variant="gold"
                size="lg"
                className={`transition-all ${focusRing(focusBet === 'deal')}`}
              >
                Deal — ante {ante}
              </Button>
            </div>
          </div>
        )}

        {phase === 'decision' && (
          <div className="rounded-xl border border-emerald-400/20 bg-slate-900/70 p-5">
            <div className="text-center text-sm uppercase tracking-wider text-emerald-200/90 mb-3 font-semibold">
              Choose your move — Call, Raise, or Fold
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {raiseOptions.map((opt, i) => {
                const canAfford = (balance ?? 0) >= opt.cost;
                const focused = focusDecision === `opt-${i}`;
                const isCall = opt.multiplier === 2;
                const label = isCall ? `CALL ${opt.multiplier}× (${opt.cost})` : `RAISE ${opt.multiplier}× (${opt.cost})`;
                return (
                  <Button
                    key={i}
                    ref={(el) => (optionRefs.current[i] = el)}
                    onClick={() => doCall(opt.multiplier)}
                    onFocus={() => setFocusDecision(`opt-${i}` as FocusDecision)}
                    disabled={busy || !canAfford}
                    size="lg"
                    className={`text-base font-black px-6 py-5 border-2 transition-all
                      ${isCall
                        ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-slate-900 border-amber-200'
                        : 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white border-emerald-300'}
                      ${(!canAfford || busy) ? 'opacity-50' : ''}
                      ${focusRing(focused)}`}
                  >
                    {label}
                  </Button>
                );
              })}
              <Button
                ref={refs.fold}
                onClick={doFold}
                onFocus={() => setFocusDecision('fold')}
                disabled={busy}
                size="lg"
                className={`text-base font-black px-6 py-5 bg-rose-600 hover:bg-rose-500 text-white border-2 border-rose-300/70 transition-all ${focusRing(focusDecision === 'fold')}`}
              >
                FOLD
              </Button>
            </div>
            {renderFair()}
          </div>
        )}

        {phase === 'reveal' && (
          <div className="text-center text-sm text-slate-300">Revealing…</div>
        )}

        {phase === 'settled' && (
          <div className="rounded-xl border border-emerald-400/20 bg-slate-900/70 p-5">
            {settleBanner}
            <div className="flex justify-center mt-5">
              <Button
                ref={refs.again}
                onClick={playAgain}
                onFocus={() => setFocusSettle('again')}
                variant="gold"
                size="lg"
                className={`transition-all ${focusRing(focusSettle === 'again')}`}
              >
                New Hand
              </Button>
            </div>
            {renderFair()}
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-lg border border-rose-400/50 bg-rose-900/40 text-rose-100 text-center text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default CasinoHoldem;
