// The language picked in the app is handed to the Android side (SnowNotify.setLanguage), only on
// the Android app, and this never throws.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ native: true, platform: 'android' }));
const setLanguage = vi.hoisted(() => vi.fn(async (_o: { lang: string }) => ({})));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => state.native, getPlatform: () => state.platform },
  registerPlugin: () => ({}),
}));
vi.mock('@/capacitor/SnowNotify', () => ({ SnowNotify: { setLanguage } }));

// The test setup has already loaded @/i18n with the real Capacitor, so take fresh copies that see the mocks.
type Sync = typeof import('./nativeLanguage').syncNativeLanguage;
let syncNativeLanguage: Sync;
let i18n: typeof import('@/i18n').default;

// The plugin is loaded with a dynamic import, which needs a moment.
const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(async () => {
  vi.resetModules();
  state.native = true;
  state.platform = 'android';
  setLanguage.mockClear();
  setLanguage.mockImplementation(async () => ({}));
  i18n = (await import('@/i18n')).default;
  syncNativeLanguage = (await import('./nativeLanguage')).syncNativeLanguage;
  await settle();
  setLanguage.mockClear(); // the start-up call of the fresh i18n
});

describe('syncNativeLanguage', () => {
  it.each(['en', 'es', 'fr', 'de', 'ar'] as const)('tells the Android side %s', async (lang) => {
    syncNativeLanguage(lang);
    await settle();
    expect(setLanguage).toHaveBeenCalledWith({ lang });
  });

  it('does nothing on the web or on another platform', async () => {
    state.native = false;
    syncNativeLanguage('es');
    state.native = true;
    state.platform = 'ios';
    syncNativeLanguage('es');
    await settle();
    expect(setLanguage).not.toHaveBeenCalled();
  });

  it('never throws, even when an older app build rejects the call', async () => {
    setLanguage.mockImplementation(async () => { throw new Error('"SnowNotify.setLanguage()" is not implemented on android'); });
    expect(() => syncNativeLanguage('fr')).not.toThrow();
    await settle();
    expect(setLanguage).toHaveBeenCalledTimes(1);
  });

  it('is called again on every language change', async () => {
    await i18n.changeLanguage('de');
    await settle();
    expect(setLanguage).toHaveBeenLastCalledWith({ lang: 'de' });
    await i18n.changeLanguage('ar');
    await settle();
    expect(setLanguage).toHaveBeenLastCalledWith({ lang: 'ar' });
  });
});
