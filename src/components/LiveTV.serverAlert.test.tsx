import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { setKidsLevel } from '@/lib/kidsFilter';
import { INTENT_KEYS } from '@/lib/appActions';

// A server alert over Live TV (PlayerServerAlertDialog, z-80) used to be drawn
// with Live TV still active: Live TV's capture listener, added first, took
// OK (played a channel, worked the player bar) and Back (left full screen)
// before the alert heard it. A popup over the Player owns the remote.
//
// A box signed in to a line. The sections themselves are stand-ins.
const box = vi.hoisted(() => ({
  line: true,
  account: null as null | { username: string; serverLabel: string },
  days: null as number | null,
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => (box.line ? { host: 'http://h.test', username: 'u', password: 'p', serverLabel: 'Dreamstreams' } : null),
  bumpXtreamRefresh: vi.fn(),
  clearLiveCatalogue: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
// The alert arrives while Live TV is already up (a realtime row), as in use.
const sa = vi.hoisted(() => ({ alert: null as null | { id: string; title: string; message: string; severity: 'warning' }, subs: new Set<() => void>(), dismiss: vi.fn() }));
vi.mock('@/hooks/usePlayerServerAlert', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (f: () => void) => { sa.subs.add(f); return () => { sa.subs.delete(f); }; };
  return {
    usePlayerServerAlert: () => {
      const alert = useSyncExternalStore(subscribe, () => sa.alert);
      return { alert, dismiss: () => { sa.dismiss(); sa.alert = null; sa.subs.forEach((f) => f()); }, appLabel: null };
    },
  };
});
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: box.account, days: box.days }) }));
vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: '1.7.8' }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackAlertShown: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), hasSessionFlag: () => false }));
vi.mock('@/lib/plex', () => ({ clearPlexToken: vi.fn() }));
vi.mock('@/lib/playerAutoSignIn', () => ({ autoSignInPlayer: async () => null, clearPlayerSignedOut: vi.fn(), markPlayerSignedOut: vi.fn() }));
vi.mock('@/lib/playerAccountSync', () => ({ syncPlayerAccountToCloud: vi.fn() }));
vi.mock('@/lib/playerSigninCapture', () => ({ capturePlayerSignin: vi.fn() }));
vi.mock('@/lib/accountClaim', () => ({ isClaimDismissed: () => true, isClaimDone: () => true, markClaimDismissed: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: vi.fn() }) } }));
// Live TV's own capture listener, added when it mounts (before any alert),
// as the real LiveSection's: OK plays the channel, Back leaves full screen.
const live = vi.hoisted(() => ({ ok: vi.fn(), back: vi.fn() }));
vi.mock('./livetv/LiveSection', async () => {
  const { useEffect } = await import('react');
  const LiveSectionStub = ({ isActive }: { isActive: boolean }) => {
    useEffect(() => {
      if (!isActive) return;
      const h = (e: KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); live.ok(); }
        if (e.key === 'Escape' || e.keyCode === 4) { e.preventDefault(); live.back(); }
      };
      window.addEventListener('keydown', h, true);
      return () => window.removeEventListener('keydown', h, true);
    }, [isActive]);
    return <div>live-section</div>;
  };
  return { default: LiveSectionStub };
});
vi.mock('./livetv/BackupsSection', () => ({ default: () => <div>backups-section</div> }));
vi.mock('./livetv/OriginalsSection', () => ({ default: () => <div>originals-section</div> }));
// Plex signed out on a box with no line: its "Sign into Live TV" (OK here).
vi.mock('./livetv/PlexSection', async () => {
  const { useEffect } = await import('react');
  const PlexSectionStub = ({ onNeedLiveTV }: { onNeedLiveTV?: () => void }) => {
    useEffect(() => {
      const h = (e: KeyboardEvent) => { if (e.key === 'Enter') onNeedLiveTV?.(); };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, [onNeedLiveTV]);
    return <div>plex-section</div>;
  };
  return { default: PlexSectionStub };
});
vi.mock('./livetv/SettingsHub', () => ({ default: () => <div>settings-hub</div> }));
vi.mock('./livetv/ExpirationNoticeDialog', () => ({ default: () => <div>expiry-notice</div> }));
// The sign-in form, whose Get started sells a line.
vi.mock('./livetv/CredentialsForm', () => ({ default: () => <div>credentials-form</div> }));

import LiveTV from './LiveTV';

const key = (k: string, keyCode?: number) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: keyCode ?? (k === 'Enter' ? 13 : undefined) }); });
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const raiseAlert = () => act(() => {
  sa.alert = { id: 'x', title: 'Server maintenance', message: 'Back soon.', severity: 'warning' };
  sa.subs.forEach((f) => f());
});
const openLiveTv = async () => {
  render(<LiveTV onBack={vi.fn()} />);
  await settle();
  key('Enter'); // mode chooser: Live TV
  await settle();
  await settle();
};

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  box.line = true; box.account = null; box.days = null;
  sa.alert = null; sa.dismiss.mockClear();
  live.ok.mockClear(); live.back.mockClear();
});
afterEach(() => { setKidsLevel(null); });

describe('a server alert over Live TV owns the remote', () => {
  it('OK dismisses the alert and never reaches Live TV under it', async () => {
    await openLiveTv();
    expect(screen.getByText('live-section')).toBeTruthy();
    key('Enter');
    expect(live.ok).toHaveBeenCalledTimes(1); // Live TV has the remote
    live.ok.mockClear();

    raiseAlert();
    await settle();
    expect(screen.getByText('Server maintenance')).toBeTruthy();
    key('Enter');
    await settle();
    expect(sa.dismiss).toHaveBeenCalledTimes(1);
    expect(live.ok).not.toHaveBeenCalled();
    expect(screen.queryByText('Server maintenance')).toBeNull();

    // Gone: Live TV has the remote back.
    key('Enter');
    expect(live.ok).toHaveBeenCalledTimes(1);
  });

  it('Back dismisses the alert and does not leave full screen under it', async () => {
    await openLiveTv();
    raiseAlert();
    await settle();
    key('GoBack', 4);
    await settle();
    expect(sa.dismiss).toHaveBeenCalledTimes(1);
    expect(live.back).not.toHaveBeenCalled();
  });

  it('waits behind the expiry notice: one popup at a time', async () => {
    box.account = { username: 'u', serverLabel: 'Dreamstreams' };
    box.days = 2;
    await openLiveTv();
    await settle();
    expect(screen.getByText('expiry-notice')).toBeTruthy();
    raiseAlert();
    await settle();
    expect(screen.queryByText('Server maintenance')).toBeNull();
    key('Enter');
    expect(live.ok).not.toHaveBeenCalled();
  });
});
