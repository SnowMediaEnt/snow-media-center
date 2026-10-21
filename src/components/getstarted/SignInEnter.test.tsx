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

describe('Vibez sign-in: Show / Hide password', () => {
  const setup = async () => {
    render(<VibezSignInScreen onDone={vi.fn()} onBack={vi.fn()} />);
    await raf();
    return {
      user: document.getElementById('vs-user') as HTMLInputElement,
      pass: document.getElementById('vs-pass') as HTMLInputElement,
      reveal: document.querySelector('[data-tv-focus-id="vs-pass-show"]') as HTMLButtonElement,
    };
  };

  it('starts as dots, flips to text and back keeping what was typed, and is dots again next time', async () => {
    const { pass, reveal } = await setup();
    expect(pass.type).toBe('password');
    expect(reveal.getAttribute('aria-label')).toBe('Show password');
    fireEvent.change(pass, { target: { value: 'secret' } });
    fireEvent.click(reveal);
    expect(pass.type).toBe('text');
    expect(pass.value).toBe('secret');
    expect(reveal.getAttribute('aria-pressed')).toBe('true');
    expect(reveal.textContent).toBe('Hide');
    expect(pass.getAttribute('autocorrect')).toBe('off');
    expect(pass.getAttribute('autocapitalize')).toBe('none');
    expect(pass.getAttribute('spellcheck')).toBe('false');
    fireEvent.click(reveal);
    expect(pass.type).toBe('password');
    expect(pass.value).toBe('secret');

    fireEvent.click(reveal);
    cleanup();
    const again = await setup();
    expect(again.pass.type).toBe('password');
  });

  it('a tap while typing keeps the field focused', async () => {
    const { pass, reveal } = await setup();
    act(() => { pass.focus(); });
    expect(fireEvent.mouseDown(reveal)).toBe(false);
    fireEvent.click(reveal);
    expect(document.activeElement).toBe(pass);
    expect(pass.type).toBe('text');
  });

  it('the remote: Right from the password, OK flips it, Left back; Done after the password still lands on Sign in', async () => {
    const { user, pass, reveal } = await setup();
    fireEvent.keyDown(user, { key: 'ArrowDown', keyCode: 40 });
    await flush();
    expect(document.activeElement).toBe(pass);
    fireEvent.keyDown(pass, { key: 'ArrowRight', keyCode: 39 });
    await flush();
    expect(document.activeElement).toBe(reveal);
    await later();
    fireEvent.keyDown(reveal, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(pass.type).toBe('text');
    fireEvent.keyDown(reveal, { key: 'ArrowDown', keyCode: 40 });
    await flush();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', keyCode: 38 });
    await flush();
    fireEvent.keyDown(pass, { key: 'ArrowRight', keyCode: 39 });
    await flush();
    fireEvent.keyDown(reveal, { key: 'ArrowLeft', keyCode: 37 });
    await flush();
    expect(document.activeElement).toBe(pass);

    // Typed in, then Done: Sign in, not the toggle.
    act(() => { pass.focus(); });
    fireEvent.input(pass, { target: { value: 'secret' } });
    await later();
    fireEvent.keyDown(pass, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(document.activeElement).not.toBe(reveal);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /sign in/i }));
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
