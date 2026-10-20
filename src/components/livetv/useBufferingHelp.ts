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
//     and only after START_GRACE_MS of the channel (or a new address for it:
//     a retry, catch-up) — the start-up buffering is normal.
// NEVER while the player shows its error card (that is the dead-channel
// path: retry / failover), nor while another layer has the remote (a dialog,
// the list over the picture: it waits for it to close), nor in the demo or a
// Kids profile (the caller's `enabled`).
// NOT NAGGING: after it closes, not again for SNOOZE_MS; at most MAX_PER_DAY
// a day; a step confirmed today ("Yes, I restarted", the VPN step's guide
// opened) is skipped for the rest of the day. Kept per box in localStorage
// (every access wrapped: a box with storage off simply asks every time).
// The VPN step is asked on every service, Vibez included (owner, 2026-10-20).
//
// Analytics: 'buffering_help' with { step, action } (and the service's own
// label, which lineEventProps turns into 'outside' for an outside service's
// line) — never a channel name, host or address.
import { useCallback, useEffect, useRef, useState } from 'react';
import { trackEvent } from '@/lib/analytics';
import { lineEventProps } from '@/lib/outsideSource';
import type { XtreamCreds } from '@/lib/xtream';

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

export function readBufferHelpStore(now = Date.now()): Stored {
  let s: Partial<Stored> = {};
  try {
    const raw = localStorage.getItem(BUFFER_HELP_STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') s = parsed as Partial<Stored>;
  } catch { s = {}; }
  const closedAt = typeof s.closedAt === 'number' && Number.isFinite(s.closedAt) ? s.closedAt : 0;
  const day = dayOf(now);
  if (s.day !== day) return { day, shown: 0, restart: false, vpn: false, closedAt };
  const shown = typeof s.shown === 'number' && Number.isFinite(s.shown) ? s.shown : 0;
  return { day, shown, restart: s.restart === true, vpn: s.vpn === true, closedAt };
}

function writeBufferHelpStore(patch: Partial<Stored>, now = Date.now()): void {
  try { localStorage.setItem(BUFFER_HELP_STORE_KEY, JSON.stringify({ ...readBufferHelpStore(now), ...patch })); } catch { /* storage off */ }
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
  /** The address being played: a new one (a retry, catch-up) starts up again. */
  loadKey: string | null;
  buffering: boolean;
  /** The player's error card is up. */
  error: boolean;
  /** Another layer has the remote (a dialog, the list over the picture): wait. */
  busy: boolean;
}

export interface BufferingHelp {
  open: boolean;
  /** The steps this time, in order (the first one is shown first). */
  steps: BufferHelpStep[];
  /** It closed (Back, a choice, the channel gone): the snooze starts. */
  close: () => void;
  /** "Yes, I restarted them": not asked again today. */
  noteRestart: () => void;
  /** The guide opened from the VPN step: that step is left out today. */
  noteVpnGuide: () => void;
  track: (step: BufferHelpStep, action: string) => void;
}

export function useBufferingHelp({ enabled, watching, loadKey, buffering, error, busy }: Args): BufferingHelp {
  const key = enabled && watching ? watching.key : null;
  const lineRef = useRef<XtreamCreds | null>(null);
  if (watching) lineRef.current = watching.line;
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const [steps, setSteps] = useState<BufferHelpStep[]>([]);
  // A trigger fired and is waiting to be shown (busy, or the next render).
  const [due, setDue] = useState<BufferHelpTrigger | null>(null);
  const startAtRef = useRef(Date.now());
  const stallsRef = useRef<number[]>([]);

  const track = useCallback((step: BufferHelpStep, action: string, extra: Record<string, unknown> = {}) => {
    const line = lineRef.current;
    try { trackEvent('buffering_help', 'player', lineEventProps(line, { step, action, ...extra }, { server: line?.serverLabel ?? null })); } catch { /* ignore */ }
  }, []);

  // Another channel: its own count, and its start-up.
  useEffect(() => { stallsRef.current = []; startAtRef.current = Date.now(); setDue(null); }, [key]);
  // Another address for it, or the error card coming or going: start-up again.
  useEffect(() => { startAtRef.current = Date.now(); }, [loadKey, error]);

  const stalled = !!key && buffering && !error;
  useEffect(() => {
    if (!stalled) { setDue(null); return; }
    const since = Date.now();
    const afterStart = since - startAtRef.current >= START_GRACE_MS;
    const count = window.setTimeout(() => {
      if (!afterStart) return;
      const now = Date.now();
      const recent = stallsRef.current.filter((at) => now - at <= STALL_WINDOW_MS);
      recent.push(since);
      stallsRef.current = recent;
      if (recent.length >= STALLS_TO_ASK) setDue((d) => d ?? 'stalls');
    }, STALL_MIN_MS);
    const long = window.setTimeout(() => setDue('long'), LONG_STALL_MS);
    return () => { window.clearTimeout(count); window.clearTimeout(long); };
  }, [stalled, key, loadKey]);

  useEffect(() => {
    if (!due || open || busy || !stalled) return;
    const now = Date.now();
    const s = readBufferHelpStore(now);
    setDue(null);
    if (!bufferHelpAllowed(s, now)) return;
    writeBufferHelpStore({ shown: s.shown + 1 }, now);
    const list = bufferHelpSteps(s);
    setSteps(list);
    openRef.current = true;
    setOpen(true);
    track(list[0], 'shown', { trigger: due });
  }, [due, open, busy, stalled, track]);

  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    writeBufferHelpStore({ closedAt: Date.now() });
    stallsRef.current = [];
    setDue(null);
    setOpen(false);
  }, []);

  // Nothing watched any more (full screen left, Live TV left), or the error
  // card took over: it goes, so that card has the remote.
  useEffect(() => { if (open && (!key || error)) close(); }, [open, key, error, close]);

  const noteRestart = useCallback(() => writeBufferHelpStore({ restart: true }), []);
  const noteVpnGuide = useCallback(() => writeBufferHelpStore({ vpn: true }), []);

  return { open, steps, close, noteRestart, noteVpnGuide, track };
}
