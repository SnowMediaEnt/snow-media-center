import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Support, already on screen, asked for one of its tools (voice, the assistant).
vi.mock('@/hooks/useUnreadTickets', () => ({ useUnreadTickets: () => ({ unreadCount: 0 }) }));
vi.mock('@/hooks/useSnowMail', () => ({ useSnowMail: () => ({ badgeCount: 0 }) }));
vi.mock('@/hooks/useAppData', () => ({ useAppData: () => ({ apps: [] }) }));
vi.mock('@/hooks/useDeviceInstalledApps', () => ({ useDeviceInstalledApps: () => ({ resolvePackageName: () => null, isPackageInstalled: () => false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock('@/components/SpeedTest', () => ({ default: () => <div>speed-test</div> }));
vi.mock('@/components/BufferingGuide', () => ({ default: () => <div>buffering-guide</div> }));
vi.mock('@/components/SupportVideos', () => ({ default: () => <div>support-videos</div> }));
vi.mock('@/components/SupportTicketSystem', () => ({ default: () => <div>tickets</div> }));
vi.mock('@/components/SnowMailPanel', () => ({ default: () => <div>posts</div> }));
vi.mock('@/components/ChatCommunity', () => ({ default: () => <div>ai-chat</div> }));
vi.mock('@/components/HowToGuide', () => ({ default: () => <div>how-to</div> }));
vi.mock('@/components/RemoteSupport', () => ({ default: () => <div>remote</div> }));
vi.mock('@/components/DeviceCleaner', () => ({ default: () => <div>cleaner</div> }));

import { INTENT_KEYS, openScreen, PLAYER_INTENT_EVENT, SCREEN_INTENT_EVENT, takeIntent, type PlayerIntent } from '@/lib/appActions';
import Support from '@/components/Support';

beforeEach(() => {
  sessionStorage.clear();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { sessionStorage.clear(); });

describe('openScreen on a screen that is already open', () => {
  it.each([
    ['guide', { section: 'guide' }],
    ['plex', { section: 'movies' }],
    ['multi_screen', { section: 'multi' }],
    ['player_settings', { section: 'live', settings: 'hub' }],
  ] as const)('tells an open Player about %s, so nothing waits for the next visit', (s, want) => {
    const seen: PlayerIntent[] = [];
    // The open Player: acts on the event and clears the stored copy.
    const player = (e: Event) => { takeIntent(INTENT_KEYS.player); seen.push((e as CustomEvent<PlayerIntent>).detail); };
    window.addEventListener(PLAYER_INTENT_EVENT, player);
    openScreen(s, vi.fn());
    window.removeEventListener(PLAYER_INTENT_EVENT, player);
    expect(seen).toEqual([want]);
    expect(sessionStorage.getItem(INTENT_KEYS.player)).toBeNull();
  });

  it('tells an open Support about its tools', () => {
    const views: string[] = [];
    const on = (e: Event) => views.push((e as CustomEvent<string>).detail);
    window.addEventListener(SCREEN_INTENT_EVENT, on);
    openScreen('speed_test', vi.fn());
    openScreen('wallpaper', vi.fn());
    window.removeEventListener(SCREEN_INTENT_EVENT, on);
    expect(views).toEqual(['support', 'settings']);
  });

  it('Support opens the tool at once and leaves nothing for the next visit', async () => {
    render(<Support onBack={vi.fn()} />);
    expect(screen.queryByText('speed-test')).toBeNull();
    await act(async () => { openScreen('speed_test', vi.fn()); });
    expect(screen.getByText('speed-test')).toBeTruthy();
    expect(sessionStorage.getItem(INTENT_KEYS.support)).toBeNull();

    await act(async () => { openScreen('support_videos', vi.fn()); });
    expect(await screen.findByText('support-videos')).toBeTruthy();
    expect(sessionStorage.getItem(INTENT_KEYS.support)).toBeNull();
  });
});
