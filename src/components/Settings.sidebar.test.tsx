import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import i18n from '@/i18n';

// Settings is laid out like Live TV › Settings (owner, 2026-10-30): a menu
// column on the left, each row's page on the right. Up / Down walk the menu
// and the page follows once the highlight rests; Right / OK go into the page;
// Back, Left at its edge or Up at its top come back to the menu.
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
const page = () => document.querySelector('[data-settings-page]')?.getAttribute('data-settings-page');
const rows = () => [...document.querySelectorAll('[data-settings-row]')].map((e) => e.getAttribute('data-settings-row'));
/** Let the highlight rest so the page beside the menu follows it. */
const rest = () => act(() => new Promise((r) => setTimeout(r, 300)));
/** On the menu: up to Back, then down to the row. */
const toRow = (id: string) => {
  for (let i = 0; i < 15 && focused() !== 'back'; i += 1) key('ArrowUp');
  for (let i = 0; i < 15 && focused() !== `row-${id}`; i += 1) key('ArrowDown');
  expect(focused()).toBe(`row-${id}`);
};

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  flags.admin = false;
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

describe('Settings menu column', () => {
  it('is one column of rows, each with a state line, still the How-to hooks', () => {
    render(<Settings onBack={vi.fn()} />);
    expect(rows()).toEqual(['account', 'home', 'backgrounds', 'profiles', 'remote', 'notifications', 'language', 'updates']);
    expect(document.querySelector('[data-settings-menu]')?.getAttribute('data-howto')).toBe('set.tabs');
    expect(document.querySelector('[data-settings-row="updates"]')?.getAttribute('data-howto')).toBe('set.updatesTab');
    expect(document.querySelector('[data-settings-row="home"]')?.getAttribute('data-howto')).toBe('set.contentBar');
    const state = (id: string) => document.querySelector(`[data-settings-row="${id}"] [data-settings-state]`)?.textContent;
    expect(state('account')).toBe('Not signed in');
    expect(state('home')).toBe('Content bar on · Compact dashboard');
    expect(state('profiles')).toBe('Main');
    expect(state('remote')).toBe('Not paired');
    expect(state('notifications')).toBe('Posts on');
    expect(state('language')).toBe('English');
  });

  it('opens on the first row with its page; Up reaches Back, and OK there leaves', () => {
    const onBack = vi.fn();
    render(<Settings onBack={onBack} />);
    expect(focused()).toBe('row-account');
    expect(page()).toBe('account');
    key('ArrowUp');
    expect(focused()).toBe('back');
    key('Enter');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Down walks the rows and the page follows once the highlight rests, dimmed until the remote goes in', async () => {
    render(<Settings onBack={vi.fn()} />);
    key('ArrowDown');
    expect(focused()).toBe('row-home');
    await rest();
    expect(page()).toBe('home');
    expect(screen.getByText('Content Bar')).toBeTruthy();
    expect(document.querySelector('[data-settings-preview]')?.getAttribute('data-settings-preview')).toBe('true');
    // The last row stays put.
    for (let i = 0; i < 10; i += 1) key('ArrowDown');
    expect(focused()).toBe('row-updates');
    await rest();
    expect(screen.getByText('app-updater')).toBeTruthy();
  });

  it('Left on the menu does nothing; Back on the menu leaves', () => {
    const onBack = vi.fn();
    render(<Settings onBack={onBack} />);
    key('ArrowDown');
    key('ArrowLeft');
    expect(focused()).toBe('row-home');
    expect(onBack).not.toHaveBeenCalled();
    key('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('My account with nothing to pick says so and keeps the remote on the menu', () => {
    render(<Settings onBack={vi.fn()} />);
    key('ArrowRight');
    expect(focused()).toBe('row-account');
    expect(screen.getByText('Not signed in. Sign in to Live TV and your line shows here.')).toBeTruthy();
  });

  it('Right or OK goes into each page; Up at its top, Left and Back come back to its row', () => {
    render(<Settings onBack={vi.fn()} />);
    toRow('home');
    key('ArrowRight');
    expect(focused()).toBe('ui-content-bar-toggle');
    expect(document.querySelector('[data-settings-preview]')?.getAttribute('data-settings-preview')).toBe('false');
    // While the remote is in the page, its row keeps a quiet gold edge (no fill that looks like focus).
    expect(document.querySelector('[data-settings-row="home"]')?.className).toContain('border-brand-gold/50');
    key('ArrowUp');
    expect(focused()).toBe('row-home');
    expect(document.querySelector('[data-settings-row="home"]')?.className).not.toContain('border-brand-gold/50');
    key('Enter');
    expect(focused()).toBe('ui-content-bar-toggle');
    key('ArrowDown');
    key('ArrowLeft');
    expect(focused()).toBe('row-home');

    toRow('backgrounds');
    key('ArrowRight');
    expect(screen.getByText('media-manager-active')).toBeTruthy();
    // The media manager's own Left edge hands the remote back to the menu.
    fireEvent.click(screen.getByText('media-left-edge'));
    expect(screen.getByText('media-manager-idle')).toBeTruthy();
    expect(focused()).toBe('row-backgrounds');

    toRow('profiles');
    key('Enter');
    expect(focused()).toBe('profiles-switch');
    key('ArrowDown');
    expect(focused()).toBe('profiles-manage');
    key('ArrowLeft');
    expect(focused()).toBe('row-profiles');

    toRow('remote');
    key('ArrowRight');
    expect(focused()).toBe('remote-hint');
    key('ArrowDown');
    expect(focused()).toBe('remote-unpair');
    key('ArrowUp'); key('ArrowUp');
    expect(focused()).toBe('row-remote');

    toRow('notifications');
    key('ArrowRight');
    expect(focused()).toBe('ui-mail-notify-toggle');
    key('Backspace');
    expect(focused()).toBe('row-notifications');

    toRow('updates');
    key('ArrowRight');
    // In the page; no ring round the panel (its buttons hold real focus and show it).
    expect(document.querySelector('[data-settings-preview]')?.getAttribute('data-settings-preview')).toBe('false');
    expect(document.querySelector('[data-settings-focus="updates-content"]')?.getAttribute('data-focused')).not.toBe('true');
    key('ArrowUp');
    expect(focused()).toBe('row-updates');
  });

  it('an admin gets App alerts and AI, and Left from either panel comes back', () => {
    flags.admin = true;
    render(<Settings onBack={vi.fn()} />);
    expect(rows().slice(-2)).toEqual(['alerts', 'ai']);
    toRow('alerts');
    key('ArrowRight');
    expect(document.querySelector('[data-settings-focus="alerts-content"]')?.getAttribute('data-focused')).toBe('true');
    key('ArrowLeft');
    expect(focused()).toBe('row-alerts');
    key('ArrowDown');
    key('ArrowRight');
    expect(document.querySelector('[data-settings-focus="ai-content"]')?.getAttribute('data-focused')).toBe('true');
    key('Escape');
    expect(focused()).toBe('row-ai');
  });

  it('the language tiles keep Left / Right between them, OK picks one, and Left from the first goes to the menu', async () => {
    render(<Settings onBack={vi.fn()} />);
    toRow('language');
    key('ArrowRight');
    // The remote lands on the language in use.
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
    expect(focused()).toBe('row-language');
  });

  it('a tap on a row opens its page with the remote in it', () => {
    render(<Settings onBack={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-settings-row="remote"]')!);
    expect(page()).toBe('remote');
    expect(focused()).toBe('remote-hint');
  });
});
