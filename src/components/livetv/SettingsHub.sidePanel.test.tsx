/**
 * Live TV -> Settings laid out like Account info (owner, 2026-10-14): the menu
 * is a column on the left, the highlighted page sits on the right; OK / Right
 * move the remote into it, Back from the page returns to the menu.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useBillingEnabled', () => ({ useBillingEnabled: () => false }));

// Each page is stood in for: what the menu hands it is what is tested here.
const pageProps = vi.hoisted(() => ({} as Record<string, { embedded?: boolean; active?: boolean; onBack?: () => void }>));
const stub = (name: string) => ({
  default: (p: { embedded?: boolean; active?: boolean; onBack?: () => void }) => {
    pageProps[name] = p;
    return <div data-testid={`page-${name}`} data-active={p.active ? 'yes' : 'no'} />;
  },
});
vi.mock('./AccountInfoScreen', () => stub('account'));
vi.mock('./ServicesScreen', () => stub('services'));
vi.mock('./HideCategoriesScreen', () => stub('categories'));
vi.mock('./AppearanceScreen', () => stub('appearance'));
vi.mock('./RewindSettingsScreen', () => stub('rewind'));
vi.mock('./PlaybackScreen', () => stub('playback'));

import SettingsHub from './SettingsHub';

const key = (k: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const settle = async (ms = 0) => { await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); }); };
const shownPage = (c: HTMLElement) => c.querySelector('[data-settings-page]')!;

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); for (const k of Object.keys(pageProps)) delete pageProps[k]; });
afterEach(() => { vi.useRealTimers(); });

const renderHub = (over: Partial<Parameters<typeof SettingsHub>[0]> = {}) => {
  const props = { onBack: vi.fn(), onSignOut: vi.fn(), onChangeCredentials: vi.fn(), onSwitchAccount: vi.fn(), ...over };
  const r = render(<SettingsHub {...props} />);
  return { ...r, props };
};

describe('Live TV Settings: menu on the left, the page on the right', () => {
  it('shows the highlighted row\'s page beside the menu, inactive, following the highlight once it rests', async () => {
    const { container } = renderHub();
    await settle();
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('account');
    expect(shownPage(container).getAttribute('data-settings-preview')).toBe('true');
    expect(await screen.findByTestId('page-account')).toBeTruthy();
    expect(pageProps.account).toMatchObject({ embedded: true, active: false });
    key('ArrowDown');
    await settle(100);
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('account'); // not yet: still moving
    await settle(300);
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('services');
  });

  it('OK or Right moves the remote into the page; Back from the page returns to the menu', async () => {
    const { container, props } = renderHub();
    await settle();
    key('ArrowRight');
    await settle();
    expect(pageProps.account.active).toBe(true);
    expect(shownPage(container).getAttribute('data-settings-preview')).toBe('false');
    // The menu does not move while the remote is in the page.
    key('ArrowDown');
    await settle(400);
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('account');
    act(() => { pageProps.account.onBack!(); });
    await settle();
    expect(pageProps.account.active).toBe(false);
    expect(props.onBack).not.toHaveBeenCalled();
    key('ArrowDown'); await settle(300);
    key('Enter'); await settle();
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('services');
    expect(pageProps.services.active).toBe(true);
  });

  it('Sign Out: OK signs out, Right does not; Up from the first row reaches Back and Back on the menu leaves', async () => {
    const { container, props } = renderHub();
    await settle();
    for (let i = 0; i < 6; i++) key('ArrowDown');
    await settle(300);
    expect(shownPage(container).textContent).toMatch(/sign/i); // the Sign Out note
    key('ArrowRight');
    expect(props.onSignOut).not.toHaveBeenCalled();
    key('Enter');
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 7; i++) key('ArrowUp');
    expect(container.querySelector('[data-focused="true"]')?.textContent).toMatch(/back/i);
    key('Escape');
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('opened on a page (the assistant\'s "open Appearance") starts with the remote in it', async () => {
    const { container } = renderHub({ initialView: 'appearance' as never });
    await settle();
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('appearance');
    expect(pageProps.appearance).toMatchObject({ embedded: true, active: true });
  });

  it('a tap on a row with no page beside the menu (Sign Out) while the remote is in a page hands the remote back to the menu', async () => {
    const { container, props } = renderHub();
    await settle();
    key('ArrowRight');
    await settle();
    expect(pageProps.account.active).toBe(true);
    const signOutRow = container.querySelector('[data-howto="hub.signOut"]') as HTMLElement;
    act(() => { signOutRow.click(); });
    await settle();
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
    expect(shownPage(container).getAttribute('data-settings-preview')).toBe('true'); // remote on the menu
    key('Escape'); // the menu has the remote again: Back leaves
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('Switch Account and Add another service are one row, "Add service", beside the menu like the others', async () => {
    const { container, props } = renderHub();
    await settle();
    const labels = Array.from(container.querySelectorAll('[data-settings-menu] > div')).map((n) => n.textContent);
    expect(labels).toEqual(['Account Info', 'Add service', 'Hide Categories', 'Appearance', 'Rewind & recording', 'Playback', 'Sign Out']);
    expect(container.querySelector('[data-howto="hub.services"]')?.textContent).toBe('Add service');
    key('ArrowDown');
    await settle(300);
    expect(shownPage(container).querySelector('h2')?.textContent).toBe('Add service');
    expect(pageProps.services).toMatchObject({ active: false });
    key('Enter');
    await settle();
    expect(pageProps.services.active).toBe(true);
    // Switching a line and adding one are the hub's own callbacks.
    const p = pageProps.services as unknown as { onPicked: unknown; onAddAccount: unknown };
    expect(p.onPicked).toBe(props.onSwitchAccount);
    expect(p.onAddAccount).toBe(props.onChangeCredentials);
  });

  it('opened on Add service (initialView "services") starts with the remote in it', async () => {
    const { container } = renderHub({ initialView: 'services' as never });
    await settle();
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('services');
    expect(pageProps.services).toMatchObject({ active: true });
    act(() => { pageProps.services.onBack!(); });
    await settle();
    expect(pageProps.services.active).toBe(false);
    expect(container.querySelector('[data-focused="true"]')?.textContent).toBe('Add service');
  });
});
