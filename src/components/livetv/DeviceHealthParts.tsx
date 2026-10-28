// Device Health's small pieces on screen (lib/deviceHealth, lib/deviceCheck):
//   * DeepCheckNote: one slim line while the owner's deep check is on for
//     this box ("Snow Media is checking this box until …"), on Fix a problem
//     and My Account. Nothing otherwise.
//   * CheckView: a 30-second check under way (a slim bar and "Checking… 18 s")
//     or its result (the plain verdict and "Sent to Snow Media").
// Slim (owner rule): one line, 36-40 px, the TV's width. Chrome 66: margins, no flex gap.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { checkAllowedToday, deepUntil, subscribeDeep } from '@/lib/deviceHealth';
import { CHECK_SECONDS, runDeviceCheck, type CheckOpts, type CheckProgress, type CheckResult } from '@/lib/deviceCheck';
import { formatDate } from '@/i18n/format';

export const DeepCheckNote = memo(({ className = '' }: { className?: string }) => {
  const { t } = useTranslation();
  const [until, setUntil] = useState<number | null>(() => deepUntil());
  useEffect(() => subscribeDeep(setUntil), []);
  if (!until) return null;
  return (
    <div data-deep-check-note="" className={`flex items-center h-9 px-3 rounded-lg border border-white/10 bg-black/30 text-xs font-nunito text-brand-ice/80 ${className}`}>
      <Activity className="w-4 h-4 mr-2 text-brand-gold shrink-0" />
      <span className="min-w-0 truncate">{t('deviceHealth.deep.note', { date: formatDate(until, 'medium') })}</span>
    </div>
  );
});
DeepCheckNote.displayName = 'DeepCheckNote';

interface CheckViewProps {
  progress: CheckProgress | null;
  result: CheckResult | null;
  /** The check could not run (6 already today, the demo, nothing to measure). */
  unavailable?: boolean;
  className?: string;
}

export const CheckView = memo(({ progress, result, unavailable = false, className = '' }: CheckViewProps) => {
  const { t } = useTranslation();
  if (unavailable) {
    return (
      <div data-check-view="unavailable" className={`flex items-center min-h-[36px] px-3 rounded-lg border border-white/10 bg-black/30 text-sm font-nunito text-brand-ice/80 ${className}`}>
        <AlertTriangle className="w-4 h-4 mr-2 text-brand-gold shrink-0" />
        <span className="min-w-0">{t('deviceHealth.check.unavailable')}</span>
      </div>
    );
  }
  if (result) {
    const Icon = result.fine ? CheckCircle2 : AlertTriangle;
    return (
      <div data-check-view="result" data-verdict={result.verdict} className={`px-3 py-2 rounded-lg border border-white/10 bg-black/30 ${className}`}>
        <div className="flex items-start">
          <Icon className={`w-4 h-4 mr-2 mt-0.5 shrink-0 ${result.fine ? 'text-emerald-300' : 'text-brand-gold'}`} />
          <p className="text-sm font-nunito text-white min-w-0">{t(result.plain.key, result.plain.params)}</p>
        </div>
        <p className="text-xs font-nunito text-brand-ice/70 mt-1 ml-6">
          {result.sent ? t('deviceHealth.check.sent') : t('deviceHealth.check.notSent')}
        </p>
      </div>
    );
  }
  const total = progress?.total ?? 30;
  const second = progress?.second ?? 0;
  const pct = Math.round((second / total) * 100);
  return (
    <div data-check-view="running" className={`px-3 py-2 rounded-lg border border-white/10 bg-black/30 ${className}`}>
      <p className="text-sm font-nunito text-white">
        {second >= total ? t('deviceHealth.check.finishing') : t('deviceHealth.check.running', { seconds: second })}
      </p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div data-check-bar="" className="h-full bg-brand-gold" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
});
CheckView.displayName = 'CheckView';

export interface DeviceCheckState {
  running: boolean;
  progress: CheckProgress | null;
  result: CheckResult | null;
  unavailable: boolean;
  /** Start one (nothing while one runs). Resolves with its result (null: cancelled / couldn't run). */
  start: (opts?: CheckOpts) => Promise<CheckResult | null>;
  cancel: () => void;
  reset: () => void;
}

/** One 30-second check at a time, for a screen (lib/deviceCheck). Cancelled on unmount. */
export function useDeviceCheck(): DeviceCheckState {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<CheckProgress | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; abortRef.current?.abort(); }, []);
  const start = useCallback(async (opts: CheckOpts = {}) => {
    if (abortRef.current) return null;
    if (!checkAllowedToday()) { setUnavailable(true); return null; }
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true); setResult(null); setUnavailable(false); setProgress({ second: 0, total: CHECK_SECONDS, stalled: false });
    const r = await runDeviceCheck({ ...opts, signal: ac.signal, onProgress: (p) => { if (aliveRef.current && !ac.signal.aborted) setProgress(p); } }).catch(() => null);
    if (abortRef.current === ac) abortRef.current = null;
    if (aliveRef.current) {
      setRunning(false);
      if (r) setResult(r);
      else if (!ac.signal.aborted) setUnavailable(true);
      else setProgress(null);
    }
    return r;
  }, []);
  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);
  const reset = useCallback(() => { setResult(null); setProgress(null); setUnavailable(false); }, []);
  return { running, progress, result, unavailable, start, cancel, reset };
}
