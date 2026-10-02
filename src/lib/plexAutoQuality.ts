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
// One measurement: bytes as they arrive at the player from the Plex server,
// in the player's own 3 s windows (RateReport). Nothing else counts: not the
// quick internet check (a customer's read 42.5 Mb/s from a test server
// while the Plex server sent 1.4-5.7 Mb/s of a 12 Mb/s file), not a short
// read of the file made from the WebView.
//
// One down rule (deliveredKbps, AutoQuality.onDelivery): what the server
// delivered over a stall, or over the stalls of the last two minutes, is
// short of what the stream needs (under 0.8x), and then it goes to the best
// rung that rate carries with headroom, lighter files first. A stall in
// which nothing arrives is the server pausing, never a reason to drop.
// Stalls counted on their own (three in five minutes) may only move to a
// lighter file — never into a conversion — and not off a 4K file whose
// line is proven. A proven line is a sustained 15 s arrival rate of twice
// what the stream needs (sustainedKbps, lineClearFor).
// What the stream needs is the smaller of the preset's cap and the source
// file's bitrate (needKbps).
// Up: once the steady speed has held comfortably above the next step up for
// a minute and a half without a stall, one step at a time, never above what
// the viewer started with, at most every 2 minutes. A raise that stalls
// within 2 minutes goes straight back down (unless the line is proven for
// it) and raising waits (10 min, then longer). What the viewer picks in the
// Quality menu is a ceiling for that title, not an off switch: lowering
// still happens below it, raising never goes above it. Picking Original
// sets no ceiling at all. Every title starts afresh.
import { PLEX_QUALITY_PRESETS, type PlexRoute, type PlexVersion } from '@/lib/plex';
import { formatMbps } from '@/lib/bufferDiagnostics';
import { sortVersions } from '@/lib/plexVersions';
import i18n from '@/i18n';

/** Automatic steps never go below this preset. */
export const AUTO_FLOOR_PRESET = '720-3';
/** On the Plex Relay: the floor, and where a play starts (the relay can't
 *  carry 1080p, nor 720p · 3 Mbps). */
export const RELAY_PRESET = '480-2';
/** Stalls within this window that move to a lighter file. */
export const STALL_WINDOW_MS = 5 * 60_000;
export const STALLS_TO_STEP = 3;
/** A stall starting this soon after a seek is the seek, not the connection. */
export const SEEK_GRACE_MS = 5_000;
/**
 * A stall this soon after playback began (a start, a resume, a quality
 * change, a reload, or playing on after a seek) is the start, not the
 * connection: the server is only getting going at that place in the file.
 * On the owner's TV a resumed film stalled at 0:02 and 0:16 and then played
 * smoothly with 30 s and more in hand; counted as stalls, those sent it to a
 * conversion. Measured from when it began to play (useNativePlayer), not
 * from the jump: the start-up hold alone can outlast a seek's 5 s.
 */
export const START_GRACE_MS = 30_000;
/** A proven line: the server has sustained this many times what the stream
 *  needs (sustainedKbps). Stalls alone then never leave the file. */
export const PROVEN_FACTOR = 2;
/** Consecutive windows with data a proof must span (5 x 3 s = 15 s). */
export const PROVEN_WINDOWS = 5;
/** The stalls delivery is judged over: this long back, since the last change. */
export const DELIVERY_WINDOW_MS = 2 * 60_000;
/** Delivered under this share of what the stream needs: too little. */
export const DELIVERY_FACTOR = 0.8;
/** Windows with data, taken while stalled, it takes to judge delivery
 *  (3 x 3 s: one stall of 9 s, or two shorter ones within the window). */
export const DELIVERY_MIN_WINDOWS = 3;
/** On a proven line (lineClearFor) it takes a longer look (15 s): a short
 *  slow spell of the server is what the buffer is there for. */
export const DELIVERY_PROVEN_WINDOWS = 5;
/** A step must fit the speed this many times over. */
export const SPEED_HEADROOM = 1.3;
/** How long the speed must have held (and no stall) before a raise. */
export const RAISE_SUSTAIN_MS = 90_000;
/** No two automatic changes closer than this. */
export const MIN_CHANGE_GAP_MS = 2 * 60_000;
/** A stall this soon after a raise undoes it. */
export const RAISE_PROBATION_MS = 2 * 60_000;
/** Raising waits this long after an undone raise or a delivery drop,
 *  doubling each time a raise is undone. */
export const RAISE_BACKOFF_MS = 10 * 60_000;
const RAISE_BACKOFF_MAX_MS = 40 * 60_000;

export interface QualityStep {
  /** 'original', 'original@<versionId>', or a preset key. */
  key: string;
  /** The preset key to put in effect ('original' for a file played as-is). */
  presetKey: string;
  /** The file played as-is (originals only). */
  versionId?: string;
  /** Preset steps: the preset's label. File steps: the file's resolution
   *  ("4K"), or '' when it has none. Never shown as it is: see stepName. */
  label: string;
  /** Bitrate of the step, kbps (unknown for a file without one). */
  kbps?: number;
}

/** What a step is called in a message: "720p · 3 Mbps", "1080p", or
 *  "original quality". */
export function stepName(step: QualityStep): string {
  if (step.presetKey !== 'original') return step.label;
  return step.label || i18n.t('plex.quality.originalQuality');
}

/** A preset's name for a menu. The plain "original" preset is worded here
 *  (its English label lives in plex.ts); the converted ones are numbers only. */
export const qualityPresetLabel = (p: { key: string; label: string }): string =>
  (p.key === 'original' ? i18n.t('plex.quality.originalDirect') : p.label);

/** The lowest preset automatic quality goes to on this route. */
export const floorPresetFor = (route?: PlexRoute | null): string => (route === 'relay' ? RELAY_PRESET : AUTO_FLOOR_PRESET);

const presetKbps = (key: string): number | undefined => PLEX_QUALITY_PRESETS.find((p) => p.key === key)?.maxVideoBitrateKbps;

/**
 * What a stream needs, kbps: the smaller of the cap it is converted to
 * (`capKbps`, none for a file played as it is) and the source file's own
 * bitrate — a 12 Mb/s file converted "to 1080p · 20 Mbps" still arrives at
 * 12. Undefined when neither is known.
 */
export function needKbps(capKbps: number | undefined, sourceKbps: number | undefined): number | undefined {
  const known = [capKbps, sourceKbps].filter((k): k is number => !!k && k > 0);
  return known.length ? Math.min(...known) : undefined;
}

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
    ? files.map((v) => ({ key: `original@${v.id}`, presetKey: 'original', versionId: v.id, label: v.label || '', kbps: v.bitrateKbps }))
    : [{ key: 'original', presetKey: 'original', versionId: files[0]?.id, label: '', kbps: files[0]?.bitrateKbps ?? fileKbps }];
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
 * The step to drop to from `index`: the best one below it that fits
 * `kbps` with headroom (files come first on the ladder, so a lighter file
 * wins over a conversion that fits too); the floor when none does; one step
 * when the speed is unknown. Null when already at the floor.
 */
export function dropTarget(ladder: QualityStep[], index: number, kbps?: number | null): QualityStep | null {
  if (index < 0) return null;
  const first = Math.floor(index) + 1;
  if (first >= ladder.length) return null;
  if (!kbps || kbps <= 0) return ladder[first];
  for (let i = first; i < ladder.length; i += 1) {
    const k = ladder[i].kbps;
    if (k && k * SPEED_HEADROOM <= kbps) return ladder[i];
  }
  return ladder[ladder.length - 1];
}

/**
 * The lighter FILE to move to from `index`: the best one below that fits
 * `kbps` with headroom, else the lightest one. Null when no lighter file
 * exists (a single-file title, or already on its lightest file).
 */
export function lighterFile(ladder: QualityStep[], index: number, kbps?: number | null): QualityStep | null {
  if (index < 0) return null;
  const files = ladder.slice(Math.floor(index) + 1).filter((s) => s.presetKey === 'original');
  if (!files.length) return null;
  if (kbps && kbps > 0) {
    const fits = files.find((s) => !!s.kbps && s.kbps * SPEED_HEADROOM <= kbps);
    if (fits) return fits;
  }
  return files[files.length - 1];
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

/** One of the player's rate reports: bytes as they arrived from the server
 *  over a 3 s window, kbps; `stalled` when playback was stalled as it was
 *  taken. */
export interface RateReport { t: number; kbps: number; stalled?: boolean }

/** The player reports its arrival rate every 3 s (SnowPlayerPlugin's
 *  bandwidth tick, getStats.arrivalKbps). A window in which nothing arrived
 *  is reported once, as 0, and then it stays quiet until data flows again. */
export const RATE_TICK_MS = 3_000;
/** Windows with data inside a stall it takes for the buffering card to name
 *  a rate (a single one may be mostly from before the stall). */
export const EVIDENCE_REPORTS = 2;

/**
 * The steady speed from the player's rate reports: the median of those in
 * the last `windowMs` that saw data flowing (a full buffer reports 0 while
 * the player waits). Null with fewer than two.
 */
export function steadyKbps(rates: RateReport[], now: number, windowMs: number): number | null {
  const v = rates.filter((r) => now - r.t <= windowMs && r.kbps > 0).map((r) => r.kbps).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

/**
 * The best sustained arrival rate in `rates` up to `now`, kbps: the highest
 * mean over PROVEN_WINDOWS consecutive reports that all saw data (a 0, the
 * server pausing, breaks the run). While the player fills its start or a
 * seek it downloads flat out, so this is what the line to the server
 * carries. Null until there has been such a run.
 */
export function sustainedKbps(rates: RateReport[], now: number): number | null {
  let best: number | null = null;
  let run: number[] = [];
  for (const r of rates) {
    if (r.t > now) break;
    if (r.kbps <= 0) { run = []; continue; }
    run.push(r.kbps);
    if (run.length > PROVEN_WINDOWS) run.shift();
    if (run.length === PROVEN_WINDOWS) {
      const m = mean(run);
      if (best == null || m > best) best = m;
    }
  }
  return best;
}

/**
 * Whether a stall at `at` belongs to a jump rather than the connection:
 * within SEEK_GRACE_MS of the jump itself (`lastSeekAt`), or within
 * START_GRACE_MS of playback beginning after it (`lastStartAt`).
 */
export function inJumpGrace(at: number, lastSeekAt = 0, lastStartAt = 0, seekGraceMs = SEEK_GRACE_MS): boolean {
  if (lastSeekAt > 0 && at - lastSeekAt >= 0 && at - lastSeekAt < seekGraceMs) return true;
  return lastStartAt > 0 && at - lastStartAt >= 0 && at - lastStartAt < START_GRACE_MS;
}

/** What the player's reports say about the server during a stall. */
export interface StallEvidence {
  /** What the server delivered over the stall, kbps: the mean of the
   *  windows inside it (with the buffer short the player downloads as fast
   *  as it is sent). Null when that can't be told: too few windows yet, or
   *  the server paused. */
  kbps: number | null;
  /** How long, within the stall, nothing has arrived from the server; 0
   *  while data flows, and 0 until a report was due inside the stall. */
  quietMs: number;
  /** A window of the stall saw nothing at all: the server (or the way to it)
   *  paused, so its speed is not what stalled playback. */
  paused: boolean;
}

/**
 * The player's own rate while stalled from `stallStart` to `now`, for the
 * buffering card. Never the steady rate before the stall — while the player
 * tops its buffer up it downloads only as fast as the video plays. A window
 * with nothing in it means the server paused (nothing arrived, so nothing
 * was measured), and pauses never count as a speed.
 */
export function stallEvidence(rates: RateReport[], stallStart: number, now: number): StallEvidence {
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
  if (paused || data.length < EVIDENCE_REPORTS) return { kbps: null, quietMs, paused };
  return { kbps: Math.round(mean(data)), quietMs, paused };
}

/** What the server delivered over the stalls lately (deliveredKbps). */
export interface Delivery {
  /** The mean arrival rate over the windows taken while stalled, kbps; null
   *  with too few windows, or while the server pauses. */
  kbps: number | null;
  /** Windows with data that went into it. */
  windows: number;
  /** The stall under way saw a window with nothing in it, or has gone quiet:
   *  the server paused. Not a speed, never a drop. */
  paused: boolean;
}

/**
 * What the server delivered, kbps, over the stalls of the last
 * DELIVERY_WINDOW_MS (since `since`, the last quality change, and outside
 * the first half minute after a start or a seek): the mean of the player's
 * windows taken while stalled — bytes over the stall, when the player pulls
 * flat out. Takes DELIVERY_MIN_WINDOWS of them: one 9 s stall, or two
 * shorter ones within the window; DELIVERY_PROVEN_WINDOWS on a proven line
 * (`proven`). A stall under way (`stallStart`) in which the server paused
 * gives no verdict at all.
 */
export function deliveredKbps(
  rates: RateReport[], now: number,
  opts: { since?: number; lastStartAt?: number; lastSeekAt?: number; stallStart?: number; proven?: boolean } = {},
): Delivery {
  const from = Math.max(opts.since ?? 0, now - DELIVERY_WINDOW_MS);
  const counts = (t: number): boolean => t > from && t <= now && !inJumpGrace(t, opts.lastSeekAt ?? 0, opts.lastStartAt ?? 0);
  const paused = opts.stallStart != null && stallEvidence(rates, opts.stallStart, now).paused;
  const data = rates.filter((r) => r.stalled && r.kbps > 0 && counts(r.t)).map((r) => r.kbps);
  const needed = opts.proven ? DELIVERY_PROVEN_WINDOWS : DELIVERY_MIN_WINDOWS;
  if (paused || data.length < needed) return { kbps: null, windows: data.length, paused };
  return { kbps: Math.round(mean(data)), windows: data.length, paused };
}

export type AutoReason = 'stalls' | 'undo-raise' | 'delivery' | 'speed';
export type AutoMove = { step: QualityStep; direction: 'down' | 'up'; reason: AutoReason };

/** What a stall is judged with, besides its time. */
export interface StallContext {
  /** When playback last began (START_GRACE_MS), 0 if unknown. */
  lastStartAt?: number;
  /** The last seek (SEEK_GRACE_MS), 0 if unknown. */
  lastSeekAt?: number;
  /** On the Plex Relay. */
  relay?: boolean;
  /** A 4K file played as it is (bugs/plex-4k.md). */
  uhd?: boolean;
  /** The best sustained rate the server has delivered this title, kbps
   *  (sustainedKbps, kept for the title). */
  sustainedKbps?: number | null;
  /** What the server delivered over the last stalls, kbps (deliveredKbps),
   *  when it is short of what the stream needs; null otherwise. The line is
   *  then not clear, whatever it once managed. */
  shortKbps?: number | null;
}

/**
 * The line is plainly fast enough for a stream of `kbps` (PROVEN_FACTOR
 * times it), off the relay: the server has delivered that much sustained,
 * and is not delivering too little now.
 */
export function lineClearFor(kbps: number | undefined, ctx: StallContext = {}): boolean {
  if (ctx.relay || !kbps) return false;
  if (ctx.shortKbps != null && ctx.shortKbps > 0) return false;
  return (ctx.sustainedKbps ?? 0) >= kbps * PROVEN_FACTOR;
}

/**
 * A 4K file played as it is at `index` on a proven line: its stalls are the
 * server's slow spells, which the buffer is there for, and the viewer picked
 * 4K (the Plex app keeps playing it). Stalls alone then never move to the
 * 1080p file. Any other file may step to a lighter one (it starts at once).
 */
export function keepsFileOnStalls(ladder: QualityStep[], index: number, ctx: StallContext = {}): boolean {
  if (!ctx.uhd) return false;
  const cur = Number.isInteger(index) ? ladder[index] : undefined;
  if (!cur || cur.presetKey !== 'original' || !cur.kbps) return false;
  return lineClearFor(cur.kbps, ctx);
}

/** What automatic quality would do next from where playback is, for the
 *  buffering card. */
export interface AutoPreview {
  /** The step a drop would go to; null when there is nothing lower. */
  next: QualityStep | null;
  /** The viewer's own pick for this title (a preset key), if any. */
  manualKey: string | null;
  /** Stalls alone won't leave the file: the server has delivered it twice over. */
  keepsFile?: boolean;
  /** Nothing moves on stalls alone from here (only conversions are below,
   *  or the line is unproven for a lighter file): only too little delivered
   *  lowers it. */
  holds?: boolean;
  /** The server delivers too little for the stream: the best rate it
   *  managed over the last stalls, kbps. The drop to `next` comes within
   *  seconds. */
  shortKbps?: number | null;
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
  if (preview.next && preview.shortKbps) {
    return i18n.t('plex.quality.autoLowersStarved', { step: stepName(preview.next), speed: formatMbps(preview.shortKbps) });
  }
  if (preview.keepsFile) return i18n.t('plex.quality.autoKeepsFile');
  if (preview.next) return i18n.t('plex.quality.autoWillLower', { step: stepName(preview.next) });
  if (preview.holds) return i18n.t('plex.quality.autoHolds');
  const pick = preview.manualKey;
  if (!pick) return i18n.t('plex.quality.autoLowest');
  // Best first; under the floor (-1) is past the end.
  const pos = (i: number): number => (i < 0 ? ladder.length : i);
  // The highest step raising may reach: the pick, or the one just under it.
  const up = Math.ceil(pos(ladderIndex(ladder, pick)));
  if (pos(index) <= up) {
    const preset = PLEX_QUALITY_PRESETS.find((p) => p.key === pick);
    return i18n.t('plex.quality.autoOff', { pick: preset ? qualityPresetLabel(preset) : pick });
  }
  return i18n.t('plex.quality.autoAtLowest', { step: stepName(ladder[up]) });
}

/**
 * The timing half of automatic quality for one title: when to drop, when to
 * raise, and not flapping between the two. The caller rebuilds the ladder
 * and works out where playback is on it at each call (versions and bitrates
 * arrive after the start), and reports each change it made with `applied`.
 */
export class AutoQuality {
  private lastChangeAt: number;
  private raisedAt = 0;
  private raisedKbps: number | undefined;
  private raiseBlockedUntil = 0;
  private backoffMs = RAISE_BACKOFF_MS;
  private lastStallAt = 0;
  private manual: string | null = null;
  private failed: Set<string>;
  /** When each stall of the stream playing now began: the one list every
   *  rule reads. */
  private stallTimes: number[] = [];

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
    this.raisedKbps = undefined;
    this.stallTimes = [];
  }

  /** The viewer's pick for this title, or null. */
  manualKey(): string | null { return this.manual; }

  /** When the stream playing now started (the last change). */
  since(): number { return this.lastChangeAt; }

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

  /** Stalls of the stream playing now in the last `windowMs`, at `at`. */
  stallsWithin(at: number, windowMs = STALL_WINDOW_MS): number {
    return this.stallTimes.filter((t) => at - t < windowMs).length;
  }

  /**
   * A stall started at `at` (never the first load; one in the first half
   * minute after a start or a seek is the jump, and is not recorded).
   * Returns the drop to make, if any: straight back after a raise that did
   * not hold (unless the line is proven for it), else — once stalls have
   * repeated (3 within 5 minutes) — a lighter FILE sized to what the server
   * delivered (`ctx.shortKbps`, else its lightest file). Stalls alone never
   * move into a conversion, nor off a 4K file whose line is proven: that
   * takes delivery evidence (onDelivery).
   */
  onStall(at: number, ladder: QualityStep[], index: number, ctx: StallContext = {}): AutoMove | null {
    if (inJumpGrace(at, ctx.lastSeekAt ?? 0, ctx.lastStartAt ?? 0)) return null;
    this.lastStallAt = at;
    this.stallTimes = this.stallTimes.filter((t) => at - t < STALL_WINDOW_MS);
    this.stallTimes.push(at);
    if (this.raisedAt && at - this.raisedAt < RAISE_PROBATION_MS) {
      const back = index >= 0 ? ladder[Math.floor(index) + 1] : undefined;
      const proven = lineClearFor(this.raisedKbps, ctx);
      this.raisedAt = 0;
      this.raisedKbps = undefined;
      if (!proven) {
        this.raiseBlockedUntil = at + this.backoffMs;
        this.backoffMs = Math.min(RAISE_BACKOFF_MAX_MS, this.backoffMs * 2);
        if (back) return { step: back, direction: 'down', reason: 'undo-raise' };
      }
    }
    if (this.stallTimes.length < STALLS_TO_STEP) return null;
    if (keepsFileOnStalls(ladder, index, ctx)) return null;
    const file = lighterFile(ladder, index, ctx.shortKbps);
    return file ? { step: file, direction: 'down', reason: 'stalls' } : null;
  }

  /**
   * What the server delivered over the stalls of the stream playing now
   * (deliveredKbps, since the last change). `stallStart`: the stall under
   * way, whose pause gives no verdict. A line proven for `needKbps`
   * (`ctx.sustainedKbps`) is given the longer look.
   */
  delivery(rates: RateReport[], now: number, ctx: StallContext = {}, stallStart?: number, needKbps?: number): Delivery {
    const proven = lineClearFor(needKbps, { ...ctx, shortKbps: null });
    return deliveredKbps(rates, now, { since: this.lastChangeAt, lastStartAt: ctx.lastStartAt, lastSeekAt: ctx.lastSeekAt, stallStart, proven });
  }

  /**
   * The one down rule: `delivery` (see delivery) is short of what the stream
   * needs (`needKbps`, under DELIVERY_FACTOR of it): drop now to the best
   * rung that rate carries with headroom, lighter files first. A pause, or
   * too little evidence, is never a drop. Raising then waits
   * (RAISE_BACKOFF_MS): the rate that starved it was measured.
   */
  onDelivery(at: number, ladder: QualityStep[], index: number, delivery: Delivery, needKbps: number | undefined): AutoMove | null {
    if (!needKbps || delivery.paused || delivery.kbps == null || delivery.kbps <= 0) return null;
    if (delivery.kbps >= needKbps * DELIVERY_FACTOR) return null;
    const step = dropTarget(ladder, index, delivery.kbps);
    if (!step) return null;
    this.raiseBlockedUntil = Math.max(this.raiseBlockedUntil, at + RAISE_BACKOFF_MS);
    return { step, direction: 'down', reason: 'delivery' };
  }

  /** A converted step the server turned down or never fed: not tried again
   *  for this title, by automatic quality either. */
  convertFailed(key: string): void {
    if (key && key !== 'original' && key.indexOf('original@') !== 0) this.failed.add(key);
  }

  /** The server won't convert this title at all: every converted step in
   *  `ladder` counts as failed, so only its files as they are are left. */
  conversionsRefused(ladder: QualityStep[]): void {
    for (const s of ladder) if (s.presetKey !== 'original') this.failed.add(s.key);
  }

  /** What would move from `index` now, and the viewer's pick. `ctx.shortKbps`
   *  set: the delivery drop is due, to what that rate carries. */
  preview(ladder: QualityStep[], index: number, ctx: StallContext = {}): AutoPreview {
    const short = ctx.shortKbps && ctx.shortKbps > 0 ? ctx.shortKbps : null;
    if (short) {
      const next = dropTarget(ladder, index, short);
      return next ? { next, manualKey: this.manual, shortKbps: short } : { next: null, manualKey: this.manual };
    }
    if (dropTarget(ladder, index) == null) return { next: null, manualKey: this.manual };
    if (keepsFileOnStalls(ladder, index, ctx)) return { next: null, manualKey: this.manual, keepsFile: true };
    const file = lighterFile(ladder, index);
    if (file) return { next: file, manualKey: this.manual };
    const cur = Number.isInteger(index) ? ladder[index] : undefined;
    if (cur?.presetKey === 'original' && lineClearFor(cur.kbps, ctx)) return { next: null, manualKey: this.manual, keepsFile: true };
    return { next: null, manualKey: this.manual, holds: true };
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

  /** The caller switched quality at `at`. */
  applied(move: AutoMove, at: number): void {
    this.lastChangeAt = at;
    this.raisedAt = move.direction === 'up' ? at : 0;
    this.raisedKbps = move.direction === 'up' ? move.step.kbps : undefined;
    this.stallTimes = [];
  }
}

// ── a conversion that fails ─────────────────────────────────────────────────
//
// One failure state machine per title, whatever failed: the decision turned
// down, the server answering the session with an HTTP error status
// (PLEX_TRANSCODE_HTTP: the native player tried that session twice), or a
// session accepted but never fed (no picture in 30 s). Never the identical
// session again. In order: a FRESH session once (a new id, with a decision
// call first); the FILE as it is (unless audio forced the conversion: it
// would play mute); a LIGHTER conversion; then a plain message with the
// status. Capped per title.

/** Recoveries (fresh sessions and other qualities) per title, in all. */
export const CONVERT_RECOVERY_MAX = 4;
/** A session that has played this long since the last recovery starts a new
 *  outage: a fresh session is tried first again. */
export const CONVERT_RECOVERY_RESET_MS = 3 * 60_000;

export type ConvertRecoveryStep = 'fresh' | 'file' | 'lighter' | 'give-up';

export interface ConvertRecovery {
  /** 0: nothing tried yet, 1: a fresh session was started, 2: the file was
   *  tried, 3: a lighter conversion was tried (or none could be), 4: gave up. */
  stage: number;
  /** Recoveries started for this title. */
  total: number;
  /** When the last one started, ms (0: never). */
  lastAt: number;
}

export const freshConvertRecovery = (): ConvertRecovery => ({ stage: 0, total: 0, lastAt: 0 });

/**
 * What to do about a conversion that failed, at `now`. `played`: the session
 * that just failed had got playing (a new outage once it has played for a
 * while). `files: false`: the file as it is is no way out (audio forced the
 * conversion). Moves `r` on.
 */
export function convertRecoveryStep(r: ConvertRecovery, now: number, played: boolean, opts: { files?: boolean } = {}): ConvertRecoveryStep {
  if (r.stage > 0 && r.stage < 4 && played && r.lastAt > 0 && now - r.lastAt >= CONVERT_RECOVERY_RESET_MS) r.stage = 0;
  if (r.stage === 1 && opts.files === false) r.stage = 2;
  if (r.total >= CONVERT_RECOVERY_MAX || r.stage >= 3) {
    r.stage = 4;
    return 'give-up';
  }
  r.total += 1;
  r.lastAt = now;
  r.stage += 1;
  return r.stage === 1 ? 'fresh' : r.stage === 2 ? 'file' : 'lighter';
}

/**
 * The file to play as it is after a conversion failed: the best file on
 * `ladder` that `measuredKbps` (what the server delivered) carries with
 * headroom, else the lightest one. Null when the title has no file.
 */
export function fileAlternative(ladder: QualityStep[], measuredKbps?: number | null): QualityStep | null {
  const files = ladder.filter((st) => st.presetKey === 'original');
  if (!files.length) return null;
  const measured = measuredKbps && measuredKbps > 0 ? measuredKbps : null;
  return files.find((st) => !!measured && !!st.kbps && st.kbps * SPEED_HEADROOM <= measured) ?? files[files.length - 1];
}

/**
 * The lighter conversion to try after `failedKey` (at `index` on `ladder`)
 * failed: the next one down that has not failed, sized to `measuredKbps`
 * when it is known (the best that fits, else the lightest). Null when none
 * is left.
 */
export function lighterConversion(
  ladder: QualityStep[], index: number, failedKey: string,
  opts: { measuredKbps?: number | null; failed?: Iterable<string> } = {},
): QualityStep | null {
  const failed = new Set(opts.failed ?? []);
  failed.add(failedKey);
  const measured = opts.measuredKbps && opts.measuredKbps > 0 ? opts.measuredKbps : null;
  const from = index < 0 ? ladder.length : Math.floor(index) + 1;
  const lower = ladder.slice(from).filter((st) => st.presetKey !== 'original' && !failed.has(st.key));
  if (!lower.length) return null;
  if (measured) return lower.find((st) => !!st.kbps && st.kbps * SPEED_HEADROOM <= measured) ?? lower[lower.length - 1];
  return lower[0];
}

// ── ending a converting session ─────────────────────────────────────────────

const TRANSCODE_START = '/video/:/transcode/universal/start';
const STOP_TIMEOUT_MS = 5_000;
/** How long a stop is waited for before the next session is asked for. */
export const STOP_WAIT_MS = 2_000;

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
  void sendQuietly(transcodeStopUrl(url));
}

/**
 * Stops the session `url` started and WAITS for the server's answer (at
 * most STOP_WAIT_MS) before resolving, so the session that replaces it is
 * asked for on a server that has the slot free: a server that allows a
 * user one conversion at a time, or is still tearing the old one down,
 * turned the new one away otherwise. Through the native HTTP stack on a
 * box (the WebView's no-cors fetch cannot be waited on). Never throws.
 */
export async function stopPlexTranscodeAndWait(url: string | null | undefined, capMs = STOP_WAIT_MS): Promise<void> {
  const stop = transcodeStopUrl(url);
  if (!stop) return;
  let timer = 0;
  const cap = new Promise<void>((resolve) => { timer = setTimeout(resolve, capMs) as unknown as number; });
  try {
    await Promise.race([sendAndWait(stop, capMs), cap]);
  } finally {
    clearTimeout(timer);
  }
}

async function sendAndWait(url: string, capMs: number): Promise<void> {
  let native = false;
  try {
    const mod = await import('@capacitor/core');
    native = !!mod.Capacitor.isNativePlatform?.() && !!mod.CapacitorHttp;
    if (native) {
      await mod.CapacitorHttp.request({ method: 'GET', url, connectTimeout: capMs, readTimeout: capMs, responseType: 'text' });
      return;
    }
  } catch {
    // Native and it failed: the server is not answering; nothing more to wait for.
    if (native) return;
  }
  await sendQuietly(url);
}

/** The address that keeps a converting session alive (Plex's own players
 *  call it every few seconds while paused), or null when `url` is not one. */
export function transcodePingUrl(url: string | null | undefined): string | null {
  const stop = transcodeStopUrl(url);
  return stop ? stop.replace('/video/:/transcode/universal/stop?', '/video/:/transcode/universal/ping?') : null;
}

/**
 * How often a paused conversion is pinged. The server ends a session it
 * hears nothing from for a while (no segment asked for, no ping): a film
 * paused for a few minutes then came back to segment requests the server
 * answered with an error status, which looked like a refused conversion.
 */
export const TRANSCODE_PING_MS = 20_000;

/** Keeps a converting session alive while playback is paused (the player
 *  asks for no segments then). Fire and forget, like stopPlexTranscode. */
export function pingPlexTranscode(url: string | null | undefined): void {
  void sendQuietly(transcodePingUrl(url));
}

/** One quiet request; resolves when it is answered or given up on. */
function sendQuietly(url: string | null): Promise<void> {
  if (!url || typeof fetch !== 'function') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { try { ac?.abort(); } catch { /* ignore */ } }, STOP_TIMEOUT_MS);
    const done = () => { clearTimeout(timer); resolve(); };
    try {
      // no-cors: the answer is never read, and a server without CORS headers
      // still gets the request.
      fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ac?.signal }).then(done, done);
    } catch {
      done();
    }
  });
}
