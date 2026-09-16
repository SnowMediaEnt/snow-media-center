import { useEffect, useRef } from 'react';

type Particle = { x: number; y: number; vx: number; vy: number; life: number; hue: number };

/**
 * Bounded Canvas2D celebration burst.
 *
 * Suppressed entirely in reduced-FX or low-memory mode. While the document is
 * hidden it schedules NO animation frame at all — a paused burst simply waits
 * for `visibilitychange` and resumes from where it stopped — and it cancels its
 * own frame plus its listener on unmount so nothing survives a Back press.
 */
export const GameFxCanvas = ({ burstKey, reduced }: { burstKey: string | number | null; reduced: boolean }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (burstKey === null || reduced) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lowMemory = document.documentElement.classList.contains('native-low-memory');
    const count = lowMemory ? 10 : 38;
    const particles: Particle[] = Array.from({ length: count }, (_, i) => ({
      x: rect.width / 2,
      y: rect.height * 0.65,
      vx: (Math.random() - 0.5) * 7,
      vy: -3 - Math.random() * 7,
      life: 1,
      hue: i % 2 ? 43 : 188,
    }));

    let raf = 0;
    let last = 0;
    let done = false;

    const clear = () => ctx.clearRect(0, 0, rect.width, rect.height);

    const draw = (now: number) => {
      raf = 0;
      if (last === 0) last = now;
      const dt = Math.min(32, now - last) / 16.67;
      last = now;
      clear();
      particles.forEach((p) => {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.22 * dt; p.life -= 0.016 * dt;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = `hsl(${p.hue} 80% 70%)`;
        ctx.fillRect(p.x, p.y, 5, 5);
      });
      if (particles.some((p) => p.life > 0)) schedule();
      else { done = true; clear(); }
    };

    // Never hold an animation frame open while the document is hidden: a
    // backgrounded Fire TV app would otherwise keep a rAF loop alive forever.
    const schedule = () => {
      if (done || raf || document.hidden) return;
      raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        return;
      }
      last = 0; // resume without a giant catch-up step
      schedule();
    };

    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (raf) cancelAnimationFrame(raf);
      clear();
    };
  }, [burstKey, reduced]);

  if (reduced) return null;
  return <canvas ref={ref} className="snow-game-fx no-inset" aria-hidden="true" />;
};
