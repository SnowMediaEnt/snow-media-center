import { memo, useEffect, useRef, useState } from 'react';
import { formatMbps, useBufferDiagnostics, type Verdict } from '@/lib/bufferDiagnostics';

/**
 * Small corner card shown during a playback stall. Tells the viewer whether
 * the problem looks like THEIR INTERNET, the STREAM SERVER or ISP THROTTLING,
 * with the live numbers behind the verdict.
 *
 * - Appears once a stall has lasted ≥ 2 s, stays 2.5 s after recovery with a
 *   green "Back to normal" line, then unmounts.
 * - pointer-events-none, no tabIndex, no data-focused: it never steals D-pad
 *   focus.
 * - No shadow-[…], no backdrop-blur, no transition-all, no animate-* (Fire TV
 *   low-memory mode strips them anyway).
 * - aria-live sits on the verdict headline only, so TalkBack announces a
 *   verdict change, not the per-second counter.
 */

interface BufferingDiagnosticsProps {
  /**
   * Stall state. Optional: when omitted the card follows the diagnostics
   * module itself (VideoPlayer / useNativePlayer already call setBuffering),
   * so a screen can simply mount <BufferingDiagnostics /> next to its player.
   */
  buffering?: boolean;
  corner?: 'top-right' | 'top-left';
  /**
   * Render the "Press Help for tips" hint line. The card is pointer-events-none
   * and handles no keys: the D-pad shell owns the Help key binding and must
   * open the help surface itself.
   */
  showHelpHint?: boolean;
  className?: string;
}

const SHOW_AFTER_MS = 2000;
const LINGER_MS = 2500;

const VERDICT_COLOR: Record<Verdict, string> = {
  throttling: 'text-brand-gold',
  server: 'text-amber-300',
  internet: 'text-red-300',
  unknown: 'text-brand-ice',
  ok: 'text-emerald-300',
};

const BufferingDiagnostics = memo(({ buffering: bufferingProp, corner = 'top-right', showHelpHint = false, className }: BufferingDiagnosticsProps) => {
  const snap = useBufferDiagnostics();
  const buffering = bufferingProp ?? snap.bufferingForMs > 0;
  // 'hidden' → (stall ≥ 2 s) → 'active' → (recovered) → 'recovered' (2.5 s) → 'hidden'
  const [phase, setPhase] = useState<'hidden' | 'active' | 'recovered'>('hidden');
  const [elapsedSec, setElapsedSec] = useState(0);
  const stallStartRef = useRef(0);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (buffering) {
      stallStartRef.current = Date.now();
      if (phaseRef.current === 'recovered') {
        // Stalled again before the recovery line finished — go straight back.
        setPhase('active');
      } else if (phaseRef.current === 'hidden') {
        timer = setTimeout(() => setPhase('active'), SHOW_AFTER_MS);
      }
    } else if (phaseRef.current === 'active') {
      setPhase('recovered');
      timer = setTimeout(() => setPhase('hidden'), LINGER_MS);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [buffering]);

  // Local 1 s counter for "Buffering · 7s" — independent of the module tick
  // so the card is right even if the integrator only passes the prop.
  useEffect(() => {
    if (phase !== 'active') return;
    const update = () => setElapsedSec(Math.max(0, Math.round((Date.now() - stallStartRef.current) / 1000)));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [phase]);

  if (phase === 'hidden') return null;

  const cornerCls = corner === 'top-left' ? 'top-4 left-4' : 'top-4 right-4';
  const seconds = snap.bufferingForMs > 0 ? Math.round(snap.bufferingForMs / 1000) : elapsedSec;
  const recoveredKbps = snap.streamKbps ?? snap.probeKbps;
  // The prop says we are stalled but the module says 'ok' (integrator passes
  // the prop without wiring setBuffering/beginStream): show a neutral verdict
  // rather than "Buffering · 7s" next to a green "Playing normally".
  const shown = snap.verdict === 'ok'
    ? { verdict: 'unknown' as const, headline: 'Buffering…', detail: 'Measuring your connection…' }
    : snap;

  return (
    <div
      className={`absolute ${cornerCls} z-30 pointer-events-none rounded-2xl bg-black/80 border border-white/10 px-4 py-3 max-w-xs font-nunito ${className || ''}`}
    >
      {phase === 'recovered' ? (
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
          <span className="inline-block w-[6px] h-[6px] rounded-full bg-emerald-300" aria-hidden="true" />
          <span className="tabular-nums">Back to normal{recoveredKbps != null ? ` · ${formatMbps(recoveredKbps)}` : ''}</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-white/90">
            <span className="inline-block w-[6px] h-[6px] rounded-full bg-brand-gold" aria-hidden="true" />
            <span className="tabular-nums">Buffering · {seconds}s</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-brand-ice/70 tabular-nums">
            <span>
              Stream {formatMbps(snap.streamKbps)}
              {snap.streamEarlyKbps != null && (
                <span className="text-brand-ice/70"> was {(snap.streamEarlyKbps / 1000).toFixed(1)}</span>
              )}
            </span>
            <span>Internet {formatMbps(snap.probeKbps)}</span>
          </div>
          <p aria-live="polite" className={`mt-2 text-sm font-semibold leading-snug ${VERDICT_COLOR[shown.verdict]}`}>{shown.headline}</p>
          {shown.detail && (
            <p className="mt-1 text-xs text-brand-ice/70 leading-snug">{shown.detail}</p>
          )}
          {showHelpHint && (
            <p className="mt-2 text-xs text-brand-ice/60">Press Help for tips</p>
          )}
        </>
      )}
    </div>
  );
});

BufferingDiagnostics.displayName = 'BufferingDiagnostics';
export default BufferingDiagnostics;
