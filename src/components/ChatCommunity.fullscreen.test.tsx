import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Support → AI Chat: opening the ask box for typing turns the chat full
// screen; Back closes the keyboard first, then full screen, then Support.
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

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const frames = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
const key = (k: string) => act(async () => { fireEvent.keyDown(document.activeElement ?? window, { key: k }); });
const fullScreen = () => document.querySelector('[data-ai-fullscreen="true"]');
const askBox = () => document.querySelector('[data-howto="ai.input"]') as HTMLInputElement;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { response: 'Tonight: **AEW All Out**' }, error: null });
  globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ currentVersion: '1.0' }) })) as unknown as typeof fetch;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollBy = vi.fn() as unknown as typeof Element.prototype.scrollBy;
});
afterEach(() => { vi.restoreAllMocks(); });

async function openEmbeddedChat(onBack = vi.fn()) {
  render(<ChatCommunity onBack={onBack} embedded lockedTab="ai" />);
  await flush();
  // Support's Down from the AI Chat tab hands the remote to the chat.
  await act(async () => { window.dispatchEvent(new Event('chat-community:focus-ai-input')); });
  await frames();
  return onBack;
}

describe('AI chat full screen', () => {
  it('opens when the ask box is opened for typing, and Back leaves it one step at a time', async () => {
    const onBack = await openEmbeddedChat();
    expect(fullScreen()).toBeNull();
    // The ask box keeps its How-to hook and stays a plain text box.
    expect(askBox().getAttribute('type')).toBe('text');
    expect(askBox().hasAttribute('enterkeyhint')).toBe(false);

    // OK on the highlighted ask box opens it for typing.
    await key('Enter');
    await frames();
    expect(document.activeElement).toBe(askBox());
    expect(fullScreen()).not.toBeNull();
    expect(fullScreen()?.getAttribute('aria-modal')).toBe('true');

    // Back: the keyboard first (the box lets go), still full screen.
    await key('Escape');
    expect(document.activeElement).not.toBe(askBox());
    expect(fullScreen()).not.toBeNull();
    expect(onBack).not.toHaveBeenCalled();

    // Back again (a separate press): full screen closes, Support stays.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    await key('Escape');
    expect(fullScreen()).toBeNull();
    expect(onBack).not.toHaveBeenCalled();

    // And the next Back leaves Support as before.
    await key('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('stays full screen after sending and shows the reply without Markdown marks', async () => {
    await openEmbeddedChat();
    await key('Enter');
    await frames();
    fireEvent.change(askBox(), { target: { value: 'What PPV is on?' } });
    await key('Enter');
    await flush();
    await flush();
    expect(fullScreen()).not.toBeNull();
    expect(screen.getByText('AEW All Out').tagName).toBe('STRONG');
    expect(fullScreen()?.textContent).not.toContain('**');
  });

  it('a tap on the ask box opens full screen too', async () => {
    await openEmbeddedChat();
    await act(async () => { askBox().focus(); });
    expect(fullScreen()).not.toBeNull();
  });
});
