// A channel or category on a service added from elsewhere (lib/outsideSource):
// not ours to fix, and nothing about it reaches our servers. Its hold menu
// has no "Report" and no "It's working now"; it says who to ask instead. The
// favourite row stays (favourites of an outside service live on the box).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTicket, invoke } = vi.hoisted(() => ({
  createTicket: vi.fn(async () => undefined),
  invoke: vi.fn(async () => ({ error: null })),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useSupportTickets', () => ({ useSupportTickets: () => ({ createTicket }) }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: null }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

import ChannelDialog from './ReportChannelDialog';
import CategoryDialog from './ReportCategoryDialog';

const OUT = { host: 'http://other.tv:8000', username: 'bob', password: 'hunter22', output: 'm3u8' as const, serverLabel: 'Other TV', outside: true as const };
const NOTE = 'Outside service — report problems to that provider.';
const rows = () => Array.from(document.querySelectorAll('[role="dialog"] button')).map((b) => b.textContent);
const press = async (key: string) => {
  await act(async () => {
    fireEvent.keyDown(window, { key });
    fireEvent.keyUp(window, { key });
    await new Promise((r) => setTimeout(r, 20));
  });
};

beforeEach(() => { vi.clearAllMocks(); });

describe('the hold menu on an outside channel', () => {
  it('no Report and no "It\'s working now"; a line says who to ask; Favorite still works', async () => {
    const onToggleFavorite = vi.fn();
    const onReportedDown = vi.fn();
    render(<ChannelDialog channelName="Other News" channelId={7} line={OUT} isDown onClearDown={vi.fn()} onReportedDown={onReportedDown} onToggleFavorite={onToggleFavorite} onClose={() => {}} />);
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(rows()).toEqual(['Add to Favorites', 'Cancel']);
    fireEvent.keyUp(window, { key: 'Enter' });
    await press('Enter');
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onReportedDown).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('a report handed in from elsewhere (the assistant) is not filed for it', async () => {
    const onClose = vi.fn();
    render(<ChannelDialog channelName="Other News" channelId={7} line={OUT} initialChoice="Channel down" onClose={onClose} />);
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(rows()).toEqual(['Cancel']);
    fireEvent.keyUp(window, { key: 'Enter' });
    await press('Enter');
    expect(onClose).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('one of our channels keeps its Report row (the control)', () => {
    render(<ChannelDialog channelName="News One" channelId={7} line={{ ...OUT, host: 'http://dstreams.xyz:8080', outside: undefined }} onClose={() => {}} />);
    expect(rows()).toContain('Report Channel');
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe('the hold menu on an outside category', () => {
  it('only Cancel, and who to ask; nothing is reported', async () => {
    const onReportedDown = vi.fn();
    const onClose = vi.fn();
    render(<CategoryDialog categoryName="Sports" categoryId="3" line={OUT} isDown onReportedDown={onReportedDown} onClearDown={vi.fn()} onClose={onClose} />);
    expect(rows()).toEqual(['Cancel']);
    expect(screen.getByText(NOTE)).toBeTruthy();
    fireEvent.keyUp(window, { key: 'Enter' });
    await press('Enter');
    expect(onClose).toHaveBeenCalled();
    expect(onReportedDown).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
