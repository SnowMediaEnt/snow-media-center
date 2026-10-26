/**
 * Live TV Settings, from the Player's side: Services › Add another service ›
 * "DreamStreams or Vibez line" opens an EMPTY sign-in form (Change
 * credentials keeps the line in use filled in); a saved line closes Settings,
 * a cancelled one goes back to Settings on Services. Channels › Update
 * channels is Live TV's own and closes Settings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PLAYER_INTENT_EVENT } from '@/lib/appActions';

const LINE = { host: 'http://h.test', username: 'u', password: 'p', output: 'm3u8', serverLabel: 'Dreamstreams' };
const box = vi.hoisted(() => ({ bump: vi.fn() }));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => ({ host: 'http://h.test', username: 'u', password: 'p', output: 'm3u8', serverLabel: 'Dreamstreams' }),
  bumpXtreamRefresh: box.bump,
  clearLiveCatalogue: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/hooks/usePlayerServerAlert', () => ({ usePlayerServerAlert: () => ({ alert: null, dismiss: vi.fn(), appLabel: null }) }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: null, days: null }) }));
vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: '1.9.4' }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackAlertShown: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), hasSessionFlag: () => false }));
vi.mock('@/lib/plex', () => ({ clearPlexToken: vi.fn() }));
vi.mock('@/lib/playerAutoSignIn', () => ({ autoSignInPlayer: async () => null, clearPlayerSignedOut: vi.fn(), markPlayerSignedOut: vi.fn() }));
vi.mock('@/lib/playerAccountSync', () => ({ syncPlayerAccountToCloud: vi.fn() }));
vi.mock('@/lib/playerSigninCapture', () => ({ capturePlayerSignin: vi.fn() }));
vi.mock('@/lib/accountClaim', () => ({ isClaimDismissed: () => true, isClaimDone: () => true, markClaimDismissed: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: vi.fn() }) } }));
vi.mock('./livetv/LiveSection', () => ({ default: () => <div>live-section</div> }));
vi.mock('./livetv/PlayerServerAlertDialog', () => ({ default: () => null }));
vi.mock('./livetv/ExpirationNoticeDialog', () => ({ default: () => null }));
vi.mock('./livetv/LiveLayoutChooser', () => ({ default: () => null }));
// Settings and the sign-in form stand in: what the Player hands them is tested here.
const seen = vi.hoisted(() => ({ hub: null as null | Record<string, unknown>, form: null as null | Record<string, unknown> }));
vi.mock('./livetv/SettingsHub', () => ({ default: (p: Record<string, unknown>) => { seen.hub = p; return <div>settings-hub</div>; } }));
vi.mock('./livetv/CredentialsForm', () => ({ default: (p: Record<string, unknown>) => { seen.form = p; return <div>credentials-form</div>; } }));

import LiveTV from './LiveTV';

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : undefined }); });
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const openSettings = async () => {
  localStorage.setItem('snow-livetv-layout', 'compact');
  render(<LiveTV onBack={vi.fn()} />);
  await settle();
  key('Enter'); // mode chooser: Live TV
  await settle();
  act(() => { window.dispatchEvent(new CustomEvent(PLAYER_INTENT_EVENT, { detail: { section: 'live', settings: 'hub' } })); });
  await settle();
  expect(screen.getByText('settings-hub')).toBeTruthy();
};
const call = (fn: unknown, ...args: unknown[]) => act(() => { (fn as (...a: unknown[]) => void)(...args); });

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  seen.hub = null; seen.form = null; box.bump.mockClear();
});

describe('Live TV Settings › Services › Add a DreamStreams or Vibez line', () => {
  it('opens an empty sign-in form; Change credentials keeps the line in use filled in', async () => {
    await openSettings();
    call(seen.hub!.onChangeCredentials);
    await settle();
    expect(screen.getByText('credentials-form')).toBeTruthy();
    expect(seen.form!.initial).toMatchObject({ host: LINE.host, username: 'u' });
    call(seen.form!.onCancel);
    await settle();
    expect(screen.getByText('settings-hub')).toBeTruthy();

    call(seen.hub!.onAddLine);
    await settle();
    expect(screen.getByText('credentials-form')).toBeTruthy();
    expect(seen.form!.initial).toBeNull();
  });

  it('a saved line closes Settings (the new line in Live TV); a cancelled one goes back to Settings on Services', async () => {
    await openSettings();
    call(seen.hub!.onAddLine);
    await settle();
    call(seen.form!.onCancel);
    await settle();
    expect(screen.getByText('settings-hub')).toBeTruthy();
    expect(seen.hub!.initialView).toBe('services');

    call(seen.hub!.onAddLine);
    await settle();
    call(seen.form!.onSaved, { ...LINE, host: 'https://strmz.xyz', username: 'me@mail.com', serverLabel: 'Vibez' });
    await settle();
    expect(screen.queryByText('settings-hub')).toBeNull();
    expect(screen.queryByText('credentials-form')).toBeNull();
  });
});

describe('Live TV Settings › Channels › Update channels', () => {
  it('is Live TV\'s own Update Channels, with Settings closed', async () => {
    await openSettings();
    call(seen.hub!.onUpdateChannels);
    await settle();
    expect(box.bump).toHaveBeenCalledWith({ fresh: true });
    expect(screen.queryByText('settings-hub')).toBeNull();
  });

describe('Live TV Settings opened by the assistant on a page', () => {
  it.each(['devices', 'rewind', 'help', 'account'] as const)('hands Settings the page: %s', async (page) => {
    localStorage.setItem('snow-livetv-layout', 'compact');
    render(<LiveTV onBack={vi.fn()} />);
    await settle();
    key('Enter');
    await settle();
    act(() => { window.dispatchEvent(new CustomEvent(PLAYER_INTENT_EVENT, { detail: { section: 'live', settings: page } })); });
    await settle();
    expect(screen.getByText('settings-hub')).toBeTruthy();
    expect(seen.hub?.initialView).toBe(page);
  });
});
});
