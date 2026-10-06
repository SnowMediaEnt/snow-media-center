import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Settings → UI → "Rate Snow Media Center": for a grown-up on a signed-in box,
// opens the review screen; not on a Kids profile.
let kidsLevel: string | null = 'kids';
vi.mock('@/hooks/useActiveProfile', () => ({
  useActiveProfile: () => ({ profile: { id: kidsLevel ? 'kid' : 'main', name: kidsLevel ? 'Kid' : 'Main', avatar: 'blue', kidsLevel, pinHash: null, position: 0, t: 0 } }),
}));
vi.mock('@/hooks/useAdminRole', () => ({ useAdminRole: () => ({ isAdmin: true }) }));
let signedIn = true;
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: signedIn ? { id: 'u1', email: 'a@b.c' } : null }) }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
const events = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/analytics', () => ({ trackEvent: (name: string) => { events.push(name); } }));
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
const ENTRY = 'Rate Snow Media Center';

beforeAll(async () => { await import('@/components/review/ReviewDialog'); });
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  events.length = 0;
  signedIn = true;
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

const openUiTab = () => { key('ArrowDown'); key('ArrowRight'); };

describe('Settings → Rate Snow Media Center', () => {
  it('is in the UI tab for a grown-up, and OK opens the review screen', async () => {
    kidsLevel = null;
    const { container } = render(<Settings onBack={vi.fn()} />);
    openUiTab();
    expect(screen.getByText(ENTRY)).toBeTruthy();
    const order = [...container.querySelectorAll('[data-settings-focus^="ui-"]')].map((e) => e.getAttribute('data-settings-focus'));
    expect(order).toContain('ui-rate-app');
    // Walk down to it with the remote.
    for (let i = 0; i < order.indexOf('ui-rate-app') + 1; i += 1) key('ArrowDown');
    expect(container.querySelector('[data-settings-focus="ui-rate-app"]')?.getAttribute('data-focused')).toBe('true');
    key('Enter');
    expect(await screen.findByText('Enjoying Snow Media Center?')).toBeTruthy();
    expect(events).toContain('review_prompt_shown');
  });

  it('is not there on a Kids profile or a signed-out box', () => {
    kidsLevel = 'kids';
    const r = render(<Settings onBack={vi.fn()} />);
    openUiTab();
    expect(screen.queryByText(ENTRY)).toBeNull();
    r.unmount();
    kidsLevel = null;
    signedIn = false;
    render(<Settings onBack={vi.fn()} />);
    openUiTab();
    expect(screen.queryByText(ENTRY)).toBeNull();
  });
});
