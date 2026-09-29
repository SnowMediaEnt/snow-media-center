/**
 * Scheduled recordings, the rules (TRACKER 25.10). The window / merge /
 * conflict / fire cases are the same vectors the Kotlin tests read
 * (ScheduleRulesTest, LineCredsTest), so the two sides can't drift apart.
 * The URL cases are checked against the real encodeURIComponent.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import vectors from './recordSchedule.vectors.json';
import {
  AFTER_CHOICES, BEFORE_CHOICES, DEFAULT_PADDING, PADDING_KEY, busyFromJobs, clockLabel, conflictMessage, estimateBytes,
  formatHm, loadPadding, mergeAdjacent, minutesUntil, paddedLabel, paddedWindow, planAtFire, programmeChoices,
  programmeMode, programmeTimeUtcMs, reasonText, recordingCap, savePadding, scheduleConflict, spaceWarning, updateGuardNote,
  type FireKind, type SchedLike,
} from './recordSchedule';
import { buildNativeLiveUrl } from './xtream';

const asSched = (o: unknown) => o as SchedLike;

describe('shared vectors', () => {
  it.each(vectors.padding)('padding: $name', (c) => {
    expect(paddedWindow(c)).toEqual(c.expect);
  });

  it.each(vectors.merge)('merge: $name', (c) => {
    expect(mergeAdjacent(c.schedules.map(asSched))).toEqual(c.expect);
  });

  it.each(vectors.conflicts)('conflicts: $name', (c) => {
    expect(scheduleConflict(c.existing.map(asSched), asSched(c.candidate), c.cap)).toEqual(c.expect);
  });

  it.each(vectors.fire)('fire: $name', (c) => {
    expect(planAtFire(asSched(c.schedule), c.now)).toBe(c.expect as FireKind);
  });

  it('the re-arm and user-tag cases are for the Kotlin side; they must at least be well formed', () => {
    for (const c of vectors.rearm) {
      expect(typeof c.now).toBe('number');
      for (const r of c.expect) expect(['ARM', 'START_NOW', 'MARK_MISSED', 'RESTART', 'MARK_DONE', 'PURGE']).toContain(r.kind);
    }
    for (const u of vectors.userTag) expect(u.expect).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('the address encoding the native side must match', () => {
  it.each(vectors.urlEncode.map((c) => [JSON.stringify(c.input), c] as const))('encodeURIComponent(%s)', (_n, c) => {
    expect(encodeURIComponent(c.input)).toBe(c.expect);
  });

  it.each(vectors.liveUrl.map((c) => [c.host, c] as const))('the live .ts address on %s is the one buildNativeLiveUrl makes', (_h, c) => {
    // The web builds it from the creds; the vector holds what the Kotlin builder must produce.
    expect(buildNativeLiveUrl({ host: c.host.replace(/\/+$/, ''), username: c.user, password: c.pass, output: 'ts' }, c.streamId)).toBe(c.expect);
  });
});

describe('programme times', () => {
  it('true UTC timestamps are used as they are, whatever the panel offset', () => {
    expect(programmeTimeUtcMs('1790625600', 120)).toBe(1790625600 * 1000);
  });

  it("the text is the panel's clock: read as UTC, then the panel's offset comes off", () => {
    // 20:00 on a panel two hours ahead of UTC is 18:00 UTC.
    expect(programmeTimeUtcMs('2026-09-28 20:00:00', 120)).toBe(Date.UTC(2026, 8, 28, 18, 0));
    expect(programmeTimeUtcMs('2026-09-28 20:00:00', -300)).toBe(Date.UTC(2026, 8, 29, 1, 0));
    expect(programmeTimeUtcMs('2026-09-28T20:00', 0)).toBe(Date.UTC(2026, 8, 28, 20, 0));
  });

  it("without a panel offset the box's own is used", () => {
    const at = Date.UTC(2026, 8, 28, 20, 0);
    expect(programmeTimeUtcMs('2026-09-28 20:00:00', null)).toBe(at + new Date(at).getTimezoneOffset() * 60_000);
  });

  it('nothing readable gives null', () => {
    expect(programmeTimeUtcMs(undefined, 0)).toBeNull();
    expect(programmeTimeUtcMs('', 0)).toBeNull();
    expect(programmeTimeUtcMs('soon', 0)).toBeNull();
  });
});

describe('padding setting', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to 2 minutes early and 5 late, and keeps a saved choice', () => {
    expect(loadPadding()).toEqual({ beforeMin: 2, afterMin: 5 });
    savePadding({ beforeMin: 10, afterMin: 30 });
    expect(loadPadding()).toEqual({ beforeMin: 10, afterMin: 30 });
  });

  it('only the offered choices are accepted; anything else falls back', () => {
    expect(BEFORE_CHOICES).toEqual([0, 2, 5, 10]);
    expect(AFTER_CHOICES).toEqual([0, 5, 10, 15, 30]);
    localStorage.setItem(PADDING_KEY, JSON.stringify({ beforeMin: 7, afterMin: 99 }));
    expect(loadPadding()).toEqual(DEFAULT_PADDING);
    localStorage.setItem(PADDING_KEY, 'not json');
    expect(loadPadding()).toEqual(DEFAULT_PADDING);
  });
});

describe('what the dialog shows', () => {
  const at = (h: number, m = 0) => new Date(2026, 8, 28, h, m).getTime();

  it('lists up to six programmes from the one under the window edge, skipping finished ones', () => {
    const list = Array.from({ length: 9 }, (_, i) => ({ title: `P${i}`, startMs: at(18 + i), endMs: at(19 + i) }));
    const got = programmeChoices(list, at(20, 0), at(20, 10));
    expect(got.map((p) => p.title)).toEqual(['P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
    // Nothing before "now" even when the window starts earlier.
    expect(programmeChoices(list, at(18, 0), at(21, 30)).map((p) => p.title)[0]).toBe('P3');
  });

  it('a programme on now records at once, a later one is scheduled, a finished one cannot be', () => {
    const p = { title: 'The News', startMs: at(20), endMs: at(21) };
    const pad = { beforeMin: 2, afterMin: 5 };
    expect(programmeMode(p, pad, at(20, 30))).toBe('now');
    expect(programmeMode(p, pad, at(19, 59))).toBe('now'); // inside the early padding
    expect(programmeMode(p, pad, at(19, 0))).toBe('later');
    expect(programmeMode(p, pad, at(21, 5))).toBe('over');
    expect(minutesUntil(at(21, 5), at(20, 30))).toBe(35);
    expect(minutesUntil(at(20, 30), at(20, 30))).toBe(1);
  });

  it('the padded times and the space estimate read plainly', () => {
    // 12-hour clock in every language (owner's choice); Intl may put a narrow space before AM/PM.
    const plain = (s: string) => s.replace(/\s/g, ' ');
    expect(plain(paddedLabel(at(19, 58), at(21, 5)))).toBe('7:58 PM → 9:05 PM');
    expect(plain(clockLabel(at(7, 5)))).toBe('7:05 AM');
    expect(formatHm(67)).toBe('1 h 07');
    expect(formatHm(45)).toBe('45 min');
    expect(formatHm(120)).toBe('2 h 00');
    expect(estimateBytes(60)).toBe(2.5 * 1024 ** 3);
    const GB = 1024 ** 3;
    // A 67 minute recording is about 2.8 GB; 3 GB free with a 1 GB floor leaves 2 GB: no.
    expect(spaceWarning(67, 3 * GB, GB)).toMatch(/^Not enough free space for about 1 h 07/);
    expect(spaceWarning(67, 10 * GB, GB)).toBeNull();
    expect(spaceWarning(67, 0.5 * GB, GB)).toMatch(/Not enough free space/);
  });

  it('the conflict message names the time and the count', () => {
    const c = { atMs: at(20), count: 2 };
    expect(conflictMessage(c).replace(/\s/g, ' ')).toBe('You already have 2 recordings at 8:00 PM. Cancel one first.');
    expect(conflictMessage({ atMs: at(20), count: 1 }).replace(/\s/g, ' ')).toBe('You already have 1 recording at 8:00 PM. Cancel one first.');
  });

  it('the limit is two, or the plan if it is smaller; running recordings count as busy', () => {
    expect(recordingCap(null)).toBe(2);
    expect(recordingCap(1)).toBe(1);
    expect(recordingCap(4)).toBe(2);
    const busy = busyFromJobs([{ id: 'r1', startedAt: at(19), endsAt: 0 }, { id: 'r2', startedAt: at(19), endsAt: at(21) }], at(20));
    const cand: SchedLike = { id: 'n', streamId: 5, startUtcMs: at(20, 30), endUtcMs: at(21, 30), padBeforeMin: 0, padAfterMin: 0 };
    expect(scheduleConflict(busy, cand, 2)).toEqual({ atMs: at(20, 30), count: 2 });
    expect(scheduleConflict(busy, cand, 4)).toBeNull();
  });
});

describe("the updater's warning", () => {
  const now = new Date(2026, 8, 28, 20, 0).getTime();
  const sched = (startMin: number, over: Partial<SchedLike> = {}) => ({
    startUtcMs: now + startMin * 60_000, endUtcMs: now + (startMin + 60) * 60_000, padBeforeMin: 2, padAfterMin: 5, status: 'scheduled', ...over,
  });

  it('a running recording is enough', () => {
    expect(updateGuardNote([{}], [], now)).toMatch(/recording is running/);
  });

  it('a schedule starting within 30 minutes is, one later or already over is not', () => {
    expect(updateGuardNote([], [sched(20)], now)).toMatch(/scheduled to start soon/);
    expect(updateGuardNote([], [sched(31)], now)).toMatch(/scheduled to start soon/); // padded start is 29 minutes away
    expect(updateGuardNote([], [sched(33)], now)).toBeNull(); // 31 minutes away
    expect(updateGuardNote([], [sched(-120)], now)).toBeNull(); // over
    expect(updateGuardNote([], [sched(10, { status: 'missed' })], now)).toBeNull();
  });

  it('nothing at stake gives null', () => {
    expect(updateGuardNote([], [], now)).toBeNull();
  });
});

describe('reasonText', () => {
  it('shows the stored English reasons in the app language, and unknown ones as they came', async () => {
    const i18n = (await import('@/i18n')).default;
    expect(reasonText('Not enough free space.')).toBe('Not enough free space.');
    expect(reasonText('3 recordings were already running.')).toBe('3 recordings were already running.');
    await i18n.changeLanguage('es');
    try {
      expect(reasonText('Not enough free space.')).toBe('No hay suficiente espacio libre.');
      expect(reasonText('The drive is full')).toBe('La unidad está llena');
      expect(reasonText('1 recording was already running.')).toBe('Ya había 1 grabación en curso.');
      expect(reasonText('Something new')).toBe('Something new');
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
