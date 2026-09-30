/**
 * The Snow Media account sign-in on an Android TV box: the keyboard's action
 * key. Email -> Continue; password -> Sign in (keyboard closed, highlighted,
 * nothing submitted); on sign-up, name -> password -> confirm -> Create.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  signIn: vi.fn(async () => ({ error: { message: 'no' } })),
  signUp: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), resetPasswordForEmail: vi.fn() },
    functions: { invoke: h.invoke },
  },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signIn: h.signIn, signUp: h.signUp, user: null }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/playerLogin', () => ({
  signInWithPlayerCredentials: vi.fn(async () => ({ ok: false, reason: 'error' })),
  looksLikeEmail: (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s),
}));

import Auth from './Auth';

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const enter = (el: Element, key = 'Enter', keyCode = 13) => fireEvent.keyDown(el, { key, keyCode });
const later = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 800)); }); };

afterEach(() => { cleanup(); h.signIn.mockClear(); h.signUp.mockClear(); h.invoke.mockReset(); });

const toPasswordStep = async () => {
  h.invoke.mockResolvedValue({ data: { exists: 'app' }, error: null });
  render(<MemoryRouter><Auth /></MemoryRouter>);
  const email = document.getElementById('auth-email') as HTMLInputElement;
  fireEvent.change(email, { target: { value: 'jane@example.com' } });
  fireEvent.click(document.getElementById('auth-continue')!);
  await flush();
  return document.getElementById('login-password') as HTMLInputElement;
};

describe('Auth sign-in: the keyboard action key', () => {
  it('Enter in the email field closes the keyboard and lands on Continue without continuing', async () => {
    render(<MemoryRouter><Auth /></MemoryRouter>);
    const email = document.getElementById('auth-email') as HTMLInputElement;
    const cont = document.getElementById('auth-continue') as HTMLButtonElement;
    act(() => { email.focus(); });
    fireEvent.change(email, { target: { value: 'jane@example.com' } });
    enter(email);
    await flush();
    expect(document.activeElement).toBe(cont);
    expect(cont.className).toContain('ring-white/60'); // highlighted for the remote
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('Enter in the password field blurs it, focuses Sign in and does not submit', async () => {
    const pass = await toPasswordStep();
    const submit = document.getElementById('login-submit') as HTMLButtonElement;
    act(() => { pass.focus(); });
    fireEvent.change(pass, { target: { value: 'secret' } });
    const notPrevented = enter(pass);
    await flush();
    expect(notPrevented).toBe(false);
    expect(document.activeElement).not.toBe(pass);
    expect(document.activeElement).toBe(submit);
    expect(submit.className).toContain('ring-white/60');
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it.each(['Go', 'Done', 'Next'])('"%s" works like Enter on the password', async (key) => {
    const pass = await toPasswordStep();
    act(() => { pass.focus(); });
    fireEvent.change(pass, { target: { value: 'secret' } });
    enter(pass, key, 0);
    await flush();
    expect(document.activeElement).toBe(document.getElementById('login-submit'));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it('OK on Sign in, after the keyboard has settled, signs in', async () => {
    const pass = await toPasswordStep();
    act(() => { pass.focus(); });
    fireEvent.change(pass, { target: { value: 'secret' } });
    enter(pass);
    await flush();
    await later();
    enter(document.getElementById('login-submit')!);
    await flush();
    expect(h.signIn).toHaveBeenCalledTimes(1);
  });

  it('the keyboard\'s parting Enter on the button does not sign in', async () => {
    const pass = await toPasswordStep();
    act(() => { pass.focus(); });
    fireEvent.change(pass, { target: { value: 'secret' } });
    enter(pass);
    await flush();
    enter(document.getElementById('login-submit')!);
    await flush();
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it('create account: name -> password -> confirm -> Create, never submitting', async () => {
    h.invoke.mockResolvedValue({ data: { exists: 'none' }, error: null });
    render(<MemoryRouter><Auth /></MemoryRouter>);
    fireEvent.change(document.getElementById('auth-email')!, { target: { value: 'new@example.com' } });
    fireEvent.click(document.getElementById('auth-continue')!);
    await flush();
    const name = document.getElementById('signup-name') as HTMLInputElement;
    const pass = document.getElementById('signup-password') as HTMLInputElement;
    const confirm = document.getElementById('signup-confirm') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'New Person' } });
    enter(name);
    await flush();
    expect(document.activeElement).toBe(pass);
    fireEvent.change(pass, { target: { value: 'secret1' } });
    enter(pass);
    await flush();
    expect(document.activeElement).toBe(confirm);
    fireEvent.change(confirm, { target: { value: 'secret1' } });
    enter(confirm);
    await flush();
    expect(document.activeElement).toBe(document.getElementById('signup-submit'));
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it('the show-password eye still works', async () => {
    const pass = await toPasswordStep();
    expect(pass.type).toBe('password');
    const eye = pass.parentElement!.querySelector('button')!;
    fireEvent.click(eye);
    expect((document.getElementById('login-password') as HTMLInputElement).type).toBe('text');
  });
});
