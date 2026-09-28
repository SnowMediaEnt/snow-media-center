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
//   plan allows two or more streams (bufferGate), and never on mpv.
//
// Addresses carry the line's credentials. This file never logs one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SnowPlayer, type TimeshiftStatus } from '@/capacitor/SnowPlayer';
import { authenticate, type XtreamCreds, type XtreamLiveStream } from '@/lib/xtream';
import {
  HARD_CAP_MB, REWIND_SETTINGS_EVENT, buildTimeshiftUrl, catchupDays, catchupDurationMin,
  deviceUtcOffsetMinutes, floorMinute, loadRewindSettings, maxRewindMinutes, rewindChannelKey,
  serverUtcOffsetMinutes, type RewindSettings,
} from '@/lib/liveRewind';

export type RewindKind = 'off' | 'buffer' | 'catchup';

/** Why rewind is off for the channel on screen (null when it is on, or nothing plays). */
export type RewindOffReason =
  /** Switched off in Settings. */
  | 'disabled'
  /** The channel plays on mpv (owner test builds): rewind is ExoPlayer only. */
  | 'engine'
  /** The plan allows one stream, so the buffer's second stream is not opened. */
  | 'streams'
  /** How many streams the plan allows is not known (another saved line). */
  | 'streams-unknown'
  /** Recordings are using the streams the buffer would need. */
  | 'recording';

/** The buffer needs its own stream next to the picture being watched. */
export const BUFFER_MIN_STREAMS = 2;

export type BufferGate = 'ok' | 'unknown' | 'few';

/**
 * May the on-box buffer open its second stream? Only when the plan's streams,
 * less those the running recordings use, still leave two (the picture and the
 * buffer). An unknown plan counts as no: a wrong guess on a one-stream line
 * costs the viewer the picture they are watching.
 */
export function bufferGate(maxConnections: number | null | undefined, activeRecordings = 0): BufferGate {
  if (maxConnections == null) return 'unknown';
  const n = Math.floor(Number(maxConnections));
  if (!Number.isFinite(n) || n < 1) return 'unknown';
  return n - Math.max(0, Math.floor(activeRecordings)) >= BUFFER_MIN_STREAMS ? 'ok' : 'few';
}

/** What to tell the viewer who asks for rewind while it is off. */
export function rewindOffMessage(reason: RewindOffReason | null): string {
  switch (reason) {
    case 'streams': return 'Your plan allows 1 stream, so rewind works only on channels with catch-up.';
    case 'streams-unknown': return 'This box can\'t tell how many streams your plan allows, so rewind works only on channels with catch-up.';
    case 'recording': return 'Rewind is paused while recording (your plan\'s streams are in use).';
    case 'engine': return 'Rewind needs the ExoPlayer engine. Change it under Live TV settings › Playback.';
    default: return 'Rewind is off. Turn on Rewind live TV in Live TV settings.';
  }
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

/** A long pause on a catch-up channel resumes from the archive (shorter ones from the player's memory). */
export const CATCHUP_RESUME_AFTER_MS = 60_000;
/** Forward to within this of now is live. */
const CATCHUP_LIVE_SLACK_MS = 30_000;

export function useLiveRewind({ active, directUrl, line, stream, watching, engine = 'exo', maxConnections = null, activeRecordings = 0 }: Args): LiveRewind {
  const [settings, setSettings] = useState<RewindSettings>(loadRewindSettings);
  useEffect(() => {
    const on = () => setSettings(loadRewindSettings());
    window.addEventListener(REWIND_SETTINGS_EVENT, on);
    return () => window.removeEventListener(REWIND_SETTINGS_EVENT, on);
  }, []);

  const days = catchupDays(stream);
  const gate = bufferGate(maxConnections, activeRecordings);
  // The gate that ignores recordings: tells "the plan is too small" from "recordings took the room".
  const planGate = bufferGate(maxConnections, 0);
  const playing = active && !!stream && !!line;
  let kind: RewindKind = 'off';
  let offReason: RewindOffReason | null = null;
  if (playing) {
    if (engine === 'mpv') offReason = 'engine';
    else if (!settings.enabled) offReason = 'disabled';
    else if (days > 0) kind = 'catchup';
    else if (gate === 'ok') kind = 'buffer';
    else if (gate === 'unknown') offReason = 'streams-unknown';
    else offReason = planGate === 'ok' ? 'recording' : 'streams';
  }
  const key = stream && line ? rewindChannelKey(line.host, stream.stream_id) : '';

  // ---- on-box buffer -------------------------------------------------------
  const bufferOn = kind === 'buffer' && !!directUrl;
  // Coming back from Home: the plugin wiped the buffer, so start again.
  const [resumeNonce, setResumeNonce] = useState(0);
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
  }, [bufferOn, directUrl, key, maxMinutes, resumeNonce]);
  // Leaving the player, rewind switched off, or the recordings taking the
  // streams: everything goes. (Sign-out wipes too, in playerSignOut.)
  useEffect(() => {
    if (!bufferOn) return;
    return () => { void SnowPlayer.timeshiftWipe().catch(() => { /* older app */ }); };
  }, [bufferOn]);

  const [status, setStatus] = useState<TimeshiftStatus | null>(null);
  useEffect(() => {
    if (!bufferOn) { setStatus(null); return; }
    if (!watching) return;
    let alive = true;
    const tick = async () => {
      try { const st = await SnowPlayer.timeshiftStatus(); if (alive) setStatus(st); } catch { /* older app */ }
    };
    void tick();
    const t = window.setInterval(tick, 1000);
    return () => { alive = false; window.clearInterval(t); };
  }, [bufferOn, watching, key]);

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

  const lineRef = useRef(line);
  lineRef.current = line;
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
        if (st.state === 'unavailable') return st.reason || 'Rewind is not available on this channel.';
        return 'Rewind is getting ready. Try again in a few seconds.';
      } catch {
        return 'Rewind needs the latest Snow Media Center app.';
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
  }, [kind, days, playCatchupFrom]);

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
        return before !== 'buffer' && st.mode === 'live' ? 'You are watching live.' : null;
      } catch {
        return null;
      }
    }
    if (kind === 'catchup') {
      const c = cuRef.current;
      if (!c) return 'You are watching live.';
      const target = headMs() + sec * 1000;
      if (target >= Date.now() - CATCHUP_LIVE_SLACK_MS) { setCu(null); return null; }
      if (cuDurRef.current > 0) {
        try { await SnowPlayer.seekTo({ position: (target - c.startMs) / 1000 }); } catch { /* ignore */ }
        return null;
      }
      if (floorMinute(target) > c.startMs) { await playCatchupFrom(target); return null; }
      return 'This channel\'s archive moves a minute at a time. Press again, or Go live.';
    }
    return null;
  }, [kind, status, playCatchupFrom]);

  const onEnded = useCallback(() => { if (cuRef.current) setCu(null); }, []);

  const info = useMemo<RewindInfo | null>(() => {
    if (kind === 'buffer') {
      const st = status;
      if (!st) return { availableSec: 0, behindSec: 0, archiveDays: 0 };
      return {
        availableSec: st.availableSec,
        behindSec: st.mode === 'buffer' ? st.behindSec : 0,
        archiveDays: 0,
        note: st.state === 'unavailable' ? (st.reason || 'Rewind is not available on this channel.') : undefined,
      };
    }
    if (kind === 'catchup') {
      const behind = cu ? Math.max(0, (Date.now() - (cu.startMs + cuPos * 1000)) / 1000) : 0;
      return { availableSec: days * 86_400, behindSec: behind, archiveDays: days };
    }
    return null;
  }, [kind, status, cu, cuPos, days]);

  return { kind, offReason, playUrl, info, rewind, forward, goLive, onPausedChange, onEnded };
}
