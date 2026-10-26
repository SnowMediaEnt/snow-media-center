// "Still buffering?" (owner, 2026-10-20): a Live TV channel that keeps
// buffering gets the usual fixes, in order, over the picture
// (BufferingHelpDialog): restart the box and the router, try a VPN, then the
// Buffering Guide (or a report of the channel). The corner card
// (BufferingDiagnostics) shows the speeds; viewers ignore it, so this asks.
//
// WHEN IT SHOWS (only while the channel is buffering right then):
//   • it has buffered for LONG_STALL_MS without a break (a channel that
//     loads that slowly counts too), or
//   • it stalled STALLS_TO_ASK times within STALL_WINDOW_MS on one channel.
//     A stall counts once it lasts STALL_MIN_MS (when the corner card shows),
//     and only once START_GRACE_MS have passed since the channel started, it
//     loaded again (a new address, a retry, the app coming back: `loadKey`)
//     or the viewer jumped in it (lib/playerSeek: rewind, catch-up, Go live).
//     The start-up buffering, and a jump's, are normal.
// NEVER while the player shows its error card (that is the dead-channel
// path: retry / failover), nor while another layer has the remote (a dialog,
// the list over the picture: it waits for it to close, and a trigger kept
// for one channel never shows on the next), nor with the app in the
// background (the player is stopped there; the clocks wait too), nor in the
// demo or a Kids profile (the caller's `enabled`).
// GOES BY ITSELF when the error card comes up or the channel changes under
// it (a voice "put on…", a kickoff reminder): that close neither starts the
// rest below nor counts as one of the day's.
// NOT NAGGING: after the viewer closes it, not again for SNOOZE_MS; at most
// MAX_PER_DAY a day; a step confirmed today ("Yes, I restarted", the VPN
// step's guide opened) is skipped for the rest of the day. Kept per box in
// localStorage (every access wrapped: with storage off it is kept in memory
// for the session instead).
// The VPN step is asked on every service, Vibez included (owner, 2026-10-20).
//
// Analytics: 'buffering_help' with { step, action } (and the service's own
// label, which lineEventProps turns into 'outside' for an outside service's
// line) — never a channel name, host or address.
import { useCallback, useEffect, useRef, useState } from 'react';
import { trackEvent } from '@/lib/analytics';
import { lineEventProps } from '@/lib/outsideSource';
import { lastSeekAt } from '@/lib/playerSeek';
import type { XtreamCreds } from '@/lib/xtream';
import { DEFAULT_CUSHION, type LiveCushion } from '@/lib/liveBuffer';

export type BufferHelpStep = 'restart' | 'vpn' | 'guide';
export type BufferHelpTrigger = 'long' | 'stalls';

/** Buffering this long without a break asks. */
export const LONG_STALL_MS = 20_000;
/** A channel's (or a new address's) first seconds: its buffering is start-up, not a stall. */
export const START_GRACE_MS = 10_000;
/** A stall counts once it has lasted this long (the corner card shows then). */
export const STALL_MIN_MS = 2_000;
/** This many stalls on one channel… */
export const STALLS_TO_ASK = 3;
/** …within this long ask. */
export const STALL_WINDOW_MS = 2 * 60_000;
/** After it closes, it stays away this long. */
export const SNOOZE_MS = 15 * 60_000;
/** At most this many times a day on this box. */
export const MAX_PER_DAY = 3;
/** Keys do nothing this long after it shows, a step changes, or it hands the
 *  remote to the error card: a press already on its way never answers it. */
export const BUFFER_HELP_ARM_MS = 600;

export const BUFFER_HELP_STORE_KEY = 'smc-buffering-help-v1';

interface Stored {
  /** The local day the counts below are for (Y-M-D). */
  day: string;
  shown: number;
  /** "Yes, I restarted them" today. */
  restart: boolean;
  /** The guide opened from the VPN step today. */
  vpn: boolean;
  /** When it last closed (any day: the snooze runs past midnight). */
  closedAt: number;
}

const dayOf = (now: number): string => {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// Storage off (a write failed): kept here for the session instead, so the
// rest and the day's count still hold. Back to storage once a write works.
let memory: Partial<Stored> | null = null;
export function __resetBufferHelpMemoryForTests(): void { memory = null; }

export function readBufferHelpStore(now = Date.now()): Stored {
  let s: Partial<Stored> = {};
  if (memory) s = memory;
  else {
    try {
      const raw = localStorage.getItem(BUFFER_HELP_STORE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') s = parsed as Partial<Stored>;
    } catch { s = {}; }
  }
  const closedAt = typeof s.closedAt === 'number' && Number.isFinite(s.closedAt) ? s.closedAt : 0;
  const day = dayOf(now);
  if (s.day !== day) return { day, shown: 0, restart: false, vpn: false, closedAt };
  const shown = typeof s.shown === 'number' && Number.isFinite(s.shown) ? s.shown : 0;
  return { day, shown, restart: s.restart === true, vpn: s.vpn === true, closedAt };
}

function writeBufferHelpStore(patch: Partial<Stored>, now = Date.now()): void {
  const next = { ...readBufferHelpStore(now), ...patch };
  try {
    localStorage.setItem(BUFFER_HELP_STORE_KEY, JSON.stringify(next));
    memory = null;
  } catch { memory = next; }
}

/** May it show now: not snoozed, not over today's count. A clock set back never snoozes forever. */
export function bufferHelpAllowed(s: Stored, now = Date.now()): boolean {
  if (s.shown >= MAX_PER_DAY) return false;
  return !(s.closedAt > 0 && s.closedAt <= now && now - s.closedAt < SNOOZE_MS);
}

/** The steps to walk through, in order: what was confirmed today is left out. */
export function bufferHelpSteps(s: Pick<Stored, 'restart' | 'vpn'>): BufferHelpStep[] {
  const steps: BufferHelpStep[] = [];
  if (!s.restart) steps.push('restart');
  if (!s.vpn) steps.push('vpn');
  steps.push('guide');
  return steps;
}

interface Args {
  /** Allowed here at all (not the demo, not a Kids profile). */
  enabled: boolean;
  /** The Live TV channel being watched — full screen, or in the box upright on a
   *  phone — with its line; null when none is. Stalls are counted per `key`. */
  watching: { key: string; line: XtreamCreds } | null;
  /** The address being played and its load: a new one (another address, a
   *  retry, the app coming back) starts up again. */
  loadKey: string | null;
  buffering: boolean;
  /** The player's error card is up. */
  error: boolean;
  /** Another layer has the remote (a dialog, the list over the picture): wait. */
  busy: boolean;
  /** It went by itself: the error card came up (`error`, which then has the
   *  remote) or the channel changed under it (`channel`). */
  onGone?: (why: 'error' | 'channel') => void;
  /** The channel's Live buffer (lib/liveBuffer): a bigger one fills for that
   *  much longer at the start, or after a stall, before "buffering too long". */
  cushion?: LiveCushion | null;
}

/** The extra wait a bigger Live buffer's fill gets: at the start, or after a stall. */
export function cushionExtraMs(cushion: LiveCushion | null | undefined, inStartUp: boolean): number {
  if (!cushion) return 0;
  return Math.max(0, inStartUp ? cushion.startMs - DEFAULT_CUSHION.startMs : cushion.rebufferMs - DEFAULT_CUSHION.rebufferMs);
}

export interface BufferingHelp {
  open: boolean;
  /** The steps this time, in order (the first one is shown first). */
  steps: BufferHelpStep[];
  /** The viewer closed it (Back, a choice): the rest starts. */
  close: () => void;
  /** "Yes, I restarted them": not asked again today. */
  noteRestart: () => void;
  /** The guide opened from the VPN step: that step is left out today. */
  noteVpnGuide: () => void;
  track: (step: BufferHelpStep, action: string) => void;
}

export function useBufferingHelp({ enabled, watching, loadKey, buffering, error, busy, onGone, cushion }: Args): BufferingHelp {
  const cushionRef = useRef(cushion);
  cushionRef.current = cushion;
  const key = enabled && watching ? watching.key : null;
  const lineRef = useRef<XtreamCreds | null>(null);
  if (watching) lineRef.current = watching.line;
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  // The channel it was opened over.
  const openKeyRef = useRef<string | null>(null);
  const [steps, setSteps] = useState<BufferHelpStep[]>([]);
  // A trigger fired, for the channel it fired on, waiting to be shown (busy,
  // or the next render). One kept for another channel is dropped.
  const [due, setDue] = useState<{ trigger: BufferHelpTrigger; key: string } | null>(null);
  const startAtRef = useRef(Date.now());
  const stallsRef = useRef<number[]>([]);
  // The app in the background: the player is stopped there (useNativePlayer).
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    let handle: { remove?: () => void } | undefined;
    let cancelled = false;
    void import('@capacitor/app')
      .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => setHidden(!isActive)))
      .then((h) => { if (cancelled) h?.remove?.(); else handle = h; })
      .catch(() => { /* web */ });
    return () => { cancelled = true; document.removeEventListener('visibilitychange', on); handle?.remove?.(); };
  }, []);

  const track = useCallback((step: BufferHelpStep, action: string, extra: Record<string, unknown> = {}) => {
    const line = lineRef.current;
    try { trackEvent('buffering_help', 'player', lineEventProps(line, { step, action, ...extra }, { server: line?.serverLabel ?? null })); } catch { /* ignore */ }
  }, []);

  // Another channel: its own count, and its start-up.
  useEffect(() => { stallsRef.current = []; startAtRef.current = Date.now(); setDue(null); }, [key]);
  // Another load (address, retry, back from the background), or the error
  // card coming or going: start-up again.
  useEffect(() => { startAtRef.current = Date.now(); }, [loadKey, error, hidden]);

  const stalled = !!key && buffering && !error && !hidden;
  // A stall: counted once it lasts STALL_MIN_MS, unless it began in a start-up or right after a jump.
  useEffect(() => {
    if (!stalled || !key) return;
    const since = Date.now();
    const count = window.setTimeout(() => {
      if (since - Math.max(startAtRef.current, lastSeekAt()) < START_GRACE_MS) return;
      const now = Date.now();
      const recent = stallsRef.current.filter((at) => now - at <= STALL_WINDOW_MS);
      recent.push(since);
      stallsRef.current = recent;
      if (recent.length >= STALLS_TO_ASK) setDue((d) => d ?? { trigger: 'stalls', key });
    }, STALL_MIN_MS);
    return () => window.clearTimeout(count);
  }, [stalled, key, loadKey]);
  // Buffering without a break: through reloads of the same channel too (a
  // stream its provider keeps dropping).
  useEffect(() => {
    if (!stalled || !key) { setDue(null); return; }
    const inStartUp = Date.now() - startAtRef.current < START_GRACE_MS;
    const long = window.setTimeout(() => setDue({ trigger: 'long', key }), LONG_STALL_MS + cushionExtraMs(cushionRef.current, inStartUp));
    return () => window.clearTimeout(long);
  }, [stalled, key]);

  useEffect(() => {
    if (!due || open || busy || !stalled) return;
    setDue(null);
    if (due.key !== key) return;
    const now = Date.now();
    const s = readBufferHelpStore(now);
    if (!bufferHelpAllowed(s, now)) return;
    writeBufferHelpStore({ shown: s.shown + 1 }, now);
    const list = bufferHelpSteps(s);
    setSteps(list);
    openRef.current = true;
    openKeyRef.current = key;
    setOpen(true);
    track(list[0], 'shown', { trigger: due.trigger });
  }, [due, open, busy, stalled, key, track]);

  const shut = useCallback(() => {
    openRef.current = false;
    openKeyRef.current = null;
    stallsRef.current = [];
    setDue(null);
    setOpen(false);
  }, []);
  const close = useCallback(() => {
    if (!openRef.current) return;
    writeBufferHelpStore({ closedAt: Date.now() });
    shut();
  }, [shut]);

  // The error card came up, or the channel changed (or went) under it: it
  // goes, so the card has the remote / it never speaks of another channel.
  // Not the viewer's close: no rest, and it is not one of the day's.
  useEffect(() => {
    if (!open || !openRef.current) return;
    const why = error ? 'error' : key !== openKeyRef.current ? 'channel' : null;
    if (!why) return;
    const s = readBufferHelpStore();
    writeBufferHelpStore({ shown: Math.max(0, s.shown - 1) });
    shut();
    onGoneRef.current?.(why);
  }, [open, key, error, shut]);

  const noteRestart = useCallback(() => writeBufferHelpStore({ restart: true }), []);
  const noteVpnGuide = useCallback(() => writeBufferHelpStore({ vpn: true }), []);

  return { open, steps, close, noteRestart, noteVpnGuide, track };
}
