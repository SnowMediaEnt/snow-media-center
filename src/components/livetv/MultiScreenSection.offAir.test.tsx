/**
 * Multi-Screen's channel picker and a channel off the air (offair-status):
 * its row says "Off the air", and OK asks first (Watch anyway / Pick
 * another) before it goes on a screen; the reports are asked for again first
 * when they are more than a few seconds old (lib/channelStatus openWhenFresh,
 * here a stand-in).
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  loadSlot: vi.fn(async (_sid: string, _url: string) => {}),
  slots: {} as Record<string, { url: string | null; buffering: boolean; error: string | null }>,
  down: new Set<string>(),
  /** What a fresh look at the reports finds; null: the list on screen is fresh. */
  fresh: null as Set<string> | null,
  opens: 0,
}));

vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => true }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: { maxConnections: 3, activeCons: 0 } }) }));
vi.mock('@/lib/favoritesSync', () => ({
  loadFavoritesForLine: () => new Map([
    [101, { stream_id: 101, name: 'Alpha News', category_id: '1' }],
    [202, { stream_id: 202, name: 'Zed Sports', category_id: '1' }],
  ]),
  lineKey: (c: { host: string; username: string }) => `${c.host.replace(/^https?:\/\//, '')}|${c.username}`,
  normalizeHost: (x: string) => x.replace(/^https?:\/\//, ''),
}));
vi.mock('@/lib/channelStatus', async (orig) => ({
  ...(await orig<typeof import('@/lib/channelStatus')>()),
  useDownChannels: () => h.down,
  openWhenFresh: (_host: string, go: (f: Set<string> | null) => void) => { h.opens += 1; go(h.fresh); },
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

// jsdom has no layout: the picker shows every row.
vi.mock('@tanstack/react-virtual', async () => {
  const { useMemo } = await import('react');
  return {
    useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: (i: number) => number }) => {
      const items = useMemo(() => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * estimateSize(index), size: estimateSize(index) })), [count, estimateSize]);
      return { getVirtualItems: () => items, getTotalSize: () => count * estimateSize(0), measure: () => {}, scrollToIndex: () => {} };
    },
  };
});

import MultiScreenSection from './MultiScreenSection';
import { __resetWarnedForTests } from './channelWarning';

const creds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts' } as never;
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent ?? '';
const warning = () => document.querySelector('[data-channel-warning]');
const urlFor = (id: number) => expect.stringContaining(`/${id}.`);
const OFF = ['http://h.test|101', 'http://h.test|off:101'].map((k) => k.replace('http://', ''));

beforeEach(() => {
  localStorage.clear();
  __resetWarnedForTests();
  for (const id of ['ms1', 'ms2', 'ms3', 'ms4']) h.slots[id] = { url: null, buffering: false, error: null };
  h.loadSlot.mockClear();
  h.down = new Set();
  h.fresh = null;
  h.opens = 0;
});

/** Two screens, OK on the first: the picker opens on Favorites; ▶ into its channels. */
async function openPicker() {
  render(<MultiScreenSection creds={creds} isActive onExitLeft={() => {}} onExitUp={() => {}} />);
  await waitFor(() => expect(text()).toContain('3 Screens'));
  key('Enter'); await settle();
  key('Enter'); await settle(100);
  key('ArrowRight'); await settle(100);
}

describe('Multi-Screen picker: a channel off the air', () => {
  it('its row says "Off the air", in red; the others nothing', async () => {
    h.down = new Set(OFF);
    await openPicker();
    const marks = [...document.querySelectorAll('[data-ms-report]')];
    expect(marks.map((m) => [m.getAttribute('data-ms-report'), m.textContent])).toEqual([['offair', 'Off the air']]);
    expect(marks[0].getAttribute('class')).toContain('text-red-300');
  });

  it('OK asks first: Pick another keeps the picker, nothing plays; Watch anyway puts it on the screen', async () => {
    h.down = new Set(OFF);
    await openPicker();
    key('Enter');
    await waitFor(() => expect(warning()?.getAttribute('data-channel-warning')).toBe('offair'));
    expect(h.loadSlot).not.toHaveBeenCalled();
    key('Enter'); // the highlight starts on Pick another
    await settle();
    expect(warning()).toBeNull();
    expect(h.loadSlot).not.toHaveBeenCalled();
    expect(text()).toContain('Alpha News');
    key('Enter');
    await waitFor(() => expect(warning()).not.toBeNull());
    key('ArrowLeft');
    key('Enter');
    await waitFor(() => expect(h.loadSlot).toHaveBeenCalledWith('ms1', urlFor(101)));
  });

  it('marked after the picker was drawn: the fresh reports asked for on OK still ask first', async () => {
    await openPicker();
    expect(document.querySelector('[data-ms-report]')).toBeNull();
    h.fresh = new Set(OFF);
    key('Enter');
    await waitFor(() => expect(warning()?.getAttribute('data-channel-warning')).toBe('offair'));
    expect(h.opens).toBe(1);
    expect(h.loadSlot).not.toHaveBeenCalled();
  });

  it('a channel nobody reported goes on the screen at once', async () => {
    await openPicker();
    key('ArrowDown');
    key('Enter');
    await waitFor(() => expect(h.loadSlot).toHaveBeenCalledWith('ms1', urlFor(202)));
    expect(warning()).toBeNull();
  });
});
