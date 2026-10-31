/**
 * Live TV › Settings › Account info by remote: the actions stand in a column,
 * so Up / Down walk Back -> Show password -> Sign-in PIN -> Change login -> Renew -> Sign out
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
vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo, isHowtoCapture: () => false }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('./RenewQR', () => ({ default: () => <div data-testid="renew-qr" /> }));
// Is this line one of the billing account's services? (asked when Renew is pressed with billing on)
const bill = vi.hoisted(() => ({ serviceId: null as number | null, asked: [] as string[] }));
vi.mock('@/lib/billing', () => ({ renewableServiceForLine: async (u: string) => { bill.asked.push(u); return bill.serviceId; } }));
// The line's devices come from the server: stood in for.
const dev = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
// The line's sign-in PIN comes from the server (my-signin-pin): stood in for.
const pinReply = vi.hoisted(() => ({ value: { ok: true, pin: '1234567890' } as { ok: boolean; pin?: string; reason?: string }, asked: [] as unknown[] }));
vi.mock('@/lib/pinSignIn', async (orig) => ({
  ...(await orig<typeof import('@/lib/pinSignIn')>()),
  fetchMyPin: async (line: unknown) => { pinReply.asked.push(line); return pinReply.value; },
}));
vi.mock('./LineDevicesPanel', () => ({ default: (p: Record<string, unknown>) => { dev.props = p; return <div data-testid="line-devices" />; } }));

import AccountInfoScreen from './AccountInfoScreen';
import { markPinLine } from '@/lib/pinSignIn';

const key = (k: string) => { act(() => { fireEvent.keyDown(window, { key: k }); }); };
const focused = (c: HTMLElement) => (c.querySelector('[data-focused="true"]')?.textContent ?? '').trim();

beforeEach(() => { h.demo = false; bill.serviceId = null; bill.asked = []; pinReply.value = { ok: true, pin: '1234567890' }; pinReply.asked = []; });
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });

describe('Account info by remote', () => {
  it('Up and Down walk the column from Back to Sign out, stopping at the ends', () => {
    const onBack = vi.fn(); const onSignOut = vi.fn(); const onChange = vi.fn();
    const { container } = render(<AccountInfoScreen onBack={onBack} onSignOut={onSignOut} onChangeCredentials={onChange} />);
    expect(focused(container)).toMatch(/Show password/i);
    key('ArrowUp');
    expect(focused(container)).toMatch(/Back/i);
    key('ArrowUp'); // already at the top
    expect(focused(container)).toMatch(/Back/i);
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(focused(container)).toMatch(/Change/i);
    key('ArrowDown');
    expect(focused(container)).toMatch(/Renew/i);
    key('ArrowDown');
    expect(focused(container)).toMatch(/Sign out/i);
    key('ArrowDown'); // already at the bottom: no wrap back to Back
    expect(focused(container)).toMatch(/Sign out/i);
    key('Enter'); // asks first
    expect(onSignOut).not.toHaveBeenCalled();
    expect(focused(container)).toBe('Press OK again to sign out');
    key('Enter');
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('the actions are a column beside the details; Left goes sideways to Back, Right has nothing to go to', () => {
    const { container } = render(<AccountInfoScreen onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    const column = container.querySelector('[data-account-actions]')!;
    expect(column.querySelectorAll('button')).toHaveLength(5); // Show password, Sign-in PIN, Change login, Renew, Sign out
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
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
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(focused(container)).toMatch(/Renew/i);
    key('ArrowLeft'); // straight out to the Settings menu, from any button
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('My Account: one Renew, and Plans & billing', () => {
  const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-account-actions] button')).map((b) => b.textContent?.trim());

  it('billing off: Renew shows the renewal QR, without asking billing', async () => {
    const { container, queryByTestId } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    expect(labels(container)).toEqual(['Show password', 'Get my sign-in PIN', 'Change credentials', 'Renew', 'Sign out']);
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    key('Enter');
    await flush();
    expect(queryByTestId('renew-qr')).toBeTruthy();
    expect(bill.asked).toEqual([]);
  });

  it('billing on, this line one of the billing account\'s services: Renew renews it there (same label)', async () => {
    bill.serviceId = 42;
    const onOpenBilling = vi.fn();
    const { container, queryByTestId } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} onOpenBilling={onOpenBilling} />);
    expect(labels(container)).toEqual(['Show password', 'Get my sign-in PIN', 'Change credentials', 'Renew', 'Plans & billing', 'Sign out']);
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(focused(container)).toBe('Renew');
    key('Enter');
    await flush();
    expect(bill.asked).toEqual(['jane']);
    expect(onOpenBilling).toHaveBeenCalledWith(42);
    expect(queryByTestId('renew-qr')).toBeNull();
  });

  it('billing on, a line that isn\'t in the billing account (Vibez, a reseller line, no billing sign-in): Renew is the QR', async () => {
    bill.serviceId = null;
    const onOpenBilling = vi.fn();
    const { queryByTestId } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} onOpenBilling={onOpenBilling} />);
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    key('Enter');
    await flush();
    expect(onOpenBilling).not.toHaveBeenCalled();
    expect(queryByTestId('renew-qr')).toBeTruthy();
  });

  it('Plans & billing opens the billing view as it is (OK or a tap)', async () => {
    const onOpenBilling = vi.fn();
    const { container } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} onOpenBilling={onOpenBilling} />);
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(focused(container)).toBe('Plans & billing');
    key('Enter');
    expect(onOpenBilling).toHaveBeenCalledWith();
    act(() => { (container.querySelector('[data-action="plans"]') as HTMLElement).click(); });
    expect(onOpenBilling).toHaveBeenCalledTimes(2);
    expect(bill.asked).toEqual([]);
  });

  it('back from the billing view: the button that opened it has the highlight', () => {
    const { container } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} onOpenBilling={vi.fn()} initialFocus="plans" />);
    expect(focused(container)).toBe('Plans & billing');
  });

  it('billing turning on while the page is open: the highlight stays on its button', () => {
    const props = { embedded: true, active: true, onBack: vi.fn(), onSignOut: vi.fn(), onChangeCredentials: vi.fn() };
    const { container, rerender } = render(<AccountInfoScreen {...props} />);
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(focused(container)).toBe('Sign out');
    rerender(<AccountInfoScreen {...props} onOpenBilling={vi.fn()} />);
    expect(focused(container)).toBe('Sign out');
    expect(labels(container)).toContain('Plans & billing');
  });
});

describe('My Account: Sign out asks once', () => {
  it('the first OK asks; moving away or Back takes the question back; the second OK signs out', () => {
    const onSignOut = vi.fn();
    const onBack = vi.fn();
    const { container } = render(<AccountInfoScreen embedded active onBack={onBack} onSignOut={onSignOut} onChangeCredentials={vi.fn()} />);
    for (let i = 0; i < 5; i += 1) key('ArrowDown');
    expect(focused(container)).toBe('Sign out');
    key('Enter');
    expect(focused(container)).toBe('Press OK again to sign out');
    key('ArrowUp'); key('ArrowDown'); // moving takes it back
    expect(focused(container)).toBe('Sign out');
    key('Enter');
    key('Escape'); // Back takes it back, and stays
    expect(focused(container)).toBe('Sign out');
    expect(onBack).not.toHaveBeenCalled();
    key('Enter'); key('Enter');
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('by touch: two taps on Sign out', () => {
    const onSignOut = vi.fn();
    const { container } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={onSignOut} onChangeCredentials={vi.fn()} />);
    const btn = () => container.querySelector('[data-action="signout"]') as HTMLElement;
    act(() => { btn().click(); });
    expect(onSignOut).not.toHaveBeenCalled();
    expect(btn().textContent).toContain('Press OK again to sign out');
    act(() => { btn().click(); });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('My Account: Devices on this line, inside the page', () => {
  const LINE = { host: 'http://dstreams.xyz:8080', username: 'jsmith' };
  const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-account-actions] button')).map((b) => b.textContent?.trim());

  it('with the line: a button before Sign out that opens its devices in the page; Back returns to the button', () => {
    const onBack = vi.fn();
    const { container, queryByTestId } = render(<AccountInfoScreen embedded active onBack={onBack} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} devicesLine={LINE} />);
    expect(labels(container)).toEqual(['Show password', 'Get my sign-in PIN', 'Change credentials', 'Renew', 'Devices on this line', 'Sign out']);
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
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

  it('opened on its devices (Multi-Screen\'s "Message the other TVs on this line"): the devices first, Back to the Devices button', () => {
    const onBack = vi.fn();
    const { container, queryByTestId } = render(<AccountInfoScreen embedded active onBack={onBack} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} devicesLine={LINE} initialDevicesOpen />);
    expect(queryByTestId('line-devices')).toBeTruthy();
    expect(dev.props).toMatchObject({ host: LINE.host, username: 'jsmith', embedded: true, active: true });
    act(() => { (dev.props!.onBack as () => void)(); });
    expect(queryByTestId('line-devices')).toBeNull();
    expect(focused(container)).toBe('Devices on this line');
    expect(onBack).not.toHaveBeenCalled();
  });

  it('asked to open on its devices without a line: the page as usual', () => {
    const { queryByTestId, container } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} initialDevicesOpen />);
    expect(queryByTestId('line-devices')).toBeNull();
    expect(focused(container)).toBe('Show password');
  });

  it('without a line: no Devices button', () => {
    const { container } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    expect(labels(container)).not.toContain('Devices on this line');
  });
});

describe('My Account: the line\'s sign-in PIN', () => {
  const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-account-actions] button')).map((b) => b.textContent?.trim());

  it('asks for it with this line as the page opens, hidden until shown, then shows / hides it', async () => {
    const { container, getByText, queryByText } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    await flush();
    expect(pinReply.asked).toEqual([{ host: 'http://h', username: 'jane', password: 'secret' }]);
    expect(queryByText('12345 67890')).toBeNull();
    expect(container.textContent).toMatch(/Sign in with a PIN/);
    key('ArrowDown');
    expect(focused(container)).toBe('Show sign-in PIN');
    key('Enter');
    expect(getByText('12345 67890')).toBeTruthy();
    expect(focused(container)).toBe('Hide sign-in PIN');
    key('Enter');
    expect(queryByText('12345 67890')).toBeNull();
    expect(pinReply.asked).toHaveLength(1); // asked once
  });

  it('says why when it can\'t get one, and a press asks again', async () => {
    pinReply.value = { ok: false, reason: 'expired' };
    const { container } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    await flush();
    expect(container.textContent).toMatch(/renew it to get your PIN/);
    key('ArrowDown');
    expect(focused(container)).toBe('Get my sign-in PIN');
    key('Enter');
    await flush();
    expect(pinReply.asked).toHaveLength(2);
  });

  it('a line signed in with a PIN shows only the PIN: no username, no password, no Show password', async () => {
    markPinLine('http://h', 'jane', true);
    try {
      const { container, queryByText } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
      await flush();
      expect(labels(container)).not.toContain('Show password');
      expect(focused(container)).toBe('Show sign-in PIN');
      expect(queryByText('jane')).toBeNull();
      expect(container.textContent).not.toMatch(/secret/);
      expect(container.textContent).not.toMatch(/Username/);
    } finally {
      markPinLine('http://h', 'jane', false);
    }
  });

  it('not in the demo', () => {
    h.demo = true;
    const { container } = render(<AccountInfoScreen embedded active onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    expect(labels(container)).not.toContain('Get my sign-in PIN');
  });
});
