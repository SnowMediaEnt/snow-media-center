/**
 * Back from a full-screen channel goes back where the channel was opened
 * from: Live TV's list of that category, the channel highlighted, never out
 * of the Player to Home, whether it was picked in the list or handed over
 * from Home's content bar. The panels over the picture (Recently watched on
 * ▶, the channel list on ◀) close first, one press each.
 *
 * The whole Player with the real Live TV section; the remote's Back as the box
 * delivers it (Capacitor's backButton, turned into an Escape by the shell).
 * Invented names only.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamLiveStream } from '@/lib/xtream';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

const h = vi.hoisted(() => ({ back: [] as Array<() => void> }));
const NEWS: XtreamLiveStream[] = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
];
const SPORTS: XtreamLiveStream[] = [
  { stream_id: 201, name: 'Sports One', num: 3, category_id: '2' },
  { stream_id: 202, name: 'Sports Two', num: 4, category_id: '2' },
];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => ({ host: 'http://h.test', username: 'u', password: 'p', serverLabel: 'Acme TV', output: 'ts' }),
  bumpXtreamRefresh: vi.fn(),
  clearLiveCatalogue: vi.fn(),
  loadSavedAccounts: async () => [],
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'Sports' }],
  getLiveStreams: async (_l: unknown, cat?: string) => (
    cat === '1' ? NEWS.map((c) => ({ ...c })) : cat === '2' ? SPORTS.map((c) => ({ ...c })) : [...NEWS, ...SPORTS].map((c) => ({ ...c }))
  ),
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 4, byCat: {} }),
}));
vi.mock('@/lib/favoritesSync', async (orig) => ({
  ...(await orig<typeof import('@/lib/favoritesSync')>()),
  scheduleFavoritesPushForLine: vi.fn(),
  reconcileFavoritesForLine: vi.fn(async () => null),
  flushFavoritesPush: vi.fn(),
}));
vi.mock('@/lib/channelStatus', async (orig) => ({
  ...(await orig<typeof import('@/lib/channelStatus')>()),
  useDownChannels: () => new Set<string>(),
  signalChannel: vi.fn(),
}));
vi.mock('@/lib/liveLayout', async (orig) => ({
  ...(await orig<typeof import('@/lib/liveLayout')>()),
  useLiveLayout: () => 'classic',
  hasLiveLayoutChoice: () => true,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/hooks/usePlayerServerAlert', () => ({ usePlayerServerAlert: () => ({ alert: null, dismiss: vi.fn(), appLabel: null }) }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: null, days: null }) }));
vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: '1.0.0' }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn(async () => ({ data: null, error: null })) } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackAlertShown: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), hasSessionFlag: () => false, getDeviceId: () => 'd' }));
vi.mock('@/lib/plex', () => ({ clearPlexToken: vi.fn() }));
vi.mock('@/lib/playerAutoSignIn', () => ({ autoSignInPlayer: async () => null, clearPlayerSignedOut: vi.fn(), markPlayerSignedOut: vi.fn() }));
vi.mock('@/lib/playerAccountSync', () => ({ syncPlayerAccountToCloud: vi.fn() }));
vi.mock('@/lib/playerSigninCapture', () => ({ capturePlayerSignin: vi.fn() }));
vi.mock('@/lib/accountClaim', () => ({ isClaimDismissed: () => true, isClaimDone: () => true, markClaimDismissed: vi.fn() }));
vi.mock('@/lib/watchHistory', async (orig) => ({ ...(await orig<typeof import('@/lib/watchHistory')>()), recordChannelWatch: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (ev: string, fn: () => void) => {
      if (ev === 'backButton') h.back.push(fn);
      return { remove: () => { h.back = h.back.filter((f) => f !== fn); } };
    },
  },
}));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: (i: number) => number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({ index: i, key: i, start: i * estimateSize(i), size: estimateSize(i), lane: 0, end: (i + 1) * estimateSize(i) })),
    getTotalSize: () => count * estimateSize(0),
    measure: () => undefined,
    scrollToOffset: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));
vi.mock('./livetv/VideoPlayer', () => ({ default: () => <div data-testid="video" /> }));
vi.mock('./livetv/PlexSection', () => ({ default: () => <div>plex-section</div> }));
vi.mock('./livetv/SettingsHub', () => ({ default: () => <div>settings-hub</div> }));
vi.mock('./livetv/PlayerServerAlertDialog', () => ({ default: () => null }));
vi.mock('./livetv/ExpirationNoticeDialog', () => ({ default: () => null }));

import LiveTV from './LiveTV';
import { INTENT_KEYS } from '@/lib/appActions';
import { __setViewerForTests } from '@/lib/viewer';

const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const until = async (fn: () => boolean) => { for (let i = 0; i < 300 && !fn(); i++) await settle(20); return fn(); };
const press = (k: string) => {
  act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : k === 'Escape' ? 27 : undefined }); });
  act(() => { fireEvent.keyUp(window, { key: k }); });
};
/** The remote's Back button, as the box delivers it. */
const hwBack = async () => { await act(async () => { for (const f of [...h.back]) f(); await Promise.resolve(); }); await settle(30); };
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const text = () => document.body.textContent ?? '';
const barUp = () => !!q('[data-howto="bar.root"]');
const barTitle = () => q('[data-howto="bar.channel"] h2')?.textContent ?? '';
const fullScreen = () => !q('[data-cat-idx]') && !!q('[data-testid="video"]');
const listFocus = () => [...document.querySelectorAll('[data-focused="true"]')]
  .filter((el) => !el.hasAttribute('data-cat-idx') && !el.closest('[data-recent-panel]'))
  .map((el) => el.textContent ?? '').join('|');

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); h.back = [];
  __setViewerForTests('device');
  sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'live', home: true }));
});
afterEach(() => { cleanup(); document.documentElement.className = ''; });

describe('Back from full screen goes back where the channel came from, never Home', { timeout: 30_000 }, () => {
  it('picked in the list: Recently watched (▶) and the channel list (◀) close first, then the bar, then the list on that channel', async () => {
    const onBack = vi.fn();
    render(<LiveTV onBack={onBack} />);
    // Live TV opens with the highlight on its categories (News).
    await until(() => text().includes('News One'));
    await settle(50);
    press('ArrowRight'); // News → its channels
    await until(() => listFocus().includes('News One'));
    press('ArrowDown'); // News Two
    press('Enter');
    await until(() => fullScreen() && barUp());
    await hwBack(); // hides the bar
    expect(barUp()).toBe(false);
    expect(fullScreen()).toBe(true);
    press('ArrowRight');
    expect(q('[data-recent-panel="picture"]')).not.toBeNull();
    await hwBack();
    expect(q('[data-recent-panel]')).toBeNull();
    expect(fullScreen()).toBe(true);
    press('ArrowLeft');
    expect(q('[data-channel-overlay]')).not.toBeNull();
    await hwBack();
    expect(q('[data-channel-overlay]')).toBeNull();
    expect(fullScreen()).toBe(true);
    await hwBack();
    await until(() => text().includes('Search channels'));
    expect(fullScreen()).toBe(false);
    expect(listFocus()).toContain('News Two');
    expect(onBack).not.toHaveBeenCalled();
  });

  it('handed over from Home\'s content bar: Back lands on its own category in the list, the channel highlighted', async () => {
    const onBack = vi.fn();
    sessionStorage.setItem('smc-live-deeplink', JSON.stringify({ host: 'http://h.test', username: 'u', streamId: 202, name: 'Sports Two', num: 4, categoryId: '2' }));
    render(<LiveTV onBack={onBack} />);
    await until(() => fullScreen() && barTitle().includes('Sports Two'));
    expect(fullScreen()).toBe(true);
    await hwBack(); // hides the bar
    await hwBack(); // leaves the picture
    await until(() => listFocus().includes('Sports Two'));
    expect(listFocus()).toContain('Sports Two');
    expect(text()).toContain('Sports One');
    expect(onBack).not.toHaveBeenCalled();
  });
});
