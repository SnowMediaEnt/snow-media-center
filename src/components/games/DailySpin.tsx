import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Coins, Sparkles, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { supabase } from '@/integrations/supabase/client';

interface DailySpinProps {
  onBack: () => void;
}

const PRIZES = [50, 100, 250, 500, 2000];
const SEG_COLORS = ['#0ea5e9', '#10b981', '#8b5cf6', '#ef4444', '#f59e0b']; // jackpot last (gold)
const COOLDOWN_MS = 4 * 60 * 60 * 1000;

interface FairInfo {
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

function fmtCountdown(ms: number) {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

const DailySpin = ({ onBack }: DailySpinProps) => {
  const { user } = useAuth();
  const { balance, status } = useGameSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spinBtnRef = useRef<HTMLButtonElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const rotRef = useRef(0);

  const [rotation, setRotation] = useState(0); // degrees
  const [spinning, setSpinning] = useState(false);
  const [nextClaimAt, setNextClaimAt] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loadingCooldown, setLoadingCooldown] = useState(true);
  const [lastWin, setLastWin] = useState<{ prize: number; jackpot: boolean } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fair, setFair] = useState<FairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const setRot = useCallback((v: number) => { rotRef.current = v; setRotation(v); }, []);

  // Draw wheel
  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 420;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 8;
    const n = PRIZES.length;
    const seg = (Math.PI * 2) / n;
    // pointer is at top (-PI/2). Segment 0 should center at -PI/2 when rotation=0.
    // We rotate clockwise by rotation degrees; here we draw without rotation and rely on CSS transform.
    const startOffset = -Math.PI / 2 - seg / 2;

    for (let i = 0; i < n; i++) {
      const a0 = startOffset + i * seg;
      const a1 = a0 + seg;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      const isJackpot = PRIZES[i] === 2000;
      if (isJackpot) {
        const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
        grad.addColorStop(0, '#fde68a');
        grad.addColorStop(0.6, '#f59e0b');
        grad.addColorStop(1, '#b45309');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = SEG_COLORS[i % SEG_COLORS.length];
      }
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.stroke();

      // Label
      const mid = a0 + seg / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mid);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isJackpot ? '#1f1300' : '#ffffff';
      ctx.font = `${isJackpot ? '800' : '700'} ${isJackpot ? 26 : 22}px system-ui, -apple-system, sans-serif`;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = isJackpot ? 0 : 4;
      ctx.fillText(`${PRIZES[i]}`, r - 18, 0);
      if (isJackpot) {
        ctx.font = '800 12px system-ui';
        ctx.fillStyle = '#7c2d12';
        ctx.fillText('JACKPOT', r - 18, 20);
      }
      ctx.restore();
    }

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fbbf24';
    ctx.stroke();

    // Hub
    ctx.beginPath();
    ctx.arc(cx, cy, 28, 0, Math.PI * 2);
    const hubGrad = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 28);
    hubGrad.addColorStop(0, '#fde68a');
    hubGrad.addColorStop(1, '#92400e');
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
  }, []);

  useEffect(() => {
    drawWheel();
  }, [drawWheel]);

  // Cooldown fetch
  useEffect(() => {
    let cancelled = false;
    async function loadCooldown() {
      if (!user) {
        setLoadingCooldown(false);
        return;
      }
      try {
        const { data } = await supabase
          .from('daily_claims')
          .select('last_claim_at')
          .eq('user_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (data?.last_claim_at) {
          const last = new Date(data.last_claim_at).getTime();
          const next = last + COOLDOWN_MS;
          if (next > Date.now()) setNextClaimAt(new Date(next));
        }
      } catch {
        // ignore — server will reject if cooldown
      } finally {
        if (!cancelled) setLoadingCooldown(false);
      }
    }
    loadCooldown();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Tick countdown
  useEffect(() => {
    if (!nextClaimAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextClaimAt]);

  // Clear cooldown when it expires
  useEffect(() => {
    if (nextClaimAt && nextClaimAt.getTime() <= now) {
      setNextClaimAt(null);
    }
  }, [now, nextClaimAt]);

  // Focus: prefer spin, else fall back to back
  useEffect(() => {
    const target = (!loadingCooldown && !nextClaimAt && user) ? spinBtnRef.current : backBtnRef.current;
    target?.focus();
  }, [loadingCooldown, nextClaimAt, user]);


  const handleSpin = useCallback(async () => {
    if (inFlight.current) return;
    if (spinning || nextClaimAt) return;
    inFlight.current = true;
    setErrorMsg(null);
    setLastWin(null);
    setFair(null);
    setSpinning(true);

    // Start a continuous spin — drive from rotRef so closures stay live
    const startRot = rotRef.current;
    const animStart = performance.now();
    let resolved = false;
    let targetRot = startRot + 360 * 6; // fallback
    let raf = 0;
    const duration = 4000;

    const animate = (t: number) => {
      const elapsed = t - animStart;
      if (!resolved) {
        // Linear spin while waiting
        setRot(startRot + (elapsed / 1000) * 720);
        raf = requestAnimationFrame(animate);
      }
    };
    raf = requestAnimationFrame(animate);

    const settle = () => { inFlight.current = false; };

    try {
      const clientSeed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.claimDailySpin(clientSeed);

      if (resp?.ok && typeof resp.index === 'number') {
        const n = PRIZES.length;
        const segDeg = 360 / n;
        const baseSpins = 6;
        // Compute target from the LIVE rotation so we continue forward without snapping back.
        const liveRot = rotRef.current;
        const currentMod = ((liveRot % 360) + 360) % 360;
        const targetMod = ((-resp.index * segDeg) % 360 + 360) % 360;
        let delta = targetMod - currentMod;
        if (delta < 0) delta += 360;
        targetRot = liveRot + baseSpins * 360 + delta;

        const reStart = performance.now();
        resolved = true;
        cancelAnimationFrame(raf);
        const restartFrom = liveRot;
        const animate2 = (t: number) => {
          const el = t - reStart;
          const p = Math.min(1, el / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setRot(restartFrom + (targetRot - restartFrom) * eased);
          if (p < 1) requestAnimationFrame(animate2);
          else {
            setSpinning(false);
            setLastWin({ prize: resp.prize, jackpot: resp.prize === 2000 });
            setCelebrate(true);
            setTimeout(() => setCelebrate(false), 2500);
            setNextClaimAt(new Date(Date.now() + COOLDOWN_MS));
            if (resp.fair) setFair(resp.fair);
            // Sync chip balance with the win
            try { gameSocket.refreshBalance(); } catch {}
            settle();
          }
        };
        requestAnimationFrame(animate2);
      } else if (resp?.error === 'cooldown') {
        cancelAnimationFrame(raf);
        setSpinning(false);
        if (resp.nextClaimAt) setNextClaimAt(new Date(resp.nextClaimAt));
        setErrorMsg(null);
        settle();
      } else {
        cancelAnimationFrame(raf);
        setSpinning(false);
        setErrorMsg("Couldn't spin right now — try again.");
        settle();
      }
    } catch {
      cancelAnimationFrame(raf);
      setSpinning(false);
      setErrorMsg("Couldn't spin right now — try again.");
      settle();
    }
  }, [spinning, nextClaimAt, setRot]);

  const remaining = nextClaimAt ? nextClaimAt.getTime() - now : 0;
  const eligible = !nextClaimAt && !loadingCooldown && !!user;

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
          <Button ref={backBtnRef} onClick={onBack} variant="gold" size="lg" className="focus:outline-none focus:ring-4 focus:ring-amber-300/80">
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-3 rounded-xl border border-emerald-300/50 bg-gradient-to-br from-emerald-500/25 to-emerald-700/25 px-5 py-3 shadow-[0_8px_28px_-12px_rgba(16,185,129,0.6)]">
            <Coins className="w-6 h-6 text-amber-300" />
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] uppercase tracking-wider text-emerald-200/90 font-semibold">Play Chips</span>
              <span className="text-2xl font-extrabold text-white tabular-nums">
                {balance !== null ? balance.toLocaleString() : 'Loading chips…'}
              </span>
            </div>
          </div>
        </div>

        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-emerald-500/15 border border-emerald-300/30 text-emerald-200 text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" /> Daily Spin
          </div>
          <h1 className="text-4xl md:text-5xl font-black drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
            One free spin every 4 hours
          </h1>
          <p className="text-slate-200/90 mt-2">Land on the gold segment for the 2,000 chip jackpot.</p>
        </div>

        {/* Wheel */}
        <div className="flex flex-col items-center">
          <div
            className="relative"
            style={{ perspective: '1200px', width: 460, maxWidth: '100%' }}
          >
            {/* Pointer */}
            <div
              className="absolute left-1/2 -translate-x-1/2 z-20"
              style={{ top: -4 }}
              aria-hidden
            >
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: '18px solid transparent',
                  borderRight: '18px solid transparent',
                  borderTop: '28px solid #fbbf24',
                  filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.6))',
                }}
              />
            </div>

            <div
              className="relative mx-auto"
              style={{
                width: 420,
                height: 420,
                maxWidth: '100%',
                transform: 'rotateX(18deg)',
                transformStyle: 'preserve-3d',
                filter: 'drop-shadow(0 30px 24px rgba(0,0,0,0.55))',
              }}
            >
              {/* Glow */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                  boxShadow: '0 0 80px 10px rgba(251,191,36,0.18), inset 0 0 60px rgba(0,0,0,0.4)',
                }}
              />
              <canvas
                ref={canvasRef}
                style={{
                  transform: `rotate(${rotation}deg)`,
                  transition: 'none',
                  display: 'block',
                  willChange: 'transform',
                }}
              />
            </div>
          </div>

          {/* Spin / cooldown */}
          <div className="mt-8 w-full max-w-md text-center">
            {!user ? (
              <Card className="p-5 bg-slate-900/70 border-amber-400/40 text-amber-100 font-semibold">
                Sign in to claim your daily spin.
              </Card>
            ) : loadingCooldown ? (
              <div className="flex items-center justify-center gap-2 text-slate-200">
                <Loader2 className="w-5 h-5 animate-spin" /> Checking your daily spin…
              </div>
            ) : nextClaimAt ? (
              <Card className="p-6 bg-slate-900/80 border-emerald-400/30">
                <div className="text-sm uppercase tracking-wider text-emerald-200/90 font-semibold mb-1">
                  Come back in
                </div>
                <div className="text-4xl font-black tabular-nums text-white">
                  {fmtCountdown(remaining)}
                </div>
                <div className="text-xs text-slate-300 mt-2">Next spin will be ready then.</div>
              </Card>
            ) : (
              <Button
                ref={spinBtnRef}
                onClick={handleSpin}
                disabled={spinning || !eligible}
                className="w-full text-2xl font-black py-8 bg-gradient-to-br from-amber-400 to-amber-600 text-slate-900 border-2 border-amber-300 hover:from-amber-300 hover:to-amber-500 focus:outline-none focus:ring-4 focus:ring-amber-300/80 focus:scale-105 transition-all shadow-[0_10px_30px_-8px_rgba(251,191,36,0.6)]"
              >
                {spinning ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin" /> Spinning…
                  </span>
                ) : (
                  'SPIN'
                )}
              </Button>
            )}

            {errorMsg && (
              <p className="mt-4 text-amber-200 font-semibold">{errorMsg}</p>
            )}

            {lastWin && (
              <div
                className={`mt-6 p-5 rounded-xl border ${
                  lastWin.jackpot
                    ? 'bg-gradient-to-br from-amber-400/30 to-amber-700/30 border-amber-300/60'
                    : 'bg-emerald-500/15 border-emerald-300/40'
                } ${celebrate ? 'animate-scale-in' : ''}`}
                style={
                  celebrate
                    ? { boxShadow: '0 0 60px 8px rgba(251,191,36,0.55)' }
                    : undefined
                }
              >
                <div className="text-sm uppercase tracking-wider font-semibold text-amber-200">
                  {lastWin.jackpot ? '🎉 JACKPOT!' : 'You won'}
                </div>
                <div className="text-4xl font-black text-white mt-1">
                  +{lastWin.prize.toLocaleString()} chips
                </div>
              </div>
            )}

            {fair && (
              <div className="mt-6 text-left">
                <button
                  onClick={() => setShowFair((s) => !s)}
                  className="text-xs text-slate-100 bg-slate-800 border border-slate-500/60 px-2 py-1 rounded inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-amber-300/80"
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
      </div>
    </div>
  );
};

export default DailySpin;
