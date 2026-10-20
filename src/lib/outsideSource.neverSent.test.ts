// THE HARD RULE for an outside service (lib/outsideSource): nothing about it
// is ever sent to Snow Media's servers. Its lists go straight to it (never
// the list proxy), its favourites stay on the box, channel status never hears
// of its host, and neither do watch-history sync, reports, the device inbox,
// the sign-in capture or the line email. Every server call is recorded here;
// no request leaves the test (HTTP is mocked).
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  invokes: [] as Array<{ name: string; body: Record<string, unknown> }>,
  tables: [] as Array<{ table: string; op: string; row?: unknown }>,
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  CapacitorHttp: { get: h.get },
}));
vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    const call: { table: string; op: string; row?: unknown } = { table, op: 'select' };
    h.tables.push(call);
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'not', 'like', 'order', 'limit', 'lte', 'is']) q[m] = () => q;
    q.upsert = (row: unknown) => { call.op = 'upsert'; call.row = row; return q; };
    q.insert = (row: unknown) => { call.op = 'insert'; call.row = row; return q; };
    q.delete = () => { call.op = 'delete'; return q; };
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res, rej);
    return q;
  };
  return {
    supabase: {
      from,
      functions: {
        invoke: vi.fn(async (name: string, opts?: { body?: Record<string, unknown> }) => {
          h.invokes.push({ name, body: opts?.body ?? {} });
          if (name === 'channel-status') return { data: { ok: true, down: [] }, error: null };
          if (name === 'player-favorites') return { data: { ok: true, favorites: null, version: null }, error: null };
          if (name === 'xtream-list-proxy') return { data: [{ category_id: '1', category_name: 'Via proxy' }], error: null };
          return { data: { ok: true }, error: null };
        }),
      },
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-12345678', trackEvent: vi.fn() }));

import { __resetOutsideForTests, outsideCreds, saveOutsideSource, type OutsideSource } from './outsideSource';
import { bumpXtreamRefresh, getLiveCategories, type PlayerAccount, type XtreamCreds } from './xtream';
import { withListFallback } from './xtreamListProxy';
import {
  commitFavoritesForLine,
  loadFavoritesForLine,
  reconcileFavoritesForLine,
  saveFavoritesForLine,
  scheduleFavoritesPushForLine,
} from './favoritesSync';
import { __setDownForTests, signalCategory, signalChannel, useDownChannels } from './channelStatus';
import { __setViewerForTests } from './viewer';
import { channelKey, loadWatchHistory, recordChannelWatch, removeWatchEntry } from './watchHistory';
import { lineReportFields } from './lineInfo';
import { registerLine } from './deviceInbox';
import { capturePlayerSignin } from './playerSigninCapture';
import { emailLineCredentials } from './lineEmail';
import { noteLivePlay } from './gameDayAi';

const SRC: OutsideSource = { id: 'x:other.tv|bob', kind: 'xtream', name: 'Other TV', host: 'http://other.tv:8000', username: 'bob', password: 'hunter22', addedAt: 1 };
const OUT = outsideCreds(SRC);
const DS: XtreamCreds = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8', serverLabel: 'Dreamstreams' };
const netError = () => new Error('Unable to resolve host');
const invoked = (name?: string) => h.invokes.filter((c) => !name || c.name === name);
/** Does anything sent to our servers mention the outside service? */
const leaked = () => JSON.stringify([h.invokes, h.tables]).match(/other\.tv|hunter22|"bob"/);

beforeEach(async () => {
  localStorage.clear();
  __resetOutsideForTests();
  h.get.mockReset();
  h.invokes.length = 0;
  h.tables.length = 0;
  bumpXtreamRefresh();
  __setDownForTests([]);
  await saveOutsideSource(SRC, DS);
});
afterEach(() => { vi.useRealTimers(); expect(leaked()).toBeNull(); });

describe('lists: straight to the outside service, never through the list proxy', () => {
  it('a direct failure that would send one of OUR lines through Snow Media does not, for an outside line', async () => {
    h.get.mockRejectedValue(netError());
    await expect(getLiveCategories(OUT)).rejects.toThrow();
    expect(invoked('xtream-list-proxy')).toHaveLength(0);
    // The same failure on a line of ours does go through the proxy (the control).
    await getLiveCategories(DS);
    expect(invoked('xtream-list-proxy')).toHaveLength(1);
    expect(invoked('xtream-list-proxy')[0].body.host).toBe('http://dstreams.xyz:8080');
    h.invokes.length = 0;
  });

  it('second lock: the proxy refuses a saved outside host even when the caller forgot the flag', async () => {
    const direct = vi.fn(async () => { throw netError(); });
    await expect(withListFallback('http://other.tv:8000/player_api.php?username=bob&password=hunter22&action=x', 1000, true, direct)).rejects.toThrow();
    expect(direct).toHaveBeenCalledTimes(1);
    expect(invoked()).toHaveLength(0);
  });
});

describe('favourites: on the box only', () => {
  it('kept in its own list on the box, never pulled or pushed, never in the active line\'s list', async () => {
    vi.useFakeTimers();
    const fav = new Map([[7, { stream_id: 7, name: 'Outside Seven' }]]);
    saveFavoritesForLine(OUT, fav);
    expect([...loadFavoritesForLine(OUT).keys()]).toEqual([7]);
    // No favourites meta yet (a fresh box): the active list is still not it.
    expect(loadFavoritesForLine(DS).size).toBe(0);
    expect(await reconcileFavoritesForLine(OUT, () => fav)).toBeNull();
    scheduleFavoritesPushForLine(OUT, fav, () => undefined);
    commitFavoritesForLine(OUT, new Map([...fav, [8, { stream_id: 8, name: 'Outside Eight' }]]), () => undefined);
    await vi.advanceTimersByTimeAsync(5000);
    expect(invoked('player-favorites')).toHaveLength(0);
    expect([...loadFavoritesForLine(OUT).keys()]).toEqual([7, 8]);
  });
});

describe('channel status: its host is never sent', () => {
  it('the down-channel list asks for our hosts only', async () => {
    renderHook(() => useDownChannels([DS, OUT, { host: 'http://other.tv:8000' }], true));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const lists = invoked('channel-status').map((c) => c.body);
    expect(lists).toEqual([{ op: 'list', hosts: ['dstreams.xyz:8080'] }]);
    h.invokes.length = 0;
  });

  it('no list at all when the outside line is the only one', async () => {
    renderHook(() => useDownChannels([OUT], true));
    await act(async () => { await Promise.resolve(); });
    expect(invoked()).toHaveLength(0);
  });

  it('no signals or reports for its channels or categories (and no local marks)', async () => {
    for (const kind of ['fail', 'down', 'buffering', 'ok', 'clear'] as const) signalChannel(OUT.host, 7, 'Outside Seven', kind, OUT);
    signalChannel('http://other.tv:8000', 9, 'No flag', 'down');
    signalCategory(OUT.host, '3', 'Sports', 'down', OUT);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(invoked()).toHaveLength(0);
  });
});

describe('watch history, reports and the rest', () => {
  it('a watched outside channel is kept on the box (Recently watched) but never sent to the account', async () => {
    __setViewerForTests('u1');
    recordChannelWatch({ stream_id: 7, name: 'Outside Seven', category_id: '3' }, OUT, 'Sports');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const hist = loadWatchHistory('u1');
    expect(hist).toHaveLength(1);
    expect(hist[0].channel?.outside).toBe(true);
    expect(h.tables).toHaveLength(0);
    await removeWatchEntry('channel', channelKey(OUT, 7));
    await removeWatchEntry('channel', channelKey(OUT, 7)); // already gone: still nothing sent
    expect(loadWatchHistory('u1')).toHaveLength(0);
    expect(h.tables).toHaveLength(0);
    // The control: one of our channels does go to the account.
    recordChannelWatch({ stream_id: 5, name: 'Ours Five' }, DS);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(h.tables.map((t) => `${t.table}:${t.op}`)).toEqual(['watch_history:upsert']);
    h.tables.length = 0;
  });

  it('a report never carries its line; the device inbox, sign-in capture, line email and Game Day never see it', async () => {
    expect(await lineReportFields(OUT)).toBeNull();
    expect(await registerLine(OUT)).toBe(false);
    const acc = { host: OUT.host, username: 'bob', password: 'hunter22', serverLabel: 'Other TV' } as unknown as PlayerAccount;
    await capturePlayerSignin(acc, 'Other TV', 'signin');
    const mail = await emailLineCredentials({ email: 'viewer@example.com', creds: OUT });
    expect(mail.ok).toBe(false);
    noteLivePlay(OUT, { stream_id: 7, name: 'Outside Seven' }, 'Sports');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(invoked()).toHaveLength(0);
    expect(h.tables).toHaveLength(0);
  });
});
