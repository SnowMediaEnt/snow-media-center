// Device Health's small pieces on screen (lib/deviceHealth, lib/deviceCheck):
//   * DeepCheckNote: one slim line while the owner's deep check is on for
//     this box ("Snow Media is checking this box until …"), on Fix a problem
//     and My Account. Nothing otherwise.
//   * CheckView: a 30-second check under way (a slim bar and "Checking… 18 s")
//     or its result (the plain verdict and "Sent to Snow Media").
//   * PlayerCheckStrip + usePlayerCheck: "Check this stream (1 minute)" from a
//     player's Help. It measures the stream on screen as it plays (never
//     stopped, reloaded or muted: `liveFallback: false`), 60 s with a sample
//     every 2 s (30 rows, the server's cap). A slim strip along the top of the
//     picture ("Checking this stream… 34 s", Back cancels), then the plain
//     verdict in the same strip for RESULT_MS (or until Back). Back answers
//     only the strip, never the player: the player's own key handler asks
//     `handleBack()` first (it runs before the strip's own listener).
//     Over 6 checks today: one line says so.
// Slim (owner rule): one line, 36-40 px, the TV's width. Chrome 66: margins, no flex gap.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { HealthContext } from '@/lib/deviceHealth';
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
  /** Start one (nothing while one runs). Resolves with its result (null: cancelled — at once — or couldn't run). */
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
    setRunning(true); setResult(null); setUnavailable(false); setProgress({ second: 0, total: opts.durationSec ?? CHECK_SECONDS, stalled: false });
    const run = runDeviceCheck({ ...opts, signal: ac.signal, onProgress: (p) => { if (aliveRef.current && !ac.signal.aborted) setProgress(p); } }).catch(() => null);
    // A stop answers at once (the check winds down by itself behind it).
    const stopped = new Promise<null>((resolve) => { ac.signal.addEventListener('abort', () => resolve(null)); });
    const r = await Promise.race([run, stopped]);
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

// --- the player's Help: "Check this stream (1 minute)" --------------------------------

/** The player's check: one minute, a sample every 2 s (30 rows). */
export const PLAYER_CHECK_SECONDS = 60;
export const PLAYER_CHECK_INTERVAL_SEC = 2;
/** The verdict (or the one-line "can't") stays this long, unless Back hides it first. */
export const PLAYER_CHECK_RESULT_MS = 10_000;

type StripShown = 'none' | 'running' | 'result' | 'limit' | 'nothing';

const isBackKey = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;

export interface PlayerCheck {
  shown: StripShown;
  /** The strip is on screen (running, or a result / a "can't" line). */
  visible: boolean;
  running: boolean;
  progress: CheckProgress | null;
  result: CheckResult | null;
  /** Start the check on what plays (nothing while one runs). */
  start: () => void;
  /** Back: cancels a running check / hides the line. true = it was the strip's. */
  handleBack: () => boolean;
}

/**
 * The player's 1-minute check (lib/deviceCheck with the stream on screen).
 * `active`: the player is up; when it goes, a running check is cancelled
 * (nothing sent) and the strip hides. `playing`: what the player plays, named
 * as it names it (context + title).
 */
export function usePlayerCheck({ active, playing, playKey = null }: {
  active: boolean;
  playing: { context: HealthContext; title?: string | null } | null;
  /** What plays (a channel's key, a title's id): another one cancels the check. */
  playKey?: string | null;
}): PlayerCheck {
  const check = useDeviceCheck();
  const [shown, setShown] = useState<StripShown>('none');
  const shownRef = useRef<StripShown>('none');
  shownRef.current = shown;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const checkRef = useRef(check);
  checkRef.current = check;

  const start = useCallback(() => {
    if (checkRef.current.running) return;
    if (!checkAllowedToday()) { setShown('limit'); return; }
    setShown('running');
    const p = playingRef.current;
    void checkRef.current.start({
      durationSec: PLAYER_CHECK_SECONDS,
      intervalSec: PLAYER_CHECK_INTERVAL_SEC,
      liveFallback: false,
      playing: p ? { context: p.context, title: p.title ?? null } : null,
    }).then((r) => {
      if (shownRef.current !== 'running') return; // cancelled meanwhile
      if (r) setShown('result');
      else setShown(checkAllowedToday() ? 'nothing' : 'limit');
    });
  }, []);

  const handleBack = useCallback((): boolean => {
    const now = shownRef.current;
    if (now === 'none') return false;
    if (now === 'running') checkRef.current.cancel();
    shownRef.current = 'none';
    setShown('none');
    checkRef.current.reset();
    (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
    return true;
  }, []);

  // The player went, or something else plays now: the check goes with it
  // (nothing sent; it would measure the wrong stream).
  const keyRef = useRef(playKey);
  useEffect(() => {
    const changed = keyRef.current !== playKey;
    keyRef.current = playKey;
    if ((active && !changed) || shownRef.current === 'none') return;
    if (shownRef.current === 'running') checkRef.current.cancel();
    shownRef.current = 'none';
    setShown('none');
    checkRef.current.reset();
  }, [active, playKey]);

  // The verdict / the "can't" line hides by itself.
  useEffect(() => {
    if (shown === 'none' || shown === 'running') return;
    const t = window.setTimeout(() => { shownRef.current = 'none'; setShown('none'); checkRef.current.reset(); }, PLAYER_CHECK_RESULT_MS);
    return () => window.clearTimeout(t);
  }, [shown]);

  // A backstop for a player that does not ask handleBack() first: Back is the
  // strip's while it shows (only when this listener runs before the player's).
  useEffect(() => {
    if (shown === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      if (!isBackKey(e)) return;
      if (handleBack()) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shown, handleBack]);

  return { shown, visible: shown !== 'none', running: check.running, progress: check.progress, result: check.result, start, handleBack };
}

/**
 * The player check's one slim strip along the top of the picture (40 px, the
 * screen's width, nothing focusable: the remote stays the player's). Running:
 * "Checking this stream… 34 s", a thin bar, "Back cancels". Then the plain
 * verdict and "Sent to Snow Media." Or one line: 6 today already / nothing
 * playing. Chrome 66: left/right (no inset), margins (no flex gap).
 */
export const PlayerCheckStrip = memo(({ check, className = '' }: { check: Pick<PlayerCheck, 'shown' | 'progress' | 'result'>; className?: string }) => {
  const { t } = useTranslation();
  const { shown, progress, result } = check;
  if (shown === 'none') return null;
  const base = `fixed z-[90] flex items-center min-h-[40px] px-4 py-1.5 rounded-lg bg-black/80 border border-white/10 font-nunito text-sm text-white pointer-events-none ${className}`;
  const style = { top: 12, left: 16, right: 16 };
  if (shown === 'limit' || shown === 'nothing') {
    return (
      <div data-player-check={shown} role="status" className={base} style={style}>
        <AlertTriangle className="w-4 h-4 mr-2 text-brand-gold shrink-0" />
        <span className="min-w-0">{shown === 'limit' ? t('deviceHealth.check.player.limit') : t('deviceHealth.check.player.nothing')}</span>
      </div>
    );
  }
  if (shown === 'result' && result) {
    const Icon = result.fine ? CheckCircle2 : AlertTriangle;
    return (
      <div data-player-check="result" data-verdict={result.verdict} role="status" className={base} style={style}>
        <Icon className={`w-4 h-4 mr-2 shrink-0 ${result.fine ? 'text-emerald-300' : 'text-brand-gold'}`} />
        <span className="min-w-0 flex-1">{t(result.plain.key, result.plain.params)}</span>
        <span className="ml-3 shrink-0 text-xs text-brand-ice/70">{result.sent ? t('deviceHealth.check.sent') : t('deviceHealth.check.notSent')}</span>
      </div>
    );
  }
  const total = progress?.total || PLAYER_CHECK_SECONDS;
  const second = Math.min(total, progress?.second ?? 0);
  const pct = Math.round((second / total) * 100);
  return (
    <div data-player-check="running" role="status" className={base} style={style}>
      <Activity className="w-4 h-4 mr-2 text-brand-gold shrink-0" />
      <span className="shrink-0 tabular-nums">
        {second >= total ? t('deviceHealth.check.finishing') : t('deviceHealth.check.player.running', { seconds: second })}
      </span>
      <div className="flex-1 min-w-[80px] mx-4 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div data-check-bar="" className="h-full bg-brand-gold" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-xs text-brand-ice/70">{t('deviceHealth.check.player.backCancels')}</span>
    </div>
  );
});
PlayerCheckStrip.displayName = 'PlayerCheckStrip';
