/**
 * Live TV -> Settings laid out like Account info (owner, 2026-10-14): the menu
 * is a column on the left, the highlighted page sits on the right; OK / Right
 * move the remote into it, Back from the page returns to the menu.
 * Reorganized (owner, 2026-10-20): eight rows, each with its state under its
 * name: My Account, Services, Channels, Appearance, Recording & Rewind,
 * Player, Fix a problem, Sign out.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const billing = vi.hoisted(() => ({ on: false }));
vi.mock('@/hooks/useBillingEnabled', () => ({ useBillingEnabled: () => billing.on }));
// The state lines are computed in useHubStates (its own test): here, what the menu shows of them.
vi.mock('./useHubStates', () => ({
  useHubStates: () => ({
    account: 'Dreamstreams · expires Nov 19', services: '2 services', channels: '3 hidden · Favorites: my order',
    appearance: 'Compact · Slim rows', rewind: 'Rewind on · Recordings on this box', player: 'ExoPlayer',
    help: 'Buffering? Start here', signout: 'Signed in as jsmith',
  }),
}));
const tool = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]> }));
vi.mock('@/lib/appActions', () => ({ openSupportTool: (t: string, nav: unknown) => { tool.calls.push([t, nav]); } }));

// Each page is stood in for: what the menu hands it is what is tested here.
type PageProps = { embedded?: boolean; active?: boolean; onBack?: () => void } & Record<string, unknown>;
const pageProps = vi.hoisted(() => ({} as Record<string, PageProps>));
const stub = (name: string) => ({
  default: (p: PageProps) => {
    pageProps[name] = p;
    return <div data-testid={`page-${name}`} data-active={p.active ? 'yes' : 'no'} />;
  },
});
vi.mock('./AccountInfoScreen', () => stub('account'));
vi.mock('./ServicesScreen', () => stub('services'));
vi.mock('./ChannelsScreen', () => stub('channels'));
vi.mock('./AppearanceScreen', () => stub('appearance'));
vi.mock('./RewindSettingsScreen', () => stub('rewind'));
vi.mock('./PlaybackScreen', () => stub('player'));
vi.mock('./FixProblemScreen', () => stub('help'));
vi.mock('@/components/billing/BillingAccountScreen', () => stub('billingView'));

import SettingsHub from './SettingsHub';

const key = (k: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const settle = async (ms = 0) => { await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); }); };
const shownPage = (c: HTMLElement) => c.querySelector('[data-settings-page]')!;
const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-hub-label]')).map((n) => n.textContent);
const focusedRow = (c: HTMLElement) => c.querySelector('[data-hub-row][data-focused="true"]')?.getAttribute('data-hub-row');
/** Down to a row from the top (My Account), letting the page follow. */
const goTo = async (c: HTMLElement, id: string) => {
  for (let i = 0; i < 8 && focusedRow(c) !== id; i += 1) key('ArrowDown');
  expect(focusedRow(c)).toBe(id);
  await settle(300);
};

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); billing.on = false; tool.calls = []; for (const k of Object.keys(pageProps)) delete pageProps[k]; });
afterEach(() => { vi.useRealTimers(); });

const renderHub = (over: Partial<Parameters<typeof SettingsHub>[0]> = {}) => {
  const props = { onBack: vi.fn(), onSignOut: vi.fn(), onChangeCredentials: vi.fn(), onSwitchAccount: vi.fn(), ...over };
  const r = render(<SettingsHub {...props} />);
  return { ...r, props };
};

describe('Live TV Settings: the menu', () => {
  it('eight rows in the owner\'s order, each with its state in small text under its name', async () => {
    const { container } = renderHub();
    await settle();
    expect(labels(container)).toEqual(['My Account', 'Services', 'Channels', 'Appearance', 'Recording & Rewind', 'Player', 'Fix a problem', 'Sign Out']);
    const state = (id: string) => container.querySelector(`[data-hub-row="${id}"] [data-hub-state]`)?.textContent;
    expect(state('account')).toBe('Dreamstreams · expires Nov 19');
    expect(state('services')).toBe('2 services');
    expect(state('channels')).toBe('3 hidden · Favorites: my order');
    expect(state('appearance')).toBe('Compact · Slim rows');
    expect(state('rewind')).toBe('Rewind on · Recordings on this box');
    expect(state('player')).toBe('ExoPlayer');
    expect(state('help')).toBe('Buffering? Start here');
    expect(state('signout')).toBe('Signed in as jsmith');
    // The How-to guide's hooks.
    expect(['hub.services', 'hub.channels', 'hub.appearance', 'hub.rewind', 'hub.signOut'].map((h) => container.querySelector(`[data-howto="${h}"]`)?.getAttribute('data-hub-row')))
      .toEqual(['services', 'channels', 'appearance', 'rewind', 'signout']);
  });

  it('no row is gone missing: Devices on this line and Hide categories are inside pages now', async () => {
    const { container } = renderHub({ line: { host: 'http://dstreams.xyz:8080', username: 'jsmith' } });
    await settle();
    expect(labels(container)).toHaveLength(8);
    expect(labels(container)).not.toContain('Devices on this line');
    expect(labels(container)).not.toContain('Hide Categories');
  });
});

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
    expect(shownPage(container).querySelector('h2')?.textContent).toBe('Services');
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

  it('Sign out asks once: the first OK says "Press OK again", the second signs out; Right does not; Up from the first row reaches Back and Back on the menu leaves', async () => {
    const { container, props } = renderHub();
    await settle();
    for (let i = 0; i < 7; i++) key('ArrowDown');
    await settle(300);
    expect(focusedRow(container)).toBe('signout');
    expect(shownPage(container).textContent).toMatch(/sign/i); // the Sign out note
    key('ArrowRight');
    expect(props.onSignOut).not.toHaveBeenCalled();
    key('Enter');
    expect(props.onSignOut).not.toHaveBeenCalled();
    const state = () => container.querySelector('[data-hub-row="signout"] [data-hub-state]');
    expect(state()?.textContent).toBe('Press OK again to sign out');
    expect(shownPage(container).textContent).toContain('Press OK again to sign out');
    // Moving takes the question back.
    key('ArrowUp'); key('ArrowDown');
    expect(state()?.textContent).toBe('Signed in as jsmith');
    key('Enter');
    // Back takes it back too, and stays in Settings.
    key('Escape');
    expect(props.onBack).not.toHaveBeenCalled();
    expect(state()?.textContent).toBe('Signed in as jsmith');
    key('Enter'); key('Enter');
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 8; i++) key('ArrowUp');
    expect(container.querySelector('[data-focused="true"]')?.textContent).toMatch(/back/i);
    key('Escape');
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('opened on a page (the assistant\'s "open Appearance") starts with the remote in it', async () => {
    const { container } = renderHub({ initialView: 'appearance' });
    await settle();
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('appearance');
    expect(pageProps.appearance).toMatchObject({ embedded: true, active: true });
    act(() => { pageProps.appearance.onBack!(); });
    await settle();
    expect(focusedRow(container)).toBe('appearance');
  });

  it('a tap on a row with no page beside the menu (Sign out) while the remote is in a page hands the remote back to the menu', async () => {
    const { container, props } = renderHub();
    await settle();
    key('ArrowRight');
    await settle();
    expect(pageProps.account.active).toBe(true);
    const signOutRow = container.querySelector('[data-howto="hub.signOut"]') as HTMLElement;
    act(() => { signOutRow.click(); });
    await settle();
    expect(props.onSignOut).not.toHaveBeenCalled(); // the first tap asks
    expect(shownPage(container).getAttribute('data-settings-preview')).toBe('true'); // remote on the menu
    act(() => { signOutRow.click(); });
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
    key('Escape'); // the menu has the remote again: Back leaves
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

describe('Live TV Settings: by touch or air mouse', () => {
  it('a tap in the page beside the menu takes the remote into it (so a level opened by the tap gets the keys, and Back goes up one)', async () => {
    const { container, props } = renderHub();
    await settle();
    await goTo(container, 'channels');
    expect(pageProps.channels.active).toBe(false);
    act(() => { (screen.getByTestId('page-channels') as HTMLElement).click(); });
    await settle();
    expect(pageProps.channels.active).toBe(true);
    expect(shownPage(container).getAttribute('data-settings-preview')).toBe('false');
    // The page owns Back now: the hub doesn't leave.
    key('Escape');
    expect(props.onBack).not.toHaveBeenCalled();
  });

  it('a tap on a page with nothing to go into (Sign out\'s note) leaves the remote on the menu', async () => {
    const { container } = renderHub();
    await settle();
    await goTo(container, 'signout');
    act(() => { (shownPage(container) as HTMLElement).click(); });
    await settle();
    expect(shownPage(container).getAttribute('data-settings-preview')).toBe('true');
  });
});

describe('Live TV Settings: each page gets what it needs', () => {
  it('Services › Add › DreamStreams or Vibez line: the empty sign-in form when Live TV gives one, else the change-login form', async () => {
    const onAddLine = vi.fn();
    const { container, props, unmount } = renderHub({ onAddLine });
    await settle();
    await goTo(container, 'services');
    expect(pageProps.services.onAddAccount).toBe(onAddLine);
    unmount();
    const again = renderHub();
    await settle();
    await goTo(again.container, 'services');
    expect(pageProps.services.onAddAccount).toBe(again.props.onChangeCredentials);
    expect(props.onChangeCredentials).not.toHaveBeenCalled();
  });

  it('My Account: the line for Devices on this line (none without a line); Services: switching and adding', async () => {
    const line = { host: 'http://dstreams.xyz:8080', username: 'jsmith' };
    const { container, props, unmount } = renderHub({ line });
    await settle();
    expect(pageProps.account.devicesLine).toEqual(line);
    await goTo(container, 'services');
    expect(pageProps.services.onPicked).toBe(props.onSwitchAccount);
    expect(pageProps.services.onAddAccount).toBe(props.onChangeCredentials);
    unmount();
    renderHub();
    await settle();
    expect(pageProps.account.devicesLine).toBeNull();
  });

  it('Channels: Update channels is Live TV\'s own; opened on "channels" it has the remote', async () => {
    const onUpdateChannels = vi.fn();
    const { container } = renderHub({ onUpdateChannels, initialView: 'channels' });
    await settle();
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('channels');
    expect(pageProps.channels).toMatchObject({ active: true, onUpdateChannels });
  });

  it('Player is the old Playback page', async () => {
    const { container } = renderHub();
    await settle();
    await goTo(container, 'player');
    expect(screen.getByTestId('page-player')).toBeTruthy();
  });

  it('Fix a problem: the Buffering Guide, and Support\'s Speed test / Submit a Ticket through the Player\'s navigation', async () => {
    const onOpenBufferingGuide = vi.fn();
    const onNavigate = vi.fn();
    const { container } = renderHub({ onOpenBufferingGuide, onNavigate });
    await settle();
    await goTo(container, 'help');
    const page = pageProps.help as { onOpenBufferingGuide?: () => void; onOpenSupportTool?: (t: string) => void };
    expect(page.onOpenBufferingGuide).toBe(onOpenBufferingGuide);
    act(() => { page.onOpenSupportTool!('speedtest'); });
    act(() => { page.onOpenSupportTool!('tickets'); });
    expect(tool.calls).toEqual([['speedtest', onNavigate], ['tickets', onNavigate]]);
  });

  it('Fix a problem without a way out of the Player: no Support tools offered', async () => {
    const { container } = renderHub();
    await settle();
    await goTo(container, 'help');
    expect(pageProps.help.onOpenSupportTool).toBeUndefined();
  });
});

describe('Live TV Settings: My Account (the line and, with billing on, its plans and renewals)', () => {
  type AccountPage = { onOpenBilling?: () => void; active?: boolean; onBack?: () => void };

  it('billing off: one My Account row, the line\'s details, no way into billing', async () => {
    const { container } = renderHub();
    await settle();
    expect(labels(container).filter((l) => /account/i.test(l ?? ''))).toEqual(['My Account']);
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('account');
    expect(shownPage(container).querySelector('h2')?.textContent).toBe('My Account');
    expect((pageProps.account as AccountPage).onOpenBilling).toBeUndefined();
  });

  it('billing on: still one My Account row; its Renew & plans opens the billing view, and Back returns to the page', async () => {
    billing.on = true;
    const { container, props } = renderHub();
    await settle();
    expect(labels(container).filter((l) => /account/i.test(l ?? ''))).toEqual(['My Account']);
    key('Enter');
    await settle();
    const page = pageProps.account as AccountPage;
    expect(page.active).toBe(true);
    expect(typeof page.onOpenBilling).toBe('function');
    act(() => { page.onOpenBilling!(); });
    expect(await screen.findByTestId('page-billingView')).toBeTruthy();
    expect(container.querySelector('[data-settings-menu]')).toBeNull(); // drawn in place of the hub, as before
    // Using a billing service in the player switches Live TV's line.
    expect(pageProps.billingView.onUseInPlayer).toBe(props.onSwitchAccount);
    act(() => { pageProps.billingView.onBack!(); });
    await settle();
    expect(screen.queryByTestId('page-billingView')).toBeNull();
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('account');
    expect((pageProps.account as AccountPage).active).toBe(true); // one level back: the page, not the menu
    act(() => { pageProps.account.onBack!(); });
    await settle();
    expect(focusedRow(container)).toBe('account');
    expect(props.onBack).not.toHaveBeenCalled();
  });

  it('Renew for a line in the billing account: the billing view renewing it; Back lands on Renew', async () => {
    billing.on = true;
    const { container } = renderHub();
    await settle();
    key('Enter');
    await settle();
    act(() => { (pageProps.account as { onOpenBilling: (id?: number) => void }).onOpenBilling(42); });
    expect(await screen.findByTestId('page-billingView')).toBeTruthy();
    expect(pageProps.billingView.renewServiceId).toBe(42);
    act(() => { pageProps.billingView.onBack!(); });
    await settle();
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('account');
    expect(pageProps.account.initialFocus).toBe('renew');
  });

  it('Plans & billing: the billing view as it is; Back lands on Plans & billing', async () => {
    billing.on = true;
    renderHub();
    await settle();
    key('Enter');
    await settle();
    act(() => { (pageProps.account as { onOpenBilling: (id?: number) => void }).onOpenBilling(); });
    expect(await screen.findByTestId('page-billingView')).toBeTruthy();
    expect(pageProps.billingView.renewServiceId).toBeUndefined();
    act(() => { pageProps.billingView.onBack!(); });
    await settle();
    expect(pageProps.account.initialFocus).toBe('plans');
  });

  it('opened on billing (initialView "billing"): the billing view, whose Back lands on My Account', async () => {
    billing.on = true;
    const { container } = renderHub({ initialView: 'billing' });
    expect(await screen.findByTestId('page-billingView')).toBeTruthy();
    act(() => { pageProps.billingView.onBack!(); });
    await settle();
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('account');
    expect((pageProps.account as AccountPage).active).toBe(true);
  });
});
