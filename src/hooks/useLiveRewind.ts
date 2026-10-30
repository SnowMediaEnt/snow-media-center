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
//   The buffer is fed by the player's own connection, and keeps the live edge
//   on one connection of its own only while the player is on the buffer (the
//   player's is closed then): never a second stream of the line. So it needs
//   no free stream and no panel check, runs on any plan and next to
//   recordings, and has nothing to give back to another device. Never on mpv.
//
// Addresses carry the line's credentials. This file never logs one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SnowPlayer, type TimeshiftStatus } from '@/capacitor/SnowPlayer';
import { markSeek } from '@/lib/playerSeek';
import { authenticate, type XtreamCreds, type XtreamLiveStream } from '@/lib/xtream';
import {
  HARD_CAP_MB, REWIND_SETTINGS_EVENT,
  buildTimeshiftUrl, catchupDays, catchupDurationMin, deviceUtcOffsetMinutes, floorMinute,
  loadRewindSettings, maxRewindMinutes, rewindChannelKey,
  serverUtcOffsetMinutes, type RewindOffReason, type RewindSettings,
} from '@/lib/liveRewind';

// The reasons and their words live in liveRewind.ts; these keep the old import path working.
export { rewindOffMessage } from '@/lib/liveRewind';
export type { RewindOffReason } from '@/lib/liveRewind';

export type RewindKind = 'off' | 'buffer' | 'catchup';

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
  /**
   * How far behind live the picture is right now, in seconds (0 at live), as
   * of the last rewind / forward even before a re-render; null when rewind
   * is off.
   */
  behindNow: () => number | null;
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

/**
 * What of a capture status the screen shows (the rewind bar's numbers, its
 * note, the arrows' "can jump" checks): two statuses with the same key draw
 * the same. With the bar up, whole seconds count; with it hidden only the
 * one-second thresholds the arrow keys and the box view test. The native call
 * hands back a new object every tick, so LiveSection re-renders only when
 * this changes; the latest status is always in the ref for code that reads
 * it at the moment (behindNow).
 */
export function timeshiftShownKey(st: TimeshiftStatus | null, barUp: boolean): string {
  if (!st) return '';
  const behind = st.mode === 'buffer' ? st.behindSec : 0;
  const head = `${st.state}|${st.mode}|${st.reason ?? ''}`;
  if (barUp) return `${head}|${Math.floor(st.availableSec)}|${Math.floor(behind)}`;
  return `${head}|${st.availableSec >= 1 ? 1 : 0}|${behind >= 1 ? 1 : 0}|${st.availableSec - behind >= 1 ? 1 : 0}`;
}
/** A plugin call whose failure changes nothing here (an older app has no such call: it may not even exist). */
function quietly(f: () => Promise<unknown>): Promise<unknown> {
  try { return f().catch(() => null); } catch { return Promise.resolve(null); }
}

/** Forward to within this of now is live. */
const CATCHUP_LIVE_SLACK_MS = 30_000;

export function useLiveRewind({ active, directUrl, line, stream, watching, engine = 'exo' }: Args): LiveRewind {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<RewindSettings>(loadRewindSettings);
  useEffect(() => {
    const on = () => setSettings(loadRewindSettings());
    window.addEventListener(REWIND_SETTINGS_EVENT, on);
    return () => window.removeEventListener(REWIND_SETTINGS_EVENT, on);
  }, []);

  const days = catchupDays(stream);
  const playing = active && !!stream && !!line;
  const key = stream && line ? rewindChannelKey(line.host, stream.stream_id) : '';
  let kind: RewindKind = 'off';
  let offReason: RewindOffReason | null = null;
  if (playing) {
    if (engine === 'mpv') offReason = 'engine';
    else if (!settings.enabled) offReason = 'disabled';
    else if (days > 0) kind = 'catchup';
    else kind = 'buffer';
  }

  const lineRef = useRef(line);
  lineRef.current = line;
  // Coming back from Home: the plugin wiped the buffer, so start it again.
  const [resumeNonce, setResumeNonce] = useState(0);

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
    void quietly(() => SnowPlayer.timeshiftStart({ url: directUrl, key, maxMinutes, hardCapMb: HARD_CAP_MB })); // older app: no rewind
  }, [bufferOn, directUrl, key, maxMinutes, resumeNonce]);
  // Leaving the player, or rewind switched off: everything goes. (Sign-out wipes too, in playerSignOut.)
  useEffect(() => {
    if (!bufferOn) return;
    return () => { void quietly(() => SnowPlayer.timeshiftWipe()); };
  }, [bufferOn]);

  const [status, setStatusState] = useState<TimeshiftStatus | null>(null);
  // The latest, for behindNow() straight after a jump (before the re-render).
  // Written only by setStatus and the status tick (which keeps readings the
  // screen would draw the same out of state), never from the render.
  const statusRef = useRef<TimeshiftStatus | null>(null);
  const setStatus = useCallback((st: TimeshiftStatus | null) => { statusRef.current = st; setStatusState(st); }, []);

  // The native capture's status (local only: no request to the panel). A
  // capture that stops (the channel can't be buffered, the disk is full, the
  // channel stopped sending) shows its reason in the bar's note.
  useEffect(() => {
    if (!bufferOn) { setStatus(null); return; }
    let alive = true;
    // The first reading after the bar comes up (or the channel changes) is
    // always drawn; after that only a change the screen would show.
    let shown: string | null = null;
    const tick = async () => {
      try {
        const st = await SnowPlayer.timeshiftStatus();
        if (!alive) return;
        const k = timeshiftShownKey(st, watching);
        if (k !== shown) { shown = k; setStatus(st); } else statusRef.current = st;
      } catch { /* older app */ }
    };
    void tick();
    const t = window.setInterval(tick, watching ? 1000 : 5000);
    return () => { alive = false; window.clearInterval(t); };
  }, [bufferOn, watching, key, resumeNonce, setStatus]);

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
    const next = { startMs: floorMinute(atMs), requestedAt: Date.now(), offsetMin };
    // Now, not at the re-render: a quick second ◀ builds on this one.
    cuRef.current = next;
    cuPosRef.current = 0;
    setCu(next);
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
      markSeek();
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
        markSeek();
        try {
          await SnowPlayer.seekTo({ position: (target - c.startMs) / 1000 });
          cuPosRef.current = (target - c.startMs) / 1000; // the next quick ◀ builds on it
        } catch { /* ignore */ }
        return null;
      }
      await playCatchupFrom(target);
      return null;
    }
    return null;
  }, [kind, days, playCatchupFrom, t, setStatus]);

  const goLive = useCallback(async () => {
    if (kind === 'buffer') {
      markSeek();
      try { setStatus(await SnowPlayer.timeshiftGoLive()); } catch { /* older app */ }
      return;
    }
    setCu(null);
  }, [kind, setStatus]);

  const forward = useCallback(async (sec: number): Promise<string | null> => {
    if (kind === 'buffer') {
      markSeek();
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
      if (target >= Date.now() - CATCHUP_LIVE_SLACK_MS) { cuRef.current = null; setCu(null); return null; }
      if (cuDurRef.current > 0) {
        markSeek();
        try {
          await SnowPlayer.seekTo({ position: (target - c.startMs) / 1000 });
          cuPosRef.current = (target - c.startMs) / 1000;
        } catch { /* ignore */ }
        return null;
      }
      if (floorMinute(target) > c.startMs) { await playCatchupFrom(target); return null; }
      return t('recordings.rewind.archiveStep');
    }
    return null;
  }, [kind, status, playCatchupFrom, t, setStatus]);

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

  const behindNow = useCallback((): number | null => {
    if (kind === 'buffer') {
      const st = statusRef.current;
      return st && st.mode === 'buffer' ? st.behindSec : 0;
    }
    if (kind === 'catchup') return cuRef.current ? Math.max(0, (Date.now() - headMs()) / 1000) : 0;
    return null;
  // headMs reads refs only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  return { kind, offReason, playUrl, info, rewind, forward, goLive, onPausedChange, onEnded, behindNow };
}
