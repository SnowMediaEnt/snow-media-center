// Automatic quality for Plex playback, like the Plex app's, kept free of
// React so the rules can be tested on their own.
//
// The ladder a title moves on: its own files first (a 4K and then a 1080p
// version, both played as they are), then the converted presets that are
// actually smaller than the lightest file, down to a floor. Below the floor
// the picture is not worth it; the viewer can still pick lower in the
// Quality menu. On the Plex Relay (which Plex caps at a couple of Mb/s) the
// floor is the relay-sized preset, and a play starts there.
//
// Down, like the Plex app: it plays the original and leaves it alone unless
// playback really keeps stalling — 3 stalls within 5 minutes (seeks and the
// first load never count) drop it to the step that fits the steady speed,
// not one step at a time. Sooner only on proof: a file played as it is that
// is plainly bigger than what the server sends flat out during a stall (see
// stallEvidence). The steady rate between stalls only sizes a drop; with the
// buffer being topped up it is the video's own bitrate, not the line's.
// Up: once the speed has stayed comfortably above the next step up for a
// minute and a half without a stall, one step at a time, never above what the
// viewer started with, at most every 2 minutes. A raise that stalls within 2
// minutes goes straight back down and raising waits (10 min, then longer).
// What the viewer picks in the Quality menu is a ceiling for that title, not
// an off switch: lowering still happens below it, raising never goes above
// it. Picking Original sets no ceiling at all. Every title starts afresh.
import { PLEX_QUALITY_PRESETS, type PlexRoute, type PlexVersion } from '@/lib/plex';
import type { DiagSnapshot } from '@/lib/bufferDiagnostics';
import { sortVersions } from '@/lib/plexVersions';

/** Automatic steps never go below this preset. */
export const AUTO_FLOOR_PRESET = '720-3';
/** On the Plex Relay: the floor, and where a play starts (the relay can't
 *  carry 1080p, nor 720p · 3 Mbps). */
export const RELAY_PRESET = '480-2';
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

/** What a step is called in a message: "720p · 3 Mbps", "1080p", or
 *  "original quality". */
export function stepName(step: QualityStep): string {
  if (step.presetKey !== 'original') return step.label;
  const name = step.label.replace(' (original)', '');
  return !name || name === 'Original' ? 'original quality' : name;
}

/** The lowest preset automatic quality goes to on this route. */
export const floorPresetFor = (route?: PlexRoute | null): string => (route === 'relay' ? RELAY_PRESET : AUTO_FLOOR_PRESET);

const presetKbps = (key: string): number | undefined => PLEX_QUALITY_PRESETS.find((p) => p.key === key)?.maxVideoBitrateKbps;

/**
 * The steps, best first. `versions` are the title's files (may be empty:
 * then one 'original' of `fileKbps`). A preset joins only when it is clearly
 * smaller than the lightest file (converting a 6 Mb/s episode "down" to
 * 12 Mb/s would not help) and not below `floor`. With no bitrate known at
 * all, presets from 1080p · 8 Mbps down.
 */
export function buildQualityLadder(versions: PlexVersion[], fileKbps?: number, floor: string = AUTO_FLOOR_PRESET): QualityStep[] {
  const files = sortVersions(versions).sort((a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0));
  const steps: QualityStep[] = files.length > 1
    ? files.map((v) => ({ key: `original@${v.id}`, presetKey: 'original', versionId: v.id, label: `${v.label || 'Original'} (original)`, kbps: v.bitrateKbps }))
    : [{ key: 'original', presetKey: 'original', versionId: files[0]?.id, label: 'Original', kbps: files[0]?.bitrateKbps ?? fileKbps }];
  const known = steps.map((s) => s.kbps).filter((k): k is number => !!k && k > 0);
  const lightest = known.length ? Math.min(...known) : undefined;
  const ceiling = lightest ? lightest * 0.8 : 8000;
  const floorKbps = presetKbps(floor) ?? presetKbps(AUTO_FLOOR_PRESET) ?? 3000;
  for (const p of PLEX_QUALITY_PRESETS) {
    const cap = p.maxVideoBitrateKbps;
    if (!cap || p.key === 'original') continue;
    if (cap < floorKbps) continue;
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
  const cur = presetKbps(qualityKey);
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

/** The player reports its download rate every 3 s (SnowPlayerPlugin's
 *  bandwidth tick). A window in which nothing arrived is reported once, as 0,
 *  and then it stays quiet until data flows again. */
export const RATE_TICK_MS = 3_000;
/** Windows with data inside a stall it takes to tell the line's speed (a
 *  single one may be mostly from before the stall). */
export const EVIDENCE_REPORTS = 2;

/**
 * What to size a drop by, kbps: the highest of the player's steady download
 * rate over the last minute, its rate during the stall under way (from
 * `stallStart`) and a fresh read of the file (`readKbps`). Never evidence
 * that a stream can't keep up — see stallEvidence for that. Null when none
 * is known.
 */
export function dropSizeKbps(rates: Array<{ t: number; kbps: number }>, now: number, opts: { stallStart?: number; readKbps?: number | null } = {}): number | null {
  const seen: number[] = [];
  const steady = steadyKbps(rates, now, DROP_WINDOW_MS);
  if (steady) seen.push(steady);
  if (opts.stallStart) {
    for (const r of rates) if (r.t > opts.stallStart && r.t <= now && r.kbps > 0) seen.push(r.kbps);
  }
  if (opts.readKbps && opts.readKbps > 0) seen.push(opts.readKbps);
  return seen.length ? Math.max(...seen) : null;
}

/** What the player's reports say about the server during a stall. */
export interface StallEvidence {
  /** What the server sent flat out, kbps: the best window inside the stall
   *  (with the buffer short the player downloads as fast as it can), or a
   *  fresh read of the file if higher. Null when that can't be told: too
   *  few windows yet, or the server paused. */
  kbps: number | null;
  /** How long, within the stall, nothing has arrived from the server; 0
   *  while data flows, and 0 until a report was due inside the stall. */
  quietMs: number;
  /** A window of the stall saw nothing at all: the server (or the way to it)
   *  paused, so its speed is not what stalled playback. */
  paused: boolean;
}

/**
 * The only evidence that the server can't send a stream fast enough: the
 * player's own rate while stalled from `stallStart` to `now`, and a fresh
 * read of the file (`readKbps`: the raise probe or the start's speed check,
 * within their freshness). Never the steady rate before the stall — while
 * the player tops its buffer up it downloads only as fast as the video plays.
 * The best window counts, not the worst: a line too slow for the file is too
 * slow in every one. A window with nothing in it means the server paused
 * (nothing arrived, so nothing was measured), and pauses never count.
 */
export function stallEvidence(rates: Array<{ t: number; kbps: number }>, stallStart: number, now: number, readKbps?: number | null): StallEvidence {
  const upTo = rates.filter((r) => r.t <= now);
  const inside = upTo.filter((r) => r.t > stallStart);
  const last = upTo[upTo.length - 1];
  // The last report saw nothing: nothing since its window began (it stays
  // quiet until data flows), counted from the stall's start at most. Only
  // once a report was due inside the stall (a tick after its start): a 0
  // from before it is the player idling on a full buffer, and the stall's
  // first window may yet bring data.
  const quietMs = last && last.kbps <= 0 && now - stallStart >= RATE_TICK_MS
    ? Math.max(0, now - Math.max(stallStart, last.t - RATE_TICK_MS)) : 0;
  const paused = inside.some((r) => r.kbps <= 0) || quietMs >= RATE_TICK_MS;
  const data = inside.filter((r) => r.kbps > 0).map((r) => r.kbps);
  const read = readKbps && readKbps > 0 ? readKbps : null;
  if (paused || (data.length < EVIDENCE_REPORTS && read == null)) return { kbps: null, quietMs, paused };
  return { kbps: Math.max(...data, read ?? 0), quietMs, paused };
}

/**
 * What a stalling stream actually gets, kbps, to size a drop by: the
 * player's own rates from the Plex server (`sizeKbps`, see dropSizeKbps)
 * when there are any, else the quick probes of the stream (host probe,
 * stream samples), and only then the general internet check. Null when
 * nothing was measured.
 */
export function stallBudgetKbps(snap: Pick<DiagSnapshot, 'hostKbps' | 'streamKbps' | 'probeKbps'>, sizeKbps?: number | null): number | null {
  if (sizeKbps != null && sizeKbps > 0) return sizeKbps;
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

export type AutoReason = 'stalls' | 'undo-raise' | 'slow-file' | 'slow-start' | 'speed';
export type AutoMove = { step: QualityStep; direction: 'down' | 'up'; reason: AutoReason };

/** What automatic quality would do next from where playback is, for the
 *  buffering card. */
export interface AutoPreview {
  /** The step a drop would go to; null when there is nothing lower. */
  next: QualityStep | null;
  /** The viewer's own pick for this title (a preset key), if any. */
  manualKey: string | null;
}

/**
 * The buffering card's line on automatic quality, from what it would do
 * next (`preview`) and where playback is on the ladder (`index`). With
 * nothing lower and a pick of the viewer's, by ladder position: playback at
 * the pick (or a pick under the floor) is automatic quality off for this
 * title, as it can neither lower nor raise; playback at the floor below the
 * pick is its lowest step, and it goes back up to the pick (the step just
 * under a pick off the ladder) when the speed allows.
 */
export function autoQualityNote(ladder: QualityStep[], index: number, preview: AutoPreview): string {
  if (preview.next) return `Auto quality: will lower to ${stepName(preview.next)} if it keeps stalling`;
  const pick = preview.manualKey;
  if (!pick) return 'Auto quality: already at its lowest step';
  // Best first; under the floor (-1) is past the end.
  const pos = (i: number): number => (i < 0 ? ladder.length : i);
  // The highest step raising may reach: the pick, or the one just under it.
  const up = Math.ceil(pos(ladderIndex(ladder, pick)));
  if (pos(index) <= up) {
    const label = PLEX_QUALITY_PRESETS.find((p) => p.key === pick)?.label ?? pick;
    return `Auto quality off for this title (you picked ${label})`;
  }
  return `Auto quality: at its lowest step (goes back up to ${stepName(ladder[up])} when the speed allows)`;
}

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
  private manual: string | null = null;
  private failed: Set<string>;
  private waitedFor: string | null = null;

  /** `failed`: converted steps that already failed to start for this title
   *  (a replay of it keeps them). */
  constructor(startedAt: number, failed: Iterable<string> = []) {
    this.lastChangeAt = startedAt;
    this.failed = new Set(failed);
  }

  /**
   * The viewer picked a quality in the menu at `at`: a preset is a ceiling
   * for this title; Original (or a file played as it is) sets none. Stalls
   * are counted afresh on the new stream, and nothing is raised for 2
   * minutes.
   */
  viewerPicked(key: string | null, at: number): void {
    this.manual = key && key !== 'original' && key.indexOf('original@') !== 0 ? key : null;
    this.lastChangeAt = at;
    this.raisedAt = 0;
    this.waitedFor = null;
    this.stalls.reset();
  }

  /** The viewer's pick for this title, or null. */
  manualKey(): string | null { return this.manual; }

  /** The highest step raising may reach: `baseCeiling` (what the title
   *  started with), and never above the viewer's pick. */
  ceiling(ladder: QualityStep[], baseCeiling: number): number {
    if (!this.manual) return baseCeiling;
    const at = ladderIndex(ladder, this.manual);
    // A pick under the floor: raising has nowhere to go.
    return at < 0 ? ladder.length : Math.max(baseCeiling, at);
  }

  /** The ladder without the converted steps that failed to start. */
  usable(ladder: QualityStep[]): QualityStep[] {
    return this.failed.size ? ladder.filter((s) => !this.failed.has(s.key)) : ladder;
  }

  /** Converted steps that failed to start for this title. */
  failedKeys(): string[] { return Array.from(this.failed); }

  /**
   * A stall started at `at` (never the first load). Returns the drop to make,
   * if any: straight back after a raise that did not hold, else the step
   * that fits `sizeKbps` once stalls have repeated (3 within 5 minutes).
   * `sizeKbps` only sizes the drop (see dropSizeKbps); it never makes one.
   */
  onStall(at: number, lastSeekAt: number, ladder: QualityStep[], index: number, sizeKbps: number | null): AutoMove | null {
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
    return this.drop(ladder, index, sizeKbps, 'stalls');
  }

  /**
   * The file played as-is is plainly bigger than what the server sends flat
   * out during a stall (the caller decides, from stallEvidence only): drop
   * now to what fits `sizeKbps`, without waiting for more stalls.
   */
  onSlowFile(ladder: QualityStep[], index: number, sizeKbps: number | null): AutoMove | null {
    return this.drop(ladder, index, sizeKbps, 'slow-file');
  }

  /** The server won't convert this title at all: every converted step in
   *  `ladder` counts as failed, so only its files as they are are left. */
  conversionsRefused(ladder: QualityStep[]): void {
    for (const s of ladder) if (s.presetKey !== 'original') this.failed.add(s.key);
  }

  /**
   * A converted step that automatic quality moved to (`key`, at `index`) has
   * not started in time: the server can't get its converting going. Never
   * back to the file that was stalling. First a file played as it is that
   * is lighter than the one it came from (`fromKbps`) and fits `speedKbps`
   * (nothing to convert, so it starts at once; `files: false` rules them
   * out, as on the relay); else one more wait for the same step; else the
   * next converted step down. The step is remembered as failed for this
   * title. Null when there is nothing left to try.
   */
  onSlowStart(ladder: QualityStep[], index: number, key: string, opts: { fromKbps?: number; speedKbps?: number | null; files?: boolean }): AutoMove | 'wait' | null {
    const fromKbps = opts.fromKbps;
    if (opts.files !== false && fromKbps) {
      // Originals are best first, so the last that fits is the lightest.
      const fits = ladder.filter((s) => s.presetKey === 'original' && !!s.kbps && s.kbps < fromKbps
        && (!opts.speedKbps || s.kbps <= opts.speedKbps));
      const file = fits.length ? fits[fits.length - 1] : null;
      if (file) {
        this.failed.add(key);
        return { step: file, direction: 'down', reason: 'slow-start' };
      }
    }
    if (this.waitedFor !== key) {
      this.waitedFor = key;
      return 'wait';
    }
    this.failed.add(key);
    const from = index < 0 ? ladder.length : Math.floor(index) + 1;
    const next = ladder.slice(from).find((s) => s.presetKey !== 'original' && !this.failed.has(s.key));
    return next ? { step: next, direction: 'down', reason: 'slow-start' } : null;
  }

  /** What a drop from `index` would go to now, and the viewer's pick. */
  preview(ladder: QualityStep[], index: number, speedKbps: number | null): AutoPreview {
    return { next: dropTarget(ladder, index, speedKbps), manualKey: this.manual };
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

  /** Whether a raise may happen now, speed aside: 2 minutes since the last
   *  change, no undone raise waiting, no stall for a minute and a half. */
  raiseWindowOpen(now: number): boolean {
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

  private drop(ladder: QualityStep[], index: number, speedKbps: number | null, reason: AutoReason): AutoMove | null {
    const step = dropTarget(ladder, index, speedKbps);
    return step ? { step, direction: 'down', reason } : null;
  }
}

// ── ending a converting session ─────────────────────────────────────────────

const TRANSCODE_START = '/video/:/transcode/universal/start';
const STOP_TIMEOUT_MS = 5_000;

/**
 * The address that ends the converting session a transcode URL started on
 * the server (its `session`, with the same client id and token), or null
 * when `url` is not one.
 */
export function transcodeStopUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const at = url.indexOf(TRANSCODE_START);
  const q = at < 0 ? -1 : url.indexOf('?', at);
  if (q < 0) return null;
  let params: URLSearchParams;
  try { params = new URLSearchParams(url.slice(q + 1)); } catch { return null; }
  const session = params.get('session') || params.get('X-Plex-Session-Identifier');
  if (!session) return null;
  const out = new URLSearchParams();
  out.set('session', session);
  const cid = params.get('X-Plex-Client-Identifier');
  if (cid) out.set('X-Plex-Client-Identifier', cid);
  const token = params.get('X-Plex-Token');
  if (token) out.set('X-Plex-Token', token);
  return `${url.slice(0, at)}/video/:/transcode/universal/stop?${out.toString()}`;
}

/**
 * Tells the server to stop converting for a transcode URL playback has
 * left. Without it every quality change left its converting job running on
 * the (shared) server until the server gave up on it by itself. Fire and
 * forget: never throws, never waits, never logs the address (it carries the
 * token).
 */
export function stopPlexTranscode(url: string | null | undefined): void {
  const stop = transcodeStopUrl(url);
  if (!stop || typeof fetch !== 'function') return;
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { try { ac?.abort(); } catch { /* ignore */ } }, STOP_TIMEOUT_MS);
  const done = () => { clearTimeout(timer); };
  try {
    // no-cors: the answer is never read, and a server without CORS headers
    // still gets the request.
    fetch(stop, { mode: 'no-cors', cache: 'no-store', signal: ac?.signal }).then(done, done);
  } catch {
    done();
  }
}
