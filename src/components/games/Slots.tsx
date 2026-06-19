import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Coins, Loader2, ChevronDown, ChevronUp, Minus, Plus, Sparkles } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';

interface SlotsProps {
  onBack: () => void;
}

const BETS = [10, 25, 50, 100];
const DEFAULT_SYMBOLS: Record<string, string> = {
  cherry: '🍒',
  lemon: '🍋',
  bell: '🔔',
  star: '⭐',
  seven: '7️⃣',
};
const REEL_KEYS = ['cherry', 'lemon', 'bell', 'star', 'seven'];

interface FairInfo {
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

// Build a long strip of random symbols for the reel animation
function buildStrip(finalKey: string, length = 40): string[] {
  const out: string[] = [];
  for (let i = 0; i < length - 1; i++) {
    out.push(REEL_KEYS[Math.floor(Math.random() * REEL_KEYS.length)]);
  }
  out.push(finalKey);
  return out;
}

// Focus targets
type FocusId = 'back' | 'betMinus' | 'betPlus' | 'spin';

const Slots = ({ onBack }: SlotsProps) => {
  const { user } = useAuth();
  const { balance, status } = useGameSocket();

  const [bet, setBet] = useState<number>(10);
  const [spinning, setSpinning] = useState(false);
  const [reels, setReels] = useState<string[]>(['cherry', 'lemon', 'bell']);
  const [reelStrips, setReelStrips] = useState<string[][]>([
    buildStrip('cherry'),
    buildStrip('lemon'),
    buildStrip('bell'),
  ]);
  const [reelStopped, setReelStopped] = useState<boolean[]>([true, true, true]);
  const [symbols, setSymbols] = useState<Record<string, string>>(DEFAULT_SYMBOLS);
  const [lastResult, setLastResult] = useState<{
    payout: number;
    multiplier: number;
    win: boolean;
    line: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fair, setFair] = useState<FairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [focus, setFocus] = useState<FocusId>('spin');
  const spinBtnRef = useRef<HTMLButtonElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const minusBtnRef = useRef<HTMLButtonElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);

  const SYMBOL_HEIGHT = 96; // px per symbol cell

  useEffect(() => {
    // initial focus on SPIN
    spinBtnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (focus === 'spin') spinBtnRef.current?.focus();
    else if (focus === 'back') backBtnRef.current?.focus();
    else if (focus === 'betMinus') minusBtnRef.current?.focus();
    else if (focus === 'betPlus') plusBtnRef.current?.focus();
  }, [focus]);

  const maxAffordableBet = balance ?? 0;
  const canBet = bet <= maxAffordableBet;

  const changeBet = useCallback(
    (dir: 1 | -1) => {
      if (spinning) return;
      const idx = BETS.indexOf(bet);
      let next = idx;
      if (dir === 1) {
        for (let i = idx + 1; i < BETS.length; i++) {
          if (BETS[i] <= (balance ?? 0)) { next = i; break; }
        }
        // even if unaffordable, allow selecting next so user sees the option, but cap at last
        if (next === idx && idx < BETS.length - 1) next = idx + 1;
      } else {
        next = Math.max(0, idx - 1);
      }
      setBet(BETS[next]);
    },
    [bet, balance, spinning]
  );

  const handleSpin = useCallback(async () => {
    if (spinning) return;
    if (!user) {
      setErrorMsg('Sign in to play.');
      return;
    }
    if (!canBet) {
      setErrorMsg('Not enough chips — grab your Daily Spin');
      return;
    }
    setErrorMsg(null);
    setLastResult(null);
    setFair(null);
    setSpinning(true);
    setReelStopped([false, false, false]);

    // kick off scrolling strips immediately with placeholder finals
    setReelStrips([
      buildStrip(REEL_KEYS[Math.floor(Math.random() * REEL_KEYS.length)]),
      buildStrip(REEL_KEYS[Math.floor(Math.random() * REEL_KEYS.length)]),
      buildStrip(REEL_KEYS[Math.floor(Math.random() * REEL_KEYS.length)]),
    ]);

    try {
      const clientSeed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.spinSlots(bet, clientSeed);

      if (resp?.ok === true && Array.isArray(resp.reels) && resp.reels.length === 3) {
        if (resp.symbols) setSymbols({ ...DEFAULT_SYMBOLS, ...resp.symbols });
        const finalReels: string[] = resp.reels;
        setReelStrips([
          buildStrip(finalReels[0]),
          buildStrip(finalReels[1]),
          buildStrip(finalReels[2]),
        ]);

        // Stagger stops left → right
        const stagger = [1800, 2400, 3000];
        stagger.forEach((delay, i) => {
          setTimeout(() => {
            setReelStopped((prev) => {
              const next = [...prev];
              next[i] = true;
              return next;
            });
            if (i === 2) {
              setReels(finalReels);
              setSpinning(false);
              setLastResult({
                payout: resp.payout ?? 0,
                multiplier: resp.multiplier ?? 0,
                win: !!resp.win,
                line: resp.line ?? '',
              });
              if (resp.win) {
                setCelebrate(true);
                setTimeout(() => setCelebrate(false), 2500);
              }
              if (resp.fair) setFair(resp.fair);
            }
          }, delay);
        });
      } else if (resp?.ok === false && resp.error === 'insufficient_balance') {
        setSpinning(false);
        setReelStopped([true, true, true]);
        setErrorMsg('Not enough chips — grab your Daily Spin');
      } else if (resp?.ok === false && resp.error === 'invalid_bet') {
        setSpinning(false);
        setReelStopped([true, true, true]);
        setErrorMsg('Invalid bet.');
      } else if (resp?.error === 'game_disabled') {
        setSpinning(false);
        setReelStopped([true, true, true]);
        setErrorMsg('Slots are temporarily disabled.');
      } else {
        setSpinning(false);
        setReelStopped([true, true, true]);
        setErrorMsg("Couldn't spin right now — try again.");
      }
    } catch {
      setSpinning(false);
      setReelStopped([true, true, true]);
      setErrorMsg("Couldn't spin right now — try again.");
    }
  }, [spinning, user, canBet, bet]);

  // D-pad / keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) {
        e.preventDefault();
        onBack();
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (focus === 'spin' || focus === 'betPlus') {
          e.preventDefault();
          if (focus === 'betPlus') setFocus('betMinus');
          else setFocus('betMinus');
        } else if (focus === 'betMinus') {
          changeBet(-1);
          e.preventDefault();
        }
      } else if (e.key === 'ArrowRight') {
        if (focus === 'betMinus') {
          e.preventDefault();
          setFocus('betPlus');
        } else if (focus === 'betPlus') {
          changeBet(1);
          e.preventDefault();
        } else if (focus === 'back') {
          e.preventDefault();
          setFocus('spin');
        }
      } else if (e.key === 'ArrowDown') {
        if (focus === 'back' || focus === 'betMinus' || focus === 'betPlus') {
          e.preventDefault();
          setFocus('spin');
        }
      } else if (e.key === 'ArrowUp') {
        if (focus === 'spin') {
          e.preventDefault();
          setFocus('betMinus');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focus, changeBet, onBack]);

  const renderReel = (reelIndex: number) => {
    const strip = reelStrips[reelIndex];
    const stopped = reelStopped[reelIndex];
    // When stopped, the final symbol is at the bottom of the strip; show it centered.
    // While spinning, scroll the entire strip past the window for a fast blur.
    const totalHeight = strip.length * SYMBOL_HEIGHT;
    const finalOffset = -(strip.length - 1) * SYMBOL_HEIGHT + SYMBOL_HEIGHT; // center final
    const spinningOffset = -(totalHeight - SYMBOL_HEIGHT * 3);

    const transition = stopped
      ? `transform ${600}ms cubic-bezier(0.15, 0.85, 0.35, 1)`
      : `transform ${2800 + reelIndex * 600}ms linear`;

    const translate = stopped ? finalOffset : spinningOffset;

    return (
      <div
        key={reelIndex}
        className="relative overflow-hidden rounded-lg border-2 border-amber-300/50 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 shadow-[inset_0_8px_18px_rgba(0,0,0,0.7),inset_0_-8px_18px_rgba(0,0,0,0.7)]"
        style={{ width: 110, height: SYMBOL_HEIGHT * 3 }}
      >
        {/* Top/bottom shading for 2.5D depth */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/80 to-transparent z-10" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/80 to-transparent z-10" />
        {/* Payline highlight (center row) */}
        <div
          className={`pointer-events-none absolute left-0 right-0 z-10 transition-all duration-300 ${
            lastResult?.win && reelStopped.every(Boolean)
              ? 'bg-amber-300/15 shadow-[inset_0_0_30px_rgba(251,191,36,0.55)]'
              : ''
          }`}
          style={{ top: SYMBOL_HEIGHT, height: SYMBOL_HEIGHT }}
        />
        <div
          style={{
            transform: `translateY(${translate}px)`,
            transition,
            willChange: 'transform',
            filter: stopped ? 'none' : 'blur(1.5px)',
            opacity: stopped ? 1 : 0.92,
          }}
        >
          {strip.map((key, i) => (
            <div
              key={i}
              className="flex items-center justify-center select-none"
              style={{ height: SYMBOL_HEIGHT, fontSize: 56, lineHeight: 1 }}
            >
              <span style={{ textShadow: '0 4px 8px rgba(0,0,0,0.5)' }}>
                {symbols[key] || '❓'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const focusRing = (id: FocusId) =>
    focus === id
      ? 'ring-4 ring-amber-300/80 scale-110 shadow-[0_0_24px_rgba(252,211,77,0.6)]'
      : '';

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
      <div className="max-w-5xl mx-auto pb-16 px-4 pt-4">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <Button
            ref={backBtnRef}
            onClick={onBack}
            onFocus={() => setFocus('back')}
            variant="gold"
            size="lg"
            className={`transition-all duration-200 ${focusRing('back')}`}
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
            <Sparkles className="w-3.5 h-3.5" /> Lucky Slots
          </div>
          <h1 className="text-4xl md:text-5xl font-black drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
            Pull the lever
          </h1>
          <p className="text-slate-200/90 mt-2">Three of a kind on the center row pays out.</p>
        </div>

        {/* Cabinet */}
        <div className="flex justify-center" style={{ perspective: '1400px' }}>
          <div
            className="relative rounded-3xl p-6 md:p-8"
            style={{
              background:
                'linear-gradient(180deg, #6b1d1d 0%, #3b0d0d 100%)',
              boxShadow:
                '0 30px 60px -20px rgba(0,0,0,0.8), inset 0 2px 0 rgba(255,255,255,0.15), inset 0 -8px 30px rgba(0,0,0,0.6)',
              border: '2px solid rgba(251,191,36,0.55)',
              transform: 'rotateX(4deg)',
              transformStyle: 'preserve-3d',
            }}
          >
            {/* Side depth */}
            <div
              className="absolute -left-3 top-4 bottom-4 w-3 rounded-l-lg"
              style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.6), rgba(0,0,0,0.1))' }}
            />
            <div
              className="absolute -right-3 top-4 bottom-4 w-3 rounded-r-lg"
              style={{ background: 'linear-gradient(270deg, rgba(0,0,0,0.6), rgba(0,0,0,0.1))' }}
            />

            {/* Marquee */}
            <div className="text-center mb-4">
              <div
                className="inline-block px-6 py-2 rounded-lg font-black text-xl tracking-widest"
                style={{
                  background: 'linear-gradient(180deg, #fde68a, #b45309)',
                  color: '#3b1402',
                  border: '2px solid #fbbf24',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.6)',
                  textShadow: '0 1px 0 rgba(255,255,255,0.5)',
                }}
              >
                LUCKY SLOTS
              </div>
            </div>

            {/* Reel window frame */}
            <div
              className="rounded-xl p-4 mb-4"
              style={{
                background: 'linear-gradient(180deg, #1a0606, #0a0202)',
                boxShadow: 'inset 0 6px 20px rgba(0,0,0,0.9), 0 0 0 3px rgba(251,191,36,0.45)',
              }}
            >
              <div className="flex justify-center gap-3">
                {[0, 1, 2].map((i) => renderReel(i))}
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {/* Bet selector */}
              <div className="flex items-center gap-3">
                <div className="text-xs uppercase tracking-wider text-amber-200 font-bold">Bet</div>
                <Button
                  ref={minusBtnRef}
                  onFocus={() => setFocus('betMinus')}
                  onClick={() => changeBet(-1)}
                  disabled={spinning || BETS.indexOf(bet) === 0}
                  size="icon"
                  className={`bg-slate-800 hover:bg-slate-700 border border-amber-400/50 text-amber-200 transition-all ${focusRing('betMinus')}`}
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <div
                  className="min-w-[80px] text-center px-4 py-2 rounded-lg font-black text-2xl tabular-nums"
                  style={{
                    background: 'linear-gradient(180deg, #0a0202, #1a0606)',
                    border: '2px solid rgba(251,191,36,0.6)',
                    color: '#fde68a',
                    boxShadow: 'inset 0 4px 10px rgba(0,0,0,0.6)',
                  }}
                >
                  {bet}
                </div>
                <Button
                  ref={plusBtnRef}
                  onFocus={() => setFocus('betPlus')}
                  onClick={() => changeBet(1)}
                  disabled={spinning || BETS.indexOf(bet) === BETS.length - 1}
                  size="icon"
                  className={`bg-slate-800 hover:bg-slate-700 border border-amber-400/50 text-amber-200 transition-all ${focusRing('betPlus')}`}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {/* SPIN button (lever-ish) */}
              <Button
                ref={spinBtnRef}
                onFocus={() => setFocus('spin')}
                onClick={handleSpin}
                disabled={spinning || !user || !canBet}
                className={`text-2xl font-black px-10 py-7 bg-gradient-to-br from-amber-400 to-amber-600 text-slate-900 border-2 border-amber-300 hover:from-amber-300 hover:to-amber-500 transition-all shadow-[0_10px_30px_-8px_rgba(251,191,36,0.6)] ${focusRing('spin')}`}
              >
                {spinning ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin" /> Spinning…
                  </span>
                ) : (
                  'SPIN'
                )}
              </Button>
            </div>

            {!canBet && user && (
              <p className="mt-3 text-center text-amber-200 font-semibold text-sm">
                Not enough chips — grab your Daily Spin
              </p>
            )}
            {!user && (
              <p className="mt-3 text-center text-amber-200 font-semibold text-sm">
                Sign in to play.
              </p>
            )}
          </div>
        </div>

        {/* Result / errors */}
        <div className="max-w-md mx-auto mt-6 text-center">
          {errorMsg && <p className="mb-3 text-amber-200 font-semibold">{errorMsg}</p>}
          {lastResult && (
            <div
              className={`p-5 rounded-xl border ${
                lastResult.win
                  ? lastResult.multiplier >= 100
                    ? 'bg-gradient-to-br from-amber-400/30 to-amber-700/30 border-amber-300/60'
                    : 'bg-emerald-500/15 border-emerald-300/40'
                  : 'bg-slate-900/60 border-slate-700/60'
              } ${celebrate ? 'animate-scale-in' : ''}`}
              style={
                celebrate
                  ? { boxShadow: '0 0 60px 8px rgba(251,191,36,0.55)' }
                  : undefined
              }
            >
              {lastResult.win ? (
                <>
                  <div className="text-sm uppercase tracking-wider font-semibold text-amber-200">
                    {lastResult.multiplier >= 100 ? '🎉 JACKPOT!' : `${lastResult.line} • ${lastResult.multiplier}×`}
                  </div>
                  <div className="text-4xl font-black text-white mt-1">
                    +{lastResult.payout.toLocaleString()} chips
                  </div>
                </>
              ) : (
                <div className="text-slate-300 font-semibold">No win — spin again!</div>
              )}
            </div>
          )}
        </div>

        {/* Paytable */}
        <Card className="mt-8 max-w-md mx-auto p-5 bg-slate-900/70 border-emerald-400/30">
          <div className="text-xs uppercase tracking-wider text-emerald-200 font-bold mb-3">Paytable</div>
          <ul className="space-y-1.5 text-sm text-slate-100 font-medium">
            <li className="flex justify-between"><span>7️⃣ 7️⃣ 7️⃣</span><span className="text-amber-300 font-bold">100×</span></li>
            <li className="flex justify-between"><span>⭐ ⭐ ⭐</span><span className="text-amber-300 font-bold">30×</span></li>
            <li className="flex justify-between"><span>🔔 🔔 🔔</span><span className="text-amber-300 font-bold">14×</span></li>
            <li className="flex justify-between"><span>🍋 🍋 🍋</span><span className="text-amber-300 font-bold">7×</span></li>
            <li className="flex justify-between"><span>🍒 🍒 🍒</span><span className="text-amber-300 font-bold">4×</span></li>
            <li className="flex justify-between"><span>Any two 🍒</span><span className="text-amber-300 font-bold">2×</span></li>
          </ul>
        </Card>

        {fair && (
          <div className="max-w-md mx-auto mt-6 text-left">
            <button
              onClick={() => setShowFair((s) => !s)}
              className="text-xs text-slate-300 hover:text-white inline-flex items-center gap-1"
            >
              Provably fair {showFair ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showFair && (
              <div className="mt-2 p-3 rounded-lg bg-slate-950/70 border border-slate-700/60 text-[11px] text-slate-300 font-mono break-all space-y-1">
                <div><span className="text-slate-400">serverSeedHash:</span> {fair.serverSeedHash}</div>
                <div><span className="text-slate-400">serverSeed:</span> {fair.serverSeed}</div>
                <div><span className="text-slate-400">clientSeed:</span> {fair.clientSeed}</div>
                <div><span className="text-slate-400">nonce:</span> {fair.nonce}</div>
                <div className="text-slate-400 pt-1">Verify: SHA-256(serverSeed) must equal the hash shown before the spin.</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Slots;
