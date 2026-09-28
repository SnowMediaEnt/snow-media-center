/**
 * Settings › Updates (AppUpdater): installing ends the app's process, and a
 * recording with it. When one is running or a schedule starts within 30
 * minutes, the button warns first; Later is the default (TRACKER 25.15).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ note: null as string | null, prepare: vi.fn(), install: vi.fn() }));

vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: '1.7.8', versionCode: 178, isLoading: false }) }));
vi.mock('@/utils/platform', () => ({ isNativePlatform: () => true }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: () => {} }), toast: () => {} }));
vi.mock('@/utils/network', () => ({
  robustFetch: async () => ({ text: async () => JSON.stringify({ version: '1.7.9', versionCode: 179, downloadUrl: 'https://example.test/smc.apk', changelog: 'x', releaseDate: '2026-09-28' }) }),
}));
vi.mock('@/capacitor/AppManager', () => ({ AppManager: { getAppInfo: async () => ({ versionName: '1.7.8', versionCode: 178 }) } }));
vi.mock('@/utils/updateCache', () => ({
  prepareSmcUpdate: async (...a: unknown[]) => { h.prepare(...a); return { filePath: '/x.apk', apkVersionName: '1.7.9', apkVersionCode: 179, apkPackageName: 'p', fromCache: false }; },
  installPreparedUpdate: async (...a: unknown[]) => { h.install(...a); },
}));
vi.mock('@/lib/recordSchedule', () => ({ recordingGuardNote: async () => h.note }));

import AppUpdater from './AppUpdater';

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };
const click = async (el: Element) => { fireEvent.click(el); await settle(); };

async function withUpdateReady() {
  render(<AppUpdater />);
  await settle();
  await click(screen.getByText('Check for Updates'));
  await settle();
  return screen.getByText(/Download v1\.7\.9/);
}

beforeEach(() => { h.note = null; h.prepare.mockClear(); h.install.mockClear(); });

describe('AppUpdater with a recording at stake', () => {
  it('nothing recording: it downloads and installs as before', async () => {
    const download = await withUpdateReady();
    await click(download);
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-app-updater-guard]')).toBeNull();
  });

  it('a recording is running: it warns instead, and installs nothing until asked again', async () => {
    h.note = 'A recording is running. Updating now will stop it.';
    const download = await withUpdateReady();
    await click(download);
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.install).not.toHaveBeenCalled();
    const box = document.querySelector('[data-app-updater-guard]')!;
    expect(box.textContent).toContain('A recording is running. Updating now will stop it.');
    // Later is the default.
    expect(document.activeElement).toBe(box.querySelector('[data-app-updater-btn="later"]'));
    // Later clears the warning and nothing is installed.
    await click(box.querySelector('[data-app-updater-btn="later"]')!);
    expect(document.querySelector('[data-app-updater-guard]')).toBeNull();
    expect(h.install).not.toHaveBeenCalled();
  });

  it('Update anyway goes ahead', async () => {
    h.note = 'A recording is scheduled to start soon. Updating now will stop it.';
    const download = await withUpdateReady();
    await click(download);
    await click(document.querySelector('[data-app-updater-btn="anyway"]')!);
    expect(h.install).toHaveBeenCalledTimes(1);
  });

  it('the remote: OK on Later leaves it, ▶ then OK is Update anyway', async () => {
    h.note = 'A recording is running. Updating now will stop it.';
    const download = await withUpdateReady();
    await click(download);
    const later = document.querySelector<HTMLElement>('[data-app-updater-btn="later"]')!;
    later.focus();
    await settle();
    act(() => { fireEvent.keyDown(later, { key: 'ArrowRight' }); });
    (document.querySelector('[data-app-updater-btn="anyway"]') as HTMLElement).focus();
    await settle();
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Enter' }); });
    await settle();
    expect(h.install).toHaveBeenCalledTimes(1);
  });
});
