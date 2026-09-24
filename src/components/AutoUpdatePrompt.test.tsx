import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: '1.7.8', versionCode: 178, isLoading: false }) }));
vi.mock('@/utils/platform', () => ({ isNativePlatform: () => true }));
vi.mock('@/hooks/use-toast', () => ({ toast: () => {} }));
vi.mock('@/utils/pausableInterval', () => ({ setPausableInterval: () => () => {} }));
vi.mock('@/utils/network', () => ({
  robustFetch: async () => ({ text: async () => JSON.stringify({ version: '1.7.9', versionCode: 179, downloadUrl: 'https://example.test/smc.apk' }) }),
}));
let finishDownload: (() => void) | null = null;
const prepareSmcUpdate = vi.fn(() => new Promise((resolve) => {
  finishDownload = () => resolve({ filePath: '/cache/apk/1.7.9.apk', apkVersionName: '1.7.9', apkVersionCode: 179, apkPackageName: 'com.snowmedia.center' });
}));
const installPreparedUpdate = vi.fn(async () => {});
vi.mock('@/utils/updateCache', () => ({
  prepareSmcUpdate: (...a: unknown[]) => prepareSmcUpdate(...(a as [])),
  installPreparedUpdate: (...a: unknown[]) => installPreparedUpdate(...(a as [])),
}));

import AutoUpdatePrompt from './AutoUpdatePrompt';

const dialog = () => document.querySelector('[data-autoupdate-dialog="true"]');
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  prepareSmcUpdate.mockClear();
  installPreparedUpdate.mockClear();
  finishDownload = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('AutoUpdatePrompt', () => {
  it('holds a finished download behind the profile screens and prompts once home is back', async () => {
    const r = render(<AutoUpdatePrompt paused={false} />);
    await tick(5000);
    expect(prepareSmcUpdate).toHaveBeenCalledTimes(1);

    // The viewer opens "Who's watching?" while the APK is downloading.
    r.rerender(<AutoUpdatePrompt paused />);
    await act(async () => { finishDownload?.(); await vi.advanceTimersByTimeAsync(0); });
    await tick(5000);
    expect(dialog()).toBeNull();

    // Profile picked: home again. The prompt waits a moment, then opens —
    // and the download was never started a second time.
    r.rerender(<AutoUpdatePrompt paused={false} />);
    await tick(200);
    expect(dialog()).toBeNull();
    await tick(3000);
    expect(dialog()).not.toBeNull();
    expect(prepareSmcUpdate).toHaveBeenCalledTimes(1);
  });

  it('prompts straight away when the download finishes on home, and OK installs', async () => {
    render(<AutoUpdatePrompt paused={false} />);
    await tick(5000);
    await act(async () => { finishDownload?.(); await vi.advanceTimersByTimeAsync(0); });
    expect(dialog()).not.toBeNull();
    await tick(900);
    const primary = document.querySelector<HTMLButtonElement>('[data-autoupdate-primary="true"]');
    expect(document.activeElement).toBe(primary);
    // The remote's OK is Enter, keyCode 13: the focused button activates.
    fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 });
    fireEvent.click(primary!);
    await tick(0);
    expect(installPreparedUpdate).toHaveBeenCalledTimes(1);
  });

  it('runs a check skipped behind the profile screens even if they flick open again before it ran', async () => {
    const r = render(<AutoUpdatePrompt paused />);
    await tick(5000);
    expect(prepareSmcUpdate).not.toHaveBeenCalled();
    r.rerender(<AutoUpdatePrompt paused={false} />);
    r.rerender(<AutoUpdatePrompt paused />);
    await tick(5000);
    expect(prepareSmcUpdate).not.toHaveBeenCalled();
    r.rerender(<AutoUpdatePrompt paused={false} />);
    await tick(5000);
    expect(prepareSmcUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Update available/)).toBeNull();
  });
});
