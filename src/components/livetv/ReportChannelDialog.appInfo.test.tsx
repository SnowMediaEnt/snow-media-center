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
