/**
 * The Live TV sign-in's Show / Hide on the password box: dots when the form
 * opens, the toggle flips the field between dots and text and keeps what was
 * typed, the remote reaches it with Right and flips it with OK, and the
 * keyboard's Done after the password still lands on Sign in, not on it.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ authenticate: vi.fn() }));

vi.mock('@/lib/xtream', () => ({
  authenticateRouted: h.authenticate,
  pickServerForUsername: () => null,
  saveCreds: vi.fn(),
  savePlayerAccount: vi.fn(),
  buildPlayerAccount: vi.fn(),
  upsertSavedAccount: vi.fn(),
  savedAccountId: vi.fn(),
  daysUntilExp: vi.fn(),
  serverDisplayName: (s: string) => s,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useBillingEnabled', () => ({ useBillingEnabled: () => false }));
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => ({ enabled: false }) }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => false }));
vi.mock('@/lib/playerLogin', () => ({ tryPlayerBridge: vi.fn() }));
vi.mock('@/lib/playerAccountSync', () => ({ syncPlayerAccountToCloud: vi.fn() }));
vi.mock('@/lib/playerSigninCapture', () => ({ capturePlayerSignin: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/components/getstarted/pending', () => ({ readPending: () => null }));
vi.mock('@/components/getstarted/GetStartedFlow', () => ({ default: () => null }));

import CredentialsForm from './CredentialsForm';

const raf = async () => { await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); }); };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const later = async () => { await act(async () => { vi.advanceTimersByTime(1000); }); };

beforeEach(() => { h.authenticate.mockReset(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const setup = async () => {
  render(<CredentialsForm onSaved={vi.fn()} onCancel={vi.fn()} />);
  await raf();
  const user = screen.getByLabelText('Username') as HTMLInputElement;
  const pass = screen.getByLabelText('Password') as HTMLInputElement;
  const reveal = document.querySelector('[data-tv-focus-id="cf-pass-show"]') as HTMLButtonElement;
  const signIn = screen.getByRole('button', { name: /sign in/i }) as HTMLButtonElement;
  return { user, pass, reveal, signIn };
};
const press = async (el: Element, key: string, keyCode: number) => {
  fireEvent.keyDown(el, { key, keyCode });
  await flush();
};

describe('Live TV sign-in: Show / Hide password', () => {
  it('starts as dots; the toggle shows the text and hides it again, keeping what was typed', async () => {
    const { pass, reveal } = await setup();
    expect(pass.type).toBe('password');
    expect(reveal.getAttribute('aria-label')).toBe('Show password');
    expect(reveal.getAttribute('aria-pressed')).toBe('false');
    expect(reveal.textContent).toBe('Show');

    fireEvent.change(pass, { target: { value: 'hunter22' } });
    fireEvent.click(reveal);
    expect(pass.type).toBe('text');
    expect(pass.value).toBe('hunter22');
    expect(reveal.getAttribute('aria-label')).toBe('Hide password');
    expect(reveal.getAttribute('aria-pressed')).toBe('true');
    expect(reveal.textContent).toBe('Hide');
    // As text: no autocorrect, capitals or suggestions.
    expect(pass.getAttribute('autocomplete')).toBe('off');
    expect(pass.getAttribute('autocorrect')).toBe('off');
    expect(pass.getAttribute('autocapitalize')).toBe('none');
    expect(pass.getAttribute('spellcheck')).toBe('false');

    fireEvent.click(reveal);
    expect(pass.type).toBe('password');
    expect(pass.value).toBe('hunter22');
  });

  it('a tap while typing keeps the field focused (the phone keyboard stays up)', async () => {
    const { pass, reveal } = await setup();
    act(() => { pass.focus(); });
    const notPrevented = fireEvent.mouseDown(reveal);
    expect(notPrevented).toBe(false);
    fireEvent.click(reveal);
    expect(document.activeElement).toBe(pass);
    expect(pass.type).toBe('text');
  });

  it('the remote: Right from the password reaches it, OK flips it, Left goes back, Up / Down as from the password', async () => {
    const { user, pass, reveal, signIn } = await setup();
    expect(document.activeElement).toBe(user);
    await press(user, 'ArrowDown', 40);
    expect(document.activeElement).toBe(pass);
    await press(pass, 'ArrowRight', 39);
    expect(document.activeElement).toBe(reveal);
    expect(reveal.dataset.tvFocused).toBe('true');
    await later();

    await press(reveal, 'Enter', 13);
    expect(pass.type).toBe('text');
    expect(document.activeElement).toBe(reveal);
    await press(reveal, 'Enter', 13);
    expect(pass.type).toBe('password');

    await press(reveal, 'ArrowRight', 39);
    expect(document.activeElement).toBe(reveal); // nothing to its right
    await press(reveal, 'ArrowLeft', 37);
    expect(document.activeElement).toBe(pass);

    await press(pass, 'ArrowRight', 39);
    await press(reveal, 'ArrowDown', 40);
    expect(document.activeElement).toBe(signIn);
    await press(signIn, 'ArrowUp', 38);
    await press(pass, 'ArrowRight', 39);
    await press(reveal, 'ArrowUp', 38);
    expect(document.activeElement).toBe(user);
    expect(h.authenticate).not.toHaveBeenCalled();
  });

  it.each([['dots', false], ['text', true]])('the keyboard\'s Done after the password (%s) lands on Sign in, not on the toggle', async (_l, shown) => {
    const { user, pass, reveal, signIn } = await setup();
    if (shown) fireEvent.click(reveal);
    fireEvent.input(user, { target: { value: 'jane' } });
    await press(user, 'Enter', 13);
    expect(document.activeElement).toBe(pass);
    fireEvent.input(pass, { target: { value: 'secret' } });
    await later();
    await press(pass, 'Enter', 13);
    expect(document.activeElement).not.toBe(reveal);
    expect(document.activeElement).toBe(signIn);
    expect(pass.type).toBe(shown ? 'text' : 'password');
    expect(h.authenticate).not.toHaveBeenCalled();
  });

  it('is dots again the next time the form opens', async () => {
    const first = await setup();
    fireEvent.change(first.pass, { target: { value: 'hunter22' } });
    fireEvent.click(first.reveal);
    expect(first.pass.type).toBe('text');
    cleanup();

    const again = await setup();
    expect(again.pass.type).toBe('password');
    expect(again.reveal.getAttribute('aria-pressed')).toBe('false');
  });
});
