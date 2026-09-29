import { describe, expect, it } from 'vitest';
import { RECORDINGS_CHANGED_EVENT, SnowRecorder, hasRecorder, notifyRecordingsChanged } from './SnowRecorder';
import { SnowPlayer, timeshiftOff } from './SnowPlayer';

// In the browser (and here) the plugins answer with their web fallbacks: rewind
// and recording are simply absent, and nothing throws until a caller tries to record.
describe('SnowRecorder on the web', () => {
  it('is not available, lists nothing, and refuses to record', async () => {
    expect(hasRecorder()).toBe(false);
    expect(await SnowRecorder.getVolumes()).toEqual({ volumes: [] });
    expect(await SnowRecorder.active()).toEqual({ jobs: [] });
    expect(await SnowRecorder.list()).toEqual({ recordings: [], volumes: [] });
    await expect(SnowRecorder.stop()).resolves.toBeUndefined();
    await expect(
      SnowRecorder.start({ url: 'http://x', channel: 'C', fileName: 'C', volumeId: 'box', durationMin: 30 }),
    ).rejects.toThrow('Snow Media Center app');
  });

  it('tells the screens when the list changes, under an smc- name', () => {
    expect(RECORDINGS_CHANGED_EVENT).toBe('smc-recordings:changed');
    let told = 0;
    const on = () => { told++; };
    window.addEventListener(RECORDINGS_CHANGED_EVENT, on);
    notifyRecordingsChanged();
    window.removeEventListener(RECORDINGS_CHANGED_EVENT, on);
    expect(told).toBe(1);
  });
});

describe('SnowPlayer rewind bridge on the web', () => {
  it('says there is no buffer and does nothing', async () => {
    expect(timeshiftOff()).toEqual({ state: 'off', mode: 'live', availableSec: 0, behindSec: 0, usedBytes: 0 });
    await expect(SnowPlayer.timeshiftStart({ url: 'http://x', key: 'k', maxMinutes: 0, hardCapMb: 4096 })).resolves.toBeUndefined();
    await expect(SnowPlayer.timeshiftStop()).resolves.toBeUndefined();
    await expect(SnowPlayer.timeshiftWipe()).resolves.toBeUndefined();
    expect(await SnowPlayer.timeshiftStatus()).toEqual(timeshiftOff());
    expect(await SnowPlayer.timeshiftSeek({ deltaSec: -10 })).toEqual(timeshiftOff());
    expect(await SnowPlayer.timeshiftGoLive()).toEqual(timeshiftOff());
    expect(await SnowPlayer.timeshiftUsage()).toEqual({ usedBytes: 0, freeBytes: 0, totalBytes: 0 });
  });
});
