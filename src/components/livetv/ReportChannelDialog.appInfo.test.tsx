import { act, fireEvent, render } from '@testing-library/react';
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
vi.mock('@/utils/platform', async () => {
  const real = await vi.importActual<typeof import('@/utils/platform')>('@/utils/platform');
  return { ...real, isNativePlatform: () => true };
});
vi.mock('@/capacitor/AppManager', () => ({
  AppManager: { getAppInfo: async () => ({ versionName: '1.8.0', versionCode: 55, packageName: 'com.snowmedia.player' }) },
}));

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  authenticate: async () => ({ user_info: { username: 'jsmith', password: 'hunter2-secret', active_cons: '2', max_connections: '3', exp_date: '1796083200' } }),
  loadCreds: async () => null,
  loadSavedAccounts: async () => [],
  loadPlayerAccount: async () => null,
}));

import Dialog from './ReportChannelDialog';

const sendReport = async () => {
  render(<Dialog channelName="TNT" channelId={11} categoryName="Sports" initialChoice="Channel down" onClose={() => {}} />);
  fireEvent.keyUp(window, { key: 'Enter' });
  await act(async () => {
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyUp(window, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 50));
  });
};

beforeEach(() => { vi.clearAllMocks(); });

describe('Channel report carries the app version', () => {
  it('signed in: the ticket starts with version and build, then the report fields', async () => {
    auth.user = { id: 'u1' };
    await sendReport();
    const [, message] = createTicket.mock.calls[0] as unknown as [string, string];
    expect(message.split('\n')[0]).toBe('App: Snow Media Center 1.8.0 (build 55)');
    expect(message).toContain('Channel Name: TNT');
    expect(message).toContain('Issue: Channel down');
  });

  it('signed out: the guest report starts with version and build', async () => {
    auth.user = null;
    await sendReport();
    const call = invoke.mock.calls[0] as unknown as [string, { body: { message: string } }];
    expect(call[0]).toBe('report-channel');
    expect(call[1].body.message.split('\n')[0]).toBe('App: Snow Media Center 1.8.0 (build 55)');
    expect(call[1].body.message).toContain('Channel Name: TNT');
  });
});

describe('Channel report carries the line, never its password', () => {
  const line = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'hunter2-secret', output: 'ts' as const, serverLabel: 'Dreamstreams' };
  const send = async (choice: 'Channel down' | 'Other', note?: string) => {
    render(<Dialog channelName="TNT" channelId={11} categoryName="Sports" line={line} initialChoice={choice} initialNote={note} onClose={() => {}} />);
    fireEvent.keyUp(window, { key: 'Enter' });
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' });
      fireEvent.keyUp(window, { key: 'Enter' });
      await new Promise((r) => setTimeout(r, 50));
    });
  };

  it('guest: the username, service, connections and expiry go; the password and host never do', async () => {
    auth.user = null;
    await send('Channel down');
    const payload = JSON.stringify(invoke.mock.calls);
    const message = (invoke.mock.calls[0] as unknown as [string, { body: { message: string } }])[1].body.message;
    expect(message).toContain('Line: jsmith (DreamStreams) · connections 2/3 · expires 2026-12-01');
    expect(payload).not.toContain('hunter2');
    expect(payload).not.toContain('dstreams.xyz');
    expect(payload).not.toContain('player_api');
  });

  it('signed in: the same through the account', async () => {
    auth.user = { id: 'u1' };
    await send('Channel down');
    const [subject, message] = createTicket.mock.calls[0] as unknown as [string, string];
    expect(message).toContain('Line: jsmith (DreamStreams) · connections 2/3');
    expect(`${subject}${message}`).not.toContain('hunter2');
  });
});

describe('Buffering report', () => {
  it('Submit a ticket tells the other boxes (onReportedBuffering) and files the ticket', async () => {
    auth.user = null;
    const onReportedBuffering = vi.fn();
    const onReportedDown = vi.fn();
    render(<Dialog channelName="ESPN" channelId={5} initialChoice="Channel buffering" onReportedBuffering={onReportedBuffering} onReportedDown={onReportedDown} onClose={() => {}} />);
    fireEvent.keyUp(window, { key: 'Enter' });
    // Reasons → Channel buffering → the guide / ticket step.
    fireEvent.keyDown(window, { key: 'Enter' }); fireEvent.keyUp(window, { key: 'Enter' });
    expect(document.body.textContent).toContain('A ticket also warns other viewers before they play it.');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' });
      fireEvent.keyUp(window, { key: 'Enter' });
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onReportedBuffering).toHaveBeenCalledTimes(1);
    expect(onReportedDown).not.toHaveBeenCalled();
    const message = (invoke.mock.calls[0] as unknown as [string, { body: { message: string } }])[1].body.message;
    expect(message).toContain('Issue: Channel buffering');
  });
});
