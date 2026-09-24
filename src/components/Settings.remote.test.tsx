import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Settings opened on a tab by a landing intent ("Set up profiles", Phone Remote).
const kidsLevel: string | null = null;
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
const focused = (c: HTMLElement) => c.querySelector('[data-focused="true"]')?.getAttribute('data-settings-focus');

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe('Settings opened on a tab', () => {
  it('"Set up profiles": Down from Back goes to the Profiles tab that is showing, and on to its buttons', () => {
    sessionStorage.setItem('smc-settings-tab', 'profiles');
    const { container } = render(<Settings onBack={vi.fn()} />);
    expect(focused(container)).toBe('back');
    key('ArrowDown');
    expect(focused(container)).toBe('tab-profiles');
    expect(screen.getByRole('tab', { name: /Profiles/ }).getAttribute('data-state')).toBe('active');
    key('ArrowDown');
    expect(focused(container)).toBe('profiles-switch');
  });

  it('Phone Remote: Down, Down reaches the typing-card switch', () => {
    sessionStorage.setItem('smc-settings-tab', 'remote');
    const { container } = render(<Settings onBack={vi.fn()} />);
    key('ArrowDown');
    expect(focused(container)).toBe('tab-remote');
    key('ArrowDown');
    expect(focused(container)).toBe('remote-hint');
  });

  it('with no intent, Down from Back still lands on Media', () => {
    const { container } = render(<Settings onBack={vi.fn()} />);
    key('ArrowDown');
    expect(focused(container)).toBe('tab-media');
  });
});
