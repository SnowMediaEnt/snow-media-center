/**
 * A trial made but never handed over: the server made it, its answer didn't
 * reach the box ("Could not reach the billing server"), and the next try said
 * "Trial already used. Pick a plan instead." (a customer, 2026-10-19). The
 * account's own trial, still live, is handed over instead; a trial that has
 * ended is still "already used", and a failure with no trial made is still
 * said as that failure.
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingService } from '@/capacitor/SmcBilling';

const b = vi.hoisted(() => ({
  trialUsed: false,
  startTrial: vi.fn(),
  services: vi.fn(),
  poll: vi.fn(async (..._a: unknown[]): Promise<{ outcome: string; service?: unknown }> => ({ outcome: 'cancelled' })),
  applied: [] as unknown[],
}));

vi.mock('@/capacitor/SmcBilling', () => ({
  SmcBilling: {
    getState: async () => ({ signedIn: true }),
    me: async () => ({ client: { email: 'viewer@example.com', trial_used: b.trialUsed } }),
    startTrial: (...a: unknown[]) => b.startTrial(...a),
    services: (...a: unknown[]) => b.services(...a),
    pollServiceActive: (...a: unknown[]) => b.poll(...a),
    cancelPoll: async () => undefined,
  },
}));
vi.mock('@/lib/billing', async (orig) => ({
  ...(await orig<typeof import('@/lib/billing')>()),
  applyServiceToPlayer: async (c: unknown) => {
    b.applied.push(c);
    return { ok: true, creds: { host: 'http://line.test', username: 'trial-user', password: 'trial-pass', output: 'ts' } };
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: () => {} }), toast: () => {} }));

import TrialFlow from './TrialFlow';

const trial = (active: boolean, extra: Partial<BillingService> = {}): BillingService => ({
  id: 108,
  plan: { id: 1, name: 'DreamStreams 24-Hour Free Trial', cycle: null, term_months: 0, trial: true },
  status: active ? 'active' : 'terminated',
  active,
  connections: 1,
  amount: null,
  currency: 'USD',
  credentials: { host: 'http://line.test', username: 'trial-user', password: 'trial-pass' },
  expires_at: new Date(Date.now() + 20 * 3600_000).toISOString(),
  ...extra,
});
const paid: BillingService = { ...trial(true), id: 9, plan: { id: 2, name: 'Monthly', cycle: 'monthly', term_months: 1, trial: false } };

const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const until = async (fn: () => boolean) => { for (let i = 0; i < 200 && !fn(); i++) await settle(20); return fn(); };
const text = () => document.body.textContent ?? '';

beforeEach(() => {
  b.trialUsed = false;
  b.applied = [];
  b.startTrial.mockReset();
  b.services.mockReset();
  b.poll.mockReset();
  b.poll.mockResolvedValue({ outcome: 'cancelled' });
});

describe('the free trial: one already made for this account', () => {
  it('its own trial, still live: handed over (the line signed in), not "Trial already used"', async () => {
    b.trialUsed = true;
    b.services.mockResolvedValue({ services: [paid, trial(true)] });
    render(<TrialFlow onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(await until(() => b.applied.length > 0)).toBe(true);
    expect(b.applied[0]).toMatchObject({ username: 'trial-user' });
    expect(text()).not.toContain('Trial already used');
    expect(b.startTrial).not.toHaveBeenCalled();
  });

  it('a trial that has ended: still "Trial already used"', async () => {
    b.trialUsed = true;
    b.services.mockResolvedValue({ services: [trial(false)] });
    render(<TrialFlow onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(await until(() => text().includes('Trial already used'))).toBe(true);
    expect(b.applied).toEqual([]);
  });

  it('the server says "already used" to POST /trial: the account\'s live trial is handed over', async () => {
    b.startTrial.mockRejectedValue({ code: 'trial_already_used', data: { code: 'trial_already_used', status: 409 } });
    b.services.mockResolvedValue({ services: [trial(true)] });
    render(<TrialFlow onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(await until(() => b.applied.length > 0)).toBe(true);
  });

  it('"couldn\'t reach" on POST /trial while the server made it: found and handed over', async () => {
    b.startTrial.mockRejectedValue({ code: 'network', message: 'Failed to fetch' });
    b.services.mockResolvedValue({ services: [trial(true)] });
    render(<TrialFlow onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(await until(() => b.applied.length > 0)).toBe(true);
    expect(text()).not.toContain('Could not reach the billing server');
  });

  it('"couldn\'t reach" and no trial made: the failure is said as it was', async () => {
    b.startTrial.mockRejectedValue({ code: 'network', message: 'Failed to fetch' });
    b.services.mockResolvedValue({ services: [] });
    render(<TrialFlow onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(await until(() => text().includes('Could not reach the billing server'))).toBe(true);
    expect(b.applied).toEqual([]);
    expect(text()).not.toContain('Trial already used');
  });

  it('a trial whose day is over (WHMCS still says active): not handed over, "Trial already used"', async () => {
    b.trialUsed = true;
    b.services.mockResolvedValue({ services: [trial(true, { expires_at: new Date(Date.now() - 3600_000).toISOString() })] });
    render(<TrialFlow onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(await until(() => text().includes('Trial already used'))).toBe(true);
    expect(b.applied).toEqual([]);
  });

  it('a trial still being set up (its answer lost mid-way): waited for, then handed over', async () => {
    b.startTrial.mockRejectedValue({ code: 'network', message: 'Failed to fetch' });
    b.services.mockResolvedValue({ services: [trial(false, { status: 'pending', credentials: null })] });
    b.poll.mockResolvedValue({ outcome: 'active', service: trial(true) });
    render(<TrialFlow onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(await until(() => b.applied.length > 0)).toBe(true);
    expect(b.poll).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 108 }));
  });

  it('the account\'s services can\'t be read: the failure is said, never "Trial already used"', async () => {
    b.trialUsed = true;
    b.services.mockRejectedValue({ code: 'network', message: 'Failed to fetch' });
    render(<TrialFlow onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(await until(() => text().includes('Could not reach the billing server'))).toBe(true);
    expect(text()).not.toContain('Trial already used');
  });

  it('an error that is the server\'s own answer (rate limited): said at once, no look for a lost trial', async () => {
    b.startTrial.mockRejectedValue({ code: 'rate_limited', message: 'Too many tries', data: { code: 'rate_limited', status: 429 } });
    render(<TrialFlow onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(await until(() => /too many|try again/i.test(text()))).toBe(true);
    expect(b.services).not.toHaveBeenCalled();
  });
});
