import { beforeEach, describe, expect, it, vi } from 'vitest';

const sp = vi.hoisted(() => ({ calls: [] as string[], state: 'capturing', fail: false }));
vi.mock('@/capacitor/SnowPlayer', () => ({
  SnowPlayer: {
    timeshiftStatus: async () => { sp.calls.push('status'); if (sp.fail) throw new Error('older app'); return { state: sp.state }; },
    timeshiftWipe: async () => { sp.calls.push('wipe'); },
  },
}));
import {
  CUSTOM_MAX, CUSTOM_MIN, LOW_SPACE_BYTES, MAX_SIMULTANEOUS_RECORDINGS, RECORD_DURATIONS, cleanRename, endsAtLabel,
  extraStreamNote, pauseRewindForRecording, formatDuration, formatMinutes, isLowSpace, listWindow, recordingFileName, safeFilePart, stepCustom,
} from './recording';
import liveSectionSrc from '../components/livetv/LiveSection.tsx?raw';
import guideSectionSrc from '../components/livetv/GuideSection.tsx?raw';
import storeKt from '../../android/app/src/main/java/com/snowmedia/dvr/RecordingStore.kt?raw';
import serviceKt from '../../android/app/src/main/java/com/snowmedia/dvr/RecordingService.kt?raw';

describe('recording names', () => {
  it('"<Channel> – <date time>.ts", with no colon (USB drives refuse it)', () => {
    const at = new Date(2026, 8, 28, 20, 5);
    expect(recordingFileName('CNN HD', at)).toBe('CNN HD – 2026-09-28 20.05.ts');
    expect(recordingFileName('CNN HD', at)).not.toContain(':');
  });

  it('channel names are made safe for any drive', () => {
    expect(safeFilePart('US: ESPN | 4K / Live*')).toBe('US ESPN 4K Live');
    expect(safeFilePart('...')).toBe('Channel');
    expect(safeFilePart('')).toBe('Channel');
    expect(safeFilePart('a'.repeat(200))).toHaveLength(80);
  });

  it('renames are cleaned the same way, the .ts left to the file', () => {
    expect(cleanRename('Big game.ts')).toBe('Big game');
    expect(cleanRename('  final: part 1?  ')).toBe('final part 1');
    expect(cleanRename('???')).toBe('');
  });

  it('the Kotlin side cleans names again before touching a file', () => {
    expect(storeKt).toContain('fun safeName(name: String): String');
    expect(storeKt).toContain('fun uniqueFile(dir: File, name: String): File');
  });
});

describe('record lengths', () => {
  it('30 min, 1 h, 2 h, 3 h, custom, until stopped', () => {
    expect(RECORD_DURATIONS.map((d) => d.minutes)).toEqual([30, 60, 120, 180, -1, 0]);
  });

  it('custom steps by 15 minutes between 15 min and 12 h', () => {
    expect(stepCustom(90, 1)).toBe(105);
    expect(stepCustom(90, -1)).toBe(75);
    expect(stepCustom(CUSTOM_MIN, -1)).toBe(CUSTOM_MIN);
    expect(stepCustom(CUSTOM_MAX, 1)).toBe(CUSTOM_MAX);
  });

  it('labels', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    expect(formatDuration(3930)).toBe('1:05:30');
    expect(formatDuration(724)).toBe('12:04');
    expect(endsAtLabel(0)).toBeNull();
    expect(endsAtLabel(90, new Date(2026, 8, 28, 20, 15))?.replace(/\s/g, ' ')).toBe('9:45 PM');
  });

  it('warns under 2 GB free', () => {
    expect(isLowSpace(LOW_SPACE_BYTES - 1)).toBe(true);
    expect(isLowSpace(LOW_SPACE_BYTES)).toBe(false);
  });
});

describe('the extra-stream notice', () => {
  it('says plainly that a recording uses one more stream, with the plan size when known', () => {
    expect(extraStreamNote(2)).toBe('Recording uses one more stream on your line (your plan allows 2 at once).');
    expect(extraStreamNote(1)).toBe('Recording uses one more stream on your line (your plan allows 1 at once).');
  });

  it('leaves the number out when the plan is not known', () => {
    for (const unknown of [null, undefined, 0, NaN, -1]) {
      expect(extraStreamNote(unknown)).toBe('Recording uses one more stream on your line.');
    }
  });

  it('never more than two recordings at once (the Kotlin side has the same cap)', () => {
    expect(MAX_SIMULTANEOUS_RECORDINGS).toBe(2);
    expect(serviceKt).toContain(`const val MAX_SIMULTANEOUS = ${MAX_SIMULTANEOUS_RECORDINGS}`);
  });
});

describe('listWindow', () => {
  it('keeps the focused row in view', () => {
    expect(listWindow(3, 2, 5)).toEqual({ start: 0, end: 3 });
    expect(listWindow(20, 0, 5)).toEqual({ start: 0, end: 5 });
    expect(listWindow(20, 10, 5)).toEqual({ start: 8, end: 13 });
    expect(listWindow(20, 19, 5)).toEqual({ start: 15, end: 20 });
  });
});

describe('the rewind buffer gives way before a recording opens its stream', () => {
  beforeEach(() => { sp.calls = []; sp.state = 'capturing'; sp.fail = false; });

  it('wipes a running buffer on plans under 4 streams (or unknown)', async () => {
    for (const plan of [1, 2, 3, null, undefined]) {
      sp.calls = [];
      expect(await pauseRewindForRecording(plan)).toBe(true);
      expect(sp.calls).toEqual(['status', 'wipe']);
    }
  });

  it('leaves it alone on 4 or more streams (room for picture + buffer + recording)', async () => {
    expect(await pauseRewindForRecording(4)).toBe(false);
    expect(await pauseRewindForRecording(10)).toBe(false);
    expect(sp.calls).toEqual([]);
  });

  it('says nothing when there is no buffer, or the app is too old to have one', async () => {
    sp.state = 'off';
    expect(await pauseRewindForRecording(2)).toBe(false);
    expect(sp.calls).toEqual(['status']);
    sp.fail = true;
    expect(await pauseRewindForRecording(2)).toBe(false);
  });

  it('Live TV and the Guide both do it before SnowRecorder.start, and say so', () => {
    for (const src of [liveSectionSrc, guideSectionSrc]) {
      const at = src.indexOf('pauseRewindForRecording(');
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(src.indexOf('SnowRecorder.start('));
      expect(src).toContain('REWIND_PAUSED_NOTE');
    }
  });
});

describe('a just-started recording stays in the list', () => {
  it('list() keeps the entry of a running recording even before its file exists', () => {
    expect(storeKt).toContain('RecordingService.isActive(it)');
    expect(storeKt).toMatch(/!onMounted \|\| running \|\| seen\.contains\(path\)/);
  });
});

describe('engine-compare sampling', () => {
  it('LiveSection reads getStats for it only when mpv is in the build or the Stats panel is open', () => {
    expect(liveSectionSrc).toContain('shouldSampleEngines(mpvInBuildRef.current, statsShownRef.current)');
    expect(liveSectionSrc).not.toMatch(/window\.setTimeout\(\(\) => \{\s*void SnowPlayer\.getStats\(\)/);
  });
});
