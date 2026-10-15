import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import i18n from '@/i18n';

// Settings > UI: the Player Account panel's "Sign out of player" is reachable
// by remote (owner, 2026-10-15): Up from the first setting, never where Right
// lands, and it takes OK twice.
const flags = vi.hoisted(() => ({ admin: false, signOutPlayer: vi.fn(async () => {}) }));
vi.mock('@/lib/playerSignOut', () => ({ signOutPlayer: flags.signOutPlayer }));
vi.mock('@/hooks/usePlayerAccount', () => ({
  usePlayerAccount: () => ({
    account: { host: 'http://h', username: 'jane', password: 'secret', serverLabel: 'DreamStreams', status: 'Active', expDate: null, createdAt: null, maxConnections: 2, activeCons: 0, isTrial: false },
    state: { severity: 'ok', show: false, label: '' },
    days: 30,
  }),
}));
vi.mock('@/hooks/useActiveProfile', () => ({
  useActiveProfile: () => ({ profile: { id: 'main', name: 'Main', avatar: 'blue', kidsLevel: null, pinHash: null, position: 0, t: 0 } }),
}));
vi.mock('@/hooks/useAdminRole', () => ({ useAdminRole: () => ({ isAdmin: flags.admin }) }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => false, isHowtoCapture: () => false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useMediaBarEnabled', () => ({ useMediaBarEnabled: () => [true, vi.fn()] }));
vi.mock('@/hooks/useDeviceAlerts', () => ({ useDeviceAlerts: () => ({ supported: false, status: { enabled: false }, busy: false, setEnabled: vi.fn() }) }));
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => ({ enabled: true }), setFeatureFlag: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/aiTiers', () => ({
  getPreferredTier: () => 'free', setPreferredTier: vi.fn(),
  loadAiTiers: async () => ({ chat: { premium: null } }),
}));
vi.mock('@/lib/dashboardSize', () => ({ useDashboardSize: () => 'compact', saveDashboardSize: vi.fn() }));
vi.mock('@/lib/snowMail', () => ({ useMailNotify: () => true, saveMailNotify: vi.fn() }));
vi.mock('@/lib/profilesUi', () => ({ openProfiles: vi.fn() }));
// Shows whether Settings handed it the remote, and lets the test press Left at its edge.
vi.mock('@/components/MediaManager', () => ({
  default: ({ isActive, onExitLeft }: { isActive?: boolean; onExitLeft?: () => void }) => (
    <div>
      <span>{isActive ? 'media-manager-active' : 'media-manager-idle'}</span>
      <button type="button" onClick={onExitLeft}>media-left-edge</button>
    </div>
  ),
}));
vi.mock('@/components/AppUpdater', () => ({ default: () => <div>app-updater</div> }));
vi.mock('@/components/AppAlertsManager', () => ({ default: () => <div>alerts-panel</div> }));
vi.mock('@/components/ApkCacheViewer', () => ({ default: () => <div>apk-cache</div> }));
vi.mock('@/components/AdminAIPanel', () => ({ default: () => <div>admin-ai</div> }));
vi.mock('@/components/remote/PairingQR', () => ({ default: () => <div>pairing-qr</div> }));
vi.mock('@/lib/phoneRemote', () => ({
  PHONE_REMOTE_EVENT: 'x', connectedPhones: () => 0, isPaired: () => false,
  setTypingHintEnabled: vi.fn(), typingHintEnabled: () => true, unpairAllPhones: vi.fn(),
}));

import Settings from './Settings';

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const focused = () => document.querySelector('[data-settings-focus][data-focused="true"]')?.getAttribute('data-settings-focus');

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  flags.admin = false;
  flags.signOutPlayer.mockClear();
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

describe('Settings > UI: Sign out of player by remote', () => {
  it('Right lands on the first setting, Up reaches Sign out, and it takes OK twice', async () => {
    render(<Settings onBack={vi.fn()} />);
    key('ArrowDown'); key('ArrowDown'); // Back -> Media -> UI
    key('ArrowRight');
    await waitFor(() => expect(focused()).not.toBe('tab-ui'));
    expect(focused()).not.toBe('ui-player-signout');
    key('ArrowUp');
    expect(focused()).toBe('ui-player-signout');
    key('Enter');
    expect(flags.signOutPlayer).not.toHaveBeenCalled();
    expect(screen.getByText('Press OK again to sign out')).toBeTruthy();
    key('Enter');
    await waitFor(() => expect(flags.signOutPlayer).toHaveBeenCalledTimes(1));
  });

  it('moving away disarms it', () => {
    render(<Settings onBack={vi.fn()} />);
    key('ArrowDown'); key('ArrowDown'); key('ArrowRight'); key('ArrowUp');
    key('Enter');
    expect(screen.getByText('Press OK again to sign out')).toBeTruthy();
    key('ArrowDown');
    key('ArrowUp');
    expect(screen.queryByText('Press OK again to sign out')).toBeNull();
    key('Enter');
    expect(flags.signOutPlayer).not.toHaveBeenCalled();
  });
});
