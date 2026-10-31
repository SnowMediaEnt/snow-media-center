import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import i18n from '@/i18n';

// The language picker is for every customer: a plain account, an admin, a Kids
// profile, and the website demo. English stays the default.
const flags = vi.hoisted(() => ({ kidsLevel: null as string | null, admin: false, demo: false }));
vi.mock('@/hooks/useActiveProfile', () => ({
  useActiveProfile: () => ({ profile: { id: flags.kidsLevel ? 'kid' : 'main', name: flags.kidsLevel ? 'Kid' : 'Main', avatar: 'blue', kidsLevel: flags.kidsLevel, pinHash: null, position: 0, t: 0 } }),
}));
vi.mock('@/hooks/useAdminRole', () => ({ useAdminRole: () => ({ isAdmin: flags.admin }) }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => flags.demo, isHowtoCapture: () => false }));
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
import { INTENT_KEYS } from '@/lib/appActions';

const NAMES = ['English', 'Español', 'Français', 'Deutsch', 'العربية'];
/** The language tiles on the page (the row's state line shows the language in use too). */
const tiles = () => [...document.querySelectorAll('[data-settings-page] [data-settings-focus^="ui-language-"]')] as HTMLElement[];
const tile = (name: string) => tiles().find((b) => b.textContent === name)!;

/** Settings, opened on its Language page. */
const openLanguage = () => {
  sessionStorage.setItem(INTENT_KEYS.settings, 'language');
  return render(<Settings onBack={vi.fn()} />);
};

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  flags.kidsLevel = null; flags.admin = false; flags.demo = false;
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

describe('Settings language picker', () => {
  it('is shown to an ordinary (non-admin) account, with English selected (an outline and a check, no fill)', () => {
    openLanguage();
    expect(tiles().map((b) => b.textContent)).toEqual(NAMES);
    const english = tile('English');
    expect(english.className).toContain('border-brand-gold');
    expect(english.className).not.toMatch(/bg-brand-gold/);
    expect(document.querySelector('[data-settings-row="language"] [data-settings-state]')?.textContent).toBe('English');
  });

  it('is shown to an admin, on a Kids profile, and in the website demo', () => {
    for (const setup of [() => { flags.admin = true; }, () => { flags.kidsLevel = 'kids'; }, () => { flags.demo = true; }, () => { flags.kidsLevel = 'kids'; flags.demo = true; }]) {
      flags.kidsLevel = null; flags.admin = false; flags.demo = false;
      setup();
      const { unmount } = openLanguage();
      expect(document.querySelector('[data-settings-row="language"]')).not.toBeNull();
      expect(tiles().map((b) => b.textContent)).toEqual(NAMES);
      unmount();
    }
  });

  it('changes the language of the screen when a customer picks one, and back again', async () => {
    openLanguage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Settings');

    fireEvent.click(tile('Español'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ajustes'));
    expect(document.querySelector('[data-settings-row="language"] [data-settings-label]')?.textContent).toBe('Idioma');
    expect(localStorage.getItem('smc_lang')).toBe('es');

    fireEvent.click(tile('English'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Settings'));
  });
});
