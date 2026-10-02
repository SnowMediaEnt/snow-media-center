/**
 * The iPhone build has no AppManager plugin. Capacitor never uses a `web`
 * fallback on iOS (a call to a missing plugin rejects UNIMPLEMENTED), so
 * AppManager registers an `ios` one: every call answers as in a browser, and a
 * web link opens in Safari's in-app view (WKWebView drops a late window.open).
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ opened: [] as string[] }));
// registerPlugin hands back what it was given, so the test can reach each platform's implementation.
vi.mock('@capacitor/core', () => ({ registerPlugin: (_name: string, impls: unknown) => impls, Capacitor: {} }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: async ({ url }: { url: string }) => { h.opened.push(url); } } }));

import { AppManager, isWebUnsupportedError, type AppManagerPlugin } from './AppManager';

const impls = AppManager as unknown as { web: AppManagerPlugin; ios?: AppManagerPlugin };

describe('AppManager on the iPhone build', () => {
  it('has an iOS implementation, so no call there rejects UNIMPLEMENTED', () => {
    expect(impls.ios).toBeDefined();
  });

  it('answers like the web: nothing installed, nothing launched', async () => {
    const ios = impls.ios!;
    expect(await ios.isInstalled({ packageName: 'com.plexapp.android' })).toEqual({ installed: false });
    expect(await ios.getInstalledApps()).toEqual({ apps: [] });
    expect((await ios.getAppInfo()).versionName).toBe('');
    const launch = await ios.launch({ packageName: 'x' }).then(() => null, (e: unknown) => e);
    expect(isWebUnsupportedError(launch)).toBe(true);
    const install = await ios.installApk({ filePath: 'x.apk' }).then(() => null, (e: unknown) => e);
    expect(isWebUnsupportedError(install)).toBe(true);
  });

  it('opens a web link in the in-app browser, and refuses anything else', async () => {
    const ios = impls.ios!;
    await ios.openUrl({ url: 'https://snowmediaent.com/plans?src=smc-tv' });
    expect(h.opened).toEqual(['https://snowmediaent.com/plans?src=smc-tv']);
    const intent = await ios.openUrl({ url: 'intent://#Intent;end' }).then(() => null, (e: unknown) => e);
    expect(isWebUnsupportedError(intent)).toBe(true);
    const plex = await ios.openUrl({ url: 'plex://play/?x=1', packageName: 'com.plexapp.android' }).then(() => null, (e: unknown) => e);
    expect(isWebUnsupportedError(plex)).toBe(true);
    expect(h.opened).toHaveLength(1);
  });
});
