import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { setKidsLevel } from '@/lib/kidsFilter';
import { INTENT_KEYS } from '@/lib/appActions';

// A box signed in to a line. The sections themselves are stand-ins: this is
// about which ones the Player shell lets a profile reach.
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => ({ host: 'http://h.test', username: 'u', password: 'p', serverLabel: 'Dreamstreams' }),
  bumpXtreamRefresh: vi.fn(),
  clearLiveCatalogue: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/hooks/usePlayerServerAlert', () => ({ usePlayerServerAlert: () => ({ alert: null, dismiss: vi.fn(), appLabel: null }) }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: null, days: null }) }));
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
vi.mock('./livetv/SettingsHub', () => ({ default: () => <div>settings-hub</div> }));
vi.mock('./livetv/PlayerServerAlertDialog', () => ({ default: () => null }));
vi.mock('./livetv/ExpirationNoticeDialog', () => ({ default: () => null }));

import LiveTV from './LiveTV';

// The remote's OK arrives as Enter, keyCode 13.
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : undefined }); });
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const openLiveTv = async () => {
  render(<LiveTV onBack={vi.fn()} />);
  await settle();
  key('Enter'); // mode chooser: Live TV
  await settle();
};
const sidebar = () => Array.from(document.querySelectorAll('[data-player-chrome] > [data-focused]')).map((n) => n.getAttribute('title') || n.textContent);

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { setKidsLevel(null); });

describe('the Player on a Kids profile', () => {
  it.each(['little', 'kids', 'teen'] as const)('%s: no Backups on the mode chooser or in the sidebar', async (level) => {
    setKidsLevel(level);
    render(<LiveTV onBack={vi.fn()} />);
    await settle();
    expect(screen.queryByText('Backups')).toBeNull();
    // Right as far as it goes, then OK: Plex, never Backups.
    key('ArrowRight'); key('ArrowRight'); key('ArrowRight');
    key('Enter');
    await settle();
    expect(screen.queryByText('backups-section')).toBeNull();
  });

  it('the sidebar has no Backups', async () => {
    setKidsLevel('teen');
    await openLiveTv();
    expect(sidebar()).toEqual(['Live TV', 'Guide', 'Game Day', 'VOD', 'Multi-Screen']);
  });

  it('the header has no Player Settings to reach (sign-out, the line password, billing)', async () => {
    setKidsLevel('kids');
    await openLiveTv();
    expect(screen.queryByRole('button', { name: /Settings/ })).toBeNull();
    // Left into the sections, Up to the header, Right as far as it goes, OK.
    key('ArrowLeft');
    key('ArrowUp');
    key('ArrowRight'); key('ArrowRight'); key('ArrowRight');
    key('Enter');
    await settle();
    expect(screen.queryByText('settings-hub')).toBeNull();
  });

  it('ignores the assistant asking for Backups or Player Settings', async () => {
    setKidsLevel('kids');
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'backups', settings: 'hub' }));
    render(<LiveTV onBack={vi.fn()} />);
    await settle();
    await settle();
    expect(screen.queryByText('backups-section')).toBeNull();
    expect(screen.queryByText('settings-hub')).toBeNull();
    expect(screen.getByText('live-section')).toBeTruthy();
  });
});

describe('the Player on a grown-up profile', () => {
  it('keeps Backups and the header Settings', async () => {
    await openLiveTv();
    expect(sidebar()).toContain('Backups');
    key('ArrowLeft');
    key('ArrowUp');
    key('ArrowRight'); key('ArrowRight');
    key('Enter');
    await settle();
    await settle();
    expect(screen.getByText('settings-hub')).toBeTruthy();
  });
});
