/**
 * Live TV › Settings › Account info by remote: the actions stand in a column,
 * so Up / Down walk Back -> Show password -> Change login -> Renew -> Sign out
 * (they used to be one row only Left / Right reached — owner, 2026-10-14).
 */
import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ demo: false }));
vi.mock('@/hooks/usePlayerAccount', () => ({
  usePlayerAccount: () => ({
    account: { host: 'http://h', username: 'jane', password: 'secret', serverLabel: 'Main', status: 'Active', expDate: null, createdAt: null, maxConnections: 2, activeCons: 0, isTrial: false },
    state: { severity: 'ok', show: false, label: '' },
    days: 30,
  }),
}));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('./RenewQR', () => ({ default: () => <div data-testid="renew-qr" /> }));
// The line's devices come from the server: stood in for.
const dev = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('./LineDevicesPanel', () => ({ default: (p: Record<string, unknown>) => { dev.props = p; return <div data-testid="line-devices" />; } }));

import AccountInfoScreen from './AccountInfoScreen';

const key = (k: string) => { act(() => { fireEvent.keyDown(window, { key: k }); }); };
const focused = (c: HTMLElement) => (c.querySelector('[data-focused="true"]')?.textContent ?? '').trim();

beforeEach(() => { h.demo = false; });

describe('Account info by remote', () => {
  it('Up and Down walk the column from Back to Sign out, stopping at the ends', () => {
    const onBack = vi.fn(); const onSignOut = vi.fn(); const onChange = vi.fn();
    const { container } = render(<AccountInfoScreen onBack={onBack} onSignOut={onSignOut} onChangeCredentials={onChange} />);
    expect(focused(container)).toMatch(/Show password/i);
    key('ArrowUp');
    expect(focused(container)).toMatch(/Back/i);
    key('ArrowUp'); // already at the top
    expect(focused(container)).toMatch(/Back/i);
    key('ArrowDown'); key('ArrowDown');
    expect(focused(container)).toMatch(/Change/i);
    key('ArrowDown');
    expect(focused(container)).toMatch(/Renew/i);
    key('ArrowDown');
    expect(focused(container)).toMatch(/Sign out/i);
    key('ArrowDown'); // already at the bottom: no wrap back to Back
    expect(focused(container)).toMatch(/Sign out/i);
    key('Enter');
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('the actions are a column beside the details; Left goes sideways to Back, Right has nothing to go to', () => {
    const { container } = render(<AccountInfoScreen onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    const column = container.querySelector('[data-account-actions]')!;
    expect(column.querySelectorAll('button')).toHaveLength(4); // Show password, Change login, Renew, Sign out
    key('ArrowDown'); key('ArrowDown');
    expect(focused(container)).toMatch(/Renew/i);
    key('ArrowRight');
    expect(focused(container)).toMatch(/Renew/i);
    key('ArrowLeft'); // owner, 2026-10-16: Left went up the column instead of sideways
    expect(focused(container)).toMatch(/Back/i);
  });

  it('Enter on Show password shows it; Back leaves', () => {
    const onBack = vi.fn();
    const { getByText } = render(<AccountInfoScreen onBack={onBack} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    key('Enter');
    expect(getByText('secret')).toBeTruthy();
    key('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('beside the Settings menu: no Back button, keys only while active, Left returns to the menu from any button', () => {
    const onBack = vi.fn();
    const { container, rerender } = render(<AccountInfoScreen embedded active={false} onBack={onBack} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    expect(container.textContent).not.toMatch(/^\s*Back/);
    key('ArrowDown');
    expect(focused(container)).toMatch(/Show password/i); // inactive: the menu has the remote
    rerender(<AccountInfoScreen embedded active onBack={onBack} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    key('ArrowUp'); // already at the top: no Back button to reach
    expect(focused(container)).toMatch(/Show password/i);
    key('ArrowDown'); key('ArrowDown');
    expect(focused(container)).toMatch(/Renew/i);
    key('ArrowLeft'); // straight out to the Settings menu, from any button
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('My Account: one Renew path', () => {
  const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-account-actions] button')).map((b) => b.textContent?.trim());

  it('billing off: Renew shows the renewal QR', () => {
    const { container, queryByTestId } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    expect(labels(container)).toEqual(['Show password', 'Change credentials', 'Renew', 'Sign out']);
    key('ArrowDown'); key('ArrowDown');
    key('Enter');
    expect(queryByTestId('renew-qr')).toBeTruthy();
  });

  it('billing on: Renew & plans takes Renew\'s place and opens the billing view (no QR, no second Renew)', () => {
    const onOpenBilling = vi.fn();
    const { container, queryByTestId } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} onOpenBilling={onOpenBilling} />);
    expect(labels(container)).toEqual(['Show password', 'Change credentials', 'Renew & plans', 'Sign out']);
    key('ArrowDown'); key('ArrowDown');
    expect(focused(container)).toBe('Renew & plans');
    key('Enter');
    expect(onOpenBilling).toHaveBeenCalledTimes(1);
    expect(queryByTestId('renew-qr')).toBeNull();
    // A tap does the same.
    act(() => { (container.querySelectorAll('[data-account-actions] button')[2] as HTMLElement).click(); });
    expect(onOpenBilling).toHaveBeenCalledTimes(2);
    expect(queryByTestId('renew-qr')).toBeNull();
  });
});

describe('My Account: Devices on this line, inside the page', () => {
  const LINE = { host: 'http://dstreams.xyz:8080', username: 'jsmith' };
  const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-account-actions] button')).map((b) => b.textContent?.trim());

  it('with the line: a button before Sign out that opens its devices in the page; Back returns to the button', () => {
    const onBack = vi.fn();
    const { container, queryByTestId } = render(<AccountInfoScreen embedded active onBack={onBack} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} devicesLine={LINE} />);
    expect(labels(container)).toEqual(['Show password', 'Change credentials', 'Renew', 'Devices on this line', 'Sign out']);
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(focused(container)).toBe('Devices on this line');
    key('Enter');
    expect(queryByTestId('line-devices')).toBeTruthy();
    expect(dev.props).toMatchObject({ host: LINE.host, username: 'jsmith', embedded: true, active: true, viaSupport: true });
    key('Escape'); // the devices panel owns the keys: this page doesn't leave
    expect(onBack).not.toHaveBeenCalled();
    act(() => { (dev.props!.onBack as () => void)(); });
    expect(queryByTestId('line-devices')).toBeNull();
    expect(focused(container)).toBe('Devices on this line');
    key('ArrowDown');
    expect(focused(container)).toBe('Sign out');
  });

  it('without a line: no Devices button', () => {
    const { container } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    expect(labels(container)).not.toContain('Devices on this line');
  });
});
