/**
 * The iPhone build is native too, so isNativePlatform() alone can no longer
 * mean "Android". isIOSNative / isAndroidNative / canManageApps split it, and
 * must leave a box and the web exactly where isNativePlatform() put them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Win = Record<string, unknown>;

const setBridge = (bridge: Win) => {
  for (const k of ['Capacitor', 'androidBridge', 'webkit']) delete (window as unknown as Win)[k];
  Object.assign(window, bridge);
};

// isNativePlatform latches true for the module's life: a fresh module per case.
const load = async () => {
  vi.resetModules();
  return import('./platform');
};

const capacitor = (platform: 'android' | 'ios' | 'web') => ({
  Capacitor: { isNativePlatform: () => platform !== 'web', getPlatform: () => platform },
});

afterEach(() => setBridge({}));

describe('platform split', () => {
  it('Android box: native, Android, apps managed', async () => {
    setBridge({ ...capacitor('android'), androidBridge: {} });
    const p = await load();
    expect(p.isNativePlatform()).toBe(true);
    expect(p.isAndroidNative()).toBe(true);
    expect(p.isIOSNative()).toBe(false);
    expect(p.canManageApps()).toBe(true);
  });

  it('iPhone: native, iOS, no apps to manage', async () => {
    setBridge({ ...capacitor('ios'), webkit: { messageHandlers: { bridge: {} } } });
    const p = await load();
    expect(p.isNativePlatform()).toBe(true);
    expect(p.isIOSNative()).toBe(true);
    expect(p.isAndroidNative()).toBe(false);
    expect(p.canManageApps()).toBe(false);
  });

  it('iPhone bridge without a Capacitor global is still iOS', async () => {
    setBridge({ webkit: { messageHandlers: { bridge: {} } } });
    const p = await load();
    expect(p.isIOSNative()).toBe(true);
    expect(p.isAndroidNative()).toBe(false);
  });

  it('Android bridge without a Capacitor global stays Android', async () => {
    setBridge({ androidBridge: {} });
    const p = await load();
    expect(p.isAndroidNative()).toBe(true);
    expect(p.isIOSNative()).toBe(false);
  });

  it('web: neither, and the web keeps its app screens', async () => {
    setBridge(capacitor('web'));
    const p = await load();
    expect(p.isNativePlatform()).toBe(false);
    expect(p.isAndroidNative()).toBe(false);
    expect(p.isIOSNative()).toBe(false);
    expect(p.canManageApps()).toBe(true);
  });
});
