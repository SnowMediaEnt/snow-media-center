/**
 * The 4-screen buffering hint (owner, 2026-10-11: "I am unable to get down and
 * press the button to make it go away"): its OK was a button the remote could
 * not reach. Back closes it, first and on its own, and it goes by itself.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  slots: {} as Record<string, { url: string | null; buffering: boolean; error: string | null; bufferingSince?: number }>,
  stopAll: vi.fn(async () => {}),
}));

vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => true }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: { maxConnections: 4, activeCons: 0 } }) }));
vi.mock('@/lib/favoritesSync', () => ({ loadFavoritesForLine: () => new Map(), lineKey: (c: { host: string; username: string }) => `${c.host}|${c.username}`, normalizeHost: (h: string) => h }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/hooks/useMultiScreenPlayers', () => ({
  MS_SLOT_IDS: ['ms1', 'ms2', 'ms3', 'ms4'],
  useMultiScreenPlayers: () => ({
    slots: h.slots,
    loadSlot: async () => {},
    closeSlot: async () => {},
    applyRect: async () => {},
    focusAudio: async () => {},
    stopAll: h.stopAll,
  }),
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getLiveCategories: async () => [],
  getLiveStreams: async () => [],
  getShortEpg: async () => ({ epg_listings: [] }),
}));

import MultiScreenSection from './MultiScreenSection';

const creds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts' } as never;
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const hint = () => (document.body.textContent ?? '').includes('Buffering?');

beforeEach(() => {
  for (const id of ['ms1', 'ms2', 'ms3', 'ms4']) h.slots[id] = { url: null, buffering: false, error: null };
});

describe('Multi-Screen: the 4-screen buffering hint', () => {
  it('Back closes the hint first, and leaves the four screens up', async () => {
    const onExitLeft = vi.fn();
    render(<MultiScreenSection creds={creds} isActive onExitLeft={onExitLeft} onExitUp={() => {}} />);
    await waitFor(() => expect(document.body.textContent).toContain('4 Screens'));
    key('ArrowRight'); key('ArrowRight'); key('ArrowRight'); key('Enter'); // 2h, 2v, 3, [4]
    await settle();
    h.slots.ms1 = { url: 'http://h.test/1.ts', buffering: true, error: null, bufferingSince: Date.now() - 7000 };
    await waitFor(() => expect(hint()).toBe(true), { timeout: 3000 });
    await settle(400); // past the double-Back guard
    key('Escape');
    await settle();
    expect(hint()).toBe(false);
    expect(h.stopAll).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-ms-tile]').length).toBe(4);
  });
});
