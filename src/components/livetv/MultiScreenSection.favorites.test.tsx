/**
 * Multi-Screen's Favorites bucket lists the line's favourites in the order
 * Live TV's Favorites shows them (lib/favoritesOrder): the viewer's own, or
 * A–Z.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  loadSlot: vi.fn(async (_sid: string, _url: string) => {}),
  slots: {} as Record<string, { url: string | null; buffering: boolean; error: string | null }>,
}));

vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => true }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: { maxConnections: 3, activeCons: 0 } }) }));
// Added in this order: Zed, Alpha, Mid. The line key as favoritesSync makes it.
vi.mock('@/lib/favoritesSync', () => ({
  loadFavoritesForLine: () => new Map([
    [202, { stream_id: 202, name: 'Zed Sports', category_id: '1' }],
    [101, { stream_id: 101, name: 'Alpha News', category_id: '1' }],
    [303, { stream_id: 303, name: 'Mid Movies', category_id: '1' }],
  ]),
  lineKey: (c: { host: string; username: string }) => `${c.host.replace(/^https?:\/\//, '')}|${c.username}`,
  normalizeHost: (h: string) => h.replace(/^https?:\/\//, ''),
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/hooks/useMultiScreenPlayers', () => ({
  MS_SLOT_IDS: ['ms1', 'ms2', 'ms3', 'ms4'],
  useMultiScreenPlayers: () => ({
    slots: h.slots,
    loadSlot: async (sid: string, url: string) => { h.slots[sid] = { url, buffering: false, error: null }; await h.loadSlot(sid, url); },
    closeSlot: async (sid: string) => { h.slots[sid] = { url: null, buffering: false, error: null }; },
    applyRect: async () => {},
    focusAudio: async () => {},
    stopAll: async () => {},
  }),
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => [],
  getShortEpg: async () => ({ epg_listings: [] }),
  // The line's connections (multiScreenLines): the panel says nothing here, no request leaves the test.
  authenticate: async () => ({ user_info: {} }),
}));

import MultiScreenSection from './MultiScreenSection';
import { saveFavOrder } from '@/lib/favoritesOrder';

const creds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts' } as never;
const LINE = 'h.test|u';
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent ?? '';
const urlFor = (id: number) => expect.stringContaining(`/${id}.`);

beforeEach(() => {
  localStorage.clear();
  for (const id of ['ms1', 'ms2', 'ms3', 'ms4']) h.slots[id] = { url: null, buffering: false, error: null };
  h.loadSlot.mockClear();
});

/** Two screens, OK on the first: the picker opens on Favorites; ▶ into its channels, ▼ `row` times, OK. */
async function pickFavorite(row: number) {
  render(<MultiScreenSection creds={creds} isActive onExitLeft={() => {}} onExitUp={() => {}} />);
  await waitFor(() => expect(text()).toContain('3 Screens'));
  key('Enter'); await settle();
  key('Enter'); await settle(100);
  key('ArrowRight'); await settle(100);
  for (let i = 0; i < row; i++) key('ArrowDown');
  key('Enter');
  await settle(80);
}

describe('Multi-Screen: Favorites in the viewer’s order', () => {
  const MINE = [{ line: LINE, id: 303, name: 'Mid Movies' }, { line: LINE, id: 202, name: 'Zed Sports' }];

  it('the viewer’s own order: the first row is the first they placed', async () => {
    saveFavOrder({ mode: 'mine', keys: MINE });
    await pickFavorite(0);
    await waitFor(() => expect(h.loadSlot).toHaveBeenCalledWith('ms1', urlFor(303)));
  });

  it('a favourite not placed yet comes after the placed ones', async () => {
    saveFavOrder({ mode: 'mine', keys: MINE });
    await pickFavorite(2);
    await waitFor(() => expect(h.loadSlot).toHaveBeenCalledWith('ms1', urlFor(101)));
  });

  it('A–Z when the viewer sorted it so', async () => {
    saveFavOrder({ mode: 'az', keys: [{ line: LINE, id: 303, name: 'Mid Movies' }] });
    await pickFavorite(1);
    await waitFor(() => expect(h.loadSlot).toHaveBeenCalledWith('ms1', urlFor(303)));
  });
});
