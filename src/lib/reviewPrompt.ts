// When to ask "Rate Snow Media Center" on its own (the Settings entry opens
// the same screen any time; nothing here applies to it).
//
// The ask comes after real use: 10 hours of the app in the foreground on this
// box, spread over at least 3 different days. "Not now" (or a prompt that was
// shown and never answered) waits 7 more days AND 5 more hours of use. Three
// asks at most, and none at all once a review was sent from this box.
//
// Foreground time is counted here, on a 30-second heartbeat, the same way the
// analytics dwell timers keep a heartbeat (src/lib/analytics.ts): an interval
// while the page is visible, settled at once when it is hidden. Analytics'
// own session clock lives on the server (analytics_sessions) and only counts
// on the installed app, so it can't be read back here; this is a small local
// total instead. One small JSON value in localStorage, written once per beat.
//
// Kept apart from the pure rule (shouldAskForReview) so the rule can be tested
// with plain numbers.

const KEY = 'smc_review_prompt';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Foreground time before the first ask. */
export const REVIEW_MIN_FOREGROUND_MS = 10 * HOUR;
/** Different days the app was used on before the first ask. */
export const REVIEW_MIN_DAYS = 3;
/** After "Not now": this long on the calendar… */
export const REVIEW_SNOOZE_MS = 7 * DAY;
/** …and this much more use. */
export const REVIEW_SNOOZE_FOREGROUND_MS = 5 * HOUR;
/** Asks, ever, on one box. */
export const REVIEW_MAX_ASKS = 3;
/** Nothing in the first moments after the app starts. */
export const REVIEW_STARTUP_QUIET_MS = 20_000;
/** The viewer has not pressed a key on Home for this long. */
export const REVIEW_IDLE_MS = 8_000;

/** The heartbeat. */
export const FOREGROUND_BEAT_MS = 30_000;
/** A beat longer than this is a box that slept, not time watched. */
const MAX_BEAT_MS = 2 * FOREGROUND_BEAT_MS;
/** Distinct days kept: only "at least 3" matters. */
const MAX_DAYS_KEPT = 7;

export interface ReviewPromptState {
  /** Foreground time on this box, ms. */
  fgMs: number;
  /** Local days ('2026-10-06') the app was in use, latest last. */
  days: string[];
  /** Times the prompt has been shown. */
  asks: number;
  /** When it was last shown (ms since epoch), 0 if never. */
  lastAskAt: number;
  /** fgMs when it was last shown. */
  lastAskFgMs: number;
  /** A review was sent from this box. */
  submitted: boolean;
}

const EMPTY: ReviewPromptState = { fgMs: 0, days: [], asks: 0, lastAskAt: 0, lastAskFgMs: 0, submitted: false };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export function loadReviewState(): ReviewPromptState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY, days: [] };
    const p = JSON.parse(raw) as Partial<ReviewPromptState>;
    return {
      fgMs: num(p.fgMs),
      days: Array.isArray(p.days) ? p.days.filter((d) => typeof d === 'string').slice(-MAX_DAYS_KEPT) : [],
      asks: num(p.asks),
      lastAskAt: num(p.lastAskAt),
      lastAskFgMs: num(p.lastAskFgMs),
      submitted: p.submitted === true,
    };
  } catch {
    return { ...EMPTY, days: [] };
  }
}

function saveReviewState(s: ReviewPromptState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: try next beat */ }
}

/** The local calendar day, e.g. '2026-10-06'. Plain numbers: no Intl on Chrome 66. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Adds foreground time that ended at `now`. Returns the new state (also saved). */
export function addForegroundTime(ms: number, now = Date.now()): ReviewPromptState {
  const s = loadReviewState();
  const add = Math.max(0, Math.min(ms, MAX_BEAT_MS));
  if (add <= 0) return s;
  s.fgMs += add;
  const today = dayKey(now);
  if (!s.days.includes(today)) {
    s.days = [...s.days, today].slice(-MAX_DAYS_KEPT);
  }
  saveReviewState(s);
  return s;
}

/** The prompt is on screen: counts as an ask, and starts the snooze. */
export function markReviewAsked(now = Date.now()): ReviewPromptState {
  const s = loadReviewState();
  s.asks += 1;
  s.lastAskAt = now;
  s.lastAskFgMs = s.fgMs;
  saveReviewState(s);
  return s;
}

/** A review was sent from this box: never ask again. */
export function markReviewSubmitted(): void {
  const s = loadReviewState();
  s.submitted = true;
  saveReviewState(s);
}

/** Foreground hours so far, one decimal (sent with a review). */
export function foregroundHours(s = loadReviewState()): number {
  return Math.round((s.fgMs / HOUR) * 10) / 10;
}

/** What the box knows about this moment, for the rule below. */
export interface ReviewPromptContext {
  now: number;
  kids: boolean;
  demo: boolean;
  signedIn: boolean;
  /** The review_prompt feature flag (missing row = on). */
  flagOn: boolean;
  onHome: boolean;
  /** ms since the app started. */
  sinceStartMs: number;
  /** Live TV, Plex or a film playing, or a player on screen. */
  playing: boolean;
  /** Another dialog, notice or prompt is up. */
  dialogOpen: boolean;
  /** ms since the viewer last pressed a key. */
  idleMs: number;
}

export type ReviewPromptVerdict =
  | 'ask'
  | 'off' | 'kids' | 'demo' | 'signedOut'
  | 'submitted' | 'maxAsks' | 'tooSoon' | 'tooFewDays' | 'snoozed'
  | 'notHome' | 'starting' | 'playing' | 'dialog' | 'busy';

/** Whether the schedule alone (time used, days, snooze, asks) says it is time. */
export function scheduleVerdict(s: ReviewPromptState, now: number): ReviewPromptVerdict {
  if (s.submitted) return 'submitted';
  if (s.asks >= REVIEW_MAX_ASKS) return 'maxAsks';
  if (s.fgMs < REVIEW_MIN_FOREGROUND_MS) return 'tooSoon';
  if (s.days.length < REVIEW_MIN_DAYS) return 'tooFewDays';
  if (s.asks > 0) {
    if (now - s.lastAskAt < REVIEW_SNOOZE_MS) return 'snoozed';
    if (s.fgMs - s.lastAskFgMs < REVIEW_SNOOZE_FOREGROUND_MS) return 'snoozed';
  }
  return 'ask';
}

/** The whole rule: schedule, who is watching, and what is on screen. */
export function shouldAskForReview(s: ReviewPromptState, c: ReviewPromptContext): ReviewPromptVerdict {
  if (!c.flagOn) return 'off';
  if (c.demo) return 'demo';
  if (c.kids) return 'kids';
  if (!c.signedIn) return 'signedOut';
  const due = scheduleVerdict(s, c.now);
  if (due !== 'ask') return due;
  if (!c.onHome) return 'notHome';
  if (c.sinceStartMs < REVIEW_STARTUP_QUIET_MS) return 'starting';
  if (c.playing) return 'playing';
  if (c.dialogOpen) return 'dialog';
  if (c.idleMs < REVIEW_IDLE_MS) return 'busy';
  return 'ask';
}

/* ── the foreground clock ─────────────────────────────────────────────────── */

let startedAt = 0;
let clockOn = false;

/** When the clock (the app) started, ms since epoch; 0 before. */
export const appStartedAt = (): number => startedAt;

/**
 * Starts counting foreground time. Call once at app start; later calls do
 * nothing. Returns a stop function (tests; the app never stops it).
 */
export function startForegroundClock(): () => void {
  if (clockOn) return () => {};
  clockOn = true;
  const now0 = Date.now();
  if (!startedAt) startedAt = now0;
  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  let last = visible() ? now0 : 0;

  const settle = () => {
    if (!last) return;
    const now = Date.now();
    addForegroundTime(now - last, now);
    last = now;
  };
  const beat = window.setInterval(() => { if (visible()) settle(); }, FOREGROUND_BEAT_MS);
  const onVisibility = () => {
    if (visible()) { last = Date.now(); return; }
    settle();
    last = 0;
  };
  const onHide = () => { settle(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onHide);
  return () => {
    window.clearInterval(beat);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onHide);
    clockOn = false;
  };
}

/** Tests: forget the clock's start. */
export function resetForegroundClockForTests(): void {
  startedAt = 0;
  clockOn = false;
}
