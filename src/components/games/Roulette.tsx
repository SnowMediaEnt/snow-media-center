import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Coins, Loader2, ChevronDown, ChevronUp, Sparkles, Check, Trash2 } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';

interface RouletteProps {
  onBack: () => void;
}

type WheelKind = 'european' | 'american';
type SlotNum = number | '00';

const DENOMS = [10, 25, 50, 100];
const RED_NUMS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const isRed = (n: number) => RED_NUMS.has(n);
const colorOf = (n: SlotNum): 'red' | 'black' | 'green' => {
  if (n === 0 || n === '00') return 'green';
  return isRed(n as number) ? 'red' : 'black';
};

const EU_ORDER: SlotNum[] = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const AM_ORDER: SlotNum[] = [0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1,'00',27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2];

type BetType =
  | 'straight' | 'column' | 'dozen'
  | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high';
interface Bet { type: BetType; selection: any; amount: number }
interface PlacedChip { type: BetType; selection: any; key: string; amount: number }
interface FairInfo { serverSeedHash: string; serverSeed: string; clientSeed: string; nonce: number }
interface SpinResult {
  number: SlotNum;
  color: 'red' | 'black' | 'green';
  bets: { type: BetType; selection: any; amount: number; won: boolean; payout: number }[];
  totalBet: number;
  totalPayout: number;
  net: number;
}

const keyFor = (type: BetType, selection: any) =>
  `${type}:${selection === null || selection === undefined ? '_' : Array.isArray(selection) ? selection.join(',') : String(selection)}`;

interface FocusItem { id: string; el: HTMLElement }
const focusRing = 'ring-4 ring-amber-300/90 shadow-[0_0_22px_rgba(252,211,77,0.7)] z-10';

const Roulette = ({ onBack }: RouletteProps) => {
  const { user } = useAuth();
  const { balance, status } = useGameSocket();

  const [wheel, setWheel] = useState<WheelKind>('european');
  const [denom, setDenom] = useState<number>(10);
  const [chips, setChips] = useState<PlacedChip[]>([]);
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // (client seed is auto-generated per spin; not user-editable)
  const [serverSeedHash, setServerSeedHash] = useState<string>('');
  const [result, setResult] = useState<SpinResult | null>(null);
  const [winKeys, setWinKeys] = useState<Set<string>>(new Set());
  const [celebrate, setCelebrate] = useState(false);
  const [fair, setFair] = useState<FairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  const [verifyOk, setVerifyOk] = useState<boolean | null>(null);

  // Wheel animation
  const [wheelRotation, setWheelRotation] = useState(0);
  const [ballRotation, setBallRotation] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wheelOrder = wheel === 'american' ? AM_ORDER : EU_ORDER;

  // Focus
  const focusItems = useRef<Map<string, HTMLElement>>(new Map());
  const [focusId, setFocusId] = useState<string>('spin');

  const registerFocus = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) focusItems.current.set(id, el);
    else focusItems.current.delete(id);
  }, []);

  // Apply focus
  useEffect(() => {
    const el = focusItems.current.get(focusId);
    if (el && document.activeElement !== el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [focusId]);

  // Spatial nav
  const moveFocus = useCallback((dir: 'up' | 'down' | 'left' | 'right') => {
    const current = focusItems.current.get(focusId);
    if (!current) return;
    const c = current.getBoundingClientRect();
    const cx = c.left + c.width / 2;
    const cy = c.top + c.height / 2;
    let best: { id: string; score: number } | null = null;
    focusItems.current.forEach((el, id) => {
      if (id === focusId) return;
      if ((el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      const rx = r.left + r.width / 2;
      const ry = r.top + r.height / 2;
      const dx = rx - cx;
      const dy = ry - cy;
      let dirOk = false;
      let primary = 0, secondary = 0;
      if (dir === 'right') { dirOk = dx > 4; primary = dx; secondary = Math.abs(dy); }
      else if (dir === 'left') { dirOk = dx < -4; primary = -dx; secondary = Math.abs(dy); }
      else if (dir === 'down') { dirOk = dy > 4; primary = dy; secondary = Math.abs(dx); }
      else { dirOk = dy < -4; primary = -dy; secondary = Math.abs(dx); }
      if (!dirOk) return;
      // Bias strongly to alignment in the perpendicular axis
      const score = primary + secondary * 3;
      if (!best || score < best.score) best = { id, score };
    });
    if (best) setFocusId(best.id);
  }, [focusId]);

  // Place a chip on focused cell
  const placeChipOn = (type: BetType, selection: any) => {
    if (spinning) return;
    const k = keyFor(type, selection);
    setChips((prev) => {
      const existing = prev.find((c) => c.key === k);
      if (existing) {
        return prev.map((c) => c.key === k ? { ...c, amount: c.amount + denom } : c);
      }
      return [...prev, { type, selection, key: k, amount: denom }];
    });
    // Clear settle visuals when re-betting
    setResult(null);
    setWinKeys(new Set());
    setFair(null);
  };

  const clearBets = () => {
    if (spinning) return;
    setChips([]);
    setResult(null);
    setWinKeys(new Set());
  };

  const totalBet = chips.reduce((s, c) => s + c.amount, 0);
  const canSpin = !spinning && !busy && totalBet > 0 && (balance ?? 0) >= totalBet && !!user;

  // Build bets[] (collapsed already by chip storage)
  const buildBets = (): Bet[] =>
    chips.map((c) => ({ type: c.type, selection: c.selection, amount: c.amount }));

  // Error handling
  const handleErr = (err: string, detail?: string) => {
    if (err === 'insufficient_balance') setError('Not enough chips for this bet.');
    else if (err === 'invalid_bet') setError(`Invalid bet${detail ? `: ${detail}` : '.'}`);
    else if (err === 'game_disabled') setError('Roulette is temporarily disabled.');
    else if (err === 'spin_failed') setError("Couldn't spin — try again.");
    else setError("Something went wrong.");
    setTimeout(() => setError(null), 3500);
  };

  // Compute landing rotation for a number
  const computeTarget = (num: SlotNum, prevRot: number) => {
    const order = wheel === 'american' ? AM_ORDER : EU_ORDER;
    const idx = order.findIndex((v) => v === num);
    if (idx < 0) return prevRot;
    const perPocket = 360 / order.length;
    // Pocket idx should align under top pointer (-90deg in canvas = top).
    // We draw pocket i centered at angle = i * perPocket starting from top.
    // To put pocket i at top: rotate wheel by -i * perPocket.
    const target = -idx * perPocket;
    // add full spins
    const spinsBase = 6 * 360;
    const cur = prevRot % 360;
    let delta = (target - cur) % 360;
    if (delta > 0) delta -= 360;
    return prevRot + spinsBase + delta;
  };

  const doSpin = useCallback(async () => {
    if (!canSpin) return;
    setBusy(true);
    setSpinning(true);
    setError(null);
    setResult(null);
    setWinKeys(new Set());
    setFair(null);
    setShowFair(false);
    setVerifyOk(null);
    setServerSeedHash('');

    // Start a perpetual spin animation
    const startRot = wheelRotation;
    const animStart = performance.now();
    let raf = 0;
    let resolved = false;
    let landed = false;

    const animateIdle = (t: number) => {
      if (landed) return;
      const elapsed = t - animStart;
      setWheelRotation(startRot + elapsed * 0.6);
      setBallRotation(-elapsed * 0.9);
      if (!resolved) raf = requestAnimationFrame(animateIdle);
    };
    raf = requestAnimationFrame(animateIdle);

    try {
      const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp: any = await gameSocket.spinRoulette({
        bets: buildBets(),
        wheel,
        clientSeed: seed,
      });
      resolved = true;

      if (!resp?.ok) {
        landed = true;
        cancelAnimationFrame(raf);
        setSpinning(false);
        setBusy(false);
        handleErr(resp?.error ?? 'spin_failed', resp?.detail);
        return;
      }

      // Land animation
      const targetRot = computeTarget(resp.result.number as SlotNum, wheelRotation);
      const landStart = performance.now();
      const dur = 4200;
      const fromRot = wheelRotation;
      const fromBall = ballRotation;
      // Ball ends at top pointer; rotates a few times opposite-ish
      const ballTarget = fromBall - 360 * 4;
      const land = (t: number) => {
        const p = Math.min(1, (t - landStart) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        setWheelRotation(fromRot + (targetRot - fromRot) * eased);
        setBallRotation(fromBall + (ballTarget - fromBall) * eased);
        if (p < 1) requestAnimationFrame(land);
        else {
          landed = true;
          // Reveal result
          const sr: SpinResult = {
            number: resp.result.number,
            color: resp.result.color,
            bets: resp.bets ?? [],
            totalBet: resp.totalBet ?? totalBet,
            totalPayout: resp.totalPayout ?? 0,
            net: resp.net ?? 0,
          };
          setResult(sr);
          const wins = new Set<string>();
          sr.bets.forEach((b) => { if (b.won) wins.add(keyFor(b.type, b.selection)); });
          setWinKeys(wins);
          if (sr.net > 0) {
            setCelebrate(true);
            setTimeout(() => setCelebrate(false), 2400);
          }
          if (resp.fair) {
            setFair(resp.fair);
            setServerSeedHash(resp.fair.serverSeedHash);
          }
          setSpinning(false);
          setBusy(false);
        }
      };
      requestAnimationFrame(land);
    } catch {
      cancelAnimationFrame(raf);
      setSpinning(false);
      setBusy(false);
      setError("Couldn't reach the table — try again.");
    }
  }, [canSpin, wheelRotation, ballRotation, wheel, chips, totalBet]);

  // D-pad handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) {
        e.preventDefault();
        onBack();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const el = focusItems.current.get(focusId) as HTMLButtonElement | undefined;
        if (el && !el.disabled) { e.preventDefault(); el.click(); }
        return;
      }
      if (e.key === 'ArrowRight') { e.preventDefault(); moveFocus('right'); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); moveFocus('left'); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus('down'); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus('up'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusId, moveFocus, onBack]);

  // Initial focus
  useEffect(() => {
    setFocusId('spin');
  }, []);

  // Draw wheel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const order = wheel === 'american' ? AM_ORDER : EU_ORDER;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 360;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2, cy = size / 2;
    const rOuter = size / 2 - 6;
    const rInner = rOuter - 44;
    const n = order.length;
    const seg = (Math.PI * 2) / n;
    // Pocket 0 centered at top: top is -PI/2 in canvas space.
    const startOffset = -Math.PI / 2 - seg / 2;
    for (let i = 0; i < n; i++) {
      const a0 = startOffset + i * seg;
      const a1 = a0 + seg;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0) * rInner, cy + Math.sin(a0) * rInner);
      ctx.arc(cx, cy, rOuter, a0, a1);
      ctx.arc(cx, cy, rInner, a1, a0, true);
      ctx.closePath();
      const col = colorOf(order[i]);
      ctx.fillStyle = col === 'red' ? '#b91c1c' : col === 'black' ? '#0a0a0a' : '#15803d';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(251,191,36,0.4)';
      ctx.stroke();
      // Label
      const mid = a0 + seg / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * (rOuter - 16), cy + Math.sin(mid) * (rOuter - 16));
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '700 11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(order[i]), 0, 0);
      ctx.restore();
    }
    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fbbf24';
    ctx.stroke();
    // Inner hub
    ctx.beginPath();
    ctx.arc(cx, cy, rInner - 6, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(cx - 10, cy - 10, 4, cx, cy, rInner);
    grad.addColorStop(0, '#fde68a');
    grad.addColorStop(1, '#78350f');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [wheel]);

  // SHA-256 verify
  useEffect(() => {
    if (!showFair || !fair) return;
    let cancelled = false;
    (async () => {
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fair.serverSeed));
        const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
        if (!cancelled) setVerifyOk(hex.toLowerCase() === (fair.serverSeedHash || '').toLowerCase());
      } catch { if (!cancelled) setVerifyOk(false); }
    })();
    return () => { cancelled = true; };
  }, [showFair, fair]);

  // ----- Render helpers -----
  const chipAt = (type: BetType, selection: any): PlacedChip | undefined =>
    chips.find((c) => c.key === keyFor(type, selection));
  const winFor = (type: BetType, selection: any) => winKeys.has(keyFor(type, selection));

  const Cell = ({
    id, label, type, selection, color, className = '', children,
  }: {
    id: string; label?: string; type: BetType; selection: any;
    color: 'red' | 'black' | 'green' | 'neutral';
    className?: string; children?: React.ReactNode;
  }) => {
    const placed = chipAt(type, selection);
    const isWin = !!placed && result && winFor(type, selection);
    const lost = !!placed && result && !isWin;
    const bg =
      color === 'red' ? 'bg-rose-700/95 hover:bg-rose-600 border-rose-300/40' :
      color === 'black' ? 'bg-slate-950 hover:bg-slate-800 border-slate-500/40' :
      color === 'green' ? 'bg-emerald-700/95 hover:bg-emerald-600 border-emerald-300/40' :
      'bg-slate-800/80 hover:bg-slate-700 border-slate-500/40';
    return (
      <button
        ref={registerFocus(id)}
        onFocus={() => setFocusId(id)}
        onClick={() => placeChipOn(type, selection)}
        disabled={spinning}
        className={`relative outline-none border text-white font-bold transition-all ${bg} ${className} ${
          focusId === id ? focusRing : ''
        } ${isWin ? 'ring-4 ring-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.7)]' : ''} ${
          lost ? 'opacity-40' : ''
        }`}
        aria-label={label || String(selection)}
      >
        {children ?? label ?? String(selection)}
        {placed && (
          <span
            className="absolute -top-2 -right-2 min-w-[26px] h-[26px] px-1 rounded-full text-[11px] font-black flex items-center justify-center text-slate-900 border-2 border-amber-200 shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
            style={{ background: 'radial-gradient(circle at 30% 30%, #fde68a, #b45309)' }}
          >
            {placed.amount}
          </span>
        )}
      </button>
    );
  };

  // Number grid: 3 rows × 12 cols. row 0 top = number = col*3 + 3
  const gridNumbers = useMemo(() => {
    const rows: number[][] = [];
    for (let r = 0; r < 3; r++) {
      const row: number[] = [];
      for (let c = 0; c < 12; c++) {
        row.push(c * 3 + (3 - r));
      }
      rows.push(row);
    }
    return rows;
  }, []);

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
        @keyframes rl-confetti { 0% { opacity: 0; transform: translateY(0) scale(.5);} 50%{opacity:1;} 100% { opacity: 0; transform: translateY(-80px) scale(1.2);} }
      `}</style>

      <div className="max-w-6xl mx-auto pb-16 px-3 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <Button
            ref={registerFocus('back') as any}
            onFocus={() => setFocusId('back')}
            onClick={onBack}
            variant="gold"
            size="lg"
            className={`transition-all ${focusId === 'back' ? focusRing : ''}`}
          >
            <ArrowLeft className="w-5 h-5 mr-2" /> Back
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
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-2 rounded-full bg-emerald-500/15 border border-emerald-300/30 text-emerald-200 text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" /> Roulette
          </div>
          <h1 className="text-3xl md:text-4xl font-black drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
            Place your bets
          </h1>
          <p className="text-slate-200/90 mt-1 text-sm">Play Chips only — free to play, never cashable.</p>
        </div>

        {/* Top row: wheel + bet summary */}
        <div className="grid md:grid-cols-[360px_1fr] gap-5 mb-5">
          {/* Wheel */}
          <div className="flex flex-col items-center">
            <div className="relative" style={{ perspective: '1200px', width: 360 }}>
              {/* Pointer */}
              <div className="absolute left-1/2 -translate-x-1/2 z-30" style={{ top: -4 }} aria-hidden>
                <div
                  style={{
                    width: 0, height: 0,
                    borderLeft: '14px solid transparent',
                    borderRight: '14px solid transparent',
                    borderTop: '22px solid #fbbf24',
                    filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.6))',
                  }}
                />
              </div>
              <div
                className="relative mx-auto"
                style={{
                  width: 360, height: 360,
                  transform: 'rotateX(22deg)',
                  transformStyle: 'preserve-3d',
                  filter: 'drop-shadow(0 24px 22px rgba(0,0,0,0.55))',
                }}
              >
                <canvas
                  ref={canvasRef}
                  style={{
                    transform: `rotate(${wheelRotation}deg)`,
                    transition: 'none',
                    display: 'block',
                    willChange: 'transform',
                  }}
                />
                {/* Ball track */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ transform: `rotate(${ballRotation}deg)`, willChange: 'transform' }}
                >
                  <div
                    className="absolute left-1/2 -translate-x-1/2"
                    style={{
                      top: 16,
                      width: 14, height: 14, borderRadius: '50%',
                      background: 'radial-gradient(circle at 30% 30%, #fff, #cbd5e1)',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.6), inset 0 1px 2px rgba(255,255,255,0.7)',
                    }}
                  />
                </div>
              </div>
            </div>
            {/* Wheel kind toggle */}
            <div className="mt-4 w-full max-w-[360px]">
              <div className="text-[10px] uppercase tracking-wider text-amber-200 font-bold mb-1.5 text-center">
                Wheel
              </div>
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950/70 border border-amber-400/40">
                {(['european', 'american'] as WheelKind[]).map((k) => {
                  const active = wheel === k;
                  return (
                    <button
                      key={k}
                      ref={registerFocus(`wheel-${k}`)}
                      onFocus={() => setFocusId(`wheel-${k}`)}
                      onClick={() => { if (!spinning) setWheel(k); }}
                      disabled={spinning}
                      aria-pressed={active}
                      className={`px-3 py-2 rounded-lg text-sm font-black uppercase tracking-wider border-2 transition-all ${
                        active
                          ? 'bg-gradient-to-br from-amber-300 to-amber-600 text-slate-900 border-amber-200 shadow-[0_4px_18px_-4px_rgba(252,211,77,0.7)]'
                          : 'bg-slate-800/70 text-amber-100 border-transparent hover:bg-slate-700/70'
                      } ${focusId === `wheel-${k}` ? focusRing : ''}`}
                    >
                      {k === 'european' ? 'European • 0' : 'American • 0 / 00'}
                    </button>
                  );
                })}
              </div>
            </div>
            {result && (
              <div className={`mt-3 px-4 py-2 rounded-xl border font-black text-2xl tabular-nums ${
                result.color === 'red' ? 'bg-rose-600/30 border-rose-300/60 text-rose-100' :
                result.color === 'black' ? 'bg-slate-900 border-slate-400/60 text-slate-100' :
                'bg-emerald-700/30 border-emerald-300/60 text-emerald-100'
              }`}>
                {result.number}
              </div>
            )}
          </div>

          {/* Bet summary + denoms */}
          <Card className="p-4 bg-slate-900/70 border-emerald-400/30">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-emerald-200 font-bold">Total Bet</div>
                <div className="text-2xl font-black text-white tabular-nums">{totalBet.toLocaleString()}</div>
              </div>
              {result && (
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wider text-emerald-200 font-bold">Net</div>
                  <div className={`text-2xl font-black tabular-nums ${
                    result.net > 0 ? 'text-emerald-300' : result.net < 0 ? 'text-rose-300' : 'text-slate-200'
                  }`}>
                    {result.net > 0 ? '+' : ''}{result.net.toLocaleString()}
                  </div>
                </div>
              )}
            </div>

            <div className="text-[11px] uppercase tracking-wider text-amber-200 font-bold mb-2">Chip in hand</div>
            <div className="flex gap-2 flex-wrap mb-4">
              {DENOMS.map((d) => (
                <button
                  key={d}
                  ref={registerFocus(`denom-${d}`)}
                  onFocus={() => setFocusId(`denom-${d}`)}
                  onClick={() => setDenom(d)}
                  disabled={spinning}
                  className={`w-14 h-14 rounded-full font-black text-base border-4 transition-all ${
                    denom === d
                      ? 'bg-gradient-to-br from-amber-300 to-amber-600 text-slate-900 border-amber-200'
                      : 'bg-gradient-to-br from-slate-700 to-slate-900 text-amber-100 border-amber-400/40'
                  } ${focusId === `denom-${d}` ? focusRing : ''}`}
                >
                  {d}
                </button>
              ))}
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                ref={registerFocus('clear') as any}
                onFocus={() => setFocusId('clear')}
                onClick={clearBets}
                disabled={spinning || chips.length === 0}
                variant="outline"
                className={`border-rose-400/60 text-rose-200 bg-rose-950/40 hover:bg-rose-900/40 ${focusId === 'clear' ? focusRing : ''}`}
              >
                <Trash2 className="w-4 h-4 mr-2" /> Clear Bets
              </Button>
              <Button
                ref={registerFocus('spin') as any}
                onFocus={() => setFocusId('spin')}
                onClick={doSpin}
                disabled={!canSpin}
                className={`ml-auto text-xl font-black px-8 py-6 bg-gradient-to-br from-emerald-400 to-emerald-600 text-slate-900 border-2 border-emerald-200 shadow-[0_10px_30px_-8px_rgba(16,185,129,0.6)] transition-all ${focusId === 'spin' ? focusRing : ''}`}
              >
                {spinning ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Spinning…</> : 'SPIN'}
              </Button>
            </div>
            {totalBet > (balance ?? 0) && (
              <p className="mt-2 text-xs text-amber-200">Your bet exceeds your balance — adjust before spinning.</p>
            )}
          </Card>
        </div>

        {/* Betting board — felt */}
        <div
          className="relative rounded-2xl p-4 md:p-5"
          style={{
            background: 'radial-gradient(ellipse at top, #0f5132 0%, #064e3b 45%, #022c22 100%)',
            border: '3px solid rgba(251,191,36,0.55)',
            boxShadow: '0 30px 60px -20px rgba(0,0,0,0.85), inset 0 0 80px rgba(0,0,0,0.5)',
          }}
        >
          {/* Number grid */}
          <div className="flex gap-1">
            {/* Zeros column */}
            <div className="flex flex-col gap-1">
              {wheel === 'american' ? (
                <>
                  <Cell id="num-0" type="straight" selection={0} color="green" className="rounded-lg h-[60px] w-12 text-lg">
                    0
                  </Cell>
                  <Cell id="num-00" type="straight" selection={'00'} color="green" className="rounded-lg h-[60px] w-12 text-lg">
                    00
                  </Cell>
                  {/* fill remaining height */}
                  <div className="flex-1" />
                </>
              ) : (
                <Cell id="num-0" type="straight" selection={0} color="green" className="rounded-lg w-12 text-lg" >
                  <div className="h-[184px] flex items-center justify-center">0</div>
                </Cell>
              )}
            </div>

            {/* 3×12 number grid */}
            <div className="flex-1">
              <div className="grid grid-rows-3 grid-flow-col gap-1">
                {gridNumbers.flatMap((row, rIdx) =>
                  row.map((n, cIdx) => (
                    <Cell
                      key={`n-${n}`}
                      id={`num-${n}`}
                      type="straight"
                      selection={n}
                      color={isRed(n) ? 'red' : 'black'}
                      className="rounded h-[60px] text-base"
                      label={String(n)}
                    >
                      {n}
                    </Cell>
                  ))
                )}
              </div>
            </div>

            {/* Column 2:1 buttons */}
            <div className="flex flex-col gap-1">
              {[3, 2, 1].map((col) => (
                <Cell
                  key={`col-${col}`}
                  id={`col-${col}`}
                  type="column"
                  selection={col}
                  color="neutral"
                  className="rounded-lg h-[60px] w-16 text-[11px] uppercase font-extrabold leading-tight"
                >
                  2 to 1
                </Cell>
              ))}
            </div>
          </div>

          {/* Dozens */}
          <div className="grid grid-cols-[60px_1fr_64px] gap-1 mt-1">
            <div />
            <div className="grid grid-cols-3 gap-1">
              {[1, 2, 3].map((d) => (
                <Cell
                  key={`dozen-${d}`}
                  id={`dozen-${d}`}
                  type="dozen"
                  selection={d}
                  color="neutral"
                  className="rounded-lg h-[44px] text-sm uppercase"
                >
                  {d === 1 ? '1st 12' : d === 2 ? '2nd 12' : '3rd 12'}
                </Cell>
              ))}
            </div>
            <div />
          </div>

          {/* Even-money row */}
          <div className="grid grid-cols-[60px_1fr_64px] gap-1 mt-1">
            <div />
            <div className="grid grid-cols-6 gap-1">
              <Cell id="bet-low" type="low" selection={null} color="neutral" className="rounded-lg h-[44px] text-sm">1–18</Cell>
              <Cell id="bet-even" type="even" selection={null} color="neutral" className="rounded-lg h-[44px] text-sm">EVEN</Cell>
              <Cell id="bet-red" type="red" selection={null} color="red" className="rounded-lg h-[44px] text-sm">RED</Cell>
              <Cell id="bet-black" type="black" selection={null} color="black" className="rounded-lg h-[44px] text-sm">BLACK</Cell>
              <Cell id="bet-odd" type="odd" selection={null} color="neutral" className="rounded-lg h-[44px] text-sm">ODD</Cell>
              <Cell id="bet-high" type="high" selection={null} color="neutral" className="rounded-lg h-[44px] text-sm">19–36</Cell>
            </div>
            <div />
          </div>
        </div>

        {/* Result line */}
        {result && (
          <div className="mt-4 text-center relative">
            <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl border bg-slate-900/70 border-amber-400/40">
              <span className="text-xs uppercase tracking-wider text-amber-200 font-bold">Payout</span>
              <span className="text-2xl font-black text-emerald-300 tabular-nums">
                {result.totalPayout.toLocaleString()} chips
              </span>
              <span className="text-xs text-slate-300">on {result.totalBet} bet</span>
            </div>
            {celebrate && (
              <div className="absolute inset-x-0 -top-2 pointer-events-none flex justify-center gap-3">
                {['🎉','✨','🪙','✨','🎉'].map((g, i) => (
                  <span key={i} className="text-2xl" style={{ animation: `rl-confetti 1800ms ease-out ${i * 100}ms both` }}>{g}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {serverSeedHash && (
          <div className="mt-4 text-[11px] text-slate-400 font-mono break-all text-center">
            seedHash: {serverSeedHash}
          </div>
        )}

        {error && (
          <div className="mt-4 mx-auto max-w-md px-4 py-3 rounded-lg bg-rose-950/70 border border-rose-400/50 text-rose-100 text-sm text-center font-semibold">
            {error}
          </div>
        )}

        {fair && (
          <div className="mt-5">
            <button
              ref={registerFocus('fair-toggle')}
              onFocus={() => setFocusId('fair-toggle')}
              onClick={() => setShowFair((s) => !s)}
              className={`text-xs text-slate-300 hover:text-white inline-flex items-center gap-1 rounded px-1 ${focusId === 'fair-toggle' ? 'ring-2 ring-amber-300/70 text-white' : ''}`}
            >
              Provably fair {showFair ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showFair && (
              <div className="mt-2 p-3 rounded-lg bg-slate-950/70 border border-slate-700/60 text-[11px] text-slate-300 font-mono break-all space-y-1">
                <div><span className="text-slate-400">serverSeedHash:</span> {fair.serverSeedHash}</div>
                <div><span className="text-slate-400">serverSeed:</span> {fair.serverSeed}</div>
                <div><span className="text-slate-400">clientSeed:</span> {fair.clientSeed}</div>
                <div><span className="text-slate-400">nonce:</span> {fair.nonce}</div>
                <div className="pt-1 flex items-center gap-2">
                  <span className="text-slate-400">Verify SHA-256(serverSeed):</span>
                  {verifyOk === null ? (
                    <span className="text-slate-400">checking…</span>
                  ) : verifyOk ? (
                    <span className="inline-flex items-center gap-1 text-emerald-300 font-bold">
                      <Check className="w-3 h-3" /> matches seedHash
                    </span>
                  ) : (
                    <span className="text-rose-300 font-bold">mismatch</span>
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

export default Roulette;
