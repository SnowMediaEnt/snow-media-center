/**
 * The 3-screen Multi-Screen layout, driven with the remote: one big screen
 * on top keeps the sound; ↓ to a small one and OK swaps the two channels, the
 * big screen still has the sound.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  loadSlot: vi.fn(async (_sid: string, _url: string) => {}),
  closeSlot: vi.fn(async (_sid: string) => {}),
  applyRect: vi.fn(async () => {}),
  focusAudio: vi.fn(async (_sid: string | null) => {}),
  stopAll: vi.fn(async () => {}),
  slots: {} as Record<string, { url: string | null; buffering: boolean; error: string | null }>,
}));

vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => true }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: { maxConnections: 3, activeCons: 0 } }) }));
vi.mock('@/lib/favoritesSync', () => ({ loadFavoritesForLine: () => new Map() }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/hooks/useMultiScreenPlayers', () => ({
  MS_SLOT_IDS: ['ms1', 'ms2', 'ms3', 'ms4'],
  useMultiScreenPlayers: () => ({
    slots: h.slots,
    loadSlot: async (sid: string, url: string) => { h.slots[sid] = { url, buffering: false, error: null }; await h.loadSlot(sid, url); },
    closeSlot: async (sid: string) => { h.slots[sid] = { url: null, buffering: false, error: null }; await h.closeSlot(sid); },
    applyRect: h.applyRect,
    focusAudio: h.focusAudio,
    stopAll: h.stopAll,
  }),
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => [
    { stream_id: 11, name: 'Alpha News', num: 1, category_id: '1' },
    { stream_id: 22, name: 'Bravo Sports', num: 2, category_id: '1' },
  ],
  getShortEpg: async () => ({ epg_listings: [] }),
}));

import MultiScreenSection from './MultiScreenSection';

const creds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts' } as never;
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent ?? '';
const urlFor = (id: number) => expect.stringContaining(`/${id}.`);

beforeEach(() => {
  for (const id of ['ms1', 'ms2', 'ms3', 'ms4']) h.slots[id] = { url: null, buffering: false, error: null };
  h.loadSlot.mockClear(); h.closeSlot.mockClear(); h.focusAudio.mockClear();
});

/** OK on the highlighted empty screen, then pick the News channel at `row`. */
async function addChannel(row: number) {
  key('Enter'); await settle();
  key('ArrowDown'); await settle(600); // Favorites -> News; its list loads once the highlight rests
  key('ArrowRight'); await settle(200);
  for (let i = 0; i < row; i++) key('ArrowDown');
  key('Enter');
  await settle(80);
}

describe('Multi-Screen: 3 screens', () => {
  it('is offered as "3 Screens, 1 Big + 2 Small"', async () => {
    render(<MultiScreenSection creds={creds} isActive onExitLeft={() => {}} onExitUp={() => {}} />);
    await waitFor(() => expect(text()).toContain('3 Screens'));
    expect(text()).toContain('1 Big + 2 Small');
  });

  it('the big screen keeps the sound; ↓ to a small one and OK swaps the channels', async () => {
    render(<MultiScreenSection creds={creds} isActive onExitLeft={() => {}} onExitUp={() => {}} />);
    await waitFor(() => expect(text()).toContain('3 Screens'));
    key('ArrowRight'); key('ArrowRight'); key('Enter'); // 2h, 2v, [3]
    await settle();
    expect(document.querySelector('[data-ms-swap-hint]')).toBeTruthy();

    await addChannel(0); // Alpha News on the big screen
    await waitFor(() => expect(h.loadSlot).toHaveBeenCalledWith('ms1', urlFor(11)));

    key('ArrowDown'); await settle(); // the left small screen
    await addChannel(1); // Bravo Sports there
    await waitFor(() => expect(h.loadSlot).toHaveBeenCalledWith('ms2', urlFor(22)));
    // Highlighting and filling a small screen never moved the sound off the big one.
    expect(h.focusAudio.mock.calls.map((c) => c[0])).not.toContain('ms2');

    h.loadSlot.mockClear(); h.focusAudio.mockClear();
    key('Enter'); // OK on the small screen: swap it into the big one
    await waitFor(() => expect(h.loadSlot).toHaveBeenCalledWith('ms1', urlFor(22)));
    expect(h.loadSlot).toHaveBeenCalledWith('ms2', urlFor(11));
    expect(h.focusAudio).toHaveBeenCalledWith('ms1');
    expect(h.focusAudio.mock.calls.map((c) => c[0])).not.toContain('ms2');
  });
});
