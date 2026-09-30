/**
 * The Live TV sign-in on an Android TV box: the keyboard's action key.
 * Username Enter/Next moves to the password; the password's Done / Go / Enter
 * puts the keyboard away (blur) and lands the remote on Sign in, highlighted,
 * WITHOUT signing in.
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

beforeEach(() => { h.authenticate.mockReset(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const setup = async () => {
  render(<CredentialsForm onSaved={vi.fn()} onCancel={vi.fn()} />);
  await raf();
  const user = screen.getByLabelText('Username') as HTMLInputElement;
  const pass = screen.getByLabelText('Password') as HTMLInputElement;
  const signIn = screen.getByRole('button', { name: /sign in/i }) as HTMLButtonElement;
  return { user, pass, signIn };
};
const later = async () => { await act(async () => { vi.advanceTimersByTime(1000); }); };

describe('Live TV sign-in: the keyboard action key', () => {
  it('Enter on the username moves to the password field', async () => {
    const { user, pass } = await setup();
    expect(document.activeElement).toBe(user);
    fireEvent.input(user, { target: { value: 'jane' } });
    fireEvent.keyDown(user, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(document.activeElement).toBe(pass);
    expect(pass.dataset.tvFocused).toBe('true');
  });

  it('Enter on the password closes the keyboard, focuses Sign in, and does not submit', async () => {
    const { user, pass, signIn } = await setup();
    fireEvent.input(user, { target: { value: 'jane' } });
    fireEvent.keyDown(user, { key: 'Enter', keyCode: 13 });
    await flush();
    fireEvent.input(pass, { target: { value: 'secret' } });
    await later();
    const submitted = vi.fn((e: Event) => e.preventDefault());
    pass.form!.addEventListener('submit', submitted);
    const notPrevented = fireEvent.keyDown(pass, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(notPrevented).toBe(false); // no implicit form submit
    expect(document.activeElement).not.toBe(pass); // blurred: keyboard closed
    expect(document.activeElement).toBe(signIn);
    expect(signIn.dataset.tvFocused).toBe('true'); // shows highlighted for the remote
    expect(submitted).not.toHaveBeenCalled();
    expect(h.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    ['Go', 13],
    ['Done', 0],
    ['Next', 0],
    ['Unidentified', 13],
  ])('the password field\'s "%s" (keyCode %i) does the same', async (key, keyCode) => {
    const { user, pass, signIn } = await setup();
    // Typed, with the field focused the way the platform does it (no OK press).
    act(() => { user.focus(); });
    fireEvent.input(user, { target: { value: 'jane' } });
    act(() => { pass.focus(); });
    fireEvent.input(pass, { target: { value: 'secret' } });
    await later();
    fireEvent.keyDown(pass, { key, keyCode });
    await flush();
    expect(document.activeElement).toBe(signIn);
    expect(h.authenticate).not.toHaveBeenCalled();
  });

  it('then one OK press on Sign in signs in', async () => {
    h.authenticate.mockResolvedValue({ ok: false, error: 'nope' });
    const { user, pass, signIn } = await setup();
    fireEvent.input(user, { target: { value: 'jane' } });
    fireEvent.keyDown(user, { key: 'Enter', keyCode: 13 });
    await flush();
    fireEvent.input(pass, { target: { value: 'secret' } });
    await later();
    fireEvent.keyDown(pass, { key: 'Enter', keyCode: 13 });
    await flush();
    await later(); // past the keyboard's parting Enter
    fireEvent.keyDown(signIn, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(h.authenticate).toHaveBeenCalledTimes(1);
  });
});
