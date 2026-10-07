import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  free: 300 * 1024 * 1024,
  low: false,
  freed: 200 * 1024 * 1024,
  closeCalls: 0,
}));

vi.mock('@/utils/platform', () => ({ isNativePlatform: () => h.native }));
vi.mock('@/capacitor/AppManager', () => ({
  AppManager: {
    getStorageInfo: async () => ({ totalBytes: 0, freeBytes: 0, totalMemoryBytes: 2e9, freeMemoryBytes: h.free, lowMemory: h.low }),
    closeBackgroundApps: async () => { h.closeCalls++; return { asked: 40, freedMemoryBytes: h.freed, freeMemoryBytes: h.free + h.freed, totalMemoryBytes: 2e9 }; },
  },
}));

import { __resetPlaybackMemoryForTests, freeMemoryForPlayback, MIN_INTERVAL_MS, setFreedMemoryNotifier } from './playbackMemory';

const MB = 1024 * 1024;

beforeEach(() => {
  __resetPlaybackMemoryForTests();
  h.native = true; h.free = 300 * MB; h.low = false; h.freed = 200 * MB; h.closeCalls = 0;
});

describe('freeing memory for playback', () => {
  it('closes background apps when the box is low on memory, and says how much it freed', async () => {
    const said: number[] = [];
    setFreedMemoryNotifier((mb) => said.push(mb));
    const r = await freeMemoryForPlayback(1_000_000);
    expect(h.closeCalls).toBe(1);
    expect(r).toEqual({ freedBytes: 200 * MB, freeBytes: 500 * MB });
    expect(said).toEqual([200]);
  });

  it('leaves the apps alone when there is enough memory', async () => {
    h.free = 900 * MB;
    expect(await freeMemoryForPlayback(1_000_000)).toBeNull();
    expect(h.closeCalls).toBe(0);
  });

  it("still closes them when Android says it's low on memory", async () => {
    h.free = 900 * MB; h.low = true;
    await freeMemoryForPlayback(1_000_000);
    expect(h.closeCalls).toBe(1);
  });

  it('runs at most once every few minutes (channel surfing does not repeat it)', async () => {
    await freeMemoryForPlayback(1_000_000);
    await freeMemoryForPlayback(1_000_000 + 10_000);
    expect(h.closeCalls).toBe(1);
    await freeMemoryForPlayback(1_000_000 + MIN_INTERVAL_MS + 1);
    expect(h.closeCalls).toBe(2);
  });

  it('no message when it freed next to nothing', async () => {
    const said: number[] = [];
    setFreedMemoryNotifier((mb) => said.push(mb));
    h.freed = 5 * MB;
    await freeMemoryForPlayback(1_000_000);
    expect(said).toEqual([]);
  });

  it('does nothing outside the installed app', async () => {
    h.native = false;
    expect(await freeMemoryForPlayback(1_000_000)).toBeNull();
    expect(h.closeCalls).toBe(0);
  });
});
