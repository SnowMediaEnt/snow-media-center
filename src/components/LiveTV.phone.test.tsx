import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { setKidsLevel } from '@/lib/kidsFilter';
import { __setPhoneModeForTests } from '@/lib/phoneMode';
import { INTENT_KEYS } from '@/lib/appActions';

// The Player on a phone held upright (Tronix 4369a23): no side menu, the
// sections as a row of chips (under Live TV's video, over the others), a tap
// opens one, and a touch screen's Back from a section leaves the Player (it
// has no side menu to hand the remote to). A TV keeps its side menu.
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
// Live TV hands the remote back to the side menu on Back, as the real one
// does, and draws the Player's chips (upright) under its video.
vi.mock('./livetv/LiveSection', async () => {
  const { useContext, useEffect } = await import('react');
  const { PlayerTabsSlot } = await import('./livetv/playerTabs');
  const LiveSectionStub = ({ isActive, onExitLeft }: { isActive: boolean; onExitLeft: () => void }) => {
    const tabs = useContext(PlayerTabsSlot);
    useEffect(() => {
      if (!isActive) return;
      const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onExitLeft(); };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, [isActive, onExitLeft]);
    return <div>live-section{tabs}</div>;
  };
  return { default: LiveSectionStub };
});
vi.mock('./livetv/GuideSection', () => ({ default: () => <div>guide-section</div> }));
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

vi.mock('./livetv/PlayerModeChooser', () => ({ default: () => <div>player-chooser</div> }));

import LiveTV from './LiveTV';

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const open = async (onBack = vi.fn()) => {
  sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'live', home: true }));
  render(<LiveTV onBack={onBack} />);
  await settle(); await settle();
  return onBack;
};
const tab = (id: string) => document.querySelector<HTMLElement>(`[data-player-tab="${id}"]`);

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); box.line = true; setKidsLevel(null); });
afterEach(() => { vi.clearAllMocks(); __setPhoneModeForTests({ touch: false, phone: false }); });

describe('the Player on a phone held upright', () => {
  it('no side menu: the sections are chips, Live TV draws them itself', async () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    await open();
    expect(screen.getByText('live-section')).toBeTruthy();
    expect(document.querySelector('[data-player-rail]')).toBeNull();
    expect(tab('live')?.getAttribute('data-active')).toBe('true');
    expect(tab('guide')).toBeTruthy();
  });

  it('a tap on a chip opens that section, with the chips over it', async () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    await open();
    act(() => { fireEvent.click(tab('guide')!); });
    await settle(); await settle();
    expect(await screen.findByText('guide-section')).toBeTruthy();
    expect(tab('guide')?.getAttribute('data-active')).toBe('true');
  });

  it('Back in a section leaves the Player (no side menu to go back to)', async () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    const onBack = await open();
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(onBack).toHaveBeenCalled();
  });
});

describe('the Player on a TV', () => {
  it('keeps its side menu; Back in a section hands the remote back to it', async () => {
    const onBack = await open();
    expect(document.querySelector('[data-player-rail]')).not.toBeNull();
    expect(tab('live')).toBeNull();
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(onBack).not.toHaveBeenCalled();
  });
});
