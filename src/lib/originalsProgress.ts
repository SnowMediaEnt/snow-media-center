// Where each viewer stopped in each Snow Original, on this box only.
//
// Most Originals are shorts (the Hub's limit is 3 minutes): those always start
// from the beginning, so only videos of 2 minutes or more are kept and resumed.
// One list per profile (`smc-originals-progress-v1:<profile id>`), the newest
// 50 kept. Nothing here is on the playback path: every storage failure (full,
// blocked, private window) is swallowed and simply means "start at 0".
import { activeProfile } from '@/lib/profiles';

interface Entry {
  /** Seconds into the video. */
  pos: number;
  /** The video's length in seconds. */
  dur: number;
  /** When it was saved (ms since epoch). */
  at: number;
}

const PREFIX = 'smc-originals-progress-v1:';
/** Shorter videos always start at 0. */
export const RESUME_MIN_SEC = 120;
/** The first seconds are not worth resuming from. */
const START_MARGIN_SEC = 15;
/** Nor are the last ones: that is the end, start again. */
const END_MARGIN_SEC = 10;
/** Past this share of the length a video counts as watched. */
const DONE_SHARE = 0.95;
export const MAX_ENTRIES = 50;

function storageKey(): string {
  let id = 'main';
  try { id = activeProfile().id || id; } catch { /* no profiles yet */ }
  return PREFIX + id;
}

function load(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, Entry> : {};
  } catch { return {}; }
}

function store(map: Record<string, Entry>): void {
  try {
    const ids = Object.keys(map);
    if (ids.length > MAX_ENTRIES) {
      const keep = ids.sort((a, b) => (map[b].at || 0) - (map[a].at || 0)).slice(0, MAX_ENTRIES);
      const trimmed: Record<string, Entry> = {};
      for (const id of keep) trimmed[id] = map[id];
      map = trimmed;
    }
    localStorage.setItem(storageKey(), JSON.stringify(map));
  } catch { /* full or blocked: nothing is resumed */ }
}

/** Seconds to start `id` at: its saved place for a video of 2 minutes or
 *  more, when that is past the first 15 s and before the last 10 s; else 0. */
export function resumeAt(id: string, durationSec: number): number {
  const e = load()[id];
  if (!e || typeof e.pos !== 'number' || !Number.isFinite(e.pos)) return 0;
  const dur = durationSec > 0 ? durationSec : e.dur;
  if (!(dur >= RESUME_MIN_SEC)) return 0;
  return e.pos >= START_MARGIN_SEC && e.pos <= dur - END_MARGIN_SEC ? e.pos : 0;
}

/** Remember where the viewer is. Shorts are not kept (they never resume);
 *  a video watched to 95% or more is forgotten instead. */
export function saveProgress(id: string, pos: number, dur: number): void {
  if (!id || !Number.isFinite(pos) || !Number.isFinite(dur) || dur < RESUME_MIN_SEC) return;
  if (pos >= dur * DONE_SHARE) { clearProgress(id); return; }
  if (pos <= 0) return;
  const map = load();
  map[id] = { pos, dur, at: Date.now() };
  store(map);
}

/** Forget a video's place (watched to the end). */
export function clearProgress(id: string): void {
  const map = load();
  if (!(id in map)) return;
  delete map[id];
  store(map);
}
