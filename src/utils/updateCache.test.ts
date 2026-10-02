// The silent update's download waits for its caller's go-ahead (an idle Home,
// see AutoUpdatePrompt); an APK already in the cache never waits.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ cached: false, order: [] as string[] }));
vi.mock('@/utils/platform', () => ({ isNativePlatform: () => true, isAndroidNative: () => true }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} },
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: {
    stat: async () => { if (!h.cached) throw new Error('missing'); return { size: 1 }; },
    getUri: async () => ({ uri: 'file:///cache/apk/snow_media_center_1.8.2.apk' }),
    deleteFile: async () => {},
  },
}));
vi.mock('@/capacitor/AppManager', () => ({
  AppManager: {
    listCachedApks: async () => ({ files: [] }),
    getApkInfo: async () => ({ versionName: '1.8.2', versionCode: 60, packageName: 'com.snowmedia.center' }),
  },
}));
vi.mock('@/utils/downloadApk', () => ({
  downloadApkToCache: async () => { h.order.push('download'); return 'file:///cache/apk/snow_media_center_1.8.2.apk'; },
  cleanupOldApks: async () => {},
}));

import { prepareSmcUpdate } from './updateCache';

const INFO = { version: '1.8.2', versionCode: 60, downloadUrl: 'https://example.test/smc.apk' };

beforeEach(() => { h.cached = false; h.order = []; });

describe('prepareSmcUpdate: beforeDownload', () => {
  it('is awaited before the download starts', async () => {
    let go: () => void = () => {};
    const gate = () => new Promise<void>((resolve) => { h.order.push('wait'); go = () => { h.order.push('go'); resolve(); }; });
    const p = prepareSmcUpdate(INFO, undefined, { beforeDownload: gate });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.order).toEqual(['wait']);
    go();
    await expect(p).resolves.toMatchObject({ apkVersionCode: 60, fromCache: false });
    expect(h.order).toEqual(['wait', 'go', 'download']);
  });

  it('gives up without downloading when the go-ahead is refused', async () => {
    await expect(prepareSmcUpdate(INFO, undefined, { beforeDownload: async () => { throw new Error('left Home'); } })).rejects.toThrow('left Home');
    expect(h.order).toEqual([]);
  });

  it('a cached APK is used at once, with no wait', async () => {
    h.cached = true;
    const gate = vi.fn(async () => {});
    await expect(prepareSmcUpdate(INFO, undefined, { beforeDownload: gate })).resolves.toMatchObject({ fromCache: true });
    expect(gate).not.toHaveBeenCalled();
    expect(h.order).toEqual([]);
  });
});
