import type { KidsGameResult, KidsProgress } from './types';

export type KidsGameId = 'snowball-splash' | 'penguin-path' | 'sled-dash' |
  'winter-match' | 'snow-world' | 'beat-blizzard';

export const KIDS_GAME_IDS: KidsGameId[] = [
  'snowball-splash', 'penguin-path', 'sled-dash',
  'winter-match', 'snow-world', 'beat-blizzard',
];

export interface ProgressRecord extends KidsProgress { updatedAt: number }
export type ProgressBook = Partial<Record<KidsGameId, ProgressRecord>>;

export const emptyProgress = (): KidsProgress => ({ plays: 0, bestScore: 0, stars: 0, level: 1 });
const bounded = (value: unknown, min: number, max: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : min;
};

export function cleanRecord(value: Partial<ProgressRecord> | null | undefined): ProgressRecord {
  return {
    plays: bounded(value?.plays, 0, 100000000),
    bestScore: bounded(value?.bestScore, 0, 100000000),
    stars: bounded(value?.stars, 0, 100000000),
    level: bounded(value?.level, 1, 10000),
    updatedAt: bounded(value?.updatedAt, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function completeRound(previous: ProgressRecord | undefined, result: KidsGameResult, now = Date.now()): ProgressRecord {
  const old = cleanRecord(previous);
  return cleanRecord({
    plays: old.plays + 1,
    bestScore: Math.max(old.bestScore, bounded(result.score, 0, 100000000)),
    stars: old.stars + bounded(result.stars, 0, 3),
    level: Math.max(old.level, bounded(result.level ?? old.level + 1, 1, 10000)),
    updatedAt: now,
  });
}

export function mergeRecord(local: ProgressRecord | undefined, cloud: ProgressRecord | undefined): ProgressRecord {
  const a = cleanRecord(local);
  const b = cleanRecord(cloud);
  return {
    plays: Math.max(a.plays, b.plays),
    bestScore: Math.max(a.bestScore, b.bestScore),
    stars: Math.max(a.stars, b.stars),
    level: Math.max(a.level, b.level),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}

export function readProgress(key: string): ProgressBook {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, ProgressRecord>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(KIDS_GAME_IDS.filter(id => parsed[id]).map(id => [id, cleanRecord(parsed[id])])) as ProgressBook;
  } catch { return {}; }
}

export function writeProgress(key: string, value: ProgressBook): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* offline storage unavailable */ }
}
