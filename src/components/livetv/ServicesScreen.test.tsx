/**
 * Live TV › Settings › Services (ServicesScreen): Switch Account and Add
 * another service in one page (owner, 2026-10-20). Your services lists every
 * DreamStreams / Vibez line on the box (the one in use marked; OK on another
 * switches to it) and the outside service with its state (OK opens its Edit /
 * Remove, it is never switched to). Add another service asks which kind: a
 * line (the sign-in form) or another provider (its form), the latter only
 * when allowed and there is room. Back leaves one layer at a time. The
 * panels are mocked: nothing leaves the test.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  creds: null as null | Record<string, unknown>,
  account: null as null | Record<string, unknown>,
  savedAccounts: [] as unknown[],
  /** authenticateRouted's answer (null: it throws). */
  auth: null as null | Record<string, unknown>,
  authCalls: [] as Array<[string, string]>,
  toasts: [] as Array<{ title?: string; description?: string }>,
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => h.creds,
  loadPlayerAccount: async () => h.account,
  loadSavedAccounts: async () => h.savedAccounts,
  authenticateRouted: async (u: string, p: string) => {
    h.authCalls.push([u, p]);
    if (!h.auth) throw new Error('no panel in tests');
    return h.auth;
  },
  saveCreds: async () => {},
  savePlayerAccount: async () => {},
  upsertSavedAccount: async () => {},
}));
vi.mock('@/lib/playerSigninCapture', () => ({ capturePlayerSignin: async () => {} }));
vi.mock('@/lib/analytics', () => ({ trackEvent: () => {} }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: (x: { title?: string }) => { h.toasts.push(x); } }), toast: () => {} }));
// The other provider's form never reaches a server here.
vi.mock('@/lib/directHttp', () => ({ contentLength: async () => null, directGet: async () => { throw new Error('no requests in tests'); } }));

import ServicesScreen from './ServicesScreen';
import { __resetOutsideForTests } from '@/lib/outsideSource';

const DS = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8', serverLabel: 'Dreamstreams' };
const VIBEZ = { host: 'https://strmz.xyz', username: 'me@mail.com', password: 'x', output: 'm3u8', serverLabel: 'Vibez' };
const saved = (c: typeof DS, addedAt: number) => ({ id: `${c.host}::${c.username}`, serverLabel: c.serverLabel, host: c.host, username: c.username, password: c.password, output: c.output, addedAt });
const ACTIVE = { serverLabel: 'Dreamstreams', host: DS.host, username: 'jsmith', password: 'pw', output: 'm3u8', expDate: null, status: 'Active', isTrial: false, maxConnections: 2, activeCons: 0, createdAt: null, lastCheckedAt: Date.now() };
const OTHER = { id: 'x:other.tv|bob', kind: 'xtream', name: 'Sports Box', host: 'http://other.tv:8000', username: 'bob', password: 'hunter22', addedAt: 1 };
const keepOutside = (owner: string) => localStorage.setItem('snow-livetv-outside-sources-v1', JSON.stringify([{ ...OTHER, owner }]));

const key = (k: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 10; i += 1) await Promise.resolve(); }); };
const until = async (cond: () => boolean) => {
  await settle();
  for (let i = 0; i < 400 && !cond(); i += 1) await settle(10);
  expect(cond()).toBe(true);
};
const page = () => document.querySelector('[data-services-screen]')?.getAttribute('data-services-screen');
const rows = () => Array.from(document.querySelectorAll('[data-row]')).map((n) => n.getAttribute('data-row'));
const focusedRow = () => document.querySelector('[data-row][data-focused="true"]')?.getAttribute('data-row');
const row = (id: string) => document.querySelector(`[data-row="${id}"]`) as HTMLElement;
const goTo = (id: string) => {
  for (let i = 0; i < 10 && focusedRow() !== id; i += 1) key('ArrowDown');
  if (focusedRow() !== id) for (let i = 0; i < 10 && focusedRow() !== id; i += 1) key('ArrowUp');
  expect(focusedRow()).toBe(id);
};
const DS_ROW = `line:${DS.host}::jsmith`;
const VIBEZ_ROW = `line:${VIBEZ.host}::me@mail.com`;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  __resetOutsideForTests();
  h.creds = { ...DS };
  h.account = { ...ACTIVE };
  h.savedAccounts = [saved(DS, 1), saved(VIBEZ, 2)];
  h.auth = null;
  h.authCalls = [];
  h.toasts = [];
});
afterEach(() => { vi.useRealTimers(); });

const renderScreen = async (active = true) => {
  const props = { onBack: vi.fn(), onPicked: vi.fn(), onAddAccount: vi.fn() };
  let unmount = () => {};
  await act(async () => { ({ unmount } = render(<ServicesScreen {...props} active={active} />)); });
  await until(() => page() === 'list' && rows().length > 0);
  return { ...props, unmount };
};

describe('Services: your services', () => {
  it('lists every line on the box (the one in use marked), then the outside service with its tag and state, then Add', async () => {
    keepOutside('dstreams.xyz|jsmith');
    await renderScreen();
    expect(rows()).toEqual([DS_ROW, VIBEZ_ROW, 'outside', 'add']);
    expect(focusedRow()).toBe(DS_ROW);
    expect(row(DS_ROW).textContent).toContain('jsmith');
    expect(row(DS_ROW).querySelector('[data-watching-now]')?.textContent).toBe('Watching now');
    expect(row(VIBEZ_ROW).textContent).toContain('Vibez');
    expect(row(VIBEZ_ROW).querySelector('[data-watching-now]')).toBeNull();
    const out = row('outside');
    expect(out.getAttribute('data-outside-state')).toBe('on');
    expect(out.textContent).toContain('Sports Box');
    expect(out.textContent).toContain('Outside');
    expect(out.textContent).toContain('On: its channels are in Live TV beside yours.');
    expect(out.textContent).toContain("You don't switch to it: it plays alongside your line. OK to edit or remove.");
    // No login of the other provider on this page.
    expect(document.body.innerHTML).not.toContain('hunter22');
    expect(document.body.innerHTML).not.toContain('other.tv');
  });

  it('OK on another line switches to it (it signs in again first)', async () => {
    h.auth = { ok: true, creds: { ...VIBEZ }, server: { label: 'Vibez' }, userInfo: { status: 'Active' } };
    const props = await renderScreen();
    goTo(VIBEZ_ROW);
    expect(row(VIBEZ_ROW).textContent).toContain('OK switches to it');
    key('Enter');
    await until(() => props.onPicked.mock.calls.length === 1);
    expect(h.authCalls).toEqual([['me@mail.com', 'x']]);
    expect(props.onPicked).toHaveBeenCalledWith(expect.objectContaining({ host: VIBEZ.host, username: 'me@mail.com' }));
    expect(h.toasts.map((x) => x.title)).toEqual(['Account switched']);
  });

  it('a line whose sign-in fails: says so, and nothing is switched', async () => {
    h.auth = { ok: false, error: 'Login refused.' };
    const props = await renderScreen();
    goTo(VIBEZ_ROW);
    key('Enter');
    await until(() => h.toasts.length === 1);
    expect(h.toasts[0]).toMatchObject({ title: 'Could not switch account', description: 'Login refused.' });
    expect(props.onPicked).not.toHaveBeenCalled();
  });

  it('OK on the line in use hands it straight back (Settings closes), without signing in again', async () => {
    const props = await renderScreen();
    expect(focusedRow()).toBe(DS_ROW);
    key('Enter');
    await until(() => props.onPicked.mock.calls.length === 1);
    expect(props.onPicked).toHaveBeenCalledWith(expect.objectContaining({ host: DS.host, username: 'jsmith' }));
    expect(h.authCalls).toEqual([]);
  });

  it('OK on the outside service opens its Edit / Remove; Back returns to the list on it, and Back again leaves', async () => {
    keepOutside('dstreams.xyz|jsmith');
    const props = await renderScreen();
    goTo('outside');
    key('Enter');
    await until(() => !!document.querySelector('[data-outside-saved]') && focusedRow() === 'edit');
    expect(page()).toBeUndefined(); // the provider's own page, in place of the list
    expect(rows()).toEqual(['edit', 'remove']);
    key('Escape');
    await until(() => page() === 'list');
    expect(focusedRow()).toBe('outside');
    expect(props.onBack).not.toHaveBeenCalled();
    key('Escape');
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('the outside service hidden: says why (the line is not active, or its line is not on this TV)', async () => {
    keepOutside('dstreams.xyz|jsmith');
    h.account = { ...ACTIVE, status: 'Expired' };
    const first = await renderScreen();
    expect(row('outside').getAttribute('data-outside-state')).toBe('line');
    expect(row('outside').textContent).toContain("Hidden: your DreamStreams or Vibez line isn't active.");
    first.unmount();

    keepOutside('gone.example|someone');
    h.account = { ...ACTIVE };
    await renderScreen();
    expect(row('outside').getAttribute('data-outside-state')).toBe('owner');
    expect(row('outside').textContent).toContain("Hidden: it was added on a line that isn't on this TV.");
  });
});

describe('Services: Add another service', () => {
  it('asks which kind; "DreamStreams or Vibez line" opens the sign-in form', async () => {
    const props = await renderScreen();
    goTo('add');
    key('Enter');
    await settle();
    expect(page()).toBe('kind');
    expect(screen.getByText('What would you like to add?')).toBeTruthy();
    expect(rows()).toEqual(['kind:line', 'kind:outside']);
    expect(focusedRow()).toBe('kind:line');
    expect(row('kind:line').textContent).toContain('DreamStreams or Vibez line');
    expect(row('kind:outside').textContent).toContain('Another provider');
    key('Enter');
    expect(props.onAddAccount).toHaveBeenCalledTimes(1);
  });

  it('"Another provider" opens its form (Xtream login / M3U link, Test, Save); Back steps back one layer at a time', async () => {
    const props = await renderScreen();
    goTo('add');
    key('Enter');
    await settle();
    key('ArrowDown');
    expect(focusedRow()).toBe('kind:outside');
    key('Enter');
    await until(() => !!document.querySelector('[data-row="server"]'));
    expect(rows()).toEqual(['kind', 'server', 'user', 'pass', 'name', 'test', 'save']);
    expect(focusedRow()).toBe('kind');
    // The form → the kind question → the list (on Add) → the Settings menu.
    key('Escape');
    await until(() => page() === 'kind');
    expect(focusedRow()).toBe('kind:outside');
    key('ArrowLeft');
    await settle();
    expect(page()).toBe('list');
    expect(focusedRow()).toBe('add');
    expect(props.onBack).not.toHaveBeenCalled();
    key('Escape');
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('"Another provider" is not offered without an active line: it says why', async () => {
    h.account = { ...ACTIVE, status: 'Expired' };
    await renderScreen();
    goTo('add');
    key('Enter');
    await settle();
    expect(rows()).toEqual(['kind:line']);
    const why = document.querySelector('[data-kind-outside-blocked]')!;
    expect(why.getAttribute('data-kind-outside-blocked')).toBe('needsLine');
    expect(why.textContent).toContain('Needs an active DreamStreams or Vibez line.');
    key('ArrowDown');
    expect(focusedRow()).toBe('kind:line');
  });

  it('"Another provider" is not offered when one is saved already: it says to remove that one', async () => {
    keepOutside('dstreams.xyz|jsmith');
    await renderScreen();
    goTo('add');
    key('Enter');
    await settle();
    expect(rows()).toEqual(['kind:line']);
    const why = document.querySelector('[data-kind-outside-blocked]')!;
    expect(why.getAttribute('data-kind-outside-blocked')).toBe('full');
    expect(why.textContent).toContain('You already have one other provider. Remove it to add a different one.');
  });

  it('with nothing else signed in (one line, no outside service) the page leads with Add another service', async () => {
    h.savedAccounts = [saved(DS, 1)];
    await renderScreen();
    expect(rows()).toEqual(['add', DS_ROW]);
    expect(focusedRow()).toBe('add');
    expect(row(DS_ROW).querySelector('[data-watching-now]')).toBeTruthy();
    key('ArrowDown');
    expect(focusedRow()).toBe(DS_ROW);
  });

  it('the line in use is listed even when it was never saved as an account', async () => {
    h.savedAccounts = [];
    await renderScreen();
    expect(rows()).toEqual(['add', DS_ROW]);
    expect(row(DS_ROW).textContent).toContain('DreamStreams');
  });
});

describe('Services: the remote', () => {
  it('while the remote is on the Settings menu the page takes no keys and shows no highlight', async () => {
    const props = await renderScreen(false);
    expect(focusedRow()).toBeUndefined();
    key('Enter');
    key('Escape');
    await settle();
    expect(props.onPicked).not.toHaveBeenCalled();
    expect(props.onBack).not.toHaveBeenCalled();
  });

  it('Up / Down stop at the ends; Left on the list goes back to the menu', async () => {
    const props = await renderScreen();
    key('ArrowUp');
    expect(focusedRow()).toBe(DS_ROW);
    for (let i = 0; i < 5; i += 1) key('ArrowDown');
    expect(focusedRow()).toBe('add');
    key('ArrowLeft');
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});
