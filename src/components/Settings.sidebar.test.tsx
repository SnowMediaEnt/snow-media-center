import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import i18n from '@/i18n';

// Settings' tabs stand in a column on the left (like Live TV's Account info):
// Up / Down walk the column and switch the content, Right / OK go into the
// content, and Up at the top of the content or Left come back to the column.
const flags = vi.hoisted(() => ({ admin: false }));
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
vi.mock('@/components/PlayerAccountCard', () => ({ default: () => <div>player-account</div> }));
vi.mock('@/components/remote/PairingQR', () => ({ default: () => <div>pairing-qr</div> }));
vi.mock('@/lib/phoneRemote', () => ({
  PHONE_REMOTE_EVENT: 'x', connectedPhones: () => 0, isPaired: () => false,
  setTypingHintEnabled: vi.fn(), typingHintEnabled: () => true, unpairAllPhones: vi.fn(),
}));

import Settings from './Settings';

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const focused = () => document.querySelector('[data-settings-focus][data-focused="true"]')?.getAttribute('data-settings-focus');
const selected = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.getAttribute('data-settings-focus');

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  flags.admin = false;
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

describe('Settings tab column', () => {
  it('is one vertical list of tabs, still the How-to "set.tabs" hook', () => {
    render(<Settings onBack={vi.fn()} />);
    const list = screen.getByRole('tablist');
    expect(list.getAttribute('data-howto')).toBe('set.tabs');
    expect(list.getAttribute('aria-orientation')).toBe('vertical');
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('data-settings-focus')))
      .toEqual(['tab-media', 'tab-ui', 'tab-profiles', 'tab-remote', 'tab-updates']);
  });

  it('Down from Back reaches the column; Up / Down move through it and switch the content', () => {
    render(<Settings onBack={vi.fn()} />);
    expect(focused()).toBe('back');
    key('ArrowDown');
    expect(focused()).toBe('tab-media');
    expect(screen.getByText('media-manager-idle')).toBeTruthy();

    key('ArrowDown');
    expect(focused()).toBe('tab-ui');
    expect(selected()).toBe('tab-ui');
    expect(screen.getByText('Content Bar')).toBeTruthy();

    key('ArrowDown');
    expect(focused()).toBe('tab-profiles');
    expect(selected()).toBe('tab-profiles');
    expect(document.querySelector('[data-settings-focus="profiles-switch"]')).not.toBeNull();

    key('ArrowDown'); key('ArrowDown');
    expect(focused()).toBe('tab-updates');
    expect(screen.getByText('app-updater')).toBeTruthy();
    // The last tab stays put.
    key('ArrowDown');
    expect(focused()).toBe('tab-updates');

    key('ArrowUp');
    expect(focused()).toBe('tab-remote');
    expect(selected()).toBe('tab-remote');
    expect(screen.getByText('pairing-qr')).toBeTruthy();
  });

  it('Up from the first tab goes to Back, and OK there leaves Settings', () => {
    const onBack = vi.fn();
    render(<Settings onBack={onBack} />);
    key('ArrowDown');
    key('ArrowUp');
    expect(focused()).toBe('back');
    expect(selected()).toBe('tab-media');
    key('Enter');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Left on a tab does nothing', () => {
    render(<Settings onBack={vi.fn()} />);
    key('ArrowDown'); key('ArrowDown');
    key('ArrowLeft');
    expect(focused()).toBe('tab-ui');
    expect(selected()).toBe('tab-ui');
  });

  it('Right goes into the content of each tab, and OK does the same', () => {
    render(<Settings onBack={vi.fn()} />);
    key('ArrowDown'); // Media
    key('ArrowRight');
    expect(screen.getByText('media-manager-active')).toBeTruthy();
    // The media manager's own Left edge hands the remote back to the column.
    fireEvent.click(screen.getByText('media-left-edge'));
    expect(screen.getByText('media-manager-idle')).toBeTruthy();
    expect(focused()).toBe('tab-media');

    key('ArrowDown'); // UI
    key('ArrowRight');
    expect(focused()).toBe('ui-content-bar-toggle');
    key('ArrowUp');
    expect(focused()).toBe('tab-ui');
    key('Enter');
    expect(focused()).toBe('ui-content-bar-toggle');
    key('ArrowUp');

    key('ArrowDown'); // Profiles
    key('Enter');
    expect(focused()).toBe('profiles-switch');
    key('ArrowUp');
    expect(focused()).toBe('tab-profiles');

    key('ArrowDown'); // Phone Remote
    key('ArrowRight');
    expect(focused()).toBe('remote-hint');
    key('ArrowUp');
    expect(focused()).toBe('tab-remote');

    key('ArrowDown'); // Updates
    key('ArrowRight');
    expect(document.querySelector('[data-settings-focus="updates-content"]')?.getAttribute('data-focused')).toBe('true');
    key('ArrowUp');
    expect(focused()).toBe('tab-updates');
  });

  it('Left from the content comes back to the tab in the column', () => {
    flags.admin = true;
    render(<Settings onBack={vi.fn()} />);
    key('ArrowDown'); key('ArrowDown'); // UI
    key('ArrowRight'); key('ArrowDown');
    expect(focused()).toBe('ui-dashboard-size-toggle');
    key('ArrowLeft');
    expect(focused()).toBe('tab-ui');
    expect(selected()).toBe('tab-ui');

    key('ArrowDown'); // Profiles
    key('ArrowRight'); key('ArrowDown');
    expect(focused()).toBe('profiles-manage');
    key('ArrowLeft');
    expect(focused()).toBe('tab-profiles');

    key('ArrowDown'); // Phone Remote: the switch and Unpair share a row
    key('ArrowRight'); key('ArrowRight');
    expect(focused()).toBe('remote-unpair');
    key('ArrowLeft');
    expect(focused()).toBe('remote-hint');
    key('ArrowLeft');
    expect(focused()).toBe('tab-remote');

    key('ArrowDown'); // Updates
    key('ArrowRight');
    key('ArrowLeft');
    expect(focused()).toBe('tab-updates');

    key('ArrowDown'); // Alerts (admin)
    key('ArrowRight');
    expect(document.querySelector('[data-settings-focus="alerts-content"]')?.getAttribute('data-focused')).toBe('true');
    key('ArrowLeft');
    expect(focused()).toBe('tab-alerts');

    key('ArrowDown'); // AI (admin)
    key('ArrowRight');
    expect(document.querySelector('[data-settings-focus="ai-content"]')?.getAttribute('data-focused')).toBe('true');
    key('ArrowLeft');
    expect(focused()).toBe('tab-ai');
  });

  it('the language tiles keep Left / Right between them, OK picks one, and Left from the first goes to the column', async () => {
    render(<Settings onBack={vi.fn()} />);
    key('ArrowDown'); key('ArrowDown'); // UI
    key('ArrowRight');
    for (let i = 0; i < 12 && !focused()?.startsWith('ui-language-'); i += 1) key('ArrowDown');
    expect(focused()).toBe('ui-language-en');

    key('ArrowRight');
    expect(focused()).toBe('ui-language-es');
    key('Enter');
    await waitFor(() => expect(i18n.language).toBe('es'));
    expect(localStorage.getItem('smc_lang')).toBe('es');

    key('ArrowRight');
    expect(focused()).toBe('ui-language-fr');
    key('ArrowLeft'); key('ArrowLeft');
    expect(focused()).toBe('ui-language-en');
    key('Enter');
    await waitFor(() => expect(i18n.language).toBe('en'));

    key('ArrowLeft');
    expect(focused()).toBe('tab-ui');
  });
});
