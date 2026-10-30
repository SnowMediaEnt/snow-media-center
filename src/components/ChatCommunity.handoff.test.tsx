import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Support › Device check's "Ask the assistant" (lib/assistantHandoff): the
// handed message is sent once, as the viewer's own, when the chat opens or
// while it is open; never twice.
const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'delete', 'in', 'neq', 'gte', 'lte', 'match', 'is']) chain[k] = self;
  chain.single = () => Promise.resolve({ data: null, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
  return {
    supabase: {
      functions: { invoke: (...a: unknown[]) => invoke(...a) },
      from: () => chain,
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => undefined,
    },
  };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => ({ profile: null, checkCredits: () => true, deductCredits: vi.fn(), fetchProfile: vi.fn() }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock('@/hooks/useSupportTickets', () => ({
  useSupportTickets: () => ({ tickets: [], messages: [], loading: false, fetchTicketMessages: vi.fn(), createTicket: vi.fn(), sendMessage: vi.fn(), closeTicket: vi.fn(), deleteTicket: vi.fn() }),
}));
vi.mock('@/hooks/useAIConversations', () => ({
  useAIConversations: () => ({ conversations: [], fetchConversations: vi.fn(), fetchConversationMessages: vi.fn(), deleteConversation: vi.fn() }),
}));
vi.mock('@/lib/aiTiers', () => ({
  loadAiTiers: () => Promise.resolve({ chat: null }),
  getPreferredTier: () => 'free',
  setPreferredTier: vi.fn(),
  premiumTrialUsed: () => Promise.resolve(true),
  describeReceipt: () => null,
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), getDeviceId: () => 'dev' }));

import ChatCommunity from '@/components/ChatCommunity';
import { handAssistant, hasAssistantHandoff } from '@/lib/assistantHandoff';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const aiCalls = () => invoke.mock.calls.filter((c) => c[0] === 'snow-media-ai');

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { response: 'Your Wi-Fi is the first thing to fix.' }, error: null });
  globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ currentVersion: '1.0' }) })) as unknown as typeof fetch;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollBy = vi.fn() as unknown as typeof Element.prototype.scrollBy;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('AI chat handoff', () => {
  it('sends a message handed before the chat opens, once', async () => {
    handAssistant('Explain my device check');
    render(<ChatCommunity onBack={vi.fn()} embedded lockedTab="ai" />);
    await flush();
    await flush();
    expect(aiCalls()).toHaveLength(1);
    expect((aiCalls()[0][1] as { body: { message: string } }).body.message).toBe('Explain my device check');
    expect(hasAssistantHandoff()).toBe(false);
    await flush();
    expect(aiCalls()).toHaveLength(1);
  });

  it('sends one handed while the chat is open', async () => {
    render(<ChatCommunity onBack={vi.fn()} embedded lockedTab="ai" />);
    await flush();
    expect(aiCalls()).toHaveLength(0);
    await act(async () => { handAssistant('Second question'); });
    await flush();
    await flush();
    expect(aiCalls()).toHaveLength(1);
    expect((aiCalls()[0][1] as { body: { message: string } }).body.message).toBe('Second question');
  });
});
