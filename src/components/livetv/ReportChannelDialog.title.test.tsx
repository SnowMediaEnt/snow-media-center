// The channel report, for a title held in Movies / Series / Plex: its own
// reasons (Won't play, Buffering, No audio, Wrong title or no subtitles,
// Other), and a ticket that says what kind of title it is. Through
// report-channel as before (the subject keeps the [Channel Report] tag the
// function already knows), so the function needs no change.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTicket, invoke, auth } = vi.hoisted(() => ({
  createTicket: vi.fn(async () => undefined),
  invoke: vi.fn(async () => ({ error: null })),
  auth: { user: null as { id: string } | null },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('@/hooks/useSupportTickets', () => ({ useSupportTickets: () => ({ createTicket }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/xtream', async (orig) => ({ ...(await orig<typeof import('@/lib/xtream')>()), loadPlayerAccount: async () => null }));

import Dialog from './ReportChannelDialog';

const ok = () => act(async () => {
  fireEvent.keyDown(window, { key: 'Enter' });
  fireEvent.keyUp(window, { key: 'Enter' });
  await new Promise((r) => setTimeout(r, 50));
});

beforeEach(() => { vi.clearAllMocks(); auth.user = null; });

describe('Report a problem on a title', () => {
  it('a film: "Title options", Report a problem, then the film reasons', async () => {
    render(<Dialog kind="movie" channelName="Big Film" channelId={77} onClose={() => {}} />);
    expect(screen.getByText(/Title options/)).toBeTruthy();
    expect(screen.queryByText('Report Channel')).toBeNull();
    fireEvent.keyUp(window, { key: 'Enter' });
    await ok();
    for (const r of ["Won't play", 'Buffering', 'No audio', 'Wrong title or no subtitles', 'Other']) expect(screen.getByText(r)).toBeTruthy();
    expect(screen.queryByText('Channel down')).toBeNull();
  });

  it('Buffering on a title is sent at once (no channel buffering guide)', async () => {
    render(<Dialog kind="series" channelName="Harbor Lights" channelId={100} initialChoice="Buffering" onClose={() => {}} />);
    fireEvent.keyUp(window, { key: 'Enter' });
    await ok();
    const [fn, opts] = invoke.mock.calls[0] as unknown as [string, { body: { subject: string; message: string } }];
    expect(fn).toBe('report-channel');
    expect(opts.body.subject).toBe('[Channel Report] Series issue: Harbor Lights');
    expect(opts.body.message).toContain('Issue: Buffering');
  });

  it('a Plex title: tagged Plex, with its server and rating key', async () => {
    render(<Dialog kind="plex" channelName="Harbor Lights (2021)" channelId="101" serviceLabel="Plex: Home Server" initialChoice="Wrong title or no subtitles" onClose={() => {}} />);
    fireEvent.keyUp(window, { key: 'Enter' });
    // Wrong title or no subtitles is the 4th reason.
    await act(async () => { fireEvent.keyDown(window, { key: 'Enter' }); fireEvent.keyUp(window, { key: 'Enter' }); await new Promise((r) => setTimeout(r, 50)); });
    const [, opts] = invoke.mock.calls[0] as unknown as [string, { body: { subject: string; message: string } }];
    expect(opts.body.subject).toBe('[Channel Report] Plex issue: Harbor Lights (2021)');
    expect(opts.body.message).toContain('Type: Plex');
    expect(opts.body.message).toContain('Title: Harbor Lights (2021)');
    expect(opts.body.message).toContain('Issue: Wrong title or no subtitles');
    expect(opts.body.message).toContain('Service: Plex: Home Server');
    expect(opts.body.message).toContain('Plex ID: 101');
  });

  it('signed in: the same ticket through the app', async () => {
    auth.user = { id: 'u1' };
    render(<Dialog kind="movie" channelName="Big Film" channelId={77} initialChoice="Won't play" onClose={() => {}} />);
    fireEvent.keyUp(window, { key: 'Enter' });
    await ok();
    const [subject, message] = createTicket.mock.calls[0] as unknown as [string, string];
    expect(subject).toBe('Movie issue: Big Film');
    expect(message).toContain("Issue: Won't play");
  });
});
