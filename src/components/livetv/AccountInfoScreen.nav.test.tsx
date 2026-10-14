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

  it('the actions are a column beside the details, and Left / Right still move for anyone used to them', () => {
    const { container } = render(<AccountInfoScreen onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} />);
    const column = container.querySelector('[data-account-actions]')!;
    expect(column.querySelectorAll('button')).toHaveLength(4); // Show password, Change login, Renew, Sign out
    key('ArrowRight');
    expect(focused(container)).toMatch(/Change/i);
    key('ArrowLeft'); key('ArrowLeft');
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
});
