import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Settings already on screen when a voice command (or the assistant) asks for
// one of its tabs: it switches now, and nothing is left for the next visit.
let kidsLevel: string | null = null;
vi.mock('@/hooks/useActiveProfile', () => ({
  useActiveProfile: () => ({ profile: { id: kidsLevel ? 'kid' : 'main', name: kidsLevel ? 'Kid' : 'Main', avatar: 'blue', kidsLevel, pinHash: null, position: 0, t: 0 } }),
}));
vi.mock('@/hooks/useAdminRole', () => ({ useAdminRole: () => ({ isAdmin: false }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' } }) }));
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
// Stands in for the wallpaper maker: shows the prompt it would take when it mounts.
vi.mock('@/components/MediaManager', () => ({
  default: () => <div>media-manager {sessionStorage.getItem('smc-wallpaper-prompt') ?? ''}</div>,
}));
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
import { generateWallpaper, INTENT_KEYS, openScreen } from '@/lib/appActions';

const selected = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.getAttribute('data-settings-focus');

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe('Settings asked for a tab while it is open', () => {
  it('switches at once and keeps nothing for the next visit', async () => {
    kidsLevel = null;
    render(<Settings onBack={vi.fn()} />);
    expect(selected()).toBe('tab-media');

    await act(async () => { openScreen('settings_ui', vi.fn()); });
    expect(selected()).toBe('tab-ui');
    expect(sessionStorage.getItem(INTENT_KEYS.settings)).toBeNull();
    // The highlight is on that tab, not on something the old tab showed.
    expect(document.querySelector('[data-settings-focus="tab-ui"]')?.getAttribute('data-focused')).toBe('true');

    await act(async () => { openScreen('phone_remote', vi.fn()); });
    expect(selected()).toBe('tab-remote');
  });

  it('a background asked for on another tab opens the wallpaper maker with it', async () => {
    kidsLevel = null;
    render(<Settings onBack={vi.fn()} />);
    await act(async () => { openScreen('settings_ui', vi.fn()); });
    await act(async () => { generateWallpaper('a beach at sunset', vi.fn()); });
    expect(selected()).toBe('tab-media');
    expect(screen.getByText(/media-manager a beach at sunset/)).toBeTruthy();
  });

  it('a Kids profile gets only its own tabs', async () => {
    kidsLevel = 'kids';
    render(<Settings onBack={vi.fn()} />);
    sessionStorage.setItem(INTENT_KEYS.settings, 'updates');
    await act(async () => { window.dispatchEvent(new CustomEvent('smc:screen-intent', { detail: 'settings' })); });
    expect(selected()).toBe('tab-media');
    await act(async () => { openScreen('settings_ui', vi.fn()); });
    expect(selected()).toBe('tab-ui');
  });
});
