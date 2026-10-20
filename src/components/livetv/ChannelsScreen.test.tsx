/**
 * Live TV › Settings › Channels (owner, 2026-10-20): Hide categories (opened
 * in the page), Favorites order (the same choice as Sort my way / Sort A–Z),
 * the failover switch moved here from Playback (only with more than one
 * line), and Update channels (Live TV's own). Back goes up one level.
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ savedAccounts: [] as unknown[], hide: null as null | { active?: boolean; onBack: () => void } }));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => h.savedAccounts,
}));
// Hide categories reads every line's categories from its server: stood in for.
vi.mock('./HideCategoriesScreen', () => ({
  default: (p: { active?: boolean; onBack: () => void }) => { h.hide = p; return <div data-testid="hide-categories" />; },
}));

import ChannelsScreen from './ChannelsScreen';
import { loadFavOrder, saveFavOrder } from '@/lib/favoritesOrder';

const key = (k: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const wait = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
const rows = () => Array.from(document.querySelectorAll('[data-row]')).map((n) => n.getAttribute('data-row'));
const focusedRow = () => document.querySelector('[data-row][data-focused="true"]')?.getAttribute('data-row');
const row = (id: string) => document.querySelector(`[data-row="${id}"]`) as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  h.savedAccounts = [];
  h.hide = null;
});

const renderPage = async (over: Partial<Parameters<typeof ChannelsScreen>[0]> = {}) => {
  const props = { onBack: vi.fn(), onUpdateChannels: vi.fn(), ...over };
  const r = render(<ChannelsScreen active {...props} />);
  await wait();
  return { ...r, props };
};

describe('Settings › Channels', () => {
  it('one line: Hide categories, Favorites order, Update channels (no failover switch)', async () => {
    await renderPage();
    expect(rows()).toEqual(['hide', 'favs', 'update']);
    expect(focusedRow()).toBe('hide');
    expect(row('update').textContent).toContain('Update Channels');
  });

  it('Hide categories opens in the page; Back returns to it on that row, and Back again leaves', async () => {
    const { props } = await renderPage();
    key('Enter');
    expect(screen.getByTestId('hide-categories')).toBeTruthy();
    expect(h.hide?.active).toBe(true);
    key('Escape'); // Hide categories owns the keys now: nothing here moves
    expect(props.onBack).not.toHaveBeenCalled();
    act(() => { h.hide!.onBack(); });
    expect(screen.queryByTestId('hide-categories')).toBeNull();
    expect(focusedRow()).toBe('hide');
    key('Escape');
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('Favorites order: OK switches My order ⇄ A–Z, the same setting as the channel menu\'s Sort, keeping the own order', async () => {
    saveFavOrder({ mode: 'mine', keys: [{ line: 'l', id: 7, name: 'Seven' }] });
    await renderPage();
    key('ArrowDown');
    expect(focusedRow()).toBe('favs');
    expect(row('favs').getAttribute('data-fav-mode')).toBe('mine');
    key('Enter');
    expect(loadFavOrder()).toEqual({ mode: 'az', keys: [{ line: 'l', id: 7, name: 'Seven' }] });
    expect(row('favs').getAttribute('data-fav-mode')).toBe('az');
    // Changed from the channel menu: the page follows.
    act(() => { saveFavOrder({ ...loadFavOrder(), mode: 'mine' }); });
    expect(row('favs').getAttribute('data-fav-mode')).toBe('mine');
  });

  it('more than one line: the failover switch is here, on by default; OK turns it off and it is remembered', async () => {
    localStorage.setItem('smc-live-line-count-v1', '2');
    await renderPage();
    expect(rows()).toEqual(['hide', 'favs', 'failover', 'update']);
    expect(row('failover').textContent).toContain('When a channel is down, play it from my other service');
    expect(row('failover').getAttribute('data-on')).toBe('true');
    key('ArrowDown'); key('ArrowDown');
    expect(focusedRow()).toBe('failover');
    key('Enter');
    expect(row('failover').getAttribute('data-on')).toBe('false');
    expect(localStorage.getItem('smc-live-failover-v1')).toBe('0');
  });

  it('two saved accounts, before Live TV has counted: the switch is there too', async () => {
    const acc = (host: string, username: string) => ({ id: host, serverLabel: 'X', host, username, password: 'pw', output: 'm3u8', addedAt: 1 });
    h.savedAccounts = [acc('http://a.test', 'one'), acc('http://b.test', 'two')];
    await renderPage();
    expect(rows()).toContain('failover');
  });

  it('Update channels is Live TV\'s own; Up / Down stop at the ends; Left leaves', async () => {
    const { props } = await renderPage();
    for (let i = 0; i < 5; i += 1) key('ArrowDown');
    expect(focusedRow()).toBe('update');
    key('Enter');
    expect(props.onUpdateChannels).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i += 1) key('ArrowUp');
    expect(focusedRow()).toBe('hide');
    key('ArrowLeft');
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('while the remote is on the Settings menu: no keys, no highlight', async () => {
    const onBack = vi.fn();
    render(<ChannelsScreen active={false} onBack={onBack} onUpdateChannels={vi.fn()} />);
    await wait();
    expect(focusedRow()).toBeUndefined();
    key('Enter'); key('Escape');
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.queryByTestId('hide-categories')).toBeNull();
  });
});
