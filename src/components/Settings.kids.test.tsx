import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Settings on an ADMIN account, with the Kids or a grown-up profile watching.
let kidsLevel: string | null = 'kids';
vi.mock('@/hooks/useActiveProfile', () => ({
  useActiveProfile: () => ({ profile: { id: kidsLevel ? 'kid' : 'main', name: kidsLevel ? 'Kid' : 'Main', avatar: 'blue', kidsLevel, pinHash: null, position: 0, t: 0 } }),
}));
vi.mock('@/hooks/useAdminRole', () => ({ useAdminRole: () => ({ isAdmin: true }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' } }) }));
vi.mock('@/hooks/useMediaBarEnabled', () => ({ useMediaBarEnabled: () => [true, vi.fn()] }));
vi.mock('@/hooks/useDeviceAlerts', () => ({ useDeviceAlerts: () => ({ supported: true, status: { enabled: true }, busy: false, setEnabled: vi.fn() }) }));
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => ({ enabled: true }), setFeatureFlag: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/aiTiers', () => ({
  getPreferredTier: () => 'free', setPreferredTier: vi.fn(),
  loadAiTiers: async () => ({ chat: { premium: { gems: 1, model: 'x' } } }),
}));
vi.mock('@/lib/dashboardSize', () => ({ useDashboardSize: () => 'compact', saveDashboardSize: vi.fn() }));
vi.mock('@/lib/snowMail', () => ({ useMailNotify: () => true, saveMailNotify: vi.fn() }));
vi.mock('@/lib/profilesUi', () => ({ openProfiles: vi.fn() }));
vi.mock('@/components/MediaManager', () => ({ default: () => <div>media-manager</div> }));
vi.mock('@/components/AppUpdater', () => ({ default: () => <div>app-updater</div> }));
vi.mock('@/components/AppAlertsManager', () => ({ default: () => <div>alerts</div> }));
vi.mock('@/components/ApkCacheViewer', () => ({ default: () => <div>apk-cache</div> }));
vi.mock('@/components/AdminAIPanel', () => ({ default: () => <div>admin-ai</div> }));
vi.mock('@/components/PlayerAccountCard', () => ({ default: () => <div>player-account</div> }));
vi.mock('@/components/remote/PairingQR', () => ({ default: () => <div>pairing-qr</div> }));
vi.mock('@/lib/phoneRemote', () => ({
  PHONE_REMOTE_EVENT: 'x', connectedPhones: () => 0, isPaired: () => false,
  setTypingHintEnabled: vi.fn(), typingHintEnabled: () => true, unpairAllPhones: vi.fn(),
}));

import Settings from './Settings';

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  // jsdom has no scrolling.
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe('Settings on a Kids profile', () => {
  it('shows only Media, UI, Profiles and Phone Remote — no Updates or admin tabs, even for an admin', () => {
    kidsLevel = 'kids';
    render(<Settings onBack={vi.fn()} />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent?.trim());
    expect(tabs).toHaveLength(4);
    expect(tabs.join('|')).toMatch(/Profiles/);
    expect(tabs.join('|')).toMatch(/Phone Remote/);
    expect(screen.queryByText('app-updater')).toBeNull();
  });

  it('UI has the profile switcher, the content bar and languages only', () => {
    kidsLevel = 'kids';
    const { container } = render(<Settings onBack={vi.fn()} />);
    key('ArrowDown'); // back → media tab
    key('ArrowRight'); // → UI tab (opens it)
    const focusIds = [...container.querySelectorAll('[data-settings-focus^="ui-"]')].map((e) => e.getAttribute('data-settings-focus'));
    expect(focusIds[0]).toBe('ui-profiles');
    expect(focusIds[1]).toBe('ui-content-bar-toggle');
    expect(focusIds.slice(2).every((id) => id?.startsWith('ui-language-'))).toBe(true);
    expect(screen.queryByText('player-account')).toBeNull();
    expect(screen.queryByText('Large dashboard')).toBeNull();
    expect(screen.queryByText('Post notifications')).toBeNull();
    expect(screen.queryByText('Alerts on this device')).toBeNull();
  });

  it('Profiles only switches (no add or edit)', () => {
    kidsLevel = 'kids';
    const { container } = render(<Settings onBack={vi.fn()} />);
    key('ArrowDown'); key('ArrowRight'); key('ArrowRight'); // → Profiles tab
    expect(container.querySelector('[data-settings-focus="profiles-switch"]')).not.toBeNull();
    expect(container.querySelector('[data-settings-focus="profiles-manage"]')).toBeNull();
  });

  it('a grown-up profile on the same admin account keeps everything', () => {
    kidsLevel = null;
    render(<Settings onBack={vi.fn()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(7);
  });
});
