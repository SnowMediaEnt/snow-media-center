import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAppInfo, native } = vi.hoisted(() => ({
  getAppInfo: vi.fn(async () => ({ versionName: '1.8.0', versionCode: 55, packageName: 'x' })),
  native: { on: true },
}));
vi.mock('@/utils/platform', () => ({ isNativePlatform: () => native.on }));
vi.mock('@/utils/idle', () => ({ runWhenIdle: (fn: () => void) => fn() }));
vi.mock('@/capacitor/AppManager', () => ({ AppManager: { getAppInfo } }));

const UA = 'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233; wv) AppleWebKit/537.36 Chrome/66.0.3359.158 Mobile Safari/537.36';

describe('app info stamped on support tickets', () => {
  beforeEach(() => {
    vi.resetModules();
    getAppInfo.mockClear();
    native.on = true;
    Object.defineProperty(navigator, 'userAgent', { value: UA, configurable: true });
  });

  it('names the version, the build number and the device', async () => {
    const { withAppInfo } = await import('./appInfo');
    const text = await withAppInfo('Body of the ticket');
    expect(text.split('\n')[0]).toBe('App: Snow Media Center 1.8.0 (build 55)');
    expect(text).toContain('Device: AFTMM, Android 9');
    expect(text.endsWith('Body of the ticket')).toBe(true);
  });

  it('leaves out the build when only the version is known', async () => {
    getAppInfo.mockResolvedValueOnce({ versionName: '1.8.0', versionCode: 0, packageName: 'x' });
    const { buildAppInfoLines } = await import('./appInfo');
    expect((await buildAppInfoLines()).split('\n')[0]).toBe('App: Snow Media Center 1.8.0');
  });

  it('still sends the ticket line when the device is unknown', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0', configurable: true });
    const { buildAppInfoLines } = await import('./appInfo');
    const text = await buildAppInfoLines();
    expect(text).toBe('App: Snow Media Center 1.8.0 (build 55)');
  });
});

describe('parseFormFactor', async () => {
  const { parseFormFactor } = await import('./appInfo');
  it.each([
    ['Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233) Chrome/70', 'tv'],
    ['Mozilla/5.0 (Linux; Android 10; BRAVIA 4K UR3 Build/QTG3) Chrome/80', 'tv'],
    ['Mozilla/5.0 (Linux; Android 12; onn. 4K Streaming Box) Chrome/110', 'tv'],
    ['Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/120 Mobile Safari/537.36', 'phone'],
    ['Mozilla/5.0 (Linux; Android 11; KFTRWI) Silk/100 like Chrome/100 Safari/537.36', 'tablet'],
    ['Mozilla/5.0 (Linux; Android 13; SM-T870) Chrome/120 Safari/537.36', 'tablet'],
  ])('%s', (ua, expected) => {
    expect(parseFormFactor(ua)).toBe(expected);
  });
});
