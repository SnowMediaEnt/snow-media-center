import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: '1.7.8', versionCode: 178, isLoading: false }) }));
vi.mock('@/utils/platform', () => ({ isNativePlatform: () => true }));
vi.mock('@/hooks/use-toast', () => ({ toast: () => {} }));
vi.mock('@/utils/pausableInterval', () => ({ setPausableInterval: () => () => {} }));
vi.mock('@/utils/network', () => ({
  robustFetch: async () => ({ text: async () => JSON.stringify({ version: '1.7.9', versionCode: 179, downloadUrl: 'https://example.test/smc.apk' }) }),
}));
// The recording guard (TRACKER 25.15): what the updater is told about running or imminent recordings.
const guard = vi.hoisted(() => ({ note: null as string | null }));
vi.mock('@/lib/recordSchedule', () => ({ recordingGuardNote: async () => guard.note }));
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
  guard.note = null;
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

describe('AutoUpdatePrompt with a recording at stake', () => {
  async function openPrompt() {
    render(<AutoUpdatePrompt paused={false} />);
    await tick(5000);
    await act(async () => { finishDownload?.(); await vi.advanceTimersByTimeAsync(0); });
    await tick(900);
  }
  const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-autoupdate-dialog] button:not([tabindex="-1"])'));
  const byText = (t: string) => buttons().find((b) => b.textContent?.includes(t));

  it('says a recording is running and updating will stop it; Later is the default, and OK on it installs nothing', async () => {
    guard.note = 'A recording is running. Updating now will stop it.';
    await openPrompt();
    expect(document.querySelector('[data-autoupdate-guard]')?.textContent).toContain('A recording is running. Updating now will stop it.');
    const later = byText('Later')!;
    expect(later.getAttribute('data-autoupdate-primary')).toBe('true');
    expect(document.activeElement).toBe(later);
    expect(byText('Update anyway')?.getAttribute('data-autoupdate-primary')).toBeNull();
    fireEvent.click(later);
    await tick(0);
    expect(installPreparedUpdate).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('"Update anyway" still installs', async () => {
    guard.note = 'A recording is scheduled to start soon. Updating now will stop it.';
    await openPrompt();
    expect(document.querySelector('[data-autoupdate-guard]')?.textContent).toContain('scheduled to start soon');
    fireEvent.click(byText('Update anyway')!);
    await tick(0);
    expect(installPreparedUpdate).toHaveBeenCalledTimes(1);
  });

  it('a recording that started while the prompt was up is caught when Update now is pressed', async () => {
    await openPrompt();
    expect(document.querySelector('[data-autoupdate-guard]')).toBeNull();
    expect(byText('Update now')?.getAttribute('data-autoupdate-primary')).toBe('true');
    guard.note = 'A recording is running. Updating now will stop it.';
    fireEvent.click(byText('Update now')!);
    await tick(0); // the check answers, the warning is drawn…
    await tick(200); // …and the default moves to Later
    expect(installPreparedUpdate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-autoupdate-guard]')).not.toBeNull();
    expect(document.activeElement).toBe(byText('Later'));
    fireEvent.click(byText('Update anyway')!);
    await tick(0);
    expect(installPreparedUpdate).toHaveBeenCalledTimes(1);
  });

  it('Back is Later: it closes the prompt and installs nothing', async () => {
    guard.note = 'A recording is running. Updating now will stop it.';
    await openPrompt();
    fireEvent.keyDown(window, { key: 'Escape' });
    await tick(0);
    expect(dialog()).toBeNull();
    expect(installPreparedUpdate).not.toHaveBeenCalled();
  });
});

// The ~40 MB APK download can't be paused once the native side has it, and
// it used to start four seconds into whatever the viewer did next. Now it
// starts only once the box has sat on Home, untouched, for a minute with no
// player open; a cached APK needs no wait.
describe('AutoUpdatePrompt: the silent download waits for an idle Home', () => {
  let started = 0;
  beforeEach(() => {
    started = 0;
    prepareSmcUpdate.mockImplementation(((_info: unknown, _p: unknown, opts?: { beforeDownload?: () => Promise<void> }) => (async () => {
      await opts?.beforeDownload?.();
      started += 1;
      return { filePath: '/cache/apk/1.7.9.apk', apkVersionName: '1.7.9', apkVersionCode: 179, apkPackageName: 'com.snowmedia.center' };
    })()) as unknown as () => Promise<never>);
  });
  afterEach(() => { document.documentElement.classList.remove('streaming-active'); });

  it('starts only after a minute on Home with no key pressed', async () => {
    render(<AutoUpdatePrompt paused={false} />);
    await tick(5000);
    expect(prepareSmcUpdate).toHaveBeenCalledTimes(1);
    expect(started).toBe(0);
    // The viewer is browsing Home: each key restarts the minute.
    await tick(40_000);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await tick(40_000);
    expect(started).toBe(0);
    await tick(25_000);
    expect(started).toBe(1);
    expect(dialog()).not.toBeNull();
  });

  it('never while a player is open: off Home, or a stream playing', async () => {
    const r = render(<AutoUpdatePrompt paused={false} />);
    await tick(5000);
    // Into a film before the minute is up.
    r.rerender(<AutoUpdatePrompt paused />);
    document.documentElement.classList.add('streaming-active');
    await tick(10 * 60_000);
    expect(started).toBe(0);
    // Back on Home: the minute starts from there.
    document.documentElement.classList.remove('streaming-active');
    r.rerender(<AutoUpdatePrompt paused={false} />);
    await tick(30_000);
    expect(started).toBe(0);
    await tick(35_000);
    expect(started).toBe(1);
  });

  it('a stream playing on Home (a preview) holds it too', async () => {
    render(<AutoUpdatePrompt paused={false} />);
    await tick(5000);
    document.documentElement.classList.add('streaming-active');
    await tick(5 * 60_000);
    expect(started).toBe(0);
  });
});
