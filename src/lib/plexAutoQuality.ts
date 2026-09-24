// Automatic quality for Plex playback, like the Plex app's, kept free of
// React so the rules can be tested on their own.
//
// The ladder a title moves on: its own files first (a 4K and then a 1080p
// version, both played as they are), then the converted presets that are
// actually smaller than the lightest file, down to a floor. Below the floor
// the picture is not worth it; the viewer can still pick lower in the
// Quality menu.
//
// Down: after repeated stalls (3 within 5 minutes; seeks and the first load
// never count) it drops to the step that fits the speed actually arriving —
// the steady speed, not one step at a time.
// Up: once the speed has stayed comfortably above the next step up for a
// minute and a half without a stall, one step at a time, never above what the
// viewer started with, at most every 2 minutes. A raise that stalls within 2
// minutes goes straight back down and raising waits (10 min, then longer).
// Whatever the viewer picks in the Quality menu wins: from then on this
// session nothing is changed for them.
import { PLEX_QUALITY_PRESETS, type PlexVersion } from '@/lib/plex';
import type { DiagSnapshot } from '@/lib/bufferDiagnostics';
import { sortVersions } from '@/lib/plexVersions';

/** Automatic steps never go below this preset. */
export const AUTO_FLOOR_PRESET = '720-3';
/** Stalls within this window that trigger a drop. */
export const STALL_WINDOW_MS = 5 * 60_000;
export const STALLS_TO_STEP = 3;
/** A stall starting this soon after a seek is the seek, not the connection. */
export const SEEK_GRACE_MS = 5_000;
/** A step must fit the speed this many times over. */
export const SPEED_HEADROOM = 1.3;
/** The steady speed a drop is sized to: the last minute. */
export const DROP_WINDOW_MS = 60_000;
/** How long the speed must have held (and no stall) before a raise. */
export const RAISE_SUSTAIN_MS = 90_000;
/** No two automatic changes closer than this. */
export const MIN_CHANGE_GAP_MS = 2 * 60_000;
/** A stall this soon after a raise undoes it. */
export const RAISE_PROBATION_MS = 2 * 60_000;
/** Raising waits this long after an undone raise, doubling each time. */
export const RAISE_BACKOFF_MS = 10 * 60_000;
const RAISE_BACKOFF_MAX_MS = 40 * 60_000;

export interface QualityStep {
  /** 'original', 'original@<versionId>', or a preset key. */
  key: string;
  /** The preset key to put in effect ('original' for a file played as-is). */
  presetKey: string;
  /** The file played as-is (originals only). */
  versionId?: string;
  label: string;
  /** Bitrate of the step, kbps (unknown for a file without one). */
  kbps?: number;
}

const floorKbps = (): number => PLEX_QUALITY_PRESETS.find((p) => p.key === AUTO_FLOOR_PRESET)?.maxVideoBitrateKbps ?? 3000;

/**
 * The steps, best first. `versions` are the title's files (may be empty:
 * then one 'original' of `fileKbps`). A preset joins only when it is clearly
 * smaller than the lightest file (converting a 6 Mb/s episode "down" to
 * 12 Mb/s would not help) and not below the floor. With no bitrate known at
 * all, presets from 1080p · 8 Mbps down.
 */
export function buildQualityLadder(versions: PlexVersion[], fileKbps?: number): QualityStep[] {
  const files = sortVersions(versions).sort((a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0));
  const steps: QualityStep[] = files.length > 1
    ? files.map((v) => ({ key: `original@${v.id}`, presetKey: 'original', versionId: v.id, label: `${v.label || 'Original'} (original)`, kbps: v.bitrateKbps }))
    : [{ key: 'original', presetKey: 'original', versionId: files[0]?.id, label: 'Original', kbps: files[0]?.bitrateKbps ?? fileKbps }];
  const known = steps.map((s) => s.kbps).filter((k): k is number => !!k && k > 0);
  const lightest = known.length ? Math.min(...known) : undefined;
  const ceiling = lightest ? lightest * 0.8 : 8000;
  for (const p of PLEX_QUALITY_PRESETS) {
    const cap = p.maxVideoBitrateKbps;
    if (!cap || p.key === 'original') continue;
    if (cap < floorKbps()) continue;
    if (lightest ? cap >= ceiling : cap > ceiling) continue;
    steps.push({ key: p.key, presetKey: p.key, label: p.label, kbps: cap });
  }
  return steps;
}

/**
 * Where playback is on the ladder. A preset the viewer picked that is not on
 * it sits just above the first step below it (so a drop from there lands on
 * that step); a preset under the floor is past the end (-1: nothing to do).
 */
export function ladderIndex(ladder: QualityStep[], qualityKey: string, versionId?: string): number {
  if (qualityKey === 'original') {
    const byVersion = versionId ? ladder.findIndex((s) => s.presetKey === 'original' && s.versionId === versionId) : -1;
    if (byVersion >= 0) return byVersion;
    return ladder.findIndex((s) => s.presetKey === 'original');
  }
  const exact = ladder.findIndex((s) => s.key === qualityKey);
  if (exact >= 0) return exact;
  const cur = PLEX_QUALITY_PRESETS.find((p) => p.key === qualityKey)?.maxVideoBitrateKbps;
  if (!cur) return -1;
  const below = ladder.findIndex((s) => s.presetKey !== 'original' && (s.kbps ?? Infinity) < cur);
  return below < 0 ? -1 : below - 0.5;
}

/**
 * The step to drop to from `index`: the best one below it that fits the
 * steady speed with headroom; the floor when none does; one step when the
 * speed is unknown. Null when already at the floor.
 */
export function dropTarget(ladder: QualityStep[], index: number, steadyKbps?: number | null): QualityStep | null {
  if (index < 0) return null;
  const first = Math.floor(index) + 1;
  if (first >= ladder.length) return null;
  if (!steadyKbps || steadyKbps <= 0) return ladder[first];
  for (let i = first; i < ladder.length; i += 1) {
    const k = ladder[i].kbps;
    if (k && k * SPEED_HEADROOM <= steadyKbps) return ladder[i];
  }
  return ladder[ladder.length - 1];
}

/** The next step up, when the steady speed carries it with headroom and it
 *  is not above `ceilingIndex`. */
export function raiseTarget(ladder: QualityStep[], index: number, ceilingIndex: number, steadyKbps?: number | null): QualityStep | null {
  if (index < 0 || !steadyKbps) return null;
  const up = Math.ceil(index) - 1;
  if (up < 0 || up < ceilingIndex) return null;
  const k = ladder[up]?.kbps;
  return k && k * SPEED_HEADROOM <= steadyKbps ? ladder[up] : null;
}

/**
 * The steady speed from the player's rate reports: the median of those in
 * the last `windowMs` that saw data flowing (a full buffer reports 0 while
 * the player waits). Null with fewer than two.
 */
export function steadyKbps(rates: Array<{ t: number; kbps: number }>, now: number, windowMs: number): number | null {
  const v = rates.filter((r) => now - r.t <= windowMs && r.kbps > 0).map((r) => r.kbps).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * What a stalling stream actually gets according to the probes, kbps: the
 * stream's own numbers (host probe, stream samples), else the general
 * internet probe. Null when nothing was measured.
 */
export function stallBudgetKbps(snap: Pick<DiagSnapshot, 'hostKbps' | 'streamKbps' | 'probeKbps'>): number | null {
  const seen = [snap.hostKbps, snap.streamKbps].filter((n): n is number => n != null && n > 0);
  if (seen.length) return Math.min(...seen);
  return snap.probeKbps && snap.probeKbps > 0 ? snap.probeKbps : null;
}

/**
 * Counts stalls — buffering after playback has started — over a sliding
 * window. The first load is never fed in; a stall right after a seek is
 * ignored (the player always refills after a jump).
 */
export class StallCounter {
  private times: number[] = [];
  constructor(private windowMs = STALL_WINDOW_MS, private needed = STALLS_TO_STEP, private seekGraceMs = SEEK_GRACE_MS) {}

  /** True when a stall at `at` is the seek at `lastSeekAt` refilling. */
  isSeek(at: number, lastSeekAt = 0): boolean {
    return lastSeekAt > 0 && at - lastSeekAt >= 0 && at - lastSeekAt < this.seekGraceMs;
  }

  /** Records a stall that started at `at`; true when that makes enough. */
  record(at: number, lastSeekAt = 0): boolean {
    if (this.isSeek(at, lastSeekAt)) return false;
    this.times = this.times.filter((t) => at - t < this.windowMs);
    this.times.push(at);
    return this.times.length >= this.needed;
  }

  count(at: number): number {
    return this.times.filter((t) => at - t < this.windowMs).length;
  }

  reset(): void { this.times = []; }
}

// The viewer picked a quality in the menu: automatic quality stands down for
// the rest of the session (module state lives as long as the app does).
let manualThisSession = false;
export function markManualQuality(): void { manualThisSession = true; }
export function isManualQuality(): boolean { return manualThisSession; }
export function _resetManualQuality(): void { manualThisSession = false; }

export type AutoMove = { step: QualityStep; direction: 'down' | 'up'; reason: 'stalls' | 'undo-raise' | 'slow-file' | 'speed' };

/**
 * The timing half of automatic quality for one title: when to drop, when to
 * raise, and not flapping between the two. The caller rebuilds the ladder
 * and works out where playback is on it at each call (versions and bitrates
 * arrive after the start), and reports each change it made with `applied`.
 */
export class AutoQuality {
  private stalls = new StallCounter();
  private lastChangeAt: number;
  private raisedAt = 0;
  private raiseBlockedUntil = 0;
  private backoffMs = RAISE_BACKOFF_MS;
  private lastStallAt = 0;

  constructor(startedAt: number) { this.lastChangeAt = startedAt; }

  /**
   * A stall started at `at` (never the first load). Returns the drop to make,
   * if any: straight back after a raise that did not hold, else the step
   * that fits the steady speed once stalls have repeated.
   */
  onStall(at: number, lastSeekAt: number, ladder: QualityStep[], index: number, steady: number | null): AutoMove | null {
    if (isManualQuality()) return null;
    if (this.stalls.isSeek(at, lastSeekAt)) return null;
    this.lastStallAt = at;
    if (this.raisedAt && at - this.raisedAt < RAISE_PROBATION_MS) {
      const back = index >= 0 ? ladder[Math.floor(index) + 1] : undefined;
      this.raisedAt = 0;
      this.raiseBlockedUntil = at + this.backoffMs;
      this.backoffMs = Math.min(RAISE_BACKOFF_MAX_MS, this.backoffMs * 2);
      if (back) return { step: back, direction: 'down', reason: 'undo-raise' };
    }
    if (!this.stalls.record(at, lastSeekAt)) return null;
    const step = dropTarget(ladder, index, steady);
    return step ? { step, direction: 'down', reason: 'stalls' } : null;
  }

  /**
   * The file played as-is is plainly bigger than what arrives and a stall
   * has lasted (or come back): drop now to what fits, without waiting for a
   * third stall. The caller decides the evidence.
   */
  onSlowFile(ladder: QualityStep[], index: number, steady: number | null): AutoMove | null {
    if (isManualQuality()) return null;
    const step = dropTarget(ladder, index, steady);
    return step ? { step, direction: 'down', reason: 'slow-file' } : null;
  }

  /**
   * Called every few seconds while playing smoothly. A raise, one step,
   * when the steady speed (over RAISE_SUSTAIN_MS) carries the step above
   * with headroom, no stall came in that time, no change in the last 2
   * minutes, not above `ceilingIndex`, and no undone raise is still waiting.
   */
  maybeRaise(now: number, ladder: QualityStep[], index: number, ceilingIndex: number, steady: number | null): AutoMove | null {
    if (!this.raiseWindowOpen(now)) return null;
    const step = raiseTarget(ladder, index, ceilingIndex, steady);
    return step ? { step, direction: 'up', reason: 'speed' } : null;
  }

  /** Whether a raise may happen now, speed aside: no manual pick, 2 minutes
   *  since the last change, no undone raise waiting, no stall for a minute
   *  and a half. */
  raiseWindowOpen(now: number): boolean {
    if (isManualQuality()) return false;
    if (now - this.lastChangeAt < MIN_CHANGE_GAP_MS) return false;
    if (now < this.raiseBlockedUntil) return false;
    if (this.lastStallAt && now - this.lastStallAt < RAISE_SUSTAIN_MS) return false;
    return true;
  }

  /** Stalls counted in the current window. */
  stallCount(at: number): number { return this.stalls.count(at); }

  /** The caller switched quality at `at`. */
  applied(move: AutoMove, at: number): void {
    this.lastChangeAt = at;
    this.raisedAt = move.direction === 'up' ? at : 0;
    this.stalls.reset();
  }
}
