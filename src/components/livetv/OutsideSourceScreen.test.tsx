/**
 * Live TV › Settings › Add another service (OutsideSourceScreen): with an
 * active DreamStreams / Vibez line, Test signs in to the other service and
 * counts its channels (plain words when it fails), Save keeps what the test
 * tried and only after it worked, the saved service shows without its
 * password, and Remove asks once. Without an active line: the reason, no
 * form. The other service's panel is mocked: nothing leaves the test.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  account: null as null | Record<string, unknown>,
  savedAccounts: [] as unknown[],
  auth: { user_info: { auth: 1, status: 'Active', exp_date: null } } as unknown,
  authThrows: null as null | Error,
  /** A sign-in left waiting (the race test answers it by hand). */
  hold: null as null | ((release: () => void) => void),
  total: 1234,
  authCalls: [] as Array<{ host: string; username: string; password: string }>,
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => ({ host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8', serverLabel: 'Dreamstreams' }),
  loadPlayerAccount: async () => h.account,
  loadSavedAccounts: async () => h.savedAccounts,
  authenticateRouted: async () => { throw new Error('no panel in tests'); },
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  countLiveStreams: async () => ({ total: h.total, byCat: {} }),
}));
// The other service's sign-in (lib/outsideProbe → lib/directHttp): never a real request.
vi.mock('@/lib/directHttp', () => ({
  contentLength: async () => null,
  directGet: async (url: string) => {
    const u = new URL(url);
    h.authCalls.push({ host: `${u.protocol}//${u.host}`, username: u.searchParams.get('username') ?? '', password: u.searchParams.get('password') ?? '' });
    if (h.hold) await new Promise<void>((r) => h.hold!(r));
    if (h.authThrows) throw h.authThrows;
    return { status: 200, data: h.auth, url, headers: {} };
  },
}));
const tracked = vi.hoisted(() => [] as Array<[string, unknown]>);
vi.mock('@/lib/analytics', () => ({ trackEvent: (name: string, _c: string, p: unknown) => { tracked.push([name, p]); } }));

import OutsideSourceScreen from './OutsideSourceScreen';
import { __resetOutsideForTests, loadOutsideSources } from '@/lib/outsideSource';

const ACTIVE = { serverLabel: 'Dreamstreams', host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8', expDate: null, status: 'Active', isTrial: false, maxConnections: 2, activeCons: 0, createdAt: null, lastCheckedAt: Date.now() };
const VIBEZ_KEY = 'strmz.xyz|me@mail.com';
const OTHER = { id: 'x:other.tv|bob', kind: 'xtream', name: 'Sports Box', host: 'http://other.tv:8000', username: 'bob', password: 'hunter22', addedAt: 1 };

const key = (k: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 10; i += 1) await Promise.resolve(); }); };
const until = async (cond: () => boolean) => {
  await settle();
  for (let i = 0; i < 400 && !cond(); i += 1) await settle(10); // room for a loaded box
  expect(cond()).toBe(true);
};
const focusedRow = () => document.querySelector('[data-row][data-focused="true"]')?.getAttribute('data-row');
const input = (row: string) => document.querySelector(`[data-row="${row}"] input`) as HTMLInputElement;
const type = (row: string, value: string) => act(() => { fireEvent.change(input(row), { target: { value } }); });
const result = () => document.querySelector('[data-outside-result]')?.getAttribute('data-outside-result');
const goTo = (row: string) => {
  for (let i = 0; i < 20 && focusedRow() !== row; i += 1) key('ArrowDown');
  if (focusedRow() !== row) for (let i = 0; i < 20 && focusedRow() !== row; i += 1) key('ArrowUp');
  expect(focusedRow()).toBe(row);
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  __resetOutsideForTests();
  h.account = { ...ACTIVE };
  h.auth = { user_info: { auth: 1, status: 'Active', exp_date: null } };
  h.authThrows = null;
  h.hold = null;
  h.savedAccounts = [];
  h.total = 1234;
  h.authCalls = [];
  tracked.length = 0;
});
afterEach(() => { vi.useRealTimers(); });

const renderScreen = async () => {
  const onBack = vi.fn();
  await act(async () => { render(<OutsideSourceScreen onBack={onBack} embedded active />); });
  await until(() => !document.querySelector('[data-outside-screen] .animate-spin'));
  return { onBack };
};

describe('Add another service', () => {
  it('without an active DreamStreams or Vibez line: says so, and there is no form', async () => {
    h.account = { ...ACTIVE, status: 'Expired' };
    await renderScreen();
    expect(screen.getByText('Needs an active DreamStreams or Vibez line.')).toBeTruthy();
    expect(document.querySelector('[data-row="server"]')).toBeNull();
    expect(document.querySelector('[data-row="test"]')).toBeNull();
  });

  it('explains itself: one other service, and that we can\'t help with it', async () => {
    await renderScreen();
    expect(screen.getByText(/You can watch one other service's Live TV channels in Snow Media Center alongside your DreamStreams\/Vibez channels\. We can't help with another provider's channels or logins\./)).toBeTruthy();
  });

  it('Test → Save → shown without its password → Remove (asks once)', async () => {
    const { onBack } = await renderScreen();
    expect(focusedRow()).toBe('kind');
    expect(input('pass').type).toBe('password');
    type('server', 'other.tv:8000');
    type('user', 'bob');
    type('pass', 'hunter22');
    type('name', 'Sports Box');

    // Save before a test: told to test first, nothing saved.
    goTo('save');
    key('Enter');
    await settle();
    expect(result()).toBe('testFirst');
    expect(focusedRow()).toBe('test');
    expect(await loadOutsideSources()).toEqual([]);

    key('Enter');
    await until(() => result() === 'works');
    expect(screen.getByRole('status').textContent).toBe('It works. Channels found: 1,234. Press Save to add it.');
    expect(h.authCalls).toEqual([{ host: 'http://other.tv:8000', username: 'bob', password: 'hunter22' }]);
    expect(focusedRow()).toBe('save');
    key('Enter');
    await until(() => result() === 'saved');
    expect(screen.getByRole('status').textContent).toBe('Saved. Its channels are in Live TV under "Sports Box".');
    // Tied to the line in use.
    expect(await loadOutsideSources()).toMatchObject([{ kind: 'xtream', name: 'Sports Box', host: 'http://other.tv:8000', username: 'bob', password: 'hunter22', owner: 'dstreams.xyz|jsmith' }]);
    expect(tracked).toEqual([['outside_source_saved', { kind: 'xtream', edit: false }]]);

    // Shown with dots, never the password; no form now, Edit and Remove instead.
    const card = document.querySelector('[data-outside-saved]')!;
    expect(card.textContent).toContain('Sports Box');
    expect(card.textContent).toContain('other.tv · bob');
    expect(card.querySelector('[data-outside-password]')?.textContent).toBe('••••••');
    expect(document.body.innerHTML).not.toContain('hunter22');
    expect(document.querySelector('[data-row="server"]')).toBeNull();
    expect(focusedRow()).toBe('edit');

    goTo('remove');
    key('Enter');
    await settle();
    expect(document.querySelector('[data-outside-confirm]')?.textContent).toBe('Press OK again to remove Sports Box from Live TV.');
    expect(await loadOutsideSources()).toHaveLength(1);
    key('Enter');
    await until(() => result() === 'removed');
    expect(await loadOutsideSources()).toEqual([]);
    expect(document.querySelector('[data-row="server"]')).toBeTruthy();

    key('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a wrong login', () => { h.auth = { user_info: { auth: 0 } }; }, 'wrongLogin', 'That service said no. Check the username and password (or the link).'],
    ['an unreachable server', () => { h.authThrows = new Error('Unable to resolve host'); }, 'unreachable', "Couldn't reach that service. Check the address and your internet, then try again."],
    ['an expired line there', () => { h.auth = { user_info: { auth: 1, status: 'Expired' } }; }, 'inactive', 'That service says this login has expired or is turned off.'],
    ['no channels', () => { h.total = 0; }, 'empty', 'That service has no Live TV channels.'],
  ])('a failed test says why in plain words (%s), and Save stays shut', async (_l, set, id, words) => {
    set();
    await renderScreen();
    type('server', 'other.tv:8000');
    type('user', 'bob');
    type('pass', 'nope');
    goTo('test');
    key('Enter');
    await until(() => result() === id);
    expect(screen.getByRole('status').textContent).toBe(words);
    goTo('save');
    key('Enter');
    await settle();
    expect(result()).toBe('testFirst');
    expect(await loadOutsideSources()).toEqual([]);
  });

  it('refuses one of ours before asking anyone', async () => {
    await renderScreen();
    type('server', 'http://dstreams.xyz:8080');
    type('user', 'bob');
    type('pass', 'x');
    goTo('test');
    key('Enter');
    await until(() => result() === 'ours');
    expect(screen.getByRole('status').textContent).toBe("That's one of ours — add it from Switch Account.");
    expect(h.authCalls).toEqual([]);
    expect(focusedRow()).toBe('server');
  });

  it('M3U link: an Xtream get.php link pasted there is tested and saved as an Xtream login, and says so', async () => {
    await renderScreen();
    key('Enter'); // the kind row: Xtream login → M3U link
    expect(document.querySelector('[data-kind="m3u"]')?.getAttribute('data-selected')).toBe('true');
    expect(document.querySelector('[data-row="server"]')).toBeNull();
    type('url', 'http://other.tv:8000/get.php?username=bob&password=hunter22&type=m3u_plus&output=ts');
    goTo('test');
    key('Enter');
    await until(() => result() === 'works');
    expect(screen.getByRole('status').textContent).toContain("That's an Xtream link, so it's added as an Xtream login");
    key('Enter');
    await until(() => result() === 'saved');
    expect(await loadOutsideSources()).toMatchObject([{ kind: 'xtream', host: 'http://other.tv:8000', username: 'bob', name: 'other.tv' }]);
  });

  it('Edit: the password comes back empty, and left empty keeps the saved one for the same server', async () => {
    await renderScreen();
    type('server', 'other.tv:8000');
    type('user', 'bob');
    type('pass', 'hunter22');
    goTo('test');
    key('Enter');
    await until(() => result() === 'works');
    key('Enter');
    await until(() => result() === 'saved');
    h.authCalls = [];

    key('Enter'); // Edit
    await settle();
    expect(input('server').value).toBe('http://other.tv:8000');
    expect(input('user').value).toBe('bob');
    expect(input('pass').value).toBe('');
    type('name', 'Renamed');
    goTo('test');
    key('Enter');
    await until(() => result() === 'works');
    expect(h.authCalls[0].password).toBe('hunter22');
    key('Enter');
    await until(() => result() === 'saved');
    expect(await loadOutsideSources()).toMatchObject([{ name: 'Renamed', password: 'hunter22' }]);

    // Another server: the saved password is not sent to it.
    key('Enter'); // Edit
    await settle();
    type('server', 'elsewhere.tv');
    goTo('test');
    key('Enter');
    await until(() => result() === 'needLogin');
  });
});

describe('Add another service: a test of what the form holds now', () => {
  it('a field changed while the test runs: its answer is dropped, and Save stays shut', async () => {
    let release: () => void = () => {};
    h.hold = (r) => { release = r; };
    await renderScreen();
    type('server', 'other.tv:8000');
    type('user', 'bob');
    type('pass', 'hunter22');
    goTo('test');
    key('Enter');
    await until(() => h.authCalls.length === 1);
    type('pass', 'changed-meanwhile');
    h.hold = null;
    release();
    await settle(50);
    expect(result()).not.toBe('works');
    expect(document.querySelector('[data-row="save"]')?.getAttribute('data-ready')).toBe('false');
    goTo('save');
    key('Enter');
    await settle();
    expect(result()).toBe('testFirst');
    expect(await loadOutsideSources()).toEqual([]);
  });
});

describe('Add another service: tied to the line that added it', () => {
  it('added on another line on this box: shown without its details, and Edit starts empty', async () => {
    localStorage.setItem('snow-livetv-outside-sources-v1', JSON.stringify([{ ...OTHER, owner: VIBEZ_KEY }]));
    h.savedAccounts = [{ id: 'v', serverLabel: 'Vibez', host: 'https://strmz.xyz', username: 'me@mail.com', password: 'x', output: 'm3u8', addedAt: 1 }];
    await renderScreen();
    const card = document.querySelector('[data-outside-saved]')!;
    expect(card.textContent).toContain('Sports Box');
    expect(card.textContent).not.toContain('other.tv');
    expect(card.textContent).not.toContain('bob');
    expect(focusedRow()).toBe('edit');
    key('Enter');
    await settle();
    expect(input('server').value).toBe('');
    expect(input('user').value).toBe('');
    expect(input('name').value).toBe('');
  });

  it('added on a line no longer on this box: the reason, and only Remove', async () => {
    localStorage.setItem('snow-livetv-outside-sources-v1', JSON.stringify([{ ...OTHER, owner: VIBEZ_KEY }]));
    await renderScreen();
    expect(screen.getByText('Needs an active DreamStreams or Vibez line.')).toBeTruthy();
    expect(screen.getByText(/It was added on a line that isn't on this TV any more/)).toBeTruthy();
    expect(document.querySelector('[data-row="edit"]')).toBeNull();
    expect(focusedRow()).toBe('remove');
    key('Enter');
    await settle();
    key('Enter');
    await until(() => result() === 'removed');
    expect(await loadOutsideSources()).toEqual([]);
  });

  it('a line not checked with its panel for 3 days: not allowed (a check is asked for)', async () => {
    h.account = { ...ACTIVE, lastCheckedAt: Date.now() - 4 * 24 * 60 * 60 * 1000 };
    await renderScreen();
    expect(screen.getByText('Needs an active DreamStreams or Vibez line.')).toBeTruthy();
    expect(document.querySelector('[data-row="server"]')).toBeNull();
  });
});
