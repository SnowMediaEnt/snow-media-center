// Player-engine comparison (PlaybackScreen's Compare table). One getStats()
// sample per Live-TV watch on the main player — 60 s in, and again when it
// stops (LiveSection owns the timing) — kept per engine in localStorage, so
// the table can say something after a handful of channel changes instead of
// needing a lab. Pure data in here: no React, no SnowPlayer import, so it can
// be checked off the device like VideoFit/PreBufferRule are on the Kotlin side.
import type { PlayerStats } from '@/capacitor/SnowPlayer';

export interface EngineSample {
  engine: 'exo' | 'mpv';
  /** Time to first picture, ms — null if the load hadn't drawn one yet. */
  firstPictureMs: number | null;
  stalls: number;
  stallSec: number;
  /** How long this sample covers, minutes (for the per-hour rates). */
  minutes: number;
  cpuPct: number | null;
  pssMb: number | null;
  at: number;
}

const KEY_PREFIX = 'smc-engine-compare-v1-';
const MAX_SAMPLES = 30;

const keyFor = (engine: EngineSample['engine']): string => `${KEY_PREFIX}${engine}`;

/** A PlayerStats read into a sample — LiveSection reads getStats() and hands
 *  the answer here rather than this file knowing how to ask for one. */
export function sampleFromStats(stats: PlayerStats, minutes: number): EngineSample {
  return {
    engine: stats.engine,
    firstPictureMs: stats.firstFrameMs,
    stalls: stats.stalls,
    stallSec: stats.stallSec,
    minutes,
    cpuPct: stats.cpuPct,
    pssMb: stats.pssMb,
    at: Date.now(),
  };
}

/** Keeps the last MAX_SAMPLES per engine. Never throws — a private window,
 *  cleared site data or a full quota all just mean this watch isn't recorded. */
export function recordEngineSample(sample: EngineSample): void {
  try {
    const list = readEngineSamples(sample.engine);
    list.push(sample);
    while (list.length > MAX_SAMPLES) list.shift();
    localStorage.setItem(keyFor(sample.engine), JSON.stringify(list));
  } catch { /* ignore */ }
}

export function readEngineSamples(engine: EngineSample['engine']): EngineSample[] {
  try {
    const raw = localStorage.getItem(keyFor(engine));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export interface EngineCompareRow {
  engine: EngineSample['engine'];
  samples: number;
  medianFirstPictureMs: number | null;
  stallsPerHour: number | null;
  stallSecPerHour: number | null;
  avgCpuPct: number | null;
  avgMemoryMb: number | null;
}

/** The Compare table's rows, one per engine — exo first, then mpv. */
export function compareEngines(): EngineCompareRow[] {
  return (['exo', 'mpv'] as const).map((engine) => {
    const list = readEngineSamples(engine);
    const hours = list.reduce((a, s) => a + s.minutes, 0) / 60;
    const firsts = list.map((s) => s.firstPictureMs).filter((n): n is number => n != null);
    const cpus = list.map((s) => s.cpuPct).filter((n): n is number => n != null);
    const mems = list.map((s) => s.pssMb).filter((n): n is number => n != null);
    return {
      engine,
      samples: list.length,
      medianFirstPictureMs: median(firsts),
      stallsPerHour: hours > 0 ? list.reduce((a, s) => a + s.stalls, 0) / hours : null,
      stallSecPerHour: hours > 0 ? list.reduce((a, s) => a + s.stallSec, 0) / hours : null,
      avgCpuPct: avg(cpus),
      avgMemoryMb: avg(mems),
    };
  });
}
