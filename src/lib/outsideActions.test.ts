// An outside service belongs to the line that added it (lib/outsideActions):
// Remove (or signing out of that line) takes it away with everything the box
// kept for it — favourites (every profile), hidden and folded categories,
// counts, its channels in Recently watched, its playlist copy — and leaves
// other lines' things alone. A line not checked lately is checked again.
// Nothing reaches a real panel: the Xtream client's sign-in is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  account: null as null | Record<string, unknown>,
  creds: null as unknown,
  savedAccounts: [] as unknown[],
  forgotten: [] as Array<{ url: string; disk?: boolean }>,
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  authenticateRouted: h.auth,
  loadPlayerAccount: async () => h.account,
  loadCreds: async () => h.creds,
  savePlayerAccount: async (a: Record<string, unknown>) => { h.account = a; },
}));
vi.mock('@/lib/m3u', async (orig) => ({
  ...(await orig<typeof import('@/lib/m3u')>()),
  forgetM3u: (url: string, opts?: { disk?: boolean }) => { h.forgotten.push({ url, disk: opts?.disk }); },
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn() } }));

import { forgetOutsideOwnedBy, forgetOutsideSource, recheckLine } from './outsideActions';
import { __resetOutsideForTests, loadOutsideSources, outsideAllowed, outsideCreds, saveOutsideSource, STALE_MS, type OutsideSource } from './outsideSource';
import { lineKey, loadFavoritesForLine, saveFavoritesForLine } from './favoritesSync';
import { loadCollapsedLines, loadHiddenCategories, saveCollapsedLines, saveHiddenCategories } from './liveLines';
import { loadWatchHistory } from './watchHistory';
import { __resetPanelReconcileForTests } from './panelReconcile';
import type { XtreamCreds } from './xtream';

const DS: XtreamCreds = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8', serverLabel: 'Dreamstreams' };
const VIBEZ: XtreamCreds = { host: 'https://strmz.xyz', username: 'me@mail.com', password: 'pw2', output: 'm3u8', serverLabel: 'Vibez' };
const LIST: OutsideSource = { id: 'm:1', kind: 'm3u', name: 'My List', url: 'http://lists.example/my.m3u', addedAt: 1 };
const OUT = outsideCreds(LIST);
const entry = (line: { host: string; username: string }, id: number, title: string) => ({
  kind: 'channel', key: `${line.host.replace(/^https?:\/\//, '')}|${line.username}|${id}`, title, watchedAt: id, count: 1,
  channel: { host: line.host, username: line.username, streamId: id },
});

beforeEach(async () => {
  localStorage.clear();
  __resetOutsideForTests();
  __resetPanelReconcileForTests();
  h.auth.mockReset();
  h.forgotten = [];
  h.creds = DS;
  h.account = { serverLabel: 'Dreamstreams', host: DS.host, username: DS.username, password: 'pw', output: 'm3u8', expDate: null, status: 'Active', lastCheckedAt: Date.now() };
  await saveOutsideSource(LIST, DS);
});

const keep = () => {
  // What the box keeps for the outside line, and for one of ours (which must stay).
  saveFavoritesForLine(OUT, new Map([[7, { stream_id: 7, name: 'Faraway' }]]));
  localStorage.setItem(`snow-livetv-favs-byline:${lineKey(OUT)}#p:kid1`, JSON.stringify({ favorites: [{ stream_id: 8, name: 'Faraway Kids' }], version: null, dirty: true }));
  saveFavoritesForLine(VIBEZ, new Map([[9, { stream_id: 9, name: 'Ours' }]]));
  saveHiddenCategories(lineKey(OUT), new Set(['1']));
  saveHiddenCategories(lineKey(VIBEZ), new Set(['2']));
  saveCollapsedLines(new Set([lineKey(OUT), lineKey(VIBEZ)]));
  localStorage.setItem('snow-watch-history:device', JSON.stringify([entry(OUT, 7, 'Faraway'), entry(VIBEZ, 9, 'Ours')]));
};

describe('Remove: everything the box kept for it goes too', () => {
  it('favourites (every profile), hidden and folded categories, Recently watched, the playlist copy; ours stay', async () => {
    keep();
    await forgetOutsideSource((await loadOutsideSources())[0]);
    expect(await loadOutsideSources()).toEqual([]);
    expect(loadFavoritesForLine(OUT).size).toBe(0);
    expect(localStorage.getItem(`snow-livetv-favs-byline:${lineKey(OUT)}#p:kid1`)).toBeNull();
    expect([...loadFavoritesForLine(VIBEZ).keys()]).toEqual([9]);
    expect(loadHiddenCategories(lineKey(OUT)).size).toBe(0);
    expect([...loadHiddenCategories(lineKey(VIBEZ))]).toEqual(['2']);
    expect([...loadCollapsedLines()]).toEqual([lineKey(VIBEZ)]);
    expect(loadWatchHistory('device').map((e) => e.title)).toEqual(['Ours']);
    expect(h.forgotten).toEqual([{ url: LIST.url, disk: true }]);
  });
});

describe('it belongs to the line that added it', () => {
  it('signing out of that line takes it (and its things) away; another line\'s sign-out leaves it', async () => {
    keep();
    await forgetOutsideOwnedBy(VIBEZ);
    expect(await loadOutsideSources()).toHaveLength(1);
    await forgetOutsideOwnedBy({ host: 'http://dstreams.xyz', username: 'JSMITH' });
    expect(await loadOutsideSources()).toEqual([]);
    expect(loadFavoritesForLine(OUT).size).toBe(0);
  });
});

describe('a line not checked lately is checked again', () => {
  it('stale: asks the panel once, saves the fresh record (the outside service comes back)', async () => {
    h.account = { ...h.account, lastCheckedAt: Date.now() - STALE_MS - 1000 };
    expect(outsideAllowed(DS, h.account as never)).toBe(false);
    h.auth.mockResolvedValue({ ok: true, server: { label: 'Dreamstreams', host: DS.host }, creds: DS, userInfo: { auth: 1, status: 'Active', exp_date: null } });
    await recheckLine(DS);
    expect(h.auth).toHaveBeenCalledWith('jsmith', 'pw');
    expect(outsideAllowed(DS, h.account as never)).toBe(true);
    // Once per window: no burst at the panel.
    h.account = { ...h.account, lastCheckedAt: 1 };
    await recheckLine(DS);
    expect(h.auth).toHaveBeenCalledTimes(1);
  });

  it('a refused login is noted: the outside service stays hidden', async () => {
    h.account = { ...h.account, lastCheckedAt: Date.now() - STALE_MS - 1000 };
    h.auth.mockResolvedValue({ ok: false, invalidLogin: true });
    await recheckLine(DS);
    expect(outsideAllowed(DS, { ...h.account, lastCheckedAt: Date.now() - 1000 } as never)).toBe(false);
  });

  it('a fresh record is not checked again', async () => {
    await recheckLine(DS);
    expect(h.auth).not.toHaveBeenCalled();
  });
});
