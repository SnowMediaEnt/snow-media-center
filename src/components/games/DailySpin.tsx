import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, Coins, Gift, Loader2, Snowflake, Sparkles, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { supabase } from '@/integrations/supabase/client';
import { GamePanel, GameShell, GameTopBar, ResultBanner } from './shared/GameUI';
import { GameFxCanvas } from './shared/GameFxCanvas';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { useGameLifecycle } from './shared/gameLifecycle';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useGameBack } from './shared/gameBack';
import { isGlobalModalOpen, visualArrowDir } from './shared/gameInput';
import { useGameAudio } from './shared/gameAudio';
import '@/styles/games-wheels.css';

interface DailySpinProps {
  onBack: () => void;
}

const PRIZES = [50, 100, 250, 500, 2000];
const COOLDOWN_MS = 4 * 60 * 60 * 1000;

/** Countdown units come from the active locale, never hardcoded h/m/s. */
function fmtCountdown(ms: number, u: { h: string; m: string; s: string }) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}${u.h} ${pad(m)}${u.m} ${pad(sec)}${u.s}`;
  if (m > 0) return `${m}${u.m} ${pad(sec)}${u.s}`;
  return `${sec}${u.s}`;
}

const DailySpin = ({ onBack }: DailySpinProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { balance, status } = useGameSocket();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  const life = useGameLifecycle();
  const { play } = useGameAudio();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wheelMeasureRef = useRef<HTMLDivElement>(null);
  const wheelVisualRef = useRef<HTMLDivElement>(null);
  const spinBtnRef = useRef<HTMLButtonElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  /** Bumped per claim: an ack from an older claim can never rotate a new wheel. */
  const claimEpoch = useRef(0);
  const rotRef = useRef(0);

  const [spinning, setSpinning] = useState(false);
  const [nextClaimAt, setNextClaimAt] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loadingCooldown, setLoadingCooldown] = useState(true);
  const [lastWin, setLastWin] = useState<{ prize: number; jackpot: boolean } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [zone, setZone] = useState<'back' | 'fx' | 'spin'>('spin');
  const [backNote, setBackNote] = useState<string | null>(null);

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
    const measured = wheelMeasureRef.current?.getBoundingClientRect().width ?? 0;
    // The CSS owns the responsive size; the bitmap follows it. The fallback is
    // only for first-paint/jsdom, before layout has produced a measurable box.
    const size = Math.max(240, Math.round(measured || 420));
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const rOuter = size / 2 - Math.max(4, size * 0.012);
    const rFace = rOuter - size * 0.068;
    const rInner = size * 0.175;
    const n = PRIZES.length;
    const seg = (Math.PI * 2) / n;
    const startOffset = -Math.PI / 2 - seg / 2;

    // Lacquered midnight backing and three metallic rails. They are all
    // painted once per resize/language change, never animated independently.
    const caseGrad = ctx.createRadialGradient(cx - size * 0.15, cy - size * 0.18, size * 0.04, cx, cy, rOuter);
    caseGrad.addColorStop(0, '#fff2b0');
    caseGrad.addColorStop(0.35, '#d5a93f');
    caseGrad.addColorStop(0.68, '#775017');
    caseGrad.addColorStop(0.82, '#f3cf68');
    caseGrad.addColorStop(1, '#3e290b');
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = caseGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, rFace + size * 0.012, 0, Math.PI * 2);
    ctx.fillStyle = '#071832';
    ctx.fill();

    const palettes = [
      ['#063b63', '#0b75a7', '#082849'],
      ['#075f57', '#10a381', '#073f3c'],
      ['#4a1c68', '#843eb0', '#301044'],
      ['#781d39', '#c83256', '#4e1128'],
      ['#8c5b0a', '#ecb52e', '#684005'],
    ];

    for (let i = 0; i < n; i++) {
      const a0 = startOffset + i * seg;
      const a1 = a0 + seg;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0) * rInner, cy + Math.sin(a0) * rInner);
      ctx.arc(cx, cy, rFace, a0, a1);
      ctx.lineTo(cx + Math.cos(a1) * rInner, cy + Math.sin(a1) * rInner);
      ctx.arc(cx, cy, rInner, a1, a0, true);
      ctx.closePath();
      const isJackpot = PRIZES[i] === 2000;
      const colors = palettes[i];
      const grad = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rFace);
      grad.addColorStop(0, isJackpot ? '#ffe89a' : colors[0]);
      grad.addColorStop(0.55, isJackpot ? '#d79b18' : colors[1]);
      grad.addColorStop(1, isJackpot ? '#704507' : colors[2]);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = Math.max(2, size * 0.006);
      ctx.strokeStyle = 'rgba(255,236,171,0.72)';
      ctx.stroke();

      // A restrained highlight along each pocket gives depth without a GPU
      // filter or a second animated layer.
      ctx.beginPath();
      ctx.arc(cx, cy, rFace - size * 0.018, a0 + 0.018, a1 - 0.018);
      ctx.lineWidth = Math.max(1, size * 0.004);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.stroke();

      const mid = a0 + seg / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mid);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isJackpot ? '#2b1900' : '#ffffff';
      ctx.font = `900 ${Math.round(size * (isJackpot ? 0.072 : 0.065))}px Montserrat, system-ui, sans-serif`;
      ctx.shadowColor = 'rgba(0,0,0,0.68)';
      ctx.shadowBlur = isJackpot ? 0 : Math.max(2, size * 0.012);
      ctx.fillText(`+${PRIZES[i].toLocaleString()}`, rFace - size * 0.055, -size * 0.012);
      ctx.font = `800 ${Math.round(size * 0.026)}px system-ui, sans-serif`;
      ctx.fillStyle = isJackpot ? '#553000' : 'rgba(255,255,255,0.8)';
      ctx.fillText('SNOW COINS', rFace - size * 0.055, size * 0.042);
      if (isJackpot) {
        ctx.font = `900 ${Math.round(size * 0.024)}px system-ui, sans-serif`;
        ctx.fillStyle = '#633a00';
        ctx.fillText(t('games.dailySpin.jackpotTag'), rFace - size * 0.055, size * 0.075);
      }
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, rFace, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, size * 0.012);
    ctx.strokeStyle = '#ffe59a';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, rInner + size * 0.012, 0, Math.PI * 2);
    const innerGrad = ctx.createRadialGradient(cx - size * 0.04, cy - size * 0.05, size * 0.01, cx, cy, rInner);
    innerGrad.addColorStop(0, '#174a6a');
    innerGrad.addColorStop(0.62, '#081d39');
    innerGrad.addColorStop(1, '#020b18');
    ctx.fillStyle = innerGrad;
    ctx.fill();
    ctx.lineWidth = Math.max(2, size * 0.01);
    ctx.strokeStyle = '#d5ac4a';
    ctx.stroke();
  }, [t]);

  const userId = user?.id;

  useEffect(() => {
    drawWheel();
    const target = wheelMeasureRef.current;
    let observer: ResizeObserver | null = null;
    let queued = 0;
    const redraw = () => {
      window.cancelAnimationFrame(queued);
      queued = window.requestAnimationFrame(drawWheel);
    };
    if (target && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(redraw);
      observer.observe(target);
    }
    window.addEventListener('resize', redraw);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', redraw);
      window.cancelAnimationFrame(queued);
    };
  }, [drawWheel]);

  useEffect(() => {
    let cancelled = false;
    // A changed (or signed-out) user must never inherit the previous account's
    // cooldown, result or loading state.
    setNextClaimAt(null);
    setLoadingCooldown(!!userId);
    async function loadCooldown() {
      if (!userId) { setLoadingCooldown(false); return; }
      try {
        const { data } = await supabase
          .from('daily_claims')
          .select('last_claim_at')
          .eq('user_id', userId)
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
  }, [userId]);

  useEffect(() => {
    if (!nextClaimAt) return;
    const id = life.interval(() => setNow(Date.now()), 1000);
    return () => life.clearTimer(id);
  }, [nextClaimAt, life]);

  useEffect(() => {
    if (nextClaimAt && nextClaimAt.getTime() <= now) setNextClaimAt(null);
  }, [now, nextClaimAt]);

  const spinReachable = !loadingCooldown && !nextClaimAt && !!user && !spinning;

  // Keep managed focus on a usable control across every phase change.
  useEffect(() => {
    let target = zone;
    if (target === 'spin' && !spinReachable) target = 'back';
    if (target !== zone) { setZone(target); return; }
    const el = target === 'back' ? backBtnRef.current
      : target === 'fx' ? fxRef.current
      : spinBtnRef.current;
    el?.focus({ preventScroll: true });
  }, [zone, spinReachable]);

  // D-pad graph: Back <-> FX on the top row, Spin below.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isGlobalModalOpen()) return;
      const dir = visualArrowDir(e);
      if (!dir) return;
      // Consume every arrow so native spatial focus cannot diverge from the
      // single data-tv-focused marker, even at a graph boundary.
      e.preventDefault();
      const down = (): 'spin' | null => (spinReachable ? 'spin' : null);
      if (zone === 'back') {
        if (dir === 'right') setZone('fx');
        else if (dir === 'down') { const n = down(); if (n) setZone(n); }
      } else if (zone === 'fx') {
        if (dir === 'left') setZone('back');
        else if (dir === 'down') { const n = down(); if (n) setZone(n); }
      } else if (zone === 'spin') {
        if (dir === 'up') setZone('back');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zone, spinReachable]);

  const { requestBack } = useGameBack({
    // A spin in flight or its settle animation must never be abandoned.
    isBusy: () => spinning || inFlight.current,
    onBlocked: () => {
      setBackNote(t('games.shared.finishSpinFirst'));
      life.timeout(() => setBackNote(null), 2600);
    },
    onExit: onBack,
  });

  const handleSpin = useCallback(async () => {
    if (inFlight.current || spinning || nextClaimAt) return;
    inFlight.current = true;
    const epoch = ++claimEpoch.current;
    setErrorMsg(null);
    setLastWin(null);
    setSpinning(true);

    const startRot = rotRef.current;
    let resolved = false;
    let raf: number | null = null;
    let visualElapsed = 0;
    let lastFrame = performance.now();
    const duration = reducedFx ? 1600 : 4000;
    const baseSpins = reducedFx ? 2 : 6;

    const scheduleIdle = () => {
      if (!resolved && !life.isHidden() && raf === null) raf = life.raf(animate);
    };
    const animate = (time: number) => {
      raf = null;
      if (resolved || life.isHidden()) return;
      visualElapsed += Math.max(0, time - lastFrame);
      lastFrame = time;
      setRot(startRot + (visualElapsed / 1000) * 720);
      scheduleIdle();
    };
    const stopWatchingVisibility = life.onVisibilityChange((hidden) => {
      if (hidden) {
        life.cancelRaf(raf);
        raf = null;
      } else {
        lastFrame = performance.now();
        scheduleIdle();
      }
    });
    scheduleIdle();

    const stopIdle = () => {
      resolved = true;
      life.cancelRaf(raf);
      raf = null;
      stopWatchingVisibility();
    };
    const settle = () => { inFlight.current = false; };

    try {
      const clientSeed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.claimDailySpin(clientSeed);

      // An ack that lands after unmount, or after a newer claim, must not
      // rotate the wheel, set state or schedule timers.
      if (!life.isMounted() || epoch !== claimEpoch.current) { stopIdle(); settle(); return; }

      // The landing segment and prize are only trusted when they are finite and
      // inside the real wheel, otherwise the rotation maths would produce NaN.
      const validIndex = typeof resp?.index === 'number'
        && Number.isInteger(resp.index)
        && resp.index >= 0
        && resp.index < PRIZES.length;
      const validPrize = typeof resp?.prize === 'number' && Number.isFinite(resp.prize);

      if (resp?.ok && validIndex && validPrize) {
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
          if (!life.isMounted() || epoch !== claimEpoch.current) return;
          if (wheelVisualRef.current) wheelVisualRef.current.style.willChange = 'auto';
          setSpinning(false);
          setLastWin({ prize: resp.prize, jackpot: resp.prize === 2000 });
          play('reelStop');
          play(resp.prize === 2000 ? 'bonus' : 'win');
          setCelebrate(true);
          life.timeout(() => setCelebrate(false), reducedFx ? 1200 : 2500);
          setNextClaimAt(new Date(Date.now() + COOLDOWN_MS));
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
  }, [spinning, nextClaimAt, setRot, life, play, reducedFx, t]);

  const remaining = nextClaimAt ? nextClaimAt.getTime() - now : 0;
  const eligible = !nextClaimAt && !loadingCooldown && !!user;
  const spinBlocked = spinning || !eligible;

  return (
    <GameShell accent="ice" className="snow-wheels-game snow-daily-game">
      <GameTopBar
        ref={backBtnRef}
        onBack={requestBack}
        backLabel={t('games.dailySpin.back')}
        balance={balance}
        status={status}
        title={t('games.dailySpin.heading')}
        phase={t('games.dailySpin.phase')}
        backFocused={zone === 'back'}
        onBackFocus={() => setZone('back')}
        reducedFx={reducedFx}
        onToggleFx={toggleReducedFx}
        fxRef={fxRef}
        fxFocused={zone === 'fx'}
        onFxFocus={() => setZone('fx')}
      />
      <GamePanel className="tv-game-board snow-wheel-stage snow-daily-stage">
        <div className="snow-daily-layout">
          <section className="snow-daily-showpiece" aria-label={t('games.dailySpin.heading')}>
            <div className="snow-daily-marquee">
              <span className="snow-daily-marquee__icon" aria-hidden="true"><Sparkles /></span>
              <span>{t('games.dailySpin.heading')}</span>
              <small>{t('games.dailySpin.phase')}</small>
            </div>

            <div className="snow-daily-wheel-frame">
              <div className="snow-daily-lights" aria-hidden="true" />
              <span className="snow-daily-pointer" aria-hidden="true"><span /></span>
              <div ref={wheelMeasureRef} className="snow-daily-wheel-measure">
                <div ref={wheelVisualRef} className="snow-daily-wheel-disc">
                  <canvas ref={canvasRef} />
                </div>
              </div>
              <div className="snow-daily-hub" aria-hidden="true">
                <Snowflake />
                <span>SMC</span>
              </div>
            </div>

            <div className="snow-daily-pedestal" aria-hidden="true">
              <span /><strong>SNOW MEDIA CASINO</strong><span />
            </div>
          </section>

          <section className="snow-wheel-controls snow-daily-console">
            <header className="snow-daily-console__head">
              <span className="snow-daily-console__gift" aria-hidden="true"><Gift /></span>
              <div>
                <small>{t('games.dailySpin.phase')}</small>
                <strong>{t('games.dailySpin.heading')}</strong>
              </div>
              <Trophy aria-hidden="true" />
            </header>

            <div className="snow-daily-prizes" aria-label={t('games.dailySpin.heading')}>
              {PRIZES.map((prize) => (
                <span key={prize} className={prize === 2000 ? 'is-jackpot' : undefined}>
                  <Coins aria-hidden="true" /><b>{prize.toLocaleString()}</b>
                </span>
              ))}
            </div>

            <div className="snow-daily-status-deck">
              {!user ? (
                <ResultBanner tone="info" title={t('games.dailySpin.signInPrompt')} />
              ) : loadingCooldown ? (
                <div className="snow-wheel-loading"><Loader2 className="animate-spin" /> {t('games.dailySpin.checkingSpin')}</div>
              ) : nextClaimAt ? (
                <div className="snow-daily-countdown" role="status">
                  <Clock3 aria-hidden="true" />
                  <span><small>{t('games.dailySpin.nextSpinReady')}</small><strong>{fmtCountdown(remaining, { h: t('games.dailySpin.unitHours'), m: t('games.dailySpin.unitMinutes'), s: t('games.dailySpin.unitSeconds') })}</strong></span>
                </div>
              ) : (
                <div className="snow-daily-ready" aria-hidden="true">
                  <span><Sparkles /></span>
                  <strong>{t('games.dailySpin.spin')}</strong>
                </div>
              )}

              {lastWin && (
                <ResultBanner tone="win" title={lastWin.jackpot ? t('games.dailySpin.jackpotResult') : t('games.dailySpin.youWon')}>
                  {t('games.dailySpin.winAmount', { prize: lastWin.prize.toLocaleString() })}
                </ResultBanner>
              )}
              {errorMsg && <ResultBanner tone="lose" title={errorMsg} />}
              {backNote && <p className="snow-game-note" role="status">{backNote}</p>}
            </div>

            <Button
              ref={spinBtnRef}
              variant="gold"
              aria-disabled={spinBlocked ? 'true' : undefined}
              data-tv-focused={zone === 'spin' ? 'true' : undefined}
              onFocus={() => setZone('spin')}
              onClick={() => { if (!spinBlocked) void handleSpin(); }}
              className="snow-game-action snow-wheel-spin snow-daily-spin"
            >
              {spinning ? <><Loader2 className="animate-spin" /> {t('games.dailySpin.spinning')}</> : <><Gift /> {t('games.dailySpin.spin')}</>}
            </Button>

          </section>
        </div>
      </GamePanel>
      <GameFxCanvas burstKey={celebrate && lastWin ? lastWin.prize : null} reduced={reducedFx} />
    </GameShell>
  );
};

export default DailySpin;
