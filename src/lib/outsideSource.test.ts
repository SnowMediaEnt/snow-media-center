// "Add another service" (lib/outsideSource): the owner's rule — a viewer with
// an active DreamStreams or Vibez line may add ONE outside service — and the
// model behind it: what the form accepts (an Xtream get.php link becomes an
// Xtream login, ours are refused), where it is kept (never with the saved
// accounts), and how the rest of the app recognises it.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_OUTSIDE_SOURCES,
  OUTSIDE_SOURCES_EVENT,
  __resetOutsideForTests,
  isOutsideHost,
  isOutsideLine,
  lineIsActive,
  loadOutsideSources,
  outsideAllowed,
  outsideCreds,
  outsideLinesFor,
  parseOutsideInput,
  removeOutsideSource,
  saveOutsideSource,
  scrubOutside,
  xtreamFromM3uLink,
  type OutsideSource,
} from './outsideSource';
import { isOurHost } from './servers';
import { buildLines } from './liveLines';
import { loadSavedAccounts, type PlayerAccount, type SavedAccount, type XtreamCreds } from './xtream';

const DS: XtreamCreds = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8', serverLabel: 'Dreamstreams' };
const VIBEZ: XtreamCreds = { host: 'https://strmz.xyz', username: 'me@mail.com', password: 'pw2', output: 'm3u8', serverLabel: 'Vibez' };
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const account = (over: Partial<PlayerAccount> = {}): PlayerAccount => ({
  serverLabel: 'Dreamstreams', host: DS.host, username: DS.username, password: DS.password, output: 'm3u8',
  expDate: Math.floor(NOW / 1000) + 30 * 86400, status: 'Active', isTrial: false, maxConnections: 2, activeCons: 0, createdAt: null, lastCheckedAt: NOW,
  ...over,
});
const XTREAM: OutsideSource = { id: 'x:other.tv|bob', kind: 'xtream', name: 'Other TV', host: 'http://other.tv:8000', username: 'bob', password: 'hunter22', addedAt: 1 };
const M3U: OutsideSource = { id: 'm:abc', kind: 'm3u', name: 'My List', url: 'http://lists.example/get/list.m3u?key=zzz', addedAt: 1 };

beforeEach(() => { localStorage.clear(); __resetOutsideForTests(); });

describe('our hosts', () => {
  it('knows DreamStreams and Vibez whatever the scheme, port, slash or case', () => {
    for (const h of ['http://dstreams.xyz:8080', 'http://dstreams.xyz', 'dstreams.xyz', 'HTTP://DSTREAMS.XYZ:8080/', 'https://strmz.xyz/', 'strmz.xyz:443', 'http://line2.strmz.xyz']) {
      expect(isOurHost(h), h).toBe(true);
    }
    for (const h of ['http://other.tv:8000', 'http://notstrmz.xyz', 'http://dstreams.xyz.evil.example', '', 'nonsense value']) {
      expect(isOurHost(h), h).toBe(false);
    }
  });
});

describe('what the form accepts', () => {
  it('turns an Xtream get.php M3U link into an Xtream login (categories and a guide)', () => {
    expect(xtreamFromM3uLink('http://other.tv:8000/get.php?username=bob&password=hunter22&type=m3u_plus&output=ts'))
      .toEqual({ host: 'http://other.tv:8000', username: 'bob', password: 'hunter22' });
    expect(xtreamFromM3uLink('other.tv/sub/player_api.php?username=a&password=b')).toEqual({ host: 'http://other.tv/sub', username: 'a', password: 'b' });
    expect(xtreamFromM3uLink('http://lists.example/list.m3u')).toBeNull();
    expect(xtreamFromM3uLink('http://other.tv/get.php?username=bob')).toBeNull();

    const r = parseOutsideInput({ kind: 'm3u', url: 'http://other.tv:8000/get.php?username=bob&password=hunter22&type=m3u_plus' }, 5);
    expect(r).toEqual({ ok: true, source: { id: 'x:other.tv|bob', kind: 'xtream', name: 'other.tv', host: 'http://other.tv:8000', username: 'bob', password: 'hunter22', addedAt: 5 } });
  });

  it('an Xtream login: the server as typed (scheme added, slash and player_api.php dropped), a name defaulting to the host', () => {
    const r = parseOutsideInput({ kind: 'xtream', server: 'other.tv:8000/player_api.php', username: ' bob ', password: 'hunter22', name: '' });
    expect(r.ok && r.source).toMatchObject({ kind: 'xtream', host: 'http://other.tv:8000', username: 'bob', password: 'hunter22', name: 'other.tv' });
    const named = parseOutsideInput({ kind: 'xtream', server: 'https://other.tv/', username: 'bob', password: 'p', name: 'Sports Box' });
    expect(named.ok && named.source).toMatchObject({ host: 'https://other.tv', name: 'Sports Box' });
  });

  it('an M3U link stays a link', () => {
    const r = parseOutsideInput({ kind: 'm3u', url: 'lists.example/my.m3u', name: 'My List' });
    expect(r.ok && r.source).toMatchObject({ kind: 'm3u', url: 'http://lists.example/my.m3u', name: 'My List' });
    expect(r.ok && r.source.id.startsWith('m:')).toBe(true);
  });

  it.each([
    [{ kind: 'xtream' as const, server: '', username: 'a', password: 'b' }, 'needServer'],
    [{ kind: 'xtream' as const, server: 'other.tv', username: 'a', password: '' }, 'needLogin'],
    [{ kind: 'm3u' as const, url: '  ' }, 'needUrl'],
    [{ kind: 'm3u' as const, url: 'ftp://lists.example/x.m3u' }, 'badUrl'],
    [{ kind: 'xtream' as const, server: 'http://dstreams.xyz:8080', username: 'a', password: 'b' }, 'ours'],
    [{ kind: 'm3u' as const, url: 'https://strmz.xyz/get.php?username=a&password=b' }, 'ours'],
    [{ kind: 'm3u' as const, url: 'http://line.strmz.xyz/list.m3u' }, 'ours'],
    [{ kind: 'xtream' as const, server: 'other.tv', username: 'a', password: 'b', name: 'Vibez' }, 'nameTaken'],
  ])('refuses %o: %s', (input, error) => {
    expect(parseOutsideInput(input)).toEqual({ ok: false, error });
  });
});

describe('the gate: an active DreamStreams or Vibez line', () => {
  it('lets an active line in, with or without an end date', () => {
    expect(outsideAllowed(DS, account(), NOW)).toBe(true);
    expect(outsideAllowed(DS, account({ expDate: null }), NOW)).toBe(true);
    expect(outsideAllowed(DS, account({ status: 'Trial' }), NOW)).toBe(true);
    expect(outsideAllowed(VIBEZ, account({ host: VIBEZ.host, username: VIBEZ.username, serverLabel: 'Vibez' }), NOW)).toBe(true);
  });

  it.each(['Expired', 'expired', 'Banned', 'Disabled'])('keeps out a line whose panel says %s', (status) => {
    expect(outsideAllowed(DS, account({ status }), NOW)).toBe(false);
  });

  it('keeps out a line whose end date has passed (to the second), even before the panel says so', () => {
    expect(outsideAllowed(DS, account({ expDate: Math.floor(NOW / 1000) - 60 }), NOW)).toBe(false);
    expect(outsideAllowed(DS, account({ expDate: Math.floor(NOW / 1000) + 60 }), NOW)).toBe(true);
    expect(lineIsActive({ status: 'Active', expDate: 0 }, NOW)).toBe(true); // 0 = no end date on some panels
  });

  it('keeps out a line that is not ours, an outside line, no account record, or a record for another line', () => {
    const other: XtreamCreds = { host: 'http://other.tv:8000', username: 'bob', password: 'x', output: 'm3u8' };
    expect(outsideAllowed(other, account({ host: other.host, username: 'bob' }), NOW)).toBe(false);
    expect(outsideAllowed({ ...DS, outside: true }, account(), NOW)).toBe(false);
    expect(outsideAllowed(DS, null, NOW)).toBe(false);
    expect(outsideAllowed(DS, account({ username: 'someoneelse' }), NOW)).toBe(false);
    expect(outsideAllowed(null, account(), NOW)).toBe(false);
  });

  it('an old line saved as "http://dstreams.xyz" (no port) still counts as the same line', () => {
    expect(outsideAllowed({ ...DS, host: 'http://dstreams.xyz' }, account(), NOW)).toBe(true);
  });
});

describe('Live TV lines (buildLines)', () => {
  const saved: SavedAccount[] = [{ id: 'v', serverLabel: 'Vibez', host: VIBEZ.host, username: VIBEZ.username, password: VIBEZ.password, output: 'm3u8', addedAt: 1 }];

  it('adds the outside service last, marked, only while the line is allowed', () => {
    const lines = buildLines(DS, saved, { sources: [XTREAM], account: account() });
    expect(lines.map((l) => l.serverLabel)).toEqual(['Dreamstreams', 'Vibez', 'Other TV']);
    expect(lines[2]).toMatchObject({ outside: true, host: XTREAM.host, username: 'bob' });
    expect(lines[0].outside).toBeUndefined();
    expect(lines[1].outside).toBeUndefined();
  });

  it('leaves it out when the line has expired, and brings it back when it is renewed (the service stays saved)', () => {
    const expired = buildLines(DS, saved, { sources: [XTREAM], account: account({ status: 'Expired' }) });
    expect(expired.map((l) => l.serverLabel)).toEqual(['Dreamstreams', 'Vibez']);
    const renewed = buildLines(DS, saved, { sources: [XTREAM], account: account() });
    expect(renewed).toHaveLength(3);
  });

  it('without the state (Game Day, the Home bar) there are no outside lines', () => {
    expect(buildLines(DS, saved)).toHaveLength(2);
    expect(buildLines(DS, saved, null)).toHaveLength(2);
  });

  it('never more than MAX_OUTSIDE_SOURCES', () => {
    const two = [XTREAM, M3U];
    expect(outsideLinesFor(DS, { sources: two, account: account() }, NOW)).toHaveLength(MAX_OUTSIDE_SOURCES);
  });

  it('an M3U link becomes a line with its own key and nothing that reaches anyone', () => {
    const c = outsideCreds(M3U);
    expect(c).toMatchObject({ host: 'http://lists.example', password: '', outside: true, m3u: M3U.url, serverLabel: 'My List' });
    expect(c.username).toMatch(/^m3u-[0-9a-f]{8}$/);
    expect(outsideCreds(M3U).username).toBe(c.username);
  });
});

describe('storage', () => {
  it('saves one service under its own key, never with the saved accounts, and tells Live TV', async () => {
    let told = 0;
    const on = () => { told += 1; };
    window.addEventListener(OUTSIDE_SOURCES_EVENT, on);
    expect(await saveOutsideSource(XTREAM)).toBe(true);
    window.removeEventListener(OUTSIDE_SOURCES_EVENT, on);
    expect(told).toBe(1);
    expect(await loadOutsideSources()).toEqual([XTREAM]);
    expect(await loadSavedAccounts()).toEqual([]);
  });

  it('only one: a second is refused, an edit replaces it, remove forgets it', async () => {
    await saveOutsideSource(XTREAM);
    expect(await saveOutsideSource(M3U)).toBe(false);
    expect(await saveOutsideSource(M3U, XTREAM.id)).toBe(true);
    expect(await loadOutsideSources()).toEqual([M3U]);
    await removeOutsideSource(M3U.id);
    expect(await loadOutsideSources()).toEqual([]);
  });

  it('never keeps one of ours, whatever is in storage', async () => {
    expect(await saveOutsideSource({ ...XTREAM, host: 'http://dstreams.xyz:8080' })).toBe(false);
    localStorage.setItem('snow-livetv-outside-sources-v1', JSON.stringify([{ ...XTREAM, host: 'https://strmz.xyz' }]));
    expect(await loadOutsideSources()).toEqual([]);
  });
});

describe('recognising an outside service', () => {
  it('by the line flag, or by the saved service\'s host (never one of ours)', async () => {
    expect(isOutsideLine({ ...DS, outside: true })).toBe(true);
    expect(isOutsideHost('http://other.tv:8000')).toBe(false);
    await saveOutsideSource(XTREAM);
    expect(isOutsideHost('http://other.tv:8000')).toBe(true);
    expect(isOutsideHost('other.tv')).toBe(true);
    expect(isOutsideLine({ host: 'http://OTHER.tv' })).toBe(true);
    expect(isOutsideHost(DS.host)).toBe(false);
    expect(isOutsideLine(DS)).toBe(false);
    await removeOutsideSource(XTREAM.id);
    expect(isOutsideHost('http://other.tv:8000')).toBe(false);
  });

  it('analytics: its name, host, login and playlist address become "outside"; everything else is untouched', async () => {
    const props = { server: 'Dreamstreams', channel: 'News One' };
    expect(scrubOutside(props)).toBe(props);
    await saveOutsideSource(XTREAM);
    expect(scrubOutside({ server: 'Other TV', channel: 'News One', count: 3 })).toEqual({ server: 'outside', channel: 'News One', count: 3 });
    expect(scrubOutside({ url: 'http://other.tv:8000/live/bob/hunter22/1.ts' })).toEqual({ url: 'outside' });
    expect(scrubOutside({ u: 'bob', p: 'hunter22' })).toEqual({ u: 'outside', p: 'outside' });
    expect(scrubOutside(props)).toBe(props);
    await saveOutsideSource(M3U, XTREAM.id);
    expect(scrubOutside({ where: M3U.url!, server: 'My List' })).toEqual({ where: 'outside', server: 'outside' });
  });
});
