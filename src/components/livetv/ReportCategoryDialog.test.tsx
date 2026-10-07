// Hold OK on a category: "Report category down" tells the other boxes and
// sends the desk a ticket with the line's username and connections (never
// its password); "It's working now" shows when it is down.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTicket, invoke, auth, track } = vi.hoisted(() => ({
  createTicket: vi.fn(async () => undefined),
  invoke: vi.fn(async () => ({ error: null })),
  auth: { user: null as { id: string } | null },
  track: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('@/hooks/useSupportTickets', () => ({ useSupportTickets: () => ({ createTicket }) }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: null }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: track }));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  authenticate: async () => ({ user_info: { username: 'jsmith', password: 'hunter2-secret', active_cons: '2', max_connections: '3' } }),
  loadCreds: async () => null,
  loadPlayerAccount: async () => null,
}));

import Dialog from './ReportCategoryDialog';

const line = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'hunter2-secret', output: 'ts' as const, serverLabel: 'Dreamstreams' };
const rows = () => Array.from(document.querySelectorAll('[role="dialog"] button')).map((b) => b.textContent);
const press = async (key: string) => {
  await act(async () => {
    fireEvent.keyDown(window, { key });
    fireEvent.keyUp(window, { key });
    await new Promise((r) => setTimeout(r, 30));
  });
};

beforeEach(() => { vi.clearAllMocks(); auth.user = null; });

describe('ReportCategoryDialog', () => {
  it('reports the category down: the boxes are told and the desk gets a ticket with the line, never the password', async () => {
    const onReportedDown = vi.fn();
    const onClose = vi.fn();
    render(<Dialog categoryName="NFL Sunday" categoryId="12" serviceLabel="DreamStreams" line={line} onReportedDown={onReportedDown} onClearDown={() => {}} onClose={onClose} />);
    expect(rows()).toEqual(['Report category down', 'Cancel']);
    // The hold that opened it: OK counts once it has been let go.
    fireEvent.keyUp(window, { key: 'Enter' });
    await press('Enter');
    expect(onReportedDown).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    const [fn, { body }] = invoke.mock.calls[0] as unknown as [string, { body: { subject: string; message: string } }];
    expect(fn).toBe('report-channel');
    expect(body.subject).toBe('[Channel Report] Category down: NFL Sunday');
    expect(body.message).toContain('Issue: Category down');
    expect(body.message).toContain('Category ID: 12');
    expect(body.message).toContain('Line: jsmith (DreamStreams) · connections 2/3');
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('hunter2');
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('dstreams.xyz');
    expect(onClose).toHaveBeenCalled();
    // The analytics event names the category, never the line's username.
    expect(track).toHaveBeenCalledWith('category_report', 'player', expect.objectContaining({ category: 'NFL Sunday' }));
    expect(JSON.stringify(track.mock.calls)).not.toContain('jsmith');
  });

  it('signed in: the ticket goes through the account', async () => {
    auth.user = { id: 'u1' };
    render(<Dialog categoryName="NFL Sunday" categoryId="12" line={line} onReportedDown={() => {}} onClearDown={() => {}} onClose={() => {}} />);
    fireEvent.keyUp(window, { key: 'Enter' });
    await press('Enter');
    await vi.waitFor(() => expect(createTicket).toHaveBeenCalled());
    const [subject, message] = createTicket.mock.calls[0] as unknown as [string, string];
    expect(subject).toBe('Category down: NFL Sunday');
    expect(message).not.toContain('hunter2');
  });

  it('down now: "It’s working now" leads and clears it', async () => {
    const onClearDown = vi.fn();
    const onReportedDown = vi.fn();
    render(<Dialog categoryName="NFL Sunday" categoryId="12" isDown onReportedDown={onReportedDown} onClearDown={onClearDown} onClose={() => {}} />);
    expect(rows()[0]).toBe("It's working now — remove ⚠️");
    fireEvent.click(screen.getByText("It's working now — remove ⚠️"));
    expect(onClearDown).toHaveBeenCalled();
    expect(onReportedDown).not.toHaveBeenCalled();
  });

  it('Back closes it without reporting', async () => {
    const onClose = vi.fn();
    const onReportedDown = vi.fn();
    render(<Dialog categoryName="News" categoryId="3" onReportedDown={onReportedDown} onClearDown={() => {}} onClose={onClose} />);
    await press('Escape');
    expect(onClose).toHaveBeenCalled();
    expect(onReportedDown).not.toHaveBeenCalled();
  });
});
