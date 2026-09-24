import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadyRequest } from '@/lib/overseerr';

// The server marks what `check` returns as notified: each title comes back once.
let serverQueue: ReadyRequest[] = [];
let resolveCheck: ((list: ReadyRequest[]) => void) | null = null;
let holdCheck = false;
vi.mock('@/lib/overseerr', () => ({
  hasPendingRequests: () => true,
  checkRequests: () => {
    const list = serverQueue;
    serverQueue = [];
    if (holdCheck) return new Promise<ReadyRequest[]>((r) => { resolveCheck = () => r(list); });
    return Promise.resolve(list);
  },
}));

const title = (t: string): ReadyRequest => ({ tmdbId: 1, mediaType: 'movie', title: t, posterUrl: null });
const enter = () => fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  serverQueue = [];
  resolveCheck = null;
  holdCheck = false;
});
afterEach(() => { vi.useRealTimers(); });

const load = async () => (await import('./RequestReadyDialog')).default;
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(12_000); });

describe('RequestReadyDialog', () => {
  it('keeps a notice that arrives after it unmounted for the next time home shows it', async () => {
    const Dialog = await load();
    holdCheck = true;
    serverQueue = [title('Moana')];
    const first = render(<Dialog onWatch={() => {}} />);
    await settle();
    // The profile screens open (or a Kids profile takes over) mid-check.
    first.unmount();
    await act(async () => { resolveCheck?.([]); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText(/Moana/)).toBeNull();

    render(<Dialog onWatch={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Moana is ready to watch.')).toBeTruthy();
  });

  it('brings back a notice that was on screen when it unmounted', async () => {
    const Dialog = await load();
    serverQueue = [title('Bluey')];
    const first = render(<Dialog onWatch={() => {}} />);
    await settle();
    expect(screen.getByText('Bluey is ready to watch.')).toBeTruthy();
    first.unmount();

    render(<Dialog onWatch={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Bluey is ready to watch.')).toBeTruthy();
  });

  it("OK on 'Watch in Plex' answers it once: it does not come back after home unmounts", async () => {
    const Dialog = await load();
    serverQueue = [title('Encanto')];
    const onWatch = vi.fn();
    const first = render(<Dialog onWatch={onWatch} />);
    await settle();
    expect(screen.getByText('Encanto is ready to watch.')).toBeTruthy();
    // The remote's OK: Enter, keyCode 13. Leaving for Plex unmounts home at once.
    enter();
    expect(onWatch).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<Dialog onWatch={onWatch} />);
    await settle();
    expect(screen.queryByText(/Encanto/)).toBeNull();
  });
});
