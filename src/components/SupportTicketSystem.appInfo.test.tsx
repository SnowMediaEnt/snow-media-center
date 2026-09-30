import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { createTicket, invoke, auth } = vi.hoisted(() => ({
  createTicket: vi.fn(async () => 'ticket-1'),
  invoke: vi.fn(async () => ({ error: null })),
  auth: { user: null as { id: string } | null },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: auth.user, signUp: vi.fn(), loading: false }) }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: null, loading: false }) }));
vi.mock('@/hooks/useSupportTickets', () => ({
  useSupportTickets: () => ({
    tickets: [], messages: {}, loading: false, fetchTicketMessages: vi.fn(async () => undefined),
    createTicket, sendMessage: vi.fn(), closeTicket: vi.fn(), deleteTicket: vi.fn(),
  }),
}));
vi.mock('@/hooks/useAIConversations', () => ({
  useAIConversations: () => ({
    conversations: [], messages: {}, loading: false, fetchConversationMessages: vi.fn(),
    createConversation: vi.fn(), sendMessage: vi.fn(), deleteConversation: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/playerLogin', () => ({ tryPlayerBridge: vi.fn(async () => null) }));
vi.mock('@/utils/platform', async () => {
  const real = await vi.importActual<typeof import('@/utils/platform')>('@/utils/platform');
  return { ...real, isNativePlatform: () => true };
});
vi.mock('@/capacitor/AppManager', () => ({
  AppManager: { getAppInfo: async () => ({ versionName: '1.8.0', versionCode: 55, packageName: 'com.snowmedia.player' }) },
}));

import SupportTicketSystem from './SupportTicketSystem';

const fileTicket = async () => {
  render(<SupportTicketSystem onBack={vi.fn()} />);
  fireEvent.click(document.querySelector('[data-tv-focus-id="new-ticket"]') as HTMLElement);
  fireEvent.change(document.querySelector('input[data-tv-focus-id="create-subject"]') as HTMLInputElement, { target: { value: 'Buffering' } });
  fireEvent.change(document.querySelector('textarea[data-tv-focus-id="create-message"]') as HTMLTextAreaElement, { target: { value: 'It stops all the time' } });
  await act(async () => {
    fireEvent.click(document.querySelector('[data-tv-focus-id="create-submit"]') as HTMLElement);
    await new Promise((r) => setTimeout(r, 50));
  });
};

beforeEach(() => { vi.clearAllMocks(); });

describe('Support ticket carries the app version', () => {
  it('signed in: the ticket message starts with version and build', async () => {
    auth.user = { id: 'u1' };
    await fileTicket();
    const [, message] = createTicket.mock.calls[0] as unknown as [string, string];
    expect(message.split('\n')[0]).toBe('App: Snow Media Center 1.8.0 (build 55)');
    expect(message).toContain('It stops all the time');
  });

  it('signed out: the guest report message starts with version and build', async () => {
    auth.user = null;
    await fileTicket();
    const call = invoke.mock.calls[0] as unknown as [string, { body: { message: string } }];
    expect(call[0]).toBe('report-channel');
    expect(call[1].body.message.split('\n')[0]).toBe('App: Snow Media Center 1.8.0 (build 55)');
    expect(call[1].body.message).toContain('It stops all the time');
  });
});
