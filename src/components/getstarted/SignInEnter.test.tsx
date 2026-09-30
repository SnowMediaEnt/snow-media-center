/**
 * Vibez sign-in and the billing sign-in/register form: the keyboard's Done on
 * the password closes the keyboard and lands on the button, and never submits
 * (these used to be allow-enter fields, where the same Enter signed in).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ apply: vi.fn(), login: vi.fn(), register: vi.fn() }));

vi.mock('@/lib/billing', async (orig) => ({ ...(await orig<Record<string, unknown>>()), applyServiceToPlayer: h.apply }));
vi.mock('@/capacitor/SmcBilling', () => ({ SmcBilling: { login: h.login, register: h.register } }));
vi.mock('./pending', () => ({ clearPending: vi.fn(), readPending: () => null }));

import VibezSignInScreen from './VibezSignInScreen';
import BillingAuthForm from '@/components/billing/BillingAuthForm';

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const raf = async () => { await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); }); };
const later = async () => { await act(async () => { vi.advanceTimersByTime(1000); }); };
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('Vibez sign-in: Done on the password', () => {
  it('closes the keyboard, focuses Sign in, does not sign in', async () => {
    render(<VibezSignInScreen onDone={vi.fn()} onBack={vi.fn()} />);
    await raf();
    const user = document.getElementById('vs-user') as HTMLInputElement;
    const pass = document.getElementById('vs-pass') as HTMLInputElement;
    fireEvent.input(user, { target: { value: 'zg4471x' } });
    await later();
    fireEvent.keyDown(user, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(document.activeElement).toBe(pass);
    fireEvent.input(pass, { target: { value: 'secret' } });
    await later();
    const notPrevented = fireEvent.keyDown(pass, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(notPrevented).toBe(false);
    const submit = screen.getByRole('button', { name: /sign in/i });
    expect(document.activeElement).toBe(submit);
    expect(h.apply).not.toHaveBeenCalled();
  });
});

describe('Billing sign-in / register: Done on the password', () => {
  it('sign-in: closes the keyboard, focuses Sign in, does not sign in', async () => {
    render(<BillingAuthForm onSuccess={vi.fn()} onCancel={vi.fn()} />);
    await raf();
    const email = document.getElementById('ba-email') as HTMLInputElement;
    const pass = document.getElementById('ba-pass') as HTMLInputElement;
    fireEvent.input(email, { target: { value: 'jane@example.com' } });
    await later();
    fireEvent.keyDown(email, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(document.activeElement).toBe(pass);
    fireEvent.input(pass, { target: { value: 'secret123' } });
    await later();
    const notPrevented = fireEvent.keyDown(pass, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /sign in/i }));
    expect(h.login).not.toHaveBeenCalled();
  });

  it('register: password goes on to the name, the last field lands on Create', async () => {
    render(<BillingAuthForm initialMode="register" onSuccess={vi.fn()} onCancel={vi.fn()} />);
    await raf();
    const email = document.getElementById('ba-email') as HTMLInputElement;
    const pass = document.getElementById('ba-pass') as HTMLInputElement;
    const first = document.getElementById('ba-first') as HTMLInputElement;
    const last = document.getElementById('ba-last') as HTMLInputElement;
    fireEvent.input(email, { target: { value: 'jane@example.com' } });
    await later();
    fireEvent.keyDown(email, { key: 'Enter', keyCode: 13 });
    await flush();
    fireEvent.input(pass, { target: { value: 'secret123' } });
    await later();
    fireEvent.keyDown(pass, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(document.activeElement).toBe(first);
    fireEvent.input(first, { target: { value: 'Jane' } });
    await later();
    fireEvent.keyDown(first, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(document.activeElement).toBe(last);
    fireEvent.input(last, { target: { value: 'Doe' } });
    await later();
    fireEvent.keyDown(last, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(document.activeElement).toBe(document.querySelector('[data-tv-focus-id="ba-submit"]'));
    expect(h.register).not.toHaveBeenCalled();
  });
});
