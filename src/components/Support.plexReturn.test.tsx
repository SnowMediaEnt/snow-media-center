import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Support opened from a film for the Buffering Guide, and the way back to it
// (the film's link, plexDeeplink.ts). The guide itself is a stand-in.
vi.mock('@/hooks/useUnreadTickets', () => ({ useUnreadTickets: () => ({ unreadCount: 0 }) }));
vi.mock('@/hooks/useSnowMail', () => ({ useSnowMail: () => ({ badgeCount: 0 }) }));
vi.mock('@/hooks/useAppData', () => ({ useAppData: () => ({ apps: [] }) }));
vi.mock('@/hooks/useDeviceInstalledApps', () => ({ useDeviceInstalledApps: () => ({ resolvePackageName: () => null, isPackageInstalled: () => false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock('@/components/SpeedTest', () => ({ default: () => <div>speed-test</div> }));
vi.mock('@/components/BufferingGuide', () => ({
  default: ({ onClose, origin }: { onClose: () => void; origin?: string | null }) => (
    <button type="button" onClick={onClose}>{origin === 'plex-movie' ? 'Back to Player' : 'Close'}</button>
  ),
}));
vi.mock('@/components/SupportVideos', () => ({ default: () => <div>support-videos</div> }));
vi.mock('@/components/SupportTicketSystem', () => ({ default: () => <div>tickets</div> }));
vi.mock('@/components/SnowMailPanel', () => ({ default: () => <div>posts</div> }));
vi.mock('@/components/ChatCommunity', () => ({ default: () => <div>ai-chat</div> }));
vi.mock('@/components/HowToGuide', () => ({ default: () => <div>how-to</div> }));
vi.mock('@/components/RemoteSupport', () => ({ default: () => <div>remote</div> }));
vi.mock('@/components/DeviceCleaner', () => ({ default: () => <div>cleaner</div> }));

import Support from '@/components/Support';
import { handPlexDeeplink, peekPlexDeeplink } from '@/lib/plexDeeplink';

const MIN = 60 * 1000;
let now = 0;

// As PlexSection's stashPlexReturn leaves it on the way to the guide.
const leaveFilm = (at: number) => {
  sessionStorage.setItem('smc-guide-origin', 'plex-movie');
  handPlexDeeplink({ ratingKey: 'h1', title: 'Heat', kind: 'movie' }, at);
};
const openGuide = () => act(async () => { window.dispatchEvent(new Event('support:open-buffering-guide')); });

beforeEach(() => {
  sessionStorage.clear();
  now = 1_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

describe('Support opened from a film for the Buffering Guide', () => {
  it('Back to Player lands on the film however long the guide was read', async () => {
    leaveFilm(now);
    const onNavigate = vi.fn();
    render(<Support onBack={vi.fn()} onNavigate={onNavigate} />);
    await openGuide();
    now += 10 * MIN;
    fireEvent.click(screen.getByText('Back to Player'));
    expect(onNavigate).toHaveBeenCalledWith('livetv');
    expect(peekPlexDeeplink()?.link.ratingKey).toBe('h1');
  });

  it('leaving Support another way keeps the film for a Player opened straight after', async () => {
    leaveFilm(now);
    const { unmount } = render(<Support onBack={vi.fn()} />);
    now += 10 * MIN;
    unmount();
    expect(peekPlexDeeplink()?.link.ratingKey).toBe('h1');
  });

  it('an origin an earlier visit left behind does not bring an old film back', async () => {
    leaveFilm(now);
    now += 30 * MIN;
    const onNavigate = vi.fn();
    const first = render(<Support onBack={vi.fn()} onNavigate={onNavigate} />);
    first.unmount();
    expect(peekPlexDeeplink()).toBeNull();
    // Nor through the guide's Back to Player, which still says so.
    render(<Support onBack={vi.fn()} onNavigate={onNavigate} />);
    await openGuide();
    fireEvent.click(screen.getByText('Back to Player'));
    expect(onNavigate).toHaveBeenCalledWith('livetv');
    expect(peekPlexDeeplink()).toBeNull();
  });
});
