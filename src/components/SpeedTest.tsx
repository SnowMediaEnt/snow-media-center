import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Gauge, Play, RotateCw, Wifi, Loader2 } from 'lucide-react';

interface SpeedTestProps {
  onClose: () => void;
}

type Phase = 'idle' | 'ping' | 'download' | 'upload' | 'done' | 'error';

const DOWNLOAD_URL = 'https://speed.cloudflare.com/__down?bytes=';
const UPLOAD_URL = 'https://speed.cloudflare.com/__up';
const PING_URL = 'https://speed.cloudflare.com/__down?bytes=0';

const fmtMbps = (bps: number) => (bps / 1_000_000).toFixed(bps > 100_000_000 ? 0 : 1);

const SpeedTest = ({ onClose }: SpeedTestProps) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [ping, setPing] = useState<number | null>(null);
  const [jitter, setJitter] = useState<number | null>(null);
  const [download, setDownload] = useState<number>(0); // bps
  const [upload, setUpload] = useState<number>(0); // bps
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [focused, setFocused] = useState<'back' | 'start'>('start');
  const abortRef = useRef<AbortController | null>(null);

  const measurePing = useCallback(async (): Promise<{ ping: number; jitter: number }> => {
    const samples: number[] = [];
    for (let i = 0; i < 8; i++) {
      const t0 = performance.now();
      try {
        await fetch(`${PING_URL}&_=${Date.now()}-${i}`, { cache: 'no-store' });
        samples.push(performance.now() - t0);
      } catch {
        // ignore
      }
    }
    if (!samples.length) throw new Error('Ping failed');
    samples.sort((a, b) => a - b);
    const trimmed = samples.slice(1, -1).length ? samples.slice(1, -1) : samples;
    const avg = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
    let jit = 0;
    for (let i = 1; i < trimmed.length; i++) jit += Math.abs(trimmed[i] - trimmed[i - 1]);
    jit = jit / Math.max(1, trimmed.length - 1);
    return { ping: avg, jitter: jit };
  }, []);

  const measureDownload = useCallback(async (signal: AbortSignal): Promise<number> => {
    // Stream a 100 MB file but cap measurement to ~10 seconds
    const sizes = [25_000_000, 100_000_000];
    let bestBps = 0;
    for (const size of sizes) {
      if (signal.aborted) break;
      const t0 = performance.now();
      const res = await fetch(`${DOWNLOAD_URL}${size}&_=${Date.now()}`, {
        cache: 'no-store',
        signal,
      });
      if (!res.body) {
        const buf = await res.arrayBuffer();
        const elapsed = (performance.now() - t0) / 1000;
        const bps = (buf.byteLength * 8) / Math.max(0.001, elapsed);
        bestBps = Math.max(bestBps, bps);
        setDownload(bestBps);
        continue;
      }
      const reader = res.body.getReader();
      let received = 0;
      let lastUpdate = t0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) received += value.byteLength;
        const now = performance.now();
        const elapsed = (now - t0) / 1000;
        const bps = (received * 8) / Math.max(0.001, elapsed);
        if (now - lastUpdate > 150) {
          setDownload(bps);
          lastUpdate = now;
        }
        if (elapsed > 10) {
          try { reader.cancel(); } catch { /* noop */ }
          break;
        }
      }
      const elapsed = (performance.now() - t0) / 1000;
      const bps = (received * 8) / Math.max(0.001, elapsed);
      bestBps = Math.max(bestBps, bps);
      setDownload(bestBps);
    }
    return bestBps;
  }, []);

  const measureUpload = useCallback(async (signal: AbortSignal): Promise<number> => {
    // Send chunks for ~8 seconds, accumulate bytes
    const chunkSize = 2_000_000; // 2 MB
    const chunk = new Uint8Array(chunkSize);
    crypto.getRandomValues(chunk.slice(0, Math.min(65536, chunkSize)));
    const t0 = performance.now();
    let sent = 0;
    let bestBps = 0;
    while (!signal.aborted) {
      const elapsed = (performance.now() - t0) / 1000;
      if (elapsed > 8) break;
      const reqStart = performance.now();
      try {
        await fetch(UPLOAD_URL, {
          method: 'POST',
          body: chunk,
          signal,
          cache: 'no-store',
        });
      } catch (e) {
        if (signal.aborted) break;
        throw e;
      }
      sent += chunkSize;
      const total = (performance.now() - t0) / 1000;
      const bps = (sent * 8) / Math.max(0.001, total);
      bestBps = Math.max(bestBps, bps);
      setUpload(bps);
      // Avoid hammering server with zero-latency loop
      if (performance.now() - reqStart < 50) await new Promise((r) => setTimeout(r, 30));
    }
    return bestBps;
  }, []);

  const runTest = useCallback(async () => {
    setErrorMsg('');
    setPing(null);
    setJitter(null);
    setDownload(0);
    setUpload(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      setPhase('ping');
      const p = await measurePing();
      setPing(p.ping);
      setJitter(p.jitter);

      setPhase('download');
      await measureDownload(ctrl.signal);

      setPhase('upload');
      await measureUpload(ctrl.signal);

      setPhase('done');
    } catch (e) {
      console.error('[SpeedTest] failed:', e);
      setErrorMsg(e instanceof Error ? e.message : 'Speed test failed');
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  }, [measurePing, measureDownload, measureUpload]);

  // D-pad navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape', 'Backspace'].includes(e.key)) {
        e.preventDefault();
      }
      if (e.key === 'Escape' || e.key === 'Backspace') {
        if (abortRef.current) abortRef.current.abort();
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft') setFocused('back');
      else if (e.key === 'ArrowRight') setFocused('start');
      else if (e.key === 'Enter' || e.key === ' ') {
        if (focused === 'back') {
          if (abortRef.current) abortRef.current.abort();
          onClose();
        } else {
          if (phase !== 'ping' && phase !== 'download' && phase !== 'upload') runTest();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, phase, runTest, onClose]);

  // Auto-start on mount
  useEffect(() => {
    runTest();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusRing = (id: 'back' | 'start') =>
    focused === id ? 'scale-110 shadow-[0_0_30px_hsl(var(--brand-ice)/0.6)]' : '';

  const isRunning = phase === 'ping' || phase === 'download' || phase === 'upload';
  const downMbps = Number(fmtMbps(download));
  const upMbps = Number(fmtMbps(upload));
  const goodFor4K = downMbps >= 25;
  const goodForHD = downMbps >= 15;

  const phaseLabel: Record<Phase, string> = {
    idle: 'Ready',
    ping: 'Measuring latency…',
    download: 'Testing download speed…',
    upload: 'Testing upload speed…',
    done: 'Test complete',
    error: 'Test failed',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <Button
            data-focus-id="speedtest-back"
            onClick={() => {
              if (abortRef.current) abortRef.current.abort();
              onClose();
            }}
            variant="gold"
            size="lg"
            className={`transition-all duration-200 ${focusRing('back')}`}
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-3 text-white">
            <Gauge className="w-7 h-7 text-brand-ice" />
            <h1 className="text-3xl font-bold">Internet Speed Test</h1>
          </div>
          <Button
            data-focus-id="speedtest-start"
            onClick={runTest}
            disabled={isRunning}
            variant="outline"
            size="lg"
            className={`bg-blue-600/20 border-blue-500/50 text-blue-100 hover:bg-blue-600/30 transition-all duration-200 ${focusRing('start')} ${isRunning ? 'opacity-60' : ''}`}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Testing…
              </>
            ) : phase === 'done' || phase === 'error' ? (
              <>
                <RotateCw className="w-5 h-5 mr-2" />
                Run Again
              </>
            ) : (
              <>
                <Play className="w-5 h-5 mr-2" />
                Start
              </>
            )}
          </Button>
        </div>

        {/* Status */}
        <div className="text-center mb-8">
          <p className="text-blue-200 text-lg flex items-center justify-center gap-2">
            {isRunning && <Loader2 className="w-4 h-4 animate-spin" />}
            {phaseLabel[phase]}
          </p>
        </div>

        {/* Big readouts */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <Card className="p-8 bg-slate-900/70 border-slate-700 text-center">
            <div className="text-blue-200 text-sm uppercase tracking-wider mb-2">Download</div>
            <div className="text-6xl font-bold text-white tabular-nums">
              {downMbps || '—'}
            </div>
            <div className="text-blue-300 mt-1">Mbps</div>
          </Card>
          <Card className="p-8 bg-slate-900/70 border-slate-700 text-center">
            <div className="text-blue-200 text-sm uppercase tracking-wider mb-2">Upload</div>
            <div className="text-6xl font-bold text-white tabular-nums">
              {upMbps || '—'}
            </div>
            <div className="text-blue-300 mt-1">Mbps</div>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <Card className="p-5 bg-slate-900/70 border-slate-700 text-center">
            <div className="text-blue-200 text-xs uppercase tracking-wider mb-1">Ping</div>
            <div className="text-2xl font-semibold text-white tabular-nums">
              {ping !== null ? `${Math.round(ping)} ms` : '—'}
            </div>
          </Card>
          <Card className="p-5 bg-slate-900/70 border-slate-700 text-center">
            <div className="text-blue-200 text-xs uppercase tracking-wider mb-1">Jitter</div>
            <div className="text-2xl font-semibold text-white tabular-nums">
              {jitter !== null ? `${Math.round(jitter)} ms` : '—'}
            </div>
          </Card>
        </div>

        {/* Verdict */}
        {phase === 'done' && (
          <Card className="p-6 bg-gradient-to-br from-slate-900/80 to-slate-800/80 border-slate-700">
            <div className="flex items-center gap-3 mb-3">
              <Wifi className="w-6 h-6 text-brand-ice" />
              <h2 className="text-xl font-bold text-white">Streaming Verdict</h2>
            </div>
            {goodFor4K ? (
              <p className="text-green-300">
                Excellent — your connection ({downMbps} Mbps) handles 4K streaming with no buffering.
              </p>
            ) : goodForHD ? (
              <p className="text-yellow-300">
                Good for HD streaming. For consistent 4K you'll want at least 25 Mbps.
              </p>
            ) : (
              <p className="text-orange-300">
                Below the 15 Mbps recommended for HD streaming — expect buffering. Try a wired
                connection, move closer to your router, or contact your ISP.
              </p>
            )}
          </Card>
        )}

        {phase === 'error' && (
          <Card className="p-6 bg-red-900/30 border-red-700/50">
            <p className="text-red-200">
              Speed test failed: {errorMsg}. Check your internet connection and try again.
            </p>
          </Card>
        )}

        <p className="text-center text-blue-300/60 text-xs mt-8">
          Powered by Cloudflare's global speed test network
        </p>
      </div>
    </div>
  );
};

export default SpeedTest;
