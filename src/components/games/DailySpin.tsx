import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { supabase } from '@/integrations/supabase/client';
import { FairnessPanel, GamePanel, GameShell, GameTopBar, ResultBanner } from './shared/GameUI';
import { GameFxCanvas } from './shared/GameFxCanvas';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { useGameLifecycle } from './shared/gameLifecycle';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import type { GameFairInfo } from './shared/gameTypes';

interface DailySpinProps {
  onBack: () => void;
}

const PRIZES = [50, 100, 250, 500, 2000];
const SEG_COLORS = ['#0ea5e9', '#10b981', '#8b5cf6', '#ef4444', '#f59e0b'];
const COOLDOWN_MS = 4 * 60 * 60 * 1000;
const WHEEL_SIZE = 420;

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
  const { t } = useTranslation();
  const { user } = useAuth();
  const { balance, status } = useGameSocket();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  const life = useGameLifecycle();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wheelVisualRef = useRef<HTMLDivElement>(null);
  const spinBtnRef = useRef<HTMLButtonElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const rotRef = useRef(0);

  const [spinning, setSpinning] = useState(false);
  const [nextClaimAt, setNextClaimAt] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loadingCooldown, setLoadingCooldown] = useState(true);
  const [lastWin, setLastWin] = useState<{ prize: number; jackpot: boolean } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fair, setFair] = useState<GameFairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  // One OK/Select press activates the focused control exactly once.
  useTvActivate(activateFocused);

  // Rotation lives on the DOM, never in React state: 60fps state updates
  // stall a Fire TV WebView.
  const setRot = useCallback((v: number) => {
    rotRef.current = v;
    if (wheelVisualRef.current) wheelVisualRef.current.style.transform = `rotate(${v}deg)`;
  }, []);

  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = WHEEL_SIZE;
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
        ctx.fillText(t('games.dailySpin.jackpotTag'), r - 18, 20);
      }
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fbbf24';
    ctx.stroke();

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
  }, [t]);

  useEffect(() => { drawWheel(); }, [drawWheel]);

  useEffect(() => {
    let cancelled = false;
    async function loadCooldown() {
      if (!user) { setLoadingCooldown(false); return; }
      try {
        const { data } = await supabase
          .from('daily_claims')
          .select('last_claim_at')
          .eq('user_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (data?.last_claim_at) {
          const next = new Date(data.last_claim_at).getTime() + COOLDOWN_MS;
          if (next > Date.now()) setNextClaimAt(new Date(next));
        }
      } catch {
        // The server rejects a claim inside the cooldown anyway.
      } finally {
        if (!cancelled) setLoadingCooldown(false);
      }
    }
    loadCooldown();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!nextClaimAt) return;
    const id = life.interval(() => setNow(Date.now()), 1000);
    return () => life.clearTimer(id);
  }, [nextClaimAt, life]);

  useEffect(() => {
    if (nextClaimAt && nextClaimAt.getTime() <= now) setNextClaimAt(null);
  }, [now, nextClaimAt]);

  // Keep focus on something usable across every phase change.
  useEffect(() => {
    const target = (!loadingCooldown && !nextClaimAt && user) ? spinBtnRef.current : backBtnRef.current;
    target?.focus({ preventScroll: true });
  }, [loadingCooldown, nextClaimAt, user]);

  const handleSpin = useCallback(async () => {
    if (inFlight.current || spinning || nextClaimAt) return;
    inFlight.current = true;
    setErrorMsg(null);
    setLastWin(null);
    setFair(null);
    setSpinning(true);

    const startRot = rotRef.current;
    const animStart = performance.now();
    let resolved = false;
    let raf = 0;
    const duration = reducedFx ? 1600 : 4000;
    const baseSpins = reducedFx ? 2 : 6;

    const animate = (time: number) => {
      if (resolved) return;
      if (!life.isHidden()) setRot(startRot + ((time - animStart) / 1000) * 720);
      raf = life.raf(animate);
    };
    raf = life.raf(animate);

    const stopIdle = () => { resolved = true; life.cancelRaf(raf); };
    const settle = () => { inFlight.current = false; };

    try {
      const clientSeed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.claimDailySpin(clientSeed);

      if (resp?.ok && typeof resp.index === 'number') {
        const segDeg = 360 / PRIZES.length;
        const liveRot = rotRef.current;
        const currentMod = ((liveRot % 360) + 360) % 360;
        const targetMod = ((-resp.index * segDeg) % 360 + 360) % 360;
        let delta = targetMod - currentMod;
        if (delta < 0) delta += 360;
        const targetRot = liveRot + baseSpins * 360 + delta;

        stopIdle();
        const reStart = performance.now();
        const animate2 = (time: number) => {
          const p = Math.min(1, (time - reStart) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setRot(liveRot + (targetRot - liveRot) * eased);
          if (p < 1) { life.raf(animate2); return; }
          if (wheelVisualRef.current) wheelVisualRef.current.style.willChange = 'auto';
          setSpinning(false);
          setLastWin({ prize: resp.prize, jackpot: resp.prize === 2000 });
          setCelebrate(true);
          life.timeout(() => setCelebrate(false), reducedFx ? 1200 : 2500);
          setNextClaimAt(new Date(Date.now() + COOLDOWN_MS));
          if (resp.fair) setFair(resp.fair);
          try { gameSocket.refreshBalance(); } catch { /* balance refreshes on next event */ }
          settle();
        };
        if (wheelVisualRef.current) wheelVisualRef.current.style.willChange = 'transform';
        life.raf(animate2);
      } else if (resp?.error === 'cooldown') {
        stopIdle();
        setSpinning(false);
        if (resp.nextClaimAt) setNextClaimAt(new Date(resp.nextClaimAt));
        setErrorMsg(null);
        settle();
      } else {
        stopIdle();
        setSpinning(false);
        setErrorMsg(t('games.dailySpin.spinError'));
        settle();
      }
    } catch {
      stopIdle();
      setSpinning(false);
      setErrorMsg(t('games.dailySpin.spinError'));
      settle();
    }
  }, [spinning, nextClaimAt, setRot, life, reducedFx, t]);

  const remaining = nextClaimAt ? nextClaimAt.getTime() - now : 0;
  const eligible = !nextClaimAt && !loadingCooldown && !!user;
  const spinBlocked = spinning || !eligible;

  return (
    <GameShell accent="ice">
      <GameTopBar
        ref={backBtnRef}
        onBack={onBack}
        backLabel={t('games.dailySpin.back')}
        balance={balance}
        status={status}
        title={t('games.dailySpin.heading')}
        phase={t('games.dailySpin.phase')}
        reducedFx={reducedFx}
        onToggleFx={toggleReducedFx}
      />
      <GamePanel className="tv-game-board snow-wheel-stage">
        <div className="snow-wheel-layout">
          <div className="snow-wheel-wrap">
            <span className="snow-wheel-pointer" aria-hidden="true" />
            <div ref={wheelVisualRef} className="snow-wheel-visual"><canvas ref={canvasRef} /></div>
          </div>
          <div className="snow-wheel-controls">
            {!user ? (
              <ResultBanner tone="info" title={t('games.dailySpin.signInPrompt')} />
            ) : loadingCooldown ? (
              <div className="snow-wheel-loading"><Loader2 className="animate-spin" /> {t('games.dailySpin.checkingSpin')}</div>
            ) : nextClaimAt ? (
              <ResultBanner tone="info" title={fmtCountdown(remaining)}>{t('games.dailySpin.nextSpinReady')}</ResultBanner>
            ) : (
              <Button
                ref={spinBtnRef}
                variant="gold"
                aria-disabled={spinBlocked ? 'true' : undefined}
                onClick={() => { if (!spinBlocked) void handleSpin(); }}
                className="snow-game-action snow-wheel-spin"
              >
                {spinning ? t('games.dailySpin.spinning') : t('games.dailySpin.spin')}
              </Button>
            )}
            {errorMsg && <ResultBanner tone="lose" title={errorMsg} />}
            {lastWin && (
              <ResultBanner tone="win" title={lastWin.jackpot ? t('games.dailySpin.jackpotResult') : t('games.dailySpin.youWon')}>
                {t('games.dailySpin.winAmount', { prize: lastWin.prize.toLocaleString() })}
              </ResultBanner>
            )}
            {fair && (
              <FairnessPanel
                fair={fair}
                open={showFair}
                onToggle={() => setShowFair((value) => !value)}
                labels={{ title: t('games.dailySpin.provablyFair'), note: t('games.dailySpin.fairVerify') }}
              />
            )}
          </div>
        </div>
      </GamePanel>
      <GameFxCanvas burstKey={celebrate && lastWin ? lastWin.prize : null} reduced={reducedFx} />
    </GameShell>
  );
};

export default DailySpin;
