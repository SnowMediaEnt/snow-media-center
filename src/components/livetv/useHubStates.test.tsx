/**
 * Live TV › Settings: the state line under each menu row, read from the box
 * (owner, 2026-10-20: a viewer, or support on the phone, reads it without
 * opening the page). Nothing here asks any server.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  creds: null as null | Record<string, unknown>,
  account: null as null | Record<string, unknown>,
  savedAccounts: [] as unknown[],
  engine: 'exo' as 'exo' | 'mpv',
  recorder: false,
  net: { configured: false } as Record<string, unknown>,
  authCalls: 0,
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => h.creds,
  loadPlayerAccount: async () => h.account,
  loadSavedAccounts: async () => h.savedAccounts,
  authenticateRouted: async () => { h.authCalls += 1; throw new Error('no panel in tests'); },
}));
vi.mock('@/hooks/usePlayerEngine', () => ({ usePlayerEngine: () => ({ engine: h.engine, setEngine: vi.fn(), loaded: true }) }));
vi.mock('@/capacitor/SnowRecorder', () => ({
  hasRecorder: () => h.recorder,
  SnowRecorder: { getNetworkFolder: async () => h.net },
}));

import { useHubStates } from './useHubStates';
import { __resetOutsideForTests } from '@/lib/outsideSource';
import { saveHiddenCategories } from '@/lib/liveLines';
import { lineKey } from '@/lib/favoritesSync';
import { loadFavOrder, saveFavOrder } from '@/lib/favoritesOrder';
import { saveLiveLayout } from '@/lib/liveLayout';
import { saveLiveRowSize } from '@/lib/liveRows';
import { saveRewindSettings } from '@/lib/liveRewind';
import { saveLiveBuffer } from '@/lib/liveBuffer';
import { formatDate } from '@/i18n/format';

const DS = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8', serverLabel: 'Dreamstreams' };
const VIBEZ = { host: 'https://strmz.xyz', username: 'me@mail.com', password: 'x', output: 'm3u8', serverLabel: 'Vibez' };
const saved = (c: typeof DS) => ({ id: `${c.host}::${c.username}`, serverLabel: c.serverLabel, host: c.host, username: c.username, password: c.password, output: c.output, addedAt: 1 });
const IN_40_DAYS = Math.floor(Date.now() / 1000) + 40 * 86400;
const ACCOUNT = { serverLabel: 'Dreamstreams', host: DS.host, username: 'jsmith', password: 'pw', output: 'm3u8', expDate: IN_40_DAYS, status: 'Active', isTrial: false, maxConnections: 2, activeCons: 0, createdAt: null, lastCheckedAt: 1 };

const settle = async () => { await act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); }); };

beforeEach(() => {
  localStorage.clear();
  __resetOutsideForTests();
  h.creds = { ...DS };
  h.account = { ...ACCOUNT };
  h.savedAccounts = [saved(DS), saved(VIBEZ)];
  h.engine = 'exo';
  h.recorder = false;
  h.net = { configured: false };
  h.authCalls = 0;
});
afterEach(() => { localStorage.clear(); });

const render = async (refresh: unknown = 'menu') => {
  const r = renderHook(({ k }) => useHubStates(k), { initialProps: { k: refresh } });
  // The lines are read from the box once, a moment after the first draw.
  await waitFor(() => expect(r.result.current.services).not.toBe(''));
  return r;
};
/** Midnight today plus `days` (daysUntilExp counts from midnight), in unix seconds. */
const daysFromToday = (days: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000) + days * 86400; };

describe('Settings menu state lines', () => {
  it('My Account: the service and its end date; Trial with the days left; Expired', async () => {
    const r = await render();
    const sameYear = new Date(IN_40_DAYS * 1000).getFullYear() === new Date().getFullYear();
    expect(r.result.current.account).toBe(`DreamStreams · expires ${formatDate(IN_40_DAYS * 1000, sameYear ? 'short' : 'medium')}`);
    r.unmount();

    // Another year: the year is said.
    const nextYear = Math.floor(new Date(new Date().getFullYear() + 1, 0, 3, 12).getTime() / 1000);
    h.account = { ...ACCOUNT, expDate: nextYear };
    const later = await render();
    expect(later.result.current.account).toBe(`DreamStreams · expires ${formatDate(nextYear * 1000, 'medium')}`);
    expect(later.result.current.account).toContain(String(new Date().getFullYear() + 1));
    later.unmount();

    h.account = { ...ACCOUNT, isTrial: true, expDate: daysFromToday(1) };
    const trial = await render();
    expect(trial.result.current.account).toMatch(/^Trial · 1 day left$/);
    trial.unmount();

    h.account = { ...ACCOUNT, status: 'Expired' };
    const expired = await render();
    expect(expired.result.current.account).toBe('Expired');
  });

  it('Services: every line on the box and the outside service; never a panel check for it', async () => {
    h.account = { ...ACCOUNT, lastCheckedAt: 1 }; // stale: Services' own page would check it, the summary must not
    localStorage.setItem('snow-livetv-outside-sources-v1', JSON.stringify([{ id: 'x:other.tv|bob', kind: 'xtream', name: 'Sports Box', host: 'http://other.tv:8000', username: 'bob', password: 'hunter22', owner: 'dstreams.xyz|jsmith', addedAt: 1 }]));
    const r = await render();
    expect(r.result.current.services).toBe('3 services');
    expect(h.authCalls).toBe(0);
    r.unmount();
    h.savedAccounts = [saved(DS)];
    localStorage.removeItem('snow-livetv-outside-sources-v1');
    const one = await render();
    expect(one.result.current.services).toBe('1 service');
  });

  it('Channels: hidden categories over every line, and the favorites order (live)', async () => {
    const r = await render();
    expect(r.result.current.channels).toBe('None hidden · Favorites: my order');
    act(() => {
      saveHiddenCategories(lineKey(DS), new Set(['1', '2']));
      saveHiddenCategories(lineKey(VIBEZ), new Set(['9']));
    });
    await waitFor(() => expect(r.result.current.channels).toBe('3 hidden · Favorites: my order'));
    act(() => { saveFavOrder({ ...loadFavOrder(), mode: 'az' }); });
    expect(r.result.current.channels).toBe('3 hidden · Favorites: A–Z');
  });

  it('Appearance: the layout, and the row size where the layout has rows', async () => {
    const r = await render();
    expect(r.result.current.appearance).toBe('Compact · Normal rows');
    act(() => { saveLiveRowSize('slim'); });
    expect(r.result.current.appearance).toBe('Compact · Slim rows');
    act(() => { saveLiveLayout('grid'); });
    expect(r.result.current.appearance).toBe('Vibez');
  });

  it('Recording & Rewind: rewind on/off, and where recordings go (this box, or the computer by name)', async () => {
    const plain = await render();
    expect(plain.result.current.rewind).toBe('Rewind on'); // no recorder on this box: nothing about recordings
    act(() => { saveRewindSettings({ enabled: false, maxRewind: 'auto' }); });
    expect(plain.result.current.rewind).toBe('Rewind off');
    plain.unmount();

    h.recorder = true;
    const here = await render();
    expect(here.result.current.rewind).toBe('Rewind off · Recordings on this box');
    // Back on the menu after setting a network folder: read again.
    h.net = { configured: true, host: '192.168.1.20', label: 'MACBOOKPRO' };
    here.rerender({ k: 'page' });
    await waitFor(() => expect(here.result.current.rewind).toBe('Rewind off · Recordings on MACBOOKPRO'));
  });

  it('Player, Fix a problem and Sign out', async () => {
    h.engine = 'mpv';
    const r = await render();
    expect(r.result.current.player).toBe('MPV · Live buffer: Auto');
    act(() => { saveLiveBuffer('large'); });
    await waitFor(() => expect(r.result.current.player).toBe('MPV · Live buffer: Large'));
    expect(r.result.current.help).toBe('Buffering? Start here');
    expect(r.result.current.signout).toBe('Signed in as jsmith');
  });
});
