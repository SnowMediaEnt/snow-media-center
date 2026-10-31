/**
 * The Live TV sign-in's "Sign in with a PIN": one 10-digit field shown
 * "12345 67890", its own Sign in and a way back. A PIN's line signs in
 * through exactly the same steps as typed credentials (signInWith), every
 * refusal has its own words, the remote reaches everything, and the PIN is
 * never kept, logged or sent anywhere but pin-signin.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  authenticate: vi.fn(),
  invoke: vi.fn(),
  toast: vi.fn(),
  saveCreds: vi.fn(),
  savePlayerAccount: vi.fn(),
  buildPlayerAccount: vi.fn(),
  upsertSavedAccount: vi.fn(),
  capture: vi.fn(),
  bridge: vi.fn(),
  track: vi.fn(),
  demo: false,
}));

vi.mock('@/lib/xtream', () => ({
  authenticateRouted: h.authenticate,
  pickServerForUsername: (u: string) => (u.includes('@') ? { label: 'Vibez', host: 'https://strmz.xyz' } : { label: 'Dreamstreams', host: 'http://dstreams.xyz:8080' }),
  saveCreds: h.saveCreds,
  savePlayerAccount: h.savePlayerAccount,
  buildPlayerAccount: h.buildPlayerAccount,
  upsertSavedAccount: h.upsertSavedAccount,
  savedAccountId: (host: string, user: string) => `${host}|${user}`,
  daysUntilExp: () => 30,
  serverDisplayName: (s: string) => s,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useBillingEnabled', () => ({ useBillingEnabled: () => true }));
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => ({ enabled: false }) }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo, isHowtoCapture: () => false }));
vi.mock('@/lib/playerLogin', () => ({ tryPlayerBridge: h.bridge }));
vi.mock('@/lib/playerAccountSync', () => ({ syncPlayerAccountToCloud: vi.fn() }));
vi.mock('@/lib/playerSigninCapture', () => ({ capturePlayerSignin: h.capture }));
vi.mock('@/lib/analytics', () => ({ trackEvent: h.track }));
vi.mock('@/components/getstarted/pending', () => ({ readPending: () => null }));
vi.mock('@/components/getstarted/GetStartedFlow', () => ({ default: () => null }));

import CredentialsForm from './CredentialsForm';
import { SERVERS } from '@/lib/servers';

const VIBEZ = SERVERS.find((s) => s.label === 'Vibez')!;
const DREAM = SERVERS.find((s) => s.label === 'Dreamstreams')!;
const PIN = '4815162342';

const raf = async () => { await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); }); };
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }); };
const later = async () => { await act(async () => { vi.advanceTimersByTime(1000); }); };
const settle = async () => { await flush(); await raf(); await flush(); };
const byId = (id: string) => document.querySelector(`[data-tv-focus-id="${id}"]`) as HTMLElement;
const press = async (el: Element, key: string, keyCode: number) => { fireEvent.keyDown(el, { key, keyCode }); await flush(); };

/** The panel accepts the line; the form gets back what it would for typed credentials. */
const panelOk = (server = VIBEZ) => {
  h.authenticate.mockImplementation(async (username: string, password: string) => ({
    ok: true,
    server,
    creds: { host: server.host, username, password, output: 'm3u8', serverLabel: server.label },
    userInfo: { auth: 1, status: 'Active' },
  }));
  h.buildPlayerAccount.mockImplementation((s: { label: string }, c: { host: string; username: string; password: string }) => ({
    host: c.host, username: c.username, password: c.password, serverLabel: s.label, isTrial: false,
  }));
};
const pinLine = (line: Record<string, unknown>) => h.invoke.mockResolvedValue({ data: { ok: true, line }, error: null });

beforeEach(() => {
  Object.values(h).forEach((v) => { if (typeof v === 'function' && 'mockReset' in v) (v as ReturnType<typeof vi.fn>).mockReset(); });
  h.demo = false;
  h.bridge.mockResolvedValue({ ok: false, reason: 'other' });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const renderForm = async () => {
  const onSaved = vi.fn();
  render(<CredentialsForm onSaved={onSaved} onCancel={vi.fn()} />);
  await raf();
  return { onSaved };
};
const openPin = async () => {
  fireEvent.click(screen.getByRole('button', { name: /sign in with a pin/i }));
  await settle();
  return screen.getByLabelText('PIN') as HTMLInputElement;
};
const typePin = (input: HTMLInputElement, value: string) => { fireEvent.change(input, { target: { value } }); };
const submitPin = async () => {
  fireEvent.click(byId('cf-pin-submit'));
  await flush(); await flush();
};
const lastToast = () => h.toast.mock.calls.at(-1)?.[0] as { title: string; description: string } | undefined;

describe('Sign in with a PIN: the screen', () => {
  it('comes after Sign in (the right column) and opens one numeric field, dots by default, shown grouped', async () => {
    await renderForm();
    const pinBtn = screen.getByRole('button', { name: /sign in with a pin/i });
    const signIn = screen.getByRole('button', { name: /^sign in$/i });
    expect(signIn.compareDocumentPosition(pinBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Get started (the new-customer way in) is still there, under it.
    expect(byId('cf-start')).toBeTruthy();

    const input = await openPin();
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.type).toBe('password');
    typePin(input, '1234567890');
    expect(input.value).toBe('12345 67890');
    typePin(input, '12a34-5 6789012');
    expect(input.value).toBe('12345 67890'); // digits only, at most 10

    fireEvent.click(byId('cf-pin-show'));
    expect(input.type).toBe('text');
    expect(input.value).toBe('12345 67890');
  });

  it('"Use username and password" goes back, with the PIN gone', async () => {
    await renderForm();
    typePin(await openPin(), PIN);
    fireEvent.click(screen.getByRole('button', { name: /use username and password/i }));
    await settle();
    expect(screen.getByLabelText('Username')).toBeTruthy();
    const again = await openPin();
    expect(again.value).toBe('');
    expect(again.type).toBe('password');
  });

  it('is not offered in demo mode', async () => {
    h.demo = true;
    await renderForm();
    expect(screen.queryByRole('button', { name: /sign in with a pin/i })).toBeNull();
  });
});

describe('Sign in with a PIN: signing in', () => {
  it('signs in with the returned line through the same steps as typed credentials', async () => {
    panelOk(VIBEZ);
    // Typed first: the reference.
    const typed = await renderForm();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw1' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await flush(); await flush();
    expect(typed.onSaved).toHaveBeenCalledTimes(1);
    const reference = {
      saveCreds: h.saveCreds.mock.calls, savePlayerAccount: h.savePlayerAccount.mock.calls,
      upsert: h.upsertSavedAccount.mock.calls.map(([a]) => ({ ...a, addedAt: 0 })), capture: h.capture.mock.calls,
      bridge: h.bridge.mock.calls, track: h.track.mock.calls, saved: typed.onSaved.mock.calls,
      toast: lastToast(),
    };
    cleanup();
    [h.saveCreds, h.savePlayerAccount, h.upsertSavedAccount, h.capture, h.bridge, h.track, h.authenticate, h.toast].forEach((f) => f.mockClear());

    // Then the PIN for the same line.
    pinLine({ server: 'Vibez', host: 'http://strmz.xyz', username: 'jane@example.com', password: 'pw1' });
    const viaPin = await renderForm();
    const input = await openPin();
    typePin(input, PIN);
    await submitPin();
    expect(h.invoke).toHaveBeenCalledWith('pin-signin', { body: { pin: PIN } });
    expect(h.authenticate).toHaveBeenCalledWith('jane@example.com', 'pw1', expect.any(Function), VIBEZ);
    expect({
      saveCreds: h.saveCreds.mock.calls, savePlayerAccount: h.savePlayerAccount.mock.calls,
      upsert: h.upsertSavedAccount.mock.calls.map(([a]) => ({ ...a, addedAt: 0 })), capture: h.capture.mock.calls,
      bridge: h.bridge.mock.calls, track: h.track.mock.calls, saved: viaPin.onSaved.mock.calls,
      toast: lastToast(),
    }).toEqual(reference);
  });

  it('routes by the returned host, not by the username\'s shape', async () => {
    panelOk(VIBEZ);
    pinLine({ server: 'Vibez', host: 'http://strmz.xyz', username: 'plainname', password: 'pw' });
    await renderForm();
    typePin(await openPin(), PIN);
    await submitPin();
    expect(h.authenticate.mock.calls[0][3]).toBe(VIBEZ);

    cleanup(); h.authenticate.mockClear(); panelOk(DREAM);
    pinLine({ server: 'DreamStreams', host: 'http://dstreams.xyz:8080', username: 'some@one.com', password: 'pw' });
    await renderForm();
    typePin(await openPin(), PIN);
    await submitPin();
    expect(h.authenticate.mock.calls[0][3]).toBe(DREAM);
  });

  it.each([
    ['invalid_pin', 'A PIN is 10 digits'],
    ['not_found', "That PIN isn't right"],
    ['expired', 'This line has expired — renew it to keep watching'],
    ['rate_limited', 'Too many tries — wait a few minutes'],
    ['error', "Couldn't check the PIN. Please try again."],
  ])('%s: says so, and signs nothing in', async (reason, words) => {
    h.invoke.mockResolvedValue({ data: { ok: false, reason }, error: null });
    const { onSaved } = await renderForm();
    const input = await openPin();
    typePin(input, PIN);
    await submitPin();
    expect(lastToast()?.description).toBe(words);
    expect(h.authenticate).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('no answer at all: try again', async () => {
    h.invoke.mockRejectedValue(new Error('offline'));
    await renderForm();
    typePin(await openPin(), PIN);
    await submitPin();
    expect(lastToast()?.description).toBe("Couldn't check the PIN. Please try again.");
  });

  it('fewer than 10 digits never leaves the box', async () => {
    await renderForm();
    typePin(await openPin(), '12345');
    await submitPin();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(lastToast()?.description).toBe('A PIN is 10 digits');
  });

  it('the panel refusing the returned password: sign in once with username and password', async () => {
    pinLine({ server: 'DreamStreams', host: 'http://dstreams.xyz:8080', username: 'joe', password: 'old' });
    h.authenticate.mockResolvedValue({ ok: false, invalidLogin: true, error: 'Invalid username or password' });
    const { onSaved } = await renderForm();
    typePin(await openPin(), PIN);
    await submitPin();
    expect(lastToast()?.description).toBe('Sign in once with your username and password; your PIN keeps working');
    expect(onSaved).not.toHaveBeenCalled();
    expect(h.saveCreds).not.toHaveBeenCalled();
  });

  it('typed credentials the panel refuses keep their own words', async () => {
    h.authenticate.mockResolvedValue({ ok: false, invalidLogin: true, error: 'Invalid username or password' });
    await renderForm();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'joe' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await flush(); await flush();
    expect(lastToast()?.description).toBe('Invalid username or password');
  });
});

describe('Sign in with a PIN: the remote', () => {
  it('Right from the Sign in row reaches it, OK opens the field, and the PIN screen is two columns too', async () => {
    await renderForm();
    expect(document.activeElement).toBe(byId('cf-user'));
    await press(byId('cf-user'), 'ArrowDown', 40);
    expect(document.activeElement).toBe(byId('cf-pass'));
    await press(byId('cf-pass'), 'ArrowDown', 40);
    expect(document.activeElement).toBe(byId('cf-submit'));
    await press(byId('cf-submit'), 'ArrowDown', 40);
    expect(document.activeElement).toBe(byId('cf-submit')); // the left column ends here
    await press(byId('cf-submit'), 'ArrowRight', 39);
    expect(document.activeElement).toBe(byId('cf-cancel'));
    await press(byId('cf-cancel'), 'ArrowRight', 39);
    expect(document.activeElement).toBe(byId('cf-pin'));
    await press(byId('cf-pin'), 'ArrowDown', 40);
    expect(document.activeElement).toBe(byId('cf-start'));
    await press(byId('cf-start'), 'ArrowUp', 38);
    expect(document.activeElement).toBe(byId('cf-pin'));
    await press(byId('cf-pin'), 'ArrowUp', 38);
    expect(document.activeElement).toBe(byId('cf-pin')); // top of the right column
    await press(byId('cf-pin'), 'ArrowLeft', 37);
    expect(document.activeElement).toBe(byId('cf-cancel')); // back where it came from
    await press(byId('cf-cancel'), 'ArrowRight', 39);
    expect(document.activeElement).toBe(byId('cf-pin'));

    await press(byId('cf-pin'), 'Enter', 13);
    await settle();
    expect(document.activeElement).toBe(byId('cf-pin-input'));
    await press(byId('cf-pin-input'), 'ArrowRight', 39);
    expect(document.activeElement).toBe(byId('cf-pin-show'));
    await press(byId('cf-pin-show'), 'ArrowLeft', 37);
    expect(document.activeElement).toBe(byId('cf-pin-input'));
    await press(byId('cf-pin-input'), 'ArrowDown', 40);
    expect(document.activeElement).toBe(byId('cf-pin-submit'));
    await press(byId('cf-pin-submit'), 'ArrowRight', 39);
    expect(document.activeElement).toBe(byId('cf-pin-back'));
    await press(byId('cf-pin-back'), 'ArrowLeft', 37);
    expect(document.activeElement).toBe(byId('cf-pin-submit'));
    await press(byId('cf-pin-submit'), 'ArrowUp', 38);
    expect(document.activeElement).toBe(byId('cf-pin-input'));
  });

  it('Right from any left-column field crosses to the right column, and Left returns to it', async () => {
    await renderForm();
    await press(byId('cf-user'), 'ArrowRight', 39);
    expect(document.activeElement).toBe(byId('cf-pin'));
    await press(byId('cf-pin'), 'ArrowDown', 40);
    await press(byId('cf-start'), 'ArrowLeft', 37);
    expect(document.activeElement).toBe(byId('cf-user'));
    await press(byId('cf-user'), 'ArrowDown', 40);
    await press(byId('cf-pass'), 'ArrowRight', 39);
    expect(document.activeElement).toBe(byId('cf-pass-show'));
    await press(byId('cf-pass-show'), 'ArrowRight', 39);
    expect(document.activeElement).toBe(byId('cf-pin'));
    await press(byId('cf-pin'), 'ArrowLeft', 37);
    expect(document.activeElement).toBe(byId('cf-pass-show'));
  });

  it('with no Cancel, Right from Sign in goes straight to the right column', async () => {
    render(<CredentialsForm onSaved={vi.fn()} />);
    await raf();
    act(() => { byId('cf-submit').focus(); });
    await press(byId('cf-submit'), 'ArrowRight', 39);
    expect(document.activeElement).toBe(byId('cf-pin'));
    await press(byId('cf-pin'), 'ArrowLeft', 37);
    expect(document.activeElement).toBe(byId('cf-submit'));
  });

  it('the keyboard\'s Done after the PIN lands on Sign in without signing in', async () => {
    await renderForm();
    const input = await openPin();
    act(() => { input.focus(); });
    fireEvent.input(input, { target: { value: PIN } });
    await later();
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(document.activeElement).toBe(byId('cf-pin-submit'));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('Back on the PIN screen goes back to username and password, on Sign in with a PIN', async () => {
    await renderForm();
    await openPin();
    act(() => { byId('cf-pin-submit').focus(); });
    await press(byId('cf-pin-submit'), 'Escape', 27);
    await settle();
    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(document.activeElement).toBe(byId('cf-pin'));
  });

  it('"Use username and password" with OK goes back too', async () => {
    await renderForm();
    await openPin();
    act(() => { byId('cf-pin-back').focus(); });
    await press(byId('cf-pin-back'), 'Enter', 13);
    await settle();
    expect(screen.getByLabelText('Username')).toBeTruthy();
  });
});

describe('Sign in with a PIN: the PIN is never kept', () => {
  it('goes to pin-signin and nowhere else, and the field is emptied', async () => {
    panelOk(DREAM);
    pinLine({ server: 'DreamStreams', host: 'http://dstreams.xyz:8080', username: 'joe', password: 'pw' });
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')];
    const { onSaved } = await renderForm();
    const input = await openPin();
    typePin(input, PIN);
    await submitPin();
    expect(onSaved).toHaveBeenCalledTimes(1);

    const seen = JSON.stringify([
      storage.mock.calls, ...logs.map((l) => l.mock.calls),
      h.saveCreds.mock.calls, h.savePlayerAccount.mock.calls, h.buildPlayerAccount.mock.calls,
      h.upsertSavedAccount.mock.calls, h.capture.mock.calls, h.bridge.mock.calls, h.track.mock.calls,
      h.authenticate.mock.calls.map((c) => c.slice(0, 2)), h.toast.mock.calls, onSaved.mock.calls,
    ]);
    expect(seen).not.toContain(PIN);
    expect(seen).not.toContain('48151 62342');
    // The one place it went.
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke.mock.calls[0]).toEqual(['pin-signin', { body: { pin: PIN } }]);
    // Nothing left on screen either (the form may still be up behind a slow shell).
    expect(input.value).toBe('');
    expect(document.body.innerHTML).not.toContain(PIN);
    [storage, ...logs].forEach((s) => s.mockRestore());
  });
});
