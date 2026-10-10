// Taking ONE channel off Recently watched (Live TV's panel): gone from the box
// at once, its account row deleted (only as it stood: a newer play elsewhere
// stays), and an offline delete kept off the next pull from the account and
// sent then. The rest of the history stays. Invented names only.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; filters: Array<[string, ...unknown[]]> }>,
  fail: false,
  rows: [] as unknown[],
}));

vi.mock('@/integrations/supabase/client', () => {
  const from = vi.fn((table: string) => {
    const call = { table, op: 'select', filters: [] as Array<[string, ...unknown[]]> };
    h.calls.push(call);
    const result = () => (h.fail ? { data: null, error: { message: 'offline' } } : { data: call.op === 'select' ? h.rows : null, error: null });
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'not', 'like', 'order', 'limit', 'lte']) {
      q[m] = (...args: unknown[]) => { call.filters.push([m, ...args]); return q; };
    }
    q.delete = () => { call.op = 'delete'; return q; };
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return q;
  });
  return { supabase: { from, auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } };
});

import type { XtreamCreds } from './xtream';
import { __setViewerForTests } from './viewer';
import { channelKey, loadWatchHistory, removeWatchEntry, syncWatchHistoryFromCloud, WATCH_HISTORY_EVENT, type WatchEntry } from './watchHistory';

const LINE: XtreamCreds = { host: 'http://panel.example.test:8080', username: 'alice', password: 's3cretPw', output: 'ts', serverLabel: 'Alpha' };
const entry = (id: number, name: string, at: number): WatchEntry => ({
  kind: 'channel', key: channelKey(LINE, id), title: name, watchedAt: at, count: 1,
  channel: { host: LINE.host, username: LINE.username, streamId: id, categoryId: '1' },
});
const cloudRow = (id: number, name: string, at: number) => ({
  kind: 'channel', item_key: channelKey(LINE, id), title: name, subtitle: null, poster: null,
  payload: { host: LINE.host, username: LINE.username, streamId: id }, watched_at: new Date(at).toISOString(), count: 1,
});
const deletes = () => h.calls.filter((c) => c.op === 'delete');

beforeEach(() => {
  localStorage.clear();
  h.calls = []; h.fail = false; h.rows = [];
  __setViewerForTests('u1');
  localStorage.setItem('snow-watch-history:u1', JSON.stringify([entry(1, 'Harbor News', 300), entry(2, 'Pinecrest Weather', 200), entry(3, 'Summit Sports', 100)]));
});

describe('Recently watched: remove one', () => {
  it('gone from the box at once (the content bar hears of it), the rest kept; its account row deleted, as it stood', async () => {
    const heard = vi.fn();
    window.addEventListener(WATCH_HISTORY_EVENT, heard);
    await removeWatchEntry('channel', channelKey(LINE, 2));
    window.removeEventListener(WATCH_HISTORY_EVENT, heard);
    expect(loadWatchHistory('u1').map((e) => e.title)).toEqual(['Harbor News', 'Summit Sports']);
    expect(heard).toHaveBeenCalled();
    expect(deletes()).toHaveLength(1);
    const f = deletes()[0].filters;
    expect(f).toEqual(expect.arrayContaining([
      ['eq', 'user_id', 'u1'], ['eq', 'kind', 'channel'], ['eq', 'item_key', channelKey(LINE, 2)],
    ]));
    expect(f.some(([m, col]) => m === 'lte' && col === 'watched_at')).toBe(true);
  });

  it('offline: the next pull does not bring it back, and sends the delete again', async () => {
    h.fail = true;
    await removeWatchEntry('channel', channelKey(LINE, 2));
    expect(loadWatchHistory('u1').map((e) => e.title)).toEqual(['Harbor News', 'Summit Sports']);
    // Back online: the account still has it (and a newer play of another channel).
    h.fail = false; h.calls = [];
    h.rows = [cloudRow(2, 'Pinecrest Weather', 200), cloudRow(4, 'Valley Music', 400)];
    const merged = await syncWatchHistoryFromCloud('u1');
    expect(merged.map((e) => e.title)).toEqual(['Valley Music', 'Harbor News', 'Summit Sports']);
    expect(deletes()).toHaveLength(1);
    // Sent: the next pull no longer asks again.
    h.calls = [];
    await syncWatchHistoryFromCloud('u1');
    expect(deletes()).toHaveLength(0);
  });

  it('watched again after it was removed: it is back', async () => {
    h.fail = true;
    await removeWatchEntry('channel', channelKey(LINE, 2));
    h.fail = false;
    h.rows = [cloudRow(2, 'Pinecrest Weather', Date.now() + 60_000)];
    const merged = await syncWatchHistoryFromCloud('u1');
    expect(merged.map((e) => e.title)).toContain('Pinecrest Weather');
  });

  it('nobody signed in: the box only, no request', async () => {
    __setViewerForTests('device');
    localStorage.setItem('snow-watch-history:device', JSON.stringify([entry(1, 'Harbor News', 300), entry(2, 'Pinecrest Weather', 200)]));
    await removeWatchEntry('channel', channelKey(LINE, 1));
    expect(loadWatchHistory('device').map((e) => e.title)).toEqual(['Pinecrest Weather']);
    expect(h.calls).toHaveLength(0);
  });
});
