import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import i18n from '@/i18n';

// Settings › Home screen: the content bar (on/off, Source, Show), the
// Dashboard's size and the Home tiles' Reset, with the remote (OK steps
// through the choices) and with a tap on a choice.
const flags = vi.hoisted(() => ({ admin: false }));
vi.mock('@/hooks/useActiveProfile', () => ({
  useActiveProfile: () => ({ profile: { id: 'main', name: 'Main', avatar: 'blue', kidsLevel: null, pinHash: null, position: 0, t: 0 } }),
}));
vi.mock('@/hooks/useAdminRole', () => ({ useAdminRole: () => ({ isAdmin: flags.admin }) }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => false, isHowtoCapture: () => false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useDeviceAlerts', () => ({ useDeviceAlerts: () => ({ supported: false, status: { enabled: false }, busy: false, setEnabled: vi.fn() }) }));
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => ({ enabled: true }), setFeatureFlag: vi.fn() }));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));
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
import { loadBarPrefs } from '@/lib/homeBar';
import { loadSavedTiles, saveTiles } from '@/lib/homeTiles';
import { readMediaBarEnabled } from '@/hooks/useMediaBarEnabled';

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const focused = () => document.querySelector('[data-settings-focus][data-focused="true"]')?.getAttribute('data-settings-focus');
const chosen = (row: string) => [...document.querySelectorAll(`[data-settings-focus="${row}"] [aria-pressed="true"]`)].map((b) => b.getAttribute('data-choice'));

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  flags.admin = false;
  toastSpy.mockClear();
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

/** Into Home screen (the second row), then Down until `row` has the highlight. */
const toRow = (row: string) => {
  key('ArrowDown'); key('ArrowRight');
  for (let i = 0; i < 12 && focused() !== row; i += 1) key('ArrowDown');
  expect(focused()).toBe(row);
};

describe('Settings › Home screen', () => {
  it('has the content bar, what it shows, the Dashboard size and the tiles, in that order', () => {
    render(<Settings onBack={vi.fn()} />);
    key('ArrowDown'); key('ArrowRight');
    expect(document.querySelector('[data-settings-page]')?.getAttribute('data-settings-page')).toBe('home');
    const ids = [...document.querySelectorAll('[data-settings-page] [data-settings-focus]')].map((e) => e.getAttribute('data-settings-focus'));
    expect(ids).toEqual(['ui-content-bar-toggle', 'ui-home-bar-source', 'ui-home-bar-show', 'ui-dashboard-size-toggle', 'ui-home-tiles-reset']);
    expect(focused()).toBe('ui-content-bar-toggle');
  });

  it('the choice in use has a gold outline and a check, not a fill (one focus look)', () => {
    render(<Settings onBack={vi.fn()} />);
    toRow('ui-home-bar-source');
    const on = document.querySelector('[data-settings-focus="ui-home-bar-source"] [aria-pressed="true"]')!;
    expect(on.className).toContain('border-brand-gold');
    expect(on.className).not.toMatch(/bg-brand-gold/);
    expect(on.querySelector('svg')).not.toBeNull();
  });

  it('OK steps the Source through Live TV and Plex → Live TV only → Plex only → Off → back on', () => {
    render(<Settings onBack={vi.fn()} />);
    toRow('ui-home-bar-source');
    expect(chosen('ui-home-bar-source')).toEqual(['both']);
    key('Enter');
    expect(loadBarPrefs().source).toBe('live');
    expect(chosen('ui-home-bar-source')).toEqual(['live']);
    key('Enter'); key('Enter');
    expect(readMediaBarEnabled()).toBe(false);
    expect(chosen('ui-home-bar-source')).toEqual(['off']);
    key('Enter');
    expect(readMediaBarEnabled()).toBe(true);
    expect(chosen('ui-home-bar-source')).toEqual(['both']);
  });

  it('OK steps what the bar shows; a tap picks one', () => {
    render(<Settings onBack={vi.fn()} />);
    toRow('ui-home-bar-show');
    key('Enter');
    expect(loadBarPrefs().show).toBe('continue');
    fireEvent.click(document.querySelector('[data-settings-focus="ui-home-bar-show"] [data-choice="favorites"]')!);
    expect(loadBarPrefs().show).toBe('favorites');
    expect(chosen('ui-home-bar-show')).toEqual(['favorites']);
  });

  it('Reset puts the four tiles back and says so', () => {
    saveTiles(['guide', 'multi', 'plex', 'store']);
    render(<Settings onBack={vi.fn()} />);
    toRow('ui-home-tiles-reset');
    key('Enter');
    expect(loadSavedTiles()).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Home tiles reset' }));
  });
});
