import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { setKidsLevel } from '@/lib/kidsFilter';
import { INTENT_KEYS } from '@/lib/appActions';

// The Player opened from Home's Live TV / Plex card must never draw its
// chooser, not even for the one render before the stored intent is read.
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
vi.mock('@/hooks/usePlayerServerAlert', () => ({ usePlayerServerAlert: () => ({ alert: null, dismiss: vi.fn(), appLabel: null }) }));
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
// Live TV hands the remote back to the sidebar on Left, as the real one does.
vi.mock('./livetv/LiveSection', async () => {
  const { useEffect } = await import('react');
  const LiveSectionStub = ({ isActive, onExitLeft }: { isActive: boolean; onExitLeft: () => void }) => {
    useEffect(() => {
      if (!isActive) return;
      const h = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') onExitLeft(); };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, [isActive, onExitLeft]);
    return <div>live-section</div>;
  };
  return { default: LiveSectionStub };
});
vi.mock('./livetv/BackupsSection', () => ({ default: () => <div>backups-section</div> }));
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
vi.mock('./livetv/PlayerServerAlertDialog', () => ({ default: () => null }));
vi.mock('./livetv/ExpirationNoticeDialog', () => ({ default: () => <div>expiry-notice</div> }));
// The sign-in form, whose Get started sells a line.
vi.mock('./livetv/CredentialsForm', () => ({ default: () => <div>credentials-form</div> }));

// Every render of the chooser is counted, so a single-frame flash fails.
const chooser = vi.hoisted(() => ({ renders: 0 }));
vi.mock('./livetv/PlayerModeChooser', () => ({
  default: () => { chooser.renders++; return <div>player-chooser</div>; },
}));

import LiveTV from './LiveTV';

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); chooser.renders = 0; box.line = true; setKidsLevel(null); });
afterEach(() => { vi.clearAllMocks(); });

describe('No flash of the Player chooser', () => {
  it.each([
    ['Live TV', { section: 'live', home: true }, 'live-section'],
    ['Plex', { section: 'movies', home: true }, 'plex-section'],
  ] as const)('%s from Home: the chooser is never rendered', async (_name, intent, lands) => {
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify(intent));
    render(<LiveTV onBack={vi.fn()} />);
    await settle(); await settle();
    expect(screen.getByText(lands)).toBeTruthy();
    expect(chooser.renders).toBe(0);
  });

  it('with no line saved yet either', async () => {
    box.line = false;
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'movies', home: true }));
    render(<LiveTV onBack={vi.fn()} />);
    await settle(); await settle();
    expect(screen.getByText('plex-section')).toBeTruthy();
    expect(chooser.renders).toBe(0);
  });

  it('opened with nothing asked for, the chooser still shows', async () => {
    render(<LiveTV onBack={vi.fn()} />);
    await settle(); await settle();
    expect(screen.getByText('player-chooser')).toBeTruthy();
  });

  it('opened again with nothing asked for, it goes back to the section last used this session', async () => {
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'movies', home: true }));
    const first = render(<LiveTV onBack={vi.fn()} />);
    await settle(); await settle();
    expect(screen.getByText('plex-section')).toBeTruthy();
    first.unmount();
    chooser.renders = 0;
    render(<LiveTV onBack={vi.fn()} />);
    await settle(); await settle();
    expect(screen.getByText('plex-section')).toBeTruthy();
    expect(chooser.renders).toBe(0);
  });

  it('Back on the loading spinner leaves the Player', async () => {
    const onBack = vi.fn();
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'live', home: true }));
    render(<LiveTV onBack={onBack} />);
    // Before anything has settled: only the spinner is up.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('an intent that cannot apply yet (a channel to play, no line) falls back to the chooser, not a spinner forever', async () => {
    box.line = false;
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'live', play: 'ESPN' }));
    render(<LiveTV onBack={vi.fn()} />);
    await settle(); await settle();
    expect(screen.getByText('player-chooser')).toBeTruthy();
  });
});
