import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Coins, Loader2, ChevronDown, ChevronUp, Minus, Plus, Sparkles, Gift, Star } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import p1img from '@/assets/slots/dreamstreams.png';
import p2img from '@/assets/slots/vibez.png';
import p3img from '@/assets/slots/snowmedia.png';
import p4img from '@/assets/slots/smc.png';

interface SlotsProps {
  onBack: () => void;
}

const BETS = [10, 25, 50, 100];

const SYMBOL_IMAGES: Record<string, string | undefined> = {
  p1: p1img,
  p2: p2img,
  p3: p3img,
  p4: p4img,
  wild: undefined,
  scatter: undefined,
};

const DEFAULT_GLYPHS: Record<string, string> = {
  p1: '💎',
  p2: '🔔',
  p3: '🎰',
  p4: '🍀',
  la: 'A',
  lk: 'K',
  lq: 'Q',
  lj: 'J',
  wild: '⭐',
  scatter: '🎁',
};
const REEL_KEYS = ['p1', 'p2', 'p3', 'p4', 'la', 'lk', 'lq', 'lj', 'wild', 'scatter'];

const ROWS = 3;
const REELS = 5;
const SYMBOL_HEIGHT = 80; // px per cell
// Fixed strip length used for every reel; finalOffset is derived from this constant.
const STRIP_LENGTH = 36;
// Extra random padding placed AFTER the 3 result symbols so the window never runs past the array end
// and reel 0's settle has visible downward travel.
const TAIL_PAD = 6;

interface FairInfo {
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

interface SpinResult {
  grid: string[][]; // [row][reel]
  wins: { symbol: string; count: number; ways: number; payout: number }[];
  scatterCount: number;
  totalPayout: number;
  net: number;
  bet: number;
  freeSpin: boolean;
  freeSpinsRemaining: number;
  multiplier: number;
  triggeredFreeSpins: number;
}

function SlotSymbol({ symbolKey, glyphs, size = 56 }: { symbolKey: string; glyphs: Record<string, string>; size?: number }) {
  // Guard against empty/unknown keys so a cell can never render blank
  const safeKey = (symbolKey && REEL_KEYS.includes(symbolKey)) ? symbolKey : 'p1';
  const img = SYMBOL_IMAGES[safeKey];
  if (img) {
    return <img src={img} alt={safeKey} style={{ width: size, height: size, objectFit: 'contain', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.45))' }} draggable={false} />;
  }
  if (safeKey === 'wild') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.5))' }}>
        <g stroke="#67e8f9" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <g key={a} transform={`rotate(${a} 32 32)`}>
              <line x1="32" y1="32" x2="32" y2="10" />
              <line x1="32" y1="14" x2="26" y2="20" />
              <line x1="32" y1="14" x2="38" y2="20" />
              <line x1="32" y1="22" x2="27" y2="27" />
              <line x1="32" y1="22" x2="37" y2="27" />
            </g>
          ))}
        </g>
        <circle cx="32" cy="32" r="10" fill="#fbbf24" />
        <text x="32" y="35.5" textAnchor="middle" fontSize="9" fontWeight="900" fill="#064e3b" style={{ fontFamily: 'system-ui, sans-serif' }}>WILD</text>
      </svg>
    );
  }
  if (safeKey === 'scatter') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.5))' }}>
        <ellipse cx="32" cy="52" rx="13" ry="4" fill="#a855f7" />
        <ellipse cx="32" cy="52" rx="13" ry="4" stroke="#c084fc" strokeWidth="1" />
        <path d="M19 51.5 C19 34 25 26 32 24 C39 26 45 34 45 51.5" fill="#e879f9" fillOpacity="0.22" stroke="#e879f9" strokeWidth="1.5" />
        <circle cx="32" cy="38" r="9" fill="#fdf4ff" fillOpacity="0.15" stroke="#e879f9" strokeWidth="1.5" />
        <g fill="#f0abfc">
          <path d="M32 30 L33.5 34.5 L38 34.5 L34.5 37.5 L35.5 42 L32 39.5 L28.5 42 L29.5 37.5 L26 34.5 L30.5 34.5 Z" />
        </g>
        <text x="32" y="54.5" textAnchor="middle" fontSize="6" fontWeight="900" fill="#fdf4ff" style={{ fontFamily: 'system-ui, sans-serif' }}>BONUS</text>
      </svg>
    );
  }
  const glyph = glyphs[safeKey] ?? DEFAULT_GLYPHS[safeKey] ?? '❓';
  const isLow = safeKey === 'la' || safeKey === 'lk' || safeKey === 'lq' || safeKey === 'lj';
  return (
    <span
      style={{
        fontSize: isLow ? Math.round(size * 0.75) : size,
        lineHeight: 1,
        fontWeight: 900,
        color: isLow ? '#fde68a' : undefined,
        textShadow: '0 4px 8px rgba(0,0,0,0.55)',
        letterSpacing: isLow ? '-1px' : 0,
      }}
    >
      {glyph}
    </span>
  );
}

// Build a deterministic-length strip. The first (STRIP_LENGTH - ROWS - TAIL_PAD) entries are random
// fillers, then exactly 3 result symbols (top→bottom), then TAIL_PAD random padding so the visible
// window has overshoot room and never runs past the array end.
function buildStrip(top: string, mid: string, bot: string): string[] {
  const out: string[] = [];
  const leading = STRIP_LENGTH - ROWS - TAIL_PAD;
  for (let i = 0; i < leading; i++) {
    out.push(REEL_KEYS[Math.floor(Math.random() * REEL_KEYS.length)]);
  }
  out.push(top, mid, bot);
  for (let i = 0; i < TAIL_PAD; i++) {
    out.push(REEL_KEYS[Math.floor(Math.random() * REEL_KEYS.length)]);
  }
  return out;
}

// Build a fully random strip (idle / placeholder spinning state).
function buildRandomStrip(): string[] {
  const out: string[] = [];
  for (let i = 0; i < STRIP_LENGTH; i++) out.push(REEL_KEYS[Math.floor(Math.random() * REEL_KEYS.length)]);
  return out;
}

type FocusId = 'back' | 'betMinus' | 'betPlus' | 'spin' | 'fair';

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const Slots = ({ onBack }: SlotsProps) => {
  const { user } = useAuth();
  const { balance, status } = useGameSocket();

  const [bet, setBet] = useState<number>(10);
  const [spinning, setSpinning] = useState(false);
  const [glyphs, setGlyphs] = useState<Record<string, string>>(DEFAULT_GLYPHS);

  // grid[reel] = vertical column of 3 symbols (top, middle, bottom)
  const initGrid = (): string[][] =>
    Array.from({ length: REELS }, () =>
      Array.from({ length: ROWS }, () => REEL_KEYS[Math.floor(Math.random() * REEL_KEYS.length)])
    );
  const [columns, setColumns] = useState<string[][]>(initGrid);
  // For each reel: scrolling strip & stopped flag
  const [reelStrips, setReelStrips] = useState<string[][]>(() =>
    Array.from({ length: REELS }, () => buildRandomStrip())
  );
  const [reelStopped, setReelStopped] = useState<boolean[]>(() => Array(REELS).fill(true));
  const inFlight = useRef(false);

  const [result, setResult] = useState<SpinResult | null>(null);
  const [winningCells, setWinningCells] = useState<boolean[][]>(() =>
    Array.from({ length: REELS }, () => Array(ROWS).fill(false))
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fair, setFair] = useState<FairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [freeBurst, setFreeBurst] = useState(false);

  // Free spins mode state mirrored from server acks
  const [freeSpinsRemaining, setFreeSpinsRemaining] = useState<number>(0);
  const [multiplier, setMultiplier] = useState<number>(1);

  // Fair verification
  const [fairValid, setFairValid] = useState<boolean | null>(null);

  const [focus, setFocus] = useState<FocusId>('spin');
  const spinBtnRef = useRef<HTMLButtonElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const minusBtnRef = useRef<HTMLButtonElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const fairBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    spinBtnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (focus === 'spin') spinBtnRef.current?.focus();
    else if (focus === 'back') backBtnRef.current?.focus();
    else if (focus === 'betMinus') minusBtnRef.current?.focus();
    else if (focus === 'betPlus') plusBtnRef.current?.focus();
    else if (focus === 'fair') fairBtnRef.current?.focus();
  }, [focus]);

  // Verify provably-fair when fair payload changes
  useEffect(() => {
    let cancelled = false;
    if (!fair?.serverSeed || !fair?.serverSeedHash) {
      setFairValid(null);
      return;
    }
    sha256Hex(fair.serverSeed).then((h) => {
      if (!cancelled) setFairValid(h.toLowerCase() === fair.serverSeedHash.toLowerCase());
    }).catch(() => { if (!cancelled) setFairValid(null); });
    return () => { cancelled = true; };
  }, [fair]);

  const inFreeSpins = freeSpinsRemaining > 0;
  const maxAffordableBet = balance ?? 0;
  const canBet = inFreeSpins || bet <= maxAffordableBet;

  const changeBet = useCallback(
    (dir: 1 | -1) => {
      if (spinning || inFreeSpins) return;
      const idx = BETS.indexOf(bet);
      let next = idx;
      if (dir === 1) next = Math.min(BETS.length - 1, idx + 1);
      else next = Math.max(0, idx - 1);
      setBet(BETS[next]);
    },
    [bet, spinning, inFreeSpins]
  );

  const handleSpin = useCallback(async () => {
    if (inFlight.current) return;
    if (spinning) return;
    if (!user) { setErrorMsg('Sign in to play.'); return; }
    if (balance === null && !inFreeSpins) { setErrorMsg('Loading chips… try again in a moment.'); return; }
    if (!inFreeSpins && !canBet) { setErrorMsg('Not enough chips — grab your Daily Spin'); return; }
    inFlight.current = true;

    setErrorMsg(null);
    setResult(null);
    setFair(null);
    setFairValid(null);
    setWinningCells(Array.from({ length: REELS }, () => Array(ROWS).fill(false)));
    setSpinning(true);
    setReelStopped(Array(REELS).fill(false));

    // Kick off scrolling strips with random placeholder content
    setReelStrips(Array.from({ length: REELS }, () => buildRandomStrip()));

    try {
      const clientSeed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.spinSlots(bet, clientSeed);

      if (resp?.ok === true && Array.isArray(resp.grid) && resp.grid.length === ROWS) {
        if (resp.symbols) setGlyphs({ ...DEFAULT_GLYPHS, ...resp.symbols });

        // Convert row-major grid[row][reel] -> column-major columns[reel][row]
        const grid: string[][] = resp.grid;
        const cols: string[][] = Array.from({ length: REELS }, (_, r) =>
          Array.from({ length: ROWS }, (_, row) => grid[row]?.[r] ?? REEL_KEYS[0])
        );

        // Build deterministic-length strips for each reel ending with this reel's 3 symbols
        // followed by TAIL_PAD random padding (so the visible window can never run past the end).
        setReelStrips(cols.map((col) => buildStrip(col[0], col[1], col[2])));

        const result: SpinResult = {
          grid,
          wins: Array.isArray(resp.wins) ? resp.wins : [],
          scatterCount: resp.scatterCount ?? 0,
          totalPayout: resp.totalPayout ?? 0,
          net: resp.net ?? 0,
          bet: resp.bet ?? bet,
          freeSpin: !!resp.freeSpin,
          freeSpinsRemaining: resp.freeSpinsRemaining ?? 0,
          multiplier: resp.multiplier ?? 1,
          triggeredFreeSpins: resp.triggeredFreeSpins ?? 0,
        };

        // Stagger stops left -> right
        const baseDelay = 900;
        const stagger = 220;
        for (let i = 0; i < REELS; i++) {
          const idx = i;
          setTimeout(() => {
            setReelStopped((prev) => {
              const n = [...prev];
              n[idx] = true;
              return n;
            });
            if (idx === REELS - 1) {
              setColumns(cols);
              setResult(result);
              setFreeSpinsRemaining(result.freeSpinsRemaining);
              setMultiplier(result.multiplier || 1);

              // Highlight winning cells — only if a win actually paid.
              const lit: boolean[][] = Array.from({ length: REELS }, () => Array(ROWS).fill(false));
              const paidWins = result.wins.filter((w) => w.payout > 0);
              const winningSymbols = new Set(paidWins.map((w) => w.symbol));
              if (result.totalPayout > 0 && winningSymbols.size > 0) {
                for (let r = 0; r < REELS; r++) {
                  for (let row = 0; row < ROWS; row++) {
                    const sym = cols[r][row];
                    if (winningSymbols.has(sym) || sym === 'wild') lit[r][row] = true;
                  }
                }
              }
              setWinningCells(lit);

              setSpinning(false);
              if (result.totalPayout > 0) {
                setCelebrate(true);
                setTimeout(() => setCelebrate(false), 2400);
              }
              if (result.triggeredFreeSpins > 0) {
                setFreeBurst(true);
                setTimeout(() => setFreeBurst(false), 2200);
              }
              if (resp.fair) setFair(resp.fair);
              inFlight.current = false;
            }
          }, baseDelay + idx * stagger);
        }
      } else if (resp?.ok === false && resp.error === 'insufficient_balance') {
        setSpinning(false);
        setReelStopped(Array(REELS).fill(true));
        setErrorMsg('Not enough chips — grab your Daily Spin');
        inFlight.current = false;
      } else if (resp?.ok === false && resp.error === 'invalid_bet') {
        setSpinning(false);
        setReelStopped(Array(REELS).fill(true));
        setErrorMsg('Invalid bet.');
        inFlight.current = false;
      } else if (resp?.error === 'game_disabled') {
        setSpinning(false);
        setReelStopped(Array(REELS).fill(true));
        setErrorMsg('Slots are temporarily disabled.');
        inFlight.current = false;
      } else {
        setSpinning(false);
        setReelStopped(Array(REELS).fill(true));
        setErrorMsg("Couldn't spin right now — try again.");
        inFlight.current = false;
      }
    } catch {
      setSpinning(false);
      setReelStopped(Array(REELS).fill(true));
      setErrorMsg("Couldn't spin right now — try again.");
      inFlight.current = false;
    }
  }, [spinning, user, canBet, bet, inFreeSpins, balance]);

  // D-pad
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        return; // let buttons handle
      }
      if (e.key === 'ArrowLeft') {
        if (focus === 'spin') { e.preventDefault(); setFocus('betPlus'); }
        else if (focus === 'betPlus') { e.preventDefault(); setFocus('betMinus'); }
        else if (focus === 'betMinus') { e.preventDefault(); changeBet(-1); }
        else if (focus === 'fair') { e.preventDefault(); setFocus('spin'); }
      } else if (e.key === 'ArrowRight') {
        if (focus === 'betMinus') { e.preventDefault(); setFocus('betPlus'); }
        else if (focus === 'betPlus') { e.preventDefault(); setFocus('spin'); }
        else if (focus === 'spin') { e.preventDefault(); setFocus('fair'); }
        else if (focus === 'back') { e.preventDefault(); setFocus('spin'); }
      } else if (e.key === 'ArrowDown') {
        if (focus === 'back') { e.preventDefault(); setFocus('betMinus'); }
        else if (focus === 'betMinus' || focus === 'betPlus' || focus === 'spin') { e.preventDefault(); setFocus('fair'); }
      } else if (e.key === 'ArrowUp') {
        if (focus === 'fair') { e.preventDefault(); setFocus('spin'); }
        else if (focus === 'spin' || focus === 'betMinus' || focus === 'betPlus') { e.preventDefault(); setFocus('back'); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focus, changeBet, onBack]);

  const focusRing = (id: FocusId) =>
    focus === id ? 'ring-4 ring-amber-300/80 scale-110 shadow-[0_0_24px_rgba(252,211,77,0.6)]' : '';

  const renderReel = (reelIndex: number) => {
    const strip = reelStrips[reelIndex] ?? [];
    const stopped = reelStopped[reelIndex];
    const totalHeight = strip.length * SYMBOL_HEIGHT;
    // Final offset so that the last 3 symbols of the strip fill the 3-row window
    const finalOffset = -(strip.length - ROWS) * SYMBOL_HEIGHT;
    const spinningOffset = -(totalHeight - SYMBOL_HEIGHT * ROWS);

    const transition = stopped
      ? `transform ${550}ms cubic-bezier(0.15, 0.85, 0.35, 1)`
      : `transform ${900 + reelIndex * 220}ms linear`;
    const translate = stopped ? finalOffset : spinningOffset;

    return (
      <div
        key={reelIndex}
        className="relative overflow-hidden rounded-lg border-2 border-amber-300/40 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 shadow-[inset_0_8px_18px_rgba(0,0,0,0.7),inset_0_-8px_18px_rgba(0,0,0,0.7)]"
        style={{ width: 96, height: SYMBOL_HEIGHT * ROWS }}
      >
        {/* depth shading */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-black/70 to-transparent z-10" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/70 to-transparent z-10" />

        {/* Winning cell highlights */}
        {stopped && winningCells[reelIndex]?.map((lit, row) => lit ? (
          <div
            key={`hl-${row}`}
            className="pointer-events-none absolute left-0 right-0 z-10 bg-amber-300/20 shadow-[inset_0_0_28px_rgba(251,191,36,0.65)] animate-pulse"
            style={{ top: row * SYMBOL_HEIGHT, height: SYMBOL_HEIGHT }}
          />
        ) : null)}

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
              style={{ height: SYMBOL_HEIGHT }}
            >
              <SlotSymbol symbolKey={key} glyphs={glyphs} size={48} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      className="tv-scroll-container tv-safe text-white relative min-h-screen"
      style={{
        background: inFreeSpins
          ? 'radial-gradient(1200px 600px at 50% -10%, rgba(168,85,247,0.28), transparent 60%),' +
            'radial-gradient(900px 500px at 90% 10%, rgba(236,72,153,0.18), transparent 60%),' +
            'linear-gradient(135deg, #16092b 0%, #0b1f1a 55%, #0a0420 100%)'
          : 'radial-gradient(1200px 600px at 20% -10%, rgba(34,197,94,0.18), transparent 60%),' +
            'radial-gradient(900px 500px at 90% 10%, rgba(56,189,248,0.12), transparent 60%),' +
            'linear-gradient(135deg, #0a1628 0%, #0b1f1a 50%, #07111c 100%)',
      }}
    >
      <style>{`
        @keyframes slot-coin {
          0% { opacity: 0; transform: translateY(0) scale(0.5); }
          30% { opacity: 1; transform: translateY(-30px) scale(1); }
          100% { opacity: 0; transform: translateY(-90px) scale(0.8); }
        }
        @keyframes free-pop {
          0% { opacity: 0; transform: scale(0.6); }
          40% { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0; transform: scale(1); }
        }
      `}</style>

      <div className="max-w-5xl mx-auto pb-16 px-4 pt-4">
        {/* Header */}
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

        <div className="text-center mb-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-emerald-500/15 border border-emerald-300/30 text-emerald-200 text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" /> Lucky Slots — 243 Ways
          </div>
          <h1 className="text-4xl md:text-5xl font-black drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
            Spin to win
          </h1>
          <p className="text-slate-200/90 mt-1 text-sm">
            <Star className="inline w-4 h-4 mb-0.5 text-amber-300" /> Wild substitutes • <Gift className="inline w-4 h-4 mb-0.5 text-pink-300" /> 3+ Scatter = Free Spins
          </p>
        </div>

        {/* Free spins banner */}
        {inFreeSpins && (
          <div className="mb-4 p-3 rounded-xl border border-fuchsia-300/50 bg-gradient-to-br from-fuchsia-600/30 to-purple-700/30 text-center font-bold text-fuchsia-100 shadow-[0_8px_28px_-12px_rgba(217,70,239,0.6)]">
            FREE SPINS: {freeSpinsRemaining} left • {multiplier}× wins
          </div>
        )}

        {/* Cabinet */}
        <div className="flex justify-center" style={{ perspective: '1400px' }}>
          <div
            className="relative rounded-3xl p-5 md:p-6 w-full max-w-4xl"
            style={{
              background: 'linear-gradient(180deg, #6b1d1d 0%, #3b0d0d 100%)',
              boxShadow: '0 30px 60px -20px rgba(0,0,0,0.8), inset 0 2px 0 rgba(255,255,255,0.15), inset 0 -8px 30px rgba(0,0,0,0.6)',
              border: '2px solid rgba(251,191,36,0.55)',
              transform: 'rotateX(3deg)',
              transformStyle: 'preserve-3d',
            }}
          >
            <div className="absolute -left-3 top-4 bottom-4 w-3 rounded-l-lg" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.6), rgba(0,0,0,0.1))' }} />
            <div className="absolute -right-3 top-4 bottom-4 w-3 rounded-r-lg" style={{ background: 'linear-gradient(270deg, rgba(0,0,0,0.6), rgba(0,0,0,0.1))' }} />

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

            {/* Reels frame */}
            <div
              className="relative rounded-xl p-3 md:p-4 mb-4"
              style={{
                background: 'linear-gradient(180deg, #1a0606, #0a0202)',
                boxShadow: 'inset 0 6px 20px rgba(0,0,0,0.9), 0 0 0 3px rgba(251,191,36,0.45)',
              }}
            >
              <div className="flex justify-center gap-2 md:gap-3">
                {Array.from({ length: REELS }, (_, i) => renderReel(i))}
              </div>

              {/* Win callout */}
              {celebrate && result && result.totalPayout > 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-20">
                  <div
                    className="px-5 py-2 rounded-xl font-black text-3xl text-amber-100"
                    style={{
                      background: 'linear-gradient(180deg, rgba(180,83,9,0.85), rgba(120,53,15,0.85))',
                      border: '2px solid rgba(251,191,36,0.8)',
                      boxShadow: '0 12px 30px rgba(0,0,0,0.6)',
                      animation: 'free-pop 2.2s ease-out both',
                    }}
                  >
                    +{result.totalPayout.toLocaleString()} chips
                  </div>
                  {/* coin burst */}
                  {Array.from({ length: 8 }).map((_, i) => (
                    <span
                      key={i}
                      className="absolute text-2xl"
                      style={{
                        left: `${30 + i * 5}%`,
                        bottom: '20%',
                        animation: `slot-coin 1.8s ease-out ${i * 80}ms both`,
                      }}
                    >🪙</span>
                  ))}
                </div>
              )}

              {freeBurst && result && result.triggeredFreeSpins > 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-20">
                  <div
                    className="px-6 py-3 rounded-2xl font-black text-3xl text-fuchsia-100 text-center"
                    style={{
                      background: 'linear-gradient(180deg, rgba(168,85,247,0.9), rgba(112,26,117,0.9))',
                      border: '2px solid rgba(232,121,249,0.9)',
                      boxShadow: '0 12px 30px rgba(0,0,0,0.6)',
                      animation: 'free-pop 2.2s ease-out both',
                    }}
                  >
                    FREE SPINS!
                    <div className="text-base mt-1 font-bold tracking-wider">+{result.triggeredFreeSpins} awarded</div>
                  </div>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="text-xs uppercase tracking-wider text-amber-200 font-bold">Bet</div>
                <Button
                  ref={minusBtnRef}
                  onFocus={() => setFocus('betMinus')}
                  onClick={() => changeBet(-1)}
                  disabled={spinning || inFreeSpins || BETS.indexOf(bet) === 0}
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
                  disabled={spinning || inFreeSpins || BETS.indexOf(bet) === BETS.length - 1}
                  size="icon"
                  className={`bg-slate-800 hover:bg-slate-700 border border-amber-400/50 text-amber-200 transition-all ${focusRing('betPlus')}`}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex flex-col items-end gap-1">
                <Button
                  ref={spinBtnRef}
                  onFocus={() => setFocus('spin')}
                  onClick={handleSpin}
                  disabled={spinning || !user || (!inFreeSpins && !canBet)}
                  className={`text-2xl font-black px-10 py-7 bg-gradient-to-br from-amber-400 to-amber-600 text-slate-900 border-2 border-amber-300 hover:from-amber-300 hover:to-amber-500 transition-all shadow-[0_10px_30px_-8px_rgba(251,191,36,0.6)] ${focusRing('spin')}`}
                >
                  {spinning ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-6 h-6 animate-spin" /> Spinning…
                    </span>
                  ) : inFreeSpins ? 'SPIN (FREE)' : 'SPIN'}
                </Button>
                {result && result.scatterCount > 0 && (
                  <div className="text-xs text-pink-200 font-semibold">🎁 Scatters: {result.scatterCount}</div>
                )}
              </div>
            </div>

            {!canBet && user && !inFreeSpins && (
              <p className="mt-3 text-center text-amber-200 font-semibold text-sm">
                Not enough chips — grab your Daily Spin.
              </p>
            )}
            {errorMsg && (
              <p className="mt-3 text-center text-rose-200 font-semibold text-sm">{errorMsg}</p>
            )}
          </div>
        </div>

        {/* Wins breakdown */}
        {result && result.wins.length > 0 && (
          <div className="mt-5 max-w-4xl mx-auto rounded-xl border border-emerald-400/30 bg-slate-900/70 p-4">
            <div className="text-sm uppercase tracking-wider text-emerald-200 font-bold mb-2">Wins this spin</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
              {result.wins.map((w, i) => (
                <div key={i} className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2 border border-emerald-400/20">
                  <SlotSymbol symbolKey={w.symbol} glyphs={glyphs} size={28} />
                  <div className="flex-1">
                    <div className="font-bold text-white">{w.count}×{w.symbol.toUpperCase()}</div>
                    <div className="text-xs text-slate-300">{w.ways} ways</div>
                  </div>
                  <div className="text-amber-200 font-extrabold">+{w.payout.toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-right text-amber-100 font-bold">
              Total: +{result.totalPayout.toLocaleString()} {result.freeSpin && multiplier > 1 ? `(${multiplier}×)` : ''}
            </div>
          </div>
        )}

        {/* Paytable */}
        <div className="mt-5 max-w-4xl mx-auto rounded-xl border border-amber-400/20 bg-slate-900/70 p-4">
          <div className="text-sm uppercase tracking-wider text-amber-200 font-bold mb-2">Paytable</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            {(['p1','p2','p3','p4'] as const).map((k) => (
              <div key={k} className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2 border border-amber-400/20">
                <SlotSymbol symbolKey={k} glyphs={glyphs} size={28} />
                <div className="font-bold text-white">{k.toUpperCase()}</div>
                <div className="ml-auto text-amber-200 text-xs">Top payer</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-300">
            A / K / Q / J pay less. <span className="text-amber-200 font-semibold">Wild</span> substitutes for all symbols except Scatter. 3+ <span className="text-pink-200 font-semibold">Scatters</span> trigger Free Spins.
          </div>
        </div>

        {/* Provably fair */}
        <div className="mt-5 max-w-4xl mx-auto">
          <Button
            ref={fairBtnRef}
            variant="outline"
            size="sm"
            onClick={() => setShowFair((v) => !v)}
            onFocus={() => setFocus('fair')}
            className={`transition-all ${focusRing('fair')}`}
          >
            {showFair ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
            Provably fair
          </Button>
          {showFair && (
            <div className="mt-3 p-4 rounded-lg bg-slate-900/70 border border-slate-700 text-xs text-slate-200 font-mono break-all space-y-1">
              {fair ? (
                <>
                  <div><span className="text-slate-400">serverSeedHash:</span> {fair.serverSeedHash}</div>
                  <div><span className="text-slate-400">serverSeed:</span> {fair.serverSeed}</div>
                  <div><span className="text-slate-400">clientSeed:</span> {fair.clientSeed}</div>
                  <div><span className="text-slate-400">nonce:</span> {fair.nonce}</div>
                  <div className="pt-1">
                    {fairValid === true && <span className="text-emerald-300 font-bold">✓ sha256(serverSeed) matches the hash</span>}
                    {fairValid === false && <span className="text-rose-300 font-bold">✗ Hash mismatch!</span>}
                    {fairValid === null && <span className="text-slate-400">Verifying…</span>}
                  </div>
                </>
              ) : (
                <div className="text-slate-400">Spin to reveal seed details.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Slots;
