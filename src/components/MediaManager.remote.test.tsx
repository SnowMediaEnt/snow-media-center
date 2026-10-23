import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The slim Media Manager (owner: the AI box was "thick", the sides wasted):
// the prompt and its buttons share a row, the type and Choose File share a
// row, and the gallery takes as many columns as fit. The remote still walks
// every control: Down/Up in reading order, Left/Right along a row, and the
// gallery's Up/Down step by the columns that are drawn.
const ASSETS = Array.from({ length: 7 }, (_, i) => ({
  id: `a${i}`, name: `Picture ${i}`, file_path: `p/${i}.jpg`, asset_type: 'background', section: 'home',
  is_active: i === 1, rotation_order: i, created_at: '', updated_at: '',
}));

vi.mock('@/hooks/useMediaAssets', () => ({
  useMediaAssets: () => ({
    assets: ASSETS, loading: false, uploadAsset: vi.fn(), toggleAssetActive: vi.fn(), deleteAsset: vi.fn(),
    getAssetUrl: (p: string) => `https://img.test/${p}`,
  }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' }, session: { user: { id: 'u1' } } }) }));
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => ({ profile: { credits: 50 }, checkCredits: () => true, deductCredits: vi.fn(), fetchProfile: vi.fn() }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => false, isHowtoCapture: () => false }));
vi.mock('@/lib/kidsFilter', () => ({ kidsLevel: () => null }));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'dev', trackEvent: vi.fn() }));
vi.mock('@/lib/aiTiers', () => ({
  getPreferredTier: () => 'free', setPreferredTier: vi.fn(), describeReceipt: () => null,
  premiumTrialUsed: async () => true,
  loadAiTiers: async () => ({ image: { premium: { gems: 5, model: 'top' } } }),
}));
vi.mock('@/components/FreeAiBlockedDialog', () => ({ default: () => null }));

import MediaManager from './MediaManager';

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
/** The control the remote is on: the one wearing the ice highlight. */
const at = () => document.querySelector('.ring-brand-ice')?.closest('[data-focus-id]')?.getAttribute('data-focus-id') ?? null;

const mount = (onExitLeft = vi.fn()) => render(
  <MemoryRouter>
    <MediaManager onBack={vi.fn()} onExitLeft={onExitLeft} embedded isActive />
  </MemoryRouter>,
);

let widthSpy: PropertyDescriptor | undefined;
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  widthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
});
afterEach(() => {
  if (widthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthSpy);
});

describe('Media Manager on the remote', () => {
  it('walks the prompt row and the upload row: Down in order, Left/Right along each row', async () => {
    const onExitLeft = vi.fn();
    mount(onExitLeft);
    await waitFor(() => expect(document.querySelector('[data-focus-id="tier-btn"]')).toBeTruthy());

    key('ArrowDown');
    expect(at()).toBe('generate-btn');
    key('ArrowRight');
    expect(at()).toBe('tier-btn');
    key('ArrowLeft');
    expect(at()).toBe('generate-btn');
    key('ArrowLeft');
    expect(at()).toBe('prompt-input');

    key('ArrowDown'); key('ArrowDown');
    expect(at()).toBe('asset-type');
    // Choose File stands beside the type: Right reaches it, Left comes back
    // (not out of the page).
    key('ArrowRight');
    expect(at()).toBe('file-input');
    key('ArrowLeft');
    expect(at()).toBe('asset-type');
    expect(onExitLeft).not.toHaveBeenCalled();
    key('ArrowLeft');
    expect(onExitLeft).toHaveBeenCalledTimes(1);

    key('ArrowDown');
    expect(at()).toBe('file-input');
    key('ArrowDown');
    expect(at()).toBe('asset-0');
    key('ArrowUp');
    expect(at()).toBe('file-input');
  });

  it('OK on the type steps through Background, Icon, Logo, Other', async () => {
    mount();
    key('ArrowDown'); key('ArrowDown');
    expect(at()).toBe('asset-type');
    const typeBtn = () => document.querySelector('[data-focus-id="asset-type"]')!.textContent ?? '';
    expect(typeBtn()).toMatch(/background/i);
    key('Enter');
    expect(typeBtn()).toMatch(/icon/i);
    key('Enter'); key('Enter');
    expect(typeBtn()).toMatch(/other/i);
    key('Enter');
    expect(typeBtn()).toMatch(/background/i);
    // Back from the type goes up to the prompt (it was taken for a gallery card).
    key('Escape');
    expect(at()).toBe('prompt-input');
  });

  it('draws the gallery as many across as fit, and Up/Down step by that many', async () => {
    // Beside Settings' tab column at 960x540 the gallery is about 610 px: four across.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 610 });
    mount();
    const grid = document.querySelector('[data-focus-id="asset-0"]')!.parentElement!;
    await waitFor(() => expect(grid.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))'));

    key('ArrowDown'); key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(at()).toBe('asset-0');
    key('ArrowDown');
    expect(at()).toBe('asset-4');
    key('ArrowRight'); key('ArrowRight');
    expect(at()).toBe('asset-6');
    key('ArrowUp');
    expect(at()).toBe('asset-2');
    key('ArrowRight');
    expect(at()).toBe('asset-3');
    key('ArrowRight'); // the row's last card: Right stays
    expect(at()).toBe('asset-3');

    // OK opens the card's buttons; Back steps out to the card again.
    key('Enter');
    expect(at()).toBe('asset-toggle-a3');
    key('ArrowRight');
    expect(at()).toBe('asset-delete-a3');
    key('Escape');
    expect(at()).toBe('asset-3');
  });

  it('a card takes the highlight from the last button, which lets go of its focus', () => {
    mount();
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(at()).toBe('file-input');
    expect(document.activeElement?.getAttribute('data-focus-id')).toBe('file-input');
    key('ArrowDown');
    expect(at()).toBe('asset-0');
    // Choose File would otherwise keep its focus ring beside the card's highlight.
    expect(document.activeElement?.getAttribute('data-focus-id')).not.toBe('file-input');
  });
});
