import { beforeEach, describe, expect, it } from 'vitest';
import { compareEngines, readEngineSamples, recordEngineSample, sampleFromStats } from './engineCompare';
import { emptyPlayerStats } from '@/capacitor/SnowPlayer';

beforeEach(() => { localStorage.clear(); });

describe('sampleFromStats', () => {
  it('reads engine, first picture, stalls, stall seconds, cpu and memory off a PlayerStats', () => {
    const st = { ...emptyPlayerStats(), engine: 'mpv' as const, firstFrameMs: 420, stalls: 2, stallSec: 3.5, cpuPct: 12.5, pssMb: 88 };
    const s = sampleFromStats(st, 4.2);
    expect(s).toMatchObject({ engine: 'mpv', firstPictureMs: 420, stalls: 2, stallSec: 3.5, minutes: 4.2, cpuPct: 12.5, pssMb: 88 });
    expect(typeof s.at).toBe('number');
  });
});

describe('recordEngineSample / readEngineSamples', () => {
  it('keeps samples per engine, most recent last, up to 30', () => {
    for (let i = 0; i < 35; i++) {
      recordEngineSample({ engine: 'exo', firstPictureMs: i, stalls: 0, stallSec: 0, minutes: 1, cpuPct: null, pssMb: null, at: i });
    }
    const list = readEngineSamples('exo');
    expect(list).toHaveLength(30);
    expect(list[0].firstPictureMs).toBe(5); // the oldest 5 were dropped
    expect(list[29].firstPictureMs).toBe(34);
    expect(readEngineSamples('mpv')).toHaveLength(0);
  });

  it('never throws when localStorage is unavailable', () => {
    const real = window.localStorage;
    // Simulate a private window / blocked storage.
    delete (window as { localStorage?: Storage }).localStorage;
    expect(() => recordEngineSample({ engine: 'mpv', firstPictureMs: 1, stalls: 0, stallSec: 0, minutes: 1, cpuPct: null, pssMb: null, at: 1 })).not.toThrow();
    expect(readEngineSamples('mpv')).toEqual([]);
    Object.defineProperty(window, 'localStorage', { value: real, configurable: true });
  });

  it('a corrupted or non-array value reads back as empty, not a crash', () => {
    localStorage.setItem('smc-engine-compare-v1-exo', 'not json');
    expect(readEngineSamples('exo')).toEqual([]);
    localStorage.setItem('smc-engine-compare-v1-exo', '{"not":"an array"}');
    expect(readEngineSamples('exo')).toEqual([]);
  });
});

describe('compareEngines', () => {
  it('with nothing recorded, both rows read as unknown (all null, zero samples)', () => {
    const rows = compareEngines();
    expect(rows.map((r) => r.engine)).toEqual(['exo', 'mpv']);
    for (const r of rows) {
      expect(r.samples).toBe(0);
      expect(r.medianFirstPictureMs).toBeNull();
      expect(r.stallsPerHour).toBeNull();
      expect(r.avgCpuPct).toBeNull();
      expect(r.avgMemoryMb).toBeNull();
    }
  });

  it('median time to first picture, stalls/hour and stall seconds/hour, over several samples', () => {
    // 3 watches of exo: 6 min with 1 stall of 2s, 6 min with 3 stalls of 6s,
    // 12 min with 0 stalls — 24 min = 0.4h total, 4 stalls / 0.4h = 10/hr.
    recordEngineSample({ engine: 'exo', firstPictureMs: 300, stalls: 1, stallSec: 2, minutes: 6, cpuPct: 10, pssMb: 100, at: 1 });
    recordEngineSample({ engine: 'exo', firstPictureMs: 500, stalls: 3, stallSec: 6, minutes: 6, cpuPct: 20, pssMb: 200, at: 2 });
    recordEngineSample({ engine: 'exo', firstPictureMs: 100, stalls: 0, stallSec: 0, minutes: 12, cpuPct: 30, pssMb: 300, at: 3 });
    const [exo] = compareEngines();
    expect(exo.samples).toBe(3);
    expect(exo.medianFirstPictureMs).toBe(300);
    expect(exo.stallsPerHour).toBeCloseTo(10, 5);
    expect(exo.stallSecPerHour).toBeCloseTo(20, 5);
    expect(exo.avgCpuPct).toBeCloseTo(20, 5);
    expect(exo.avgMemoryMb).toBeCloseTo(200, 5);
  });

  it('a null cpu/memory sample is left out of the average, not treated as zero', () => {
    recordEngineSample({ engine: 'mpv', firstPictureMs: 200, stalls: 0, stallSec: 0, minutes: 5, cpuPct: null, pssMb: null, at: 1 });
    recordEngineSample({ engine: 'mpv', firstPictureMs: 400, stalls: 0, stallSec: 0, minutes: 5, cpuPct: 40, pssMb: 400, at: 2 });
    const [, mpv] = compareEngines();
    expect(mpv.avgCpuPct).toBe(40);
    expect(mpv.avgMemoryMb).toBe(400);
    expect(mpv.medianFirstPictureMs).toBe(300);
  });
});
