// Rewind live TV (TRACKER 25) for the full-screen channel: which way this
// channel can go back in time, the bar's timeline, and the Rewind / Forward /
// Go live actions. See src/lib/liveRewind.ts for the rules.
//
// - Panel catch-up channels: the player is handed the panel's timeshift
//   address (`playUrl`) instead of the channel's; Go live hands it back.
//   Nothing is stored on the box and no extra stream is opened.
// - Every other channel: the native plugin keeps an on-box buffer of the
//   channel while it plays full screen (timeshiftStart) and moves the player
//   onto it to rewind; everything is wiped when the player is left, the app
//   goes to the background (native), or the viewer signs out (playerSignOut).
//   The buffer is a second connection to the line, so it runs only when the
//   plan allows two or more streams AND the panel says a stream is free right
//   now (bufferGate), and never on mpv. While it runs the panel is asked again
//   every 60 s at most; when another device has taken the line, or the
//   provider refuses or drops the capture, the buffer is wiped (the viewer is
//   moved to live first), a toast says why, and it is tried again only on the
//   next channel or after 5 minutes.
//
// Addresses carry the line's credentials. This file never logs one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { SnowPlayer, type TimeshiftStatus } from '@/capacitor/SnowPlayer';
import { toast } from '@/hooks/use-toast';
import { authenticate, type XtreamCreds, type XtreamLiveStream } from '@/lib/xtream';
import {
  HARD_CAP_MB, LINE_CHECK_SETTLE_MS, LINE_RECHECK_MS, LINE_RETRY_MS, REWIND_SETTINGS_EVENT,
  buildTimeshiftUrl, captureRefused, catchupDays, catchupDurationMin, deviceUtcOffsetMinutes, floorMinute,
  lineTakenByOthers, loadRewindSettings, maxRewindMinutes, parseLineUsage, rewindChannelKey,
  serverUtcOffsetMinutes, type LineUsage, type RewindOffReason, type RewindSettings,
} from '@/lib/liveRewind';

// The reasons and their words live in liveRewind.ts; these keep the old import path working.
export { rewindOffMessage } from '@/lib/liveRewind';
export type { RewindOffReason } from '@/lib/liveRewind';

export type RewindKind = 'off' | 'buffer' | 'catchup';

/** The buffer needs its own stream next to the picture being watched. */
export const BUFFER_MIN_STREAMS = 2;

/** ok: start · unknown: can't tell · few: the plan is too small · full: the panel says no stream is free. */
export type BufferGate = 'ok' | 'unknown' | 'few' | 'full';

/**
 * May the on-box buffer open its second stream?
 *
 * Without `usage` this is the plan check, which costs no request: the plan's
 * streams, less those the running recordings use, must still leave two (the
 * picture and the buffer). An unknown plan counts as no: a wrong guess on a
 * one-stream line costs the viewer the picture they are watching.
 *
 * With `usage` (what the panel reports right now, see parseLineUsage) the
 * panel's own numbers decide, and the plan check is repeated on its
 * max_connections: a stream must be free (max - active_cons >= 1). active_cons
 * already counts this box's own playing stream (see liveRewind.ts), and a
 * count of 0 while a channel plays is not believed. `usage` null = the panel
 * could not be asked, or did not say: 'unknown', no buffer.
 */
export function bufferGate(
  maxConnections: number | null | undefined,
  activeRecordings = 0,
  usage?: LineUsage | null,
): BufferGate {
  if (usage === null) return 'unknown';
  const planned = usage ? usage.max : maxConnections;
  if (planned == null) return 'unknown';
  const n = Math.floor(Number(planned));
  if (!Number.isFinite(n) || n < 1) return 'unknown';
  if (n - Math.max(0, Math.floor(activeRecordings)) < BUFFER_MIN_STREAMS) return 'few';
  if (!usage) return 'ok';
  if (usage.active < 1) return 'unknown';
  return usage.max - usage.active >= 1 ? 'ok' : 'full';
}

/** What the last ask of the panel decided for a channel (token = channel + restarts). */
interface LineCheck {
  token: string;
  gate: BufferGate;
  /** The buffer ran and gave its stream back (vs never started). */
  taken: boolean;
}

export interface RewindInfo {
  /** How far back can be reached from live, seconds (catch-up: its days). */
  availableSec: number;
  /** Where the picture is, seconds behind live; 0 = live. */
  behindSec: number;
  /** Catch-up archive days (0 = the on-box buffer). */
  archiveDays: number;
  /** Why rewind can't be used right now, when it can't. */
  note?: string;
}

interface Args {
  /** A channel plays full screen on the native player. */
  active: boolean;
  /** The channel's own address (what the player plays live). */
  directUrl: string | null;
  line: XtreamCreds | null;
  stream: Pick<XtreamLiveStream, 'stream_id' | 'tv_archive' | 'tv_archive_duration'> | null;
  /** The bar is on screen: keep the timeline fresh. */
  watching: boolean;
  /** The player engine in use: rewind is ExoPlayer only, so 'mpv' turns it off. */
  engine?: 'exo' | 'mpv';
  /** Streams the plan allows at once (null = not known). The on-box buffer runs only with 2 or more. */
  maxConnections?: number | null;
  /**
   * Recordings running now: each one uses a stream of the plan, so the buffer
   * yields when they take the streams it needs. The screen re-reads the count
   * when a recording starts or stops (RECORDINGS_CHANGED_EVENT).
   */
  activeRecordings?: number;
}

export interface LiveRewind {
  kind: RewindKind;
  /** Why rewind is off (null while it is on, or nothing plays full screen). */
  offReason: RewindOffReason | null;
  /** Play this instead of `directUrl` (catch-up); null = the channel itself. */
  playUrl: string | null;
  info: RewindInfo | null;
  /** Back / forward by `sec`. Resolves to a message for the viewer when nothing could be done. */
  rewind: (sec: number) => Promise<string | null>;
  forward: (sec: number) => Promise<string | null>;
  goLive: () => Promise<void>;
  /** The player's paused flag, for a pause on a catch-up channel. */
  onPausedChange: (paused: boolean) => void;
  /** The catch-up stream ended: back to live. */
  onEnded: () => void;
}

/** Panel clock offsets, per server, for this run. */
const offsetByHost = new Map<string, number>();
/**
 * Minutes the panel's clock is ahead of UTC (cached per server for the run;
 * the box's own offset when the panel doesn't say). Also used by scheduled
 * recordings to turn a listing's panel-time text into a real moment.
 */
export async function panelOffset(line: XtreamCreds): Promise<number> {
  const known = offsetByHost.get(line.host);
  if (known != null) return known;
  let off: number | null = null;
  try {
    const r = await authenticate(line);
    off = serverUtcOffsetMinutes((r as { server_info?: { time_now?: unknown; timestamp_now?: unknown } } | null)?.server_info);
  } catch { /* offline or blocked: the box's own clock */ }
  const v = off ?? deviceUtcOffsetMinutes();
  offsetByHost.set(line.host, v);
  return v;
}

/**
 * What the panel says about the line now: the account read the app already
 * makes (direct first, then Snow Media's list proxy on an ISP block). Null
 * when it fails or doesn't say. The request carries the line's login: nothing
 * here logs it or its errors.
 */
async function fetchLineUsage(line: XtreamCreds): Promise<LineUsage | null> {
  try { return parseLineUsage(await authenticate(line)); } catch { return null; }
}

/** A long pause on a catch-up channel resumes from the archive (shorter ones from the player's memory). */
export const CATCHUP_RESUME_AFTER_MS = 60_000;
/** Forward to within this of now is live. */
const CATCHUP_LIVE_SLACK_MS = 30_000;

export function useLiveRewind({ active, directUrl, line, stream, watching, engine = 'exo', maxConnections = null, activeRecordings = 0 }: Args): LiveRewind {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<RewindSettings>(loadRewindSettings);
  useEffect(() => {
    const on = () => setSettings(loadRewindSettings());
    window.addEventListener(REWIND_SETTINGS_EVENT, on);
    return () => window.removeEventListener(REWIND_SETTINGS_EVENT, on);
  }, []);

  const days = catchupDays(stream);
  // The plan check (no request): can the plan ever hold the picture and the buffer?
  const gate = bufferGate(maxConnections, activeRecordings);
  // The gate that ignores recordings: tells "the plan is too small" from "recordings took the room".
  const planGate = bufferGate(maxConnections, 0);
  const playing = active && !!stream && !!line;
  const key = stream && line ? rewindChannelKey(line.host, stream.stream_id) : '';

  // ---- is a stream free on the line? -------------------------------------------
  // For an ordinary channel the plan check passes, the panel is asked once
  // (a few seconds after the channel opens: zapping doesn't ask per channel),
  // and the buffer starts only if a stream is free. Not asked at all when
  // rewind is off, on mpv, on a catch-up channel, or when not full screen.
  const wantBuffer = playing && engine !== 'mpv' && settings.enabled && days === 0 && gate === 'ok' && !!directUrl;
  // Coming back from Home: the plugin wiped the buffer, so start again (and ask again).
  const [resumeNonce, setResumeNonce] = useState(0);
  // Bumped by the retry timer: ask again after the buffer was refused or gave up.
  const [retryNonce, setRetryNonce] = useState(0);
  const checkToken = `${key}#${resumeNonce}#${retryNonce}`;
  const [lineCheck, setLineCheck] = useState<LineCheck | null>(null);
  const verdict = lineCheck && lineCheck.token === checkToken ? lineCheck : null;
  let kind: RewindKind = 'off';
  let offReason: RewindOffReason | null = null;
  if (playing) {
    if (engine === 'mpv') offReason = 'engine';
    else if (!settings.enabled) offReason = 'disabled';
    else if (days > 0) kind = 'catchup';
    else if (gate === 'unknown') offReason = 'streams-unknown';
    else if (gate === 'few') offReason = planGate === 'ok' ? 'recording' : 'streams';
    else if (!verdict) offReason = 'line-checking';
    else if (verdict.gate === 'ok') kind = 'buffer';
    else if (verdict.taken) offReason = 'line-taken';
    else if (verdict.gate === 'full') offReason = 'line-full';
    else if (verdict.gate === 'few') offReason = 'streams';
    else offReason = 'line-unknown';
  }

  // Latest values for the timers below (they must not restart on every render).
  const lineRef = useRef(line);
  lineRef.current = line;
  const recordingsRef = useRef(activeRecordings);
  recordingsRef.current = activeRecordings;
  const maxConnectionsRef = useRef(maxConnections);
  maxConnectionsRef.current = maxConnections;
  const checkTokenRef = useRef(checkToken);
  checkTokenRef.current = checkToken;
  // What the other devices used when the buffer started (the panel's count less ours).
  const baseRef = useRef({ others: 0, rec: 0 });
  // When the panel was last asked: the running buffer never asks more often than LINE_RECHECK_MS.
  const lastAskRef = useRef(0);
  const lineUser = line ? `${line.host}|${line.username}` : '';

  // The start check.
  useEffect(() => {
    if (!wantBuffer) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      const l = lineRef.current;
      if (!l) return;
      lastAskRef.current = Date.now();
      const usage = await fetchLineUsage(l);
      if (!alive) return;
      const rec = recordingsRef.current;
      const g = bufferGate(maxConnectionsRef.current, rec, usage);
      if (usage) baseRef.current = { others: Math.max(0, usage.active - 1 - rec), rec };
      setLineCheck({ token: checkTokenRef.current, gate: g, taken: false });
    }, LINE_CHECK_SETTLE_MS);
    return () => { alive = false; window.clearTimeout(t); setLineCheck(null); };
  }, [wantBuffer, checkToken, lineUser]);

  // Not started (or given up): try again after 5 minutes, or on the next channel.
  const retryDue = wantBuffer && !!verdict && verdict.gate !== 'ok';
  useEffect(() => {
    if (!retryDue) return;
    const t = window.setTimeout(() => setRetryNonce((n) => n + 1), LINE_RETRY_MS);
    return () => window.clearTimeout(t);
  }, [retryDue, checkToken]);

  // ---- on-box buffer -------------------------------------------------------
  const bufferOn = kind === 'buffer' && !!directUrl;
  useEffect(() => {
    if (!bufferOn) return;
    let hidden = document.hidden;
    const onVis = () => {
      if (document.hidden) { hidden = true; return; }
      if (hidden) { hidden = false; setResumeNonce((n) => n + 1); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [bufferOn]);
  const maxMinutes = maxRewindMinutes(settings.maxRewind);
  useEffect(() => {
    if (!bufferOn || !directUrl || !key) return;
    void SnowPlayer.timeshiftStart({ url: directUrl, key, maxMinutes, hardCapMb: HARD_CAP_MB }).catch(() => { /* older app: no rewind */ });
  }, [bufferOn, directUrl, key, maxMinutes, resumeNonce, activeRecordings]);
  // Leaving the player, rewind switched off, the recordings taking the
  // streams, or the line taken: everything goes. (Sign-out wipes too, in playerSignOut.)
  useEffect(() => {
    if (!bufferOn) return;
    return () => { void SnowPlayer.timeshiftWipe().catch(() => { /* older app */ }); };
  }, [bufferOn]);

  const [status, setStatus] = useState<TimeshiftStatus | null>(null);
  const statusRef = useRef<TimeshiftStatus | null>(null);
  statusRef.current = status;

  // The buffer gives its stream back: jump to live first if the viewer is behind
  // it, then everything is wiped (bufferOn goes false), and one short toast says why.
  const yieldedRef = useRef('');
  const yieldBuffer = useCallback(async (token: string) => {
    if (yieldedRef.current === token) return;
    yieldedRef.current = token;
    try {
      const st = await SnowPlayer.timeshiftStatus();
      if (st.mode === 'buffer') await SnowPlayer.timeshiftGoLive();
    } catch { /* older app: the wipe below still runs */ }
    if (checkTokenRef.current !== token) return;
    setLineCheck({ token, gate: 'full', taken: true });
    try { toast({ title: i18n.t('recordings.rewind.off.lineTaken') }); } catch { /* ignore */ }
  }, []);

  // While the buffer runs: ask the panel again, at most every 60 s, and give the
  // stream back if another device has taken the line. A failed read changes nothing.
  useEffect(() => {
    if (!bufferOn) return;
    const token = checkToken;
    let alive = true;
    let busy = false;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(run, Math.max(0, lastAskRef.current + LINE_RECHECK_MS - Date.now()));
    };
    const run = async () => {
      timer = 0;
      const l = lineRef.current;
      if (!alive || !l) return;
      if (!document.hidden && !busy) {
        busy = true;
        lastAskRef.current = Date.now();
        const usage = await fetchLineUsage(l);
        busy = false;
        if (!alive) return;
        if (usage) {
          const rec = recordingsRef.current;
          const buffer = statusRef.current && statusRef.current.state === 'unavailable' ? 0 : 1;
          const own = 1 + buffer + rec;
          if (baseRef.current.rec !== rec) {
            // A recording started or stopped: the panel's count may lag, so start from this reading.
            baseRef.current = { others: Math.max(0, usage.active - own), rec };
          } else if (lineTakenByOthers(usage, own, baseRef.current.others)) {
            void yieldBuffer(token);
            return;
          }
        }
      }
      if (alive) schedule();
    };
    schedule();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [bufferOn, checkToken, yieldBuffer]);

  // The native capture's status. The provider refusing or dropping the buffer's
  // own connection ends it the same way. (Local only: no request to the panel.)
  useEffect(() => {
    if (!bufferOn) { setStatus(null); return; }
    const token = checkToken;
    let alive = true;
    const tick = async () => {
      try {
        const st = await SnowPlayer.timeshiftStatus();
        if (!alive) return;
        setStatus(st);
        if (captureRefused(st)) void yieldBuffer(token);
      } catch { /* older app */ }
    };
    void tick();
    const t = window.setInterval(tick, watching ? 1000 : 5000);
    return () => { alive = false; window.clearInterval(t); };
  }, [bufferOn, watching, key, checkToken, yieldBuffer]);

  // ---- panel catch-up --------------------------------------------------------
  // Null = live. startMs: the minute the archive stream starts at; requestedAt
  // fixes the length asked for, so the address stays the same while it plays.
  const [cu, setCu] = useState<{ startMs: number; requestedAt: number; offsetMin: number } | null>(null);
  const cuRef = useRef(cu);
  cuRef.current = cu;
  useEffect(() => { setCu(null); }, [key, kind]);
  const [cuPos, setCuPos] = useState(0);
  const cuPosRef = useRef(0);
  const cuDurRef = useRef(0);
  useEffect(() => {
    if (kind !== 'catchup' || !cu) { setCuPos(0); cuPosRef.current = 0; cuDurRef.current = 0; return; }
    let alive = true;
    const tick = async () => {
      try {
        const p = await SnowPlayer.getPosition();
        if (!alive) return;
        cuPosRef.current = p.position;
        cuDurRef.current = p.duration;
        setCuPos(p.position);
      } catch { /* ignore */ }
    };
    void tick();
    const t = window.setInterval(tick, watching ? 1000 : 5000);
    return () => { alive = false; window.clearInterval(t); };
  }, [kind, cu, watching]);

  const playUrl = useMemo(() => {
    if (kind !== 'catchup' || !cu || !line || !stream) return null;
    return buildTimeshiftUrl(line, stream.stream_id, cu.startMs, catchupDurationMin(cu.startMs, cu.requestedAt), cu.offsetMin);
  }, [kind, cu, line, stream]);

  const playCatchupFrom = useCallback(async (atMs: number) => {
    const l = lineRef.current;
    if (!l) return;
    const offsetMin = await panelOffset(l);
    setCu({ startMs: floorMinute(atMs), requestedAt: Date.now(), offsetMin });
  }, []);

  const headMs = (): number => {
    const c = cuRef.current;
    return c ? c.startMs + cuPosRef.current * 1000 : Date.now();
  };

  // A live pause on a catch-up channel.
  const pausedAtRef = useRef(0);
  const onPausedChange = useCallback((paused: boolean) => {
    if (kind !== 'catchup' || cuRef.current) { pausedAtRef.current = 0; return; }
    if (paused) { pausedAtRef.current = Date.now(); return; }
    const at = pausedAtRef.current;
    pausedAtRef.current = 0;
    if (at && Date.now() - at >= CATCHUP_RESUME_AFTER_MS) void playCatchupFrom(at);
  }, [kind, playCatchupFrom]);

  // ---- actions ---------------------------------------------------------------
  const rewind = useCallback(async (sec: number): Promise<string | null> => {
    if (kind === 'buffer') {
      try {
        const st = await SnowPlayer.timeshiftSeek({ deltaSec: -sec });
        setStatus(st);
        if (st.mode === 'buffer') return null;
        if (st.state === 'unavailable') return st.reason || t('recordings.rewind.notAvailable');
        return t('recordings.rewind.gettingReadyRetry');
      } catch {
        return t('recordings.rewind.needsLatestApp');
      }
    }
    if (kind === 'catchup') {
      const now = Date.now();
      const target = Math.max(now - days * 86_400_000, headMs() - sec * 1000);
      const c = cuRef.current;
      // Inside what is loaded, on a stream that can seek: just seek.
      if (c && target >= c.startMs && cuDurRef.current > 0) {
        try { await SnowPlayer.seekTo({ position: (target - c.startMs) / 1000 }); } catch { /* ignore */ }
        return null;
      }
      await playCatchupFrom(target);
      return null;
    }
    return null;
  }, [kind, days, playCatchupFrom, t]);

  const goLive = useCallback(async () => {
    if (kind === 'buffer') {
      try { setStatus(await SnowPlayer.timeshiftGoLive()); } catch { /* older app */ }
      return;
    }
    setCu(null);
  }, [kind]);

  const forward = useCallback(async (sec: number): Promise<string | null> => {
    if (kind === 'buffer') {
      try {
        const before = status?.mode;
        const st = await SnowPlayer.timeshiftSeek({ deltaSec: sec });
        setStatus(st);
        return before !== 'buffer' && st.mode === 'live' ? t('recordings.rewind.watchingLive') : null;
      } catch {
        return null;
      }
    }
    if (kind === 'catchup') {
      const c = cuRef.current;
      if (!c) return t('recordings.rewind.watchingLive');
      const target = headMs() + sec * 1000;
      if (target >= Date.now() - CATCHUP_LIVE_SLACK_MS) { setCu(null); return null; }
      if (cuDurRef.current > 0) {
        try { await SnowPlayer.seekTo({ position: (target - c.startMs) / 1000 }); } catch { /* ignore */ }
        return null;
      }
      if (floorMinute(target) > c.startMs) { await playCatchupFrom(target); return null; }
      return t('recordings.rewind.archiveStep');
    }
    return null;
  }, [kind, status, playCatchupFrom, t]);

  const onEnded = useCallback(() => { if (cuRef.current) setCu(null); }, []);

  const info = useMemo<RewindInfo | null>(() => {
    if (kind === 'buffer') {
      const st = status;
      if (!st) return { availableSec: 0, behindSec: 0, archiveDays: 0 };
      return {
        availableSec: st.availableSec,
        behindSec: st.mode === 'buffer' ? st.behindSec : 0,
        archiveDays: 0,
        note: st.state === 'unavailable' ? (st.reason || t('recordings.rewind.notAvailable')) : undefined,
      };
    }
    if (kind === 'catchup') {
      const behind = cu ? Math.max(0, (Date.now() - (cu.startMs + cuPos * 1000)) / 1000) : 0;
      return { availableSec: days * 86_400, behindSec: behind, archiveDays: days };
    }
    return null;
  }, [kind, status, cu, cuPos, days, t]);

  return { kind, offReason, playUrl, info, rewind, forward, goLive, onPausedChange, onEnded };
}
