import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_REWIND_SETTINGS, HARD_CAP_BYTES, MIN_FREE_BYTES, REWIND_SETTINGS_EVENT, REWIND_SETTINGS_KEY,
  availableLabel, behindLabel, buildTimeshiftUrl, catchupDays, catchupDurationMin, floorMinute, formatBytes,
  hasCatchup, loadRewindSettings, maxRewindMinutes, reserveBytes, rewindBudgetBytes, rewindChannelKey,
  saveRewindSettings, serverUtcOffsetMinutes, timeshiftStamp,
} from './liveRewind';
import storageBudgetKt from '../../android/app/src/main/java/com/snowmedia/dvr/StorageBudget.kt?raw';

const GB = 1024 * 1024 * 1024;
const LINE = { host: 'http://panel.example:8080/', username: 'jo hn', password: 'p@ss/w0rd#1' };

describe('Rewind settings', () => {
  afterEach(() => localStorage.clear());

  it('default: on, Auto', () => {
    expect(loadRewindSettings()).toEqual(DEFAULT_REWIND_SETTINGS);
    expect(DEFAULT_REWIND_SETTINGS).toEqual({ enabled: true, maxRewind: 'auto' });
  });

  it('saves, reads back, and tells the player', () => {
    let told = 0;
    const on = () => { told++; };
    window.addEventListener(REWIND_SETTINGS_EVENT, on);
    saveRewindSettings({ enabled: false, maxRewind: 30 });
    window.removeEventListener(REWIND_SETTINGS_EVENT, on);
    expect(told).toBe(1);
    expect(loadRewindSettings()).toEqual({ enabled: false, maxRewind: 30 });
  });

  it('a damaged or unknown value falls back to the defaults', () => {
    localStorage.setItem(REWIND_SETTINGS_KEY, '{not json');
    expect(loadRewindSettings()).toEqual(DEFAULT_REWIND_SETTINGS);
    localStorage.setItem(REWIND_SETTINGS_KEY, JSON.stringify({ enabled: true, maxRewind: 45 }));
    expect(loadRewindSettings().maxRewind).toBe('auto');
  });

  it('Max rewind in minutes for the buffer (0 = Auto)', () => {
    expect(maxRewindMinutes('auto')).toBe(0);
    expect(maxRewindMinutes(10)).toBe(10);
    expect(maxRewindMinutes(60)).toBe(60);
  });
});

describe('the disk budget (same math as StorageBudget.kt)', () => {
  it('always keeps max(1 GB, 15% of the volume) free', () => {
    expect(reserveBytes(4 * GB)).toBe(MIN_FREE_BYTES); // 15% of 4 GB is 0.6 GB: 1 GB wins
    expect(reserveBytes(100 * GB)).toBe(15 * GB);
  });

  it('takes what is left above the reserve, up to the hard cap', () => {
    // 8 GB stick with 3 GB free: 3 - max(1, 1.2) = 1.8 GB.
    expect(rewindBudgetBytes({ freeBytes: 3 * GB, totalBytes: 8 * GB, usedBytes: 0 })).toBeCloseTo(1.8 * GB, -7);
    // A big empty drive stops at the hard cap.
    expect(rewindBudgetBytes({ freeBytes: 500 * GB, totalBytes: 1000 * GB, usedBytes: 0 })).toBe(HARD_CAP_BYTES);
  });

  it('what the buffer already holds counts as its own space', () => {
    // 1.5 GB free with 1 GB of buffer on an 8 GB box: 2.5 - 1.2 = 1.3 GB.
    const b = rewindBudgetBytes({ freeBytes: 1.5 * GB, totalBytes: 8 * GB, usedBytes: 1 * GB });
    expect(b).toBeCloseTo(1.3 * GB, -7);
  });

  it('a nearly full box gets nothing (never negative)', () => {
    expect(rewindBudgetBytes({ freeBytes: 0.5 * GB, totalBytes: 8 * GB, usedBytes: 0 })).toBe(0);
  });

  it('the Kotlin side uses the same numbers', () => {
    expect(storageBudgetKt).toContain('const val MIN_FREE_BYTES = 1L shl 30');
    expect(storageBudgetKt).toContain('const val MIN_FREE_PERCENT = 15L');
    expect(storageBudgetKt).toMatch(/maxOf\(MIN_FREE_BYTES, totalBytes \/ 100L \* MIN_FREE_PERCENT\)/);
    expect(storageBudgetKt).toMatch(/maxOf\(0L, minOf\(hardCapBytes, usedBytes \+ freeBytes - reserveBytes\(totalBytes\)\)\)/);
  });
});

describe('panel catch-up', () => {
  it('only channels with tv_archive = 1 and some days of archive', () => {
    expect(hasCatchup({ tv_archive: 1, tv_archive_duration: 3 })).toBe(true);
    expect(catchupDays({ tv_archive: '1' as unknown as number, tv_archive_duration: '7' as unknown as number })).toBe(7);
    expect(hasCatchup({ tv_archive: 0, tv_archive_duration: 3 })).toBe(false);
    expect(hasCatchup({ tv_archive: 1, tv_archive_duration: 0 })).toBe(false);
    expect(hasCatchup({})).toBe(false);
    expect(hasCatchup(null)).toBe(false);
  });

  it("reads the panel's clock from server_info", () => {
    // Panel in UTC+2: its local time is two hours ahead of the timestamp.
    const ts = Date.UTC(2026, 8, 28, 10, 0, 0) / 1000;
    expect(serverUtcOffsetMinutes({ time_now: '2026-09-28 12:00:03', timestamp_now: ts })).toBe(120);
    expect(serverUtcOffsetMinutes({ time_now: '2026-09-28 05:30:00', timestamp_now: ts })).toBe(-270);
    expect(serverUtcOffsetMinutes({ time_now: 'soon', timestamp_now: ts })).toBeNull();
    expect(serverUtcOffsetMinutes(undefined)).toBeNull();
  });

  it('stamps the start in the panel time, minute-precise', () => {
    const at = Date.UTC(2026, 8, 28, 23, 45, 50);
    expect(timeshiftStamp(at, 0)).toBe('2026-09-28:23-45');
    expect(timeshiftStamp(at, 60)).toBe('2026-09-29:00-45'); // next day in the panel's zone
    expect(floorMinute(at)).toBe(Date.UTC(2026, 8, 28, 23, 45, 0));
  });

  it('builds the standard Xtream timeshift address, credentials encoded like every stream address', () => {
    const at = Date.UTC(2026, 8, 28, 20, 15, 30);
    const url = buildTimeshiftUrl(LINE, 1234, at, 45, 0);
    expect(url).toBe('http://panel.example:8080/timeshift/jo%20hn/p%40ss%2Fw0rd%231/45/2026-09-28:20-15/1234.ts');
    // Never a raw slash or # from the password that would break the path.
    expect(url.split('/')).toHaveLength(9);
  });

  it('asks for the archive up to now, plus a little', () => {
    const now = Date.UTC(2026, 8, 28, 21, 0, 0);
    expect(catchupDurationMin(now - 30 * 60_000, now)).toBe(35);
    expect(catchupDurationMin(now, now)).toBe(5);
  });
});

describe('labels', () => {
  it('available and behind', () => {
    expect(availableLabel(750)).toBe('-12:30 available');
    expect(availableLabel(3725)).toBe('-1:02:05 available');
    expect(availableLabel(0)).toBe('Rewind is getting ready');
    expect(availableLabel(0, 3)).toBe('Catch-up: up to 3 days back');
    expect(behindLabel(0)).toBe('LIVE');
    expect(behindLabel(45)).toBe('-0:45');
  });

  it('sizes', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(350 * 1024 * 1024)).toBe('350 MB');
    expect(formatBytes(1.25 * GB)).toBe('1.3 GB');
  });

  it('the buffer key names the channel, never the line', () => {
    const key = rewindChannelKey('http://panel.example:8080/', 99);
    expect(key).toBe('http://panel.example:8080|99');
    expect(key).not.toContain(LINE.password);
  });
});
