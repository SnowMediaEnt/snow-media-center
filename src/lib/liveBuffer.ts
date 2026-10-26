// Live TV's "Live buffer" (owner, 2026-10-26: "sooo many complaints about
// 24/7"). How much of a live channel the native player holds before it plays
// (`start`) and before it plays on after a stall (`rebuffer`), sent with each
// load (SnowPlayerLoadOpts.liveStartBufferMs / liveRebufferMs; LiveCushion.kt).
//
// A live .ts stream arrives at about real-time speed, so the wait before the
// picture starts IS the cushion the whole session keeps: start at 2.5 s and
// any hiccup of the server longer than 2.5 s stalls. A 24/7 channel is a
// looped film, often at a higher bitrate and from a busier origin, and
// hiccups more.
//
// The setting (Live TV Settings › Player › Live buffer): Auto (default),
// Small, Medium, Large, Extra large. Auto:
//   • a normal channel starts quick (Small), so zapping stays fast;
//   • a 24/7 channel (its category or name says "24/7", "24-7" or "247")
//     starts at Large (10 s);
//   • a channel that stalls anyway gets one size more for the rest of the
//     day (2.5 → 6 → 10 → 15 s; a 24/7 one 10 → 15 s), at most every STEP_GAP_MS, kept per box in
//     localStorage, so it starts with the bigger cushion next time too.
// The fixed sizes never step. Every storage access is wrapped: with storage
// off the steps are kept in memory for the session.
import { hash32 } from '@/lib/hash32';

export type LiveBufferChoice = 'auto' | 'small' | 'medium' | 'large' | 'xlarge';

export interface LiveCushion {
  startMs: number;
  rebufferMs: number;
}

/** The sizes, smallest first (Auto's steps go along these). */
export const CUSHION_LEVELS: readonly LiveCushion[] = [
  { startMs: 2500, rebufferMs: 5000 },
  { startMs: 6000, rebufferMs: 8000 },
  { startMs: 10000, rebufferMs: 12000 },
  { startMs: 15000, rebufferMs: 18000 },
];
/** The player's own, and Auto's for a normal channel. */
export const DEFAULT_CUSHION: LiveCushion = CUSHION_LEVELS[0];
/** Auto's start for a 24/7 channel: Large (owner, 2026-10-26: "for 24/7 we
 *  can make the buffer bigger; live channels people like the quick loading"). */
export const AUTO_247_CUSHION: LiveCushion = CUSHION_LEVELS[2];
/** Auto steps a channel up at most this often. */
export const STEP_GAP_MS = 30_000;

export const LIVE_BUFFER_CHOICES: readonly LiveBufferChoice[] = ['auto', 'small', 'medium', 'large', 'xlarge'];
const FIXED: Record<Exclude<LiveBufferChoice, 'auto'>, LiveCushion> = {
  small: CUSHION_LEVELS[0],
  medium: CUSHION_LEVELS[1],
  large: CUSHION_LEVELS[2],
  xlarge: CUSHION_LEVELS[3],
};
/** Translation keys of the choices (live.playback.buffer.*). */
export const LIVE_BUFFER_LABEL_KEY: Record<LiveBufferChoice, string> = {
  auto: 'live.playback.buffer.auto',
  small: 'live.playback.buffer.small',
  medium: 'live.playback.buffer.medium',
  large: 'live.playback.buffer.large',
  xlarge: 'live.playback.buffer.xlarge',
};

export const LIVE_BUFFER_KEY = 'smc-live-buffer';
export const LIVE_BUFFER_STEPS_KEY = 'smc-live-buffer-steps-v1';
/** Fired on window when the setting changes (the Settings menu's Player line). */
export const LIVE_BUFFER_EVENT = 'smc:live-buffer-changed';

export function loadLiveBuffer(): LiveBufferChoice {
  try {
    const v = localStorage.getItem(LIVE_BUFFER_KEY);
    if (v && (LIVE_BUFFER_CHOICES as readonly string[]).includes(v)) return v as LiveBufferChoice;
  } catch { /* ignore */ }
  return 'auto';
}

export function saveLiveBuffer(choice: LiveBufferChoice): void {
  try { localStorage.setItem(LIVE_BUFFER_KEY, choice); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(LIVE_BUFFER_EVENT)); } catch { /* ignore */ }
}

/** A 24/7 channel by its name or category: "24/7", "24-7" or "247" (not inside a longer number). */
export function isTwentyFourSeven(...texts: Array<string | null | undefined>): boolean {
  return texts.some((s) => !!s && /24\s*[/-]\s*7|(^|[^0-9])247([^0-9]|$)/i.test(s));
}

// ── Auto's steps, per channel, for the day ──────────────────────────────────

interface Steps { day: string; ch: Record<string, number> }

const dayOf = (now: number): string => {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// Storage off: kept here for the session. Also the session's own record, so
// a step holds for the rest of it even past midnight.
let session: Record<string, number> = {};
let memory: Steps | null = null;
const lastStepAt = new Map<string, number>();

export function __resetLiveBufferForTests(): void {
  session = {};
  memory = null;
  lastStepAt.clear();
}

/** The key a channel's step is kept under: never the line's login. */
export const channelBufferKey = (lineChannelKey: string): string => hash32(lineChannelKey).toString(36);

function readSteps(now: number): Steps {
  const day = dayOf(now);
  let s: Partial<Steps> | null = memory;
  if (!s) {
    try {
      const raw = localStorage.getItem(LIVE_BUFFER_STEPS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') s = parsed as Partial<Steps>;
    } catch { s = null; }
  }
  if (!s || s.day !== day || !s.ch || typeof s.ch !== 'object') return { day, ch: {} };
  return { day, ch: { ...s.ch } };
}

function writeSteps(next: Steps): void {
  try {
    localStorage.setItem(LIVE_BUFFER_STEPS_KEY, JSON.stringify(next));
    memory = null;
  } catch { memory = next; }
}

/** The step a channel has reached (0 = none), today or this session. */
export function stepOf(key: string, now = Date.now()): number {
  const stored = readSteps(now).ch[key];
  const day = typeof stored === 'number' && Number.isFinite(stored) ? stored : 0;
  const own = session[key] ?? 0;
  return Math.max(0, Math.min(CUSHION_LEVELS.length - 1, Math.max(day, own)));
}

/** The level a cushion is at: the biggest size it holds at least. */
const levelOf = (c: LiveCushion): number => {
  let at = 0;
  CUSHION_LEVELS.forEach((l, i) => { if (c.startMs >= l.startMs) at = i; });
  return at;
};

export interface ChannelInfo {
  /** channelBufferKey of the channel; null: no steps (nothing to key them by). */
  key: string | null;
  name?: string | null;
  category?: string | null;
}

/** The cushion a channel loads with. */
export function cushionFor(choice: LiveBufferChoice, ch: ChannelInfo, now = Date.now()): LiveCushion {
  if (choice !== 'auto') return FIXED[choice];
  const base = isTwentyFourSeven(ch.name, ch.category) ? AUTO_247_CUSHION : DEFAULT_CUSHION;
  const step = ch.key ? stepOf(ch.key, now) : 0;
  const stepped = CUSHION_LEVELS[step];
  return stepped.startMs > base.startMs ? stepped : base;
}

/**
 * A real stall on a channel playing with `current`: Auto steps it up one
 * size (kept for the day), unless it stepped less than STEP_GAP_MS ago or is
 * at the biggest. The new cushion, or null when nothing changed.
 */
export function noteStall(choice: LiveBufferChoice, ch: ChannelInfo, current: LiveCushion, now = Date.now()): LiveCushion | null {
  if (choice !== 'auto' || !ch.key) return null;
  const last = lastStepAt.get(ch.key);
  if (last != null && last <= now && now - last < STEP_GAP_MS) return null;
  const next = levelOf(current) + 1;
  if (next >= CUSHION_LEVELS.length) return null;
  lastStepAt.set(ch.key, now);
  session[ch.key] = Math.max(session[ch.key] ?? 0, next);
  const steps = readSteps(now);
  steps.ch[ch.key] = Math.max(steps.ch[ch.key] ?? 0, next);
  writeSteps(steps);
  return CUSHION_LEVELS[next];
}

/** Bigger than the player's own start: the picture takes longer, and says why. */
export const isBigCushion = (c: LiveCushion | null | undefined): boolean => !!c && c.startMs > DEFAULT_CUSHION.startMs;
