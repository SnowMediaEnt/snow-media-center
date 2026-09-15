import { useEffect, useRef } from 'react';

type Particle = { x: number; y: number; vx: number; vy: number; life: number; hue: number };

export const GameFxCanvas = ({ burstKey, reduced }: { burstKey: string | number | null; reduced: boolean }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (burstKey === null || reduced) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = document.documentElement.classList.contains('native-low-memory') ? 10 : 38;
    const particles: Particle[] = Array.from({ length: count }, (_, i) => ({ x: rect.width / 2, y: rect.height * .65, vx: (Math.random() - .5) * 7, vy: -3 - Math.random() * 7, life: 1, hue: i % 2 ? 43 : 188 }));
    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      if (document.hidden) { last = now; raf = requestAnimationFrame(draw); return; }
      const dt = Math.min(32, now - last) / 16.67; last = now;
      ctx.clearRect(0, 0, rect.width, rect.height);
      particles.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += .22 * dt; p.life -= .016 * dt; ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = `hsl(${p.hue} 80% 70%)`; ctx.fillRect(p.x, p.y, 5, 5); });
      if (particles.some((p) => p.life > 0)) raf = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, rect.width, rect.height);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, rect.width, rect.height); };
  }, [burstKey, reduced]);
  return <canvas ref={ref} className="snow-game-fx" aria-hidden="true" />;
};
