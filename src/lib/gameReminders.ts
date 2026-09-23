// "Remind me" on Game Day: at kickoff a popup on the TV offers to put the
// game on (GameReminderHost). Kept on the box; a reminder is let go a few
// hours after its game starts. It only shows while the app is open — or
// when it is opened in the first half hour of the game.
import type { LiveDeeplink } from '@/lib/appActions';

export interface GameReminder {
  id: string;
  title: string;
  leagueLabel: string;
  /** ISO kickoff time. */
  start: string;
  /** The channel Game Day found for it, if any. */
  channel?: LiveDeeplink;
  networks: string[];
  firedAt?: number;
}

const KEY = 'smc-game-reminders-v1';
export const GAME_REMINDERS_EVENT = 'smc-game-reminders:changed';
/** Pop up this long before the listed start… */
const EARLY_MS = 60_000;
/** …and still offer it this long after. */
const LATE_MS = 30 * 60_000;
const FORGET_MS = 4 * 60 * 60_000;

const load = (): GameReminder[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((r) => r && typeof r.id === 'string' && typeof r.start === 'string') : [];
  } catch { return []; }
};
const save = (list: GameReminder[]) => {
  const now = Date.now();
  const kept = list.filter((r) => Date.parse(r.start) + FORGET_MS > now).slice(-30);
  try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* full */ }
  try { window.dispatchEvent(new CustomEvent(GAME_REMINDERS_EVENT)); } catch { /* ignore */ }
};

export const hasReminder = (id: string): boolean => load().some((r) => r.id === id);

/** Add or remove. Returns whether it is set now. */
export function toggleReminder(r: GameReminder): boolean {
  const list = load();
  if (list.some((x) => x.id === r.id)) { save(list.filter((x) => x.id !== r.id)); return false; }
  save([...list, { ...r, firedAt: undefined }]);
  return true;
}

/** Reminders whose game is starting now (and not shown yet). */
export function dueReminders(now = Date.now()): GameReminder[] {
  return load().filter((r) => {
    const t = Date.parse(r.start);
    return !r.firedAt && Number.isFinite(t) && now >= t - EARLY_MS && now < t + LATE_MS;
  });
}

export function markFired(id: string): void {
  save(load().map((r) => (r.id === id ? { ...r, firedAt: Date.now() } : r)));
}

export const reminderCount = (): number => load().filter((r) => !r.firedAt).length;
