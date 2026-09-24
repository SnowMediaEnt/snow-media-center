import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ tables: [] as string[] }));
const conversations = [{ id: 'c1', user_id: 'u1', title: "Dad's chat", created_at: '', updated_at: '', last_message_at: '' }];

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    h.tables.push(table);
    const q = {
      select: () => q, order: () => q, eq: () => q,
      limit: () => Promise.resolve({ data: conversations, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'm1', conversation_id: 'c1', sender_type: 'user', message: 'hi', created_at: '' }], error: null }).then(res),
    };
    return q;
  };
  return { supabase: { from, auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } };
});
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: () => {} }) }));

afterEach(async () => { h.tables = []; (await import('@/lib/kidsFilter')).setKidsLevel(null); });

describe('useAIConversations', () => {
  it("a Kids profile doesn't see or open the account's saved chats", async () => {
    (await import('@/lib/kidsFilter')).setKidsLevel('kids');
    const { useAIConversations } = await import('./useAIConversations');
    const { result } = renderHook(() => useAIConversations());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.conversations).toEqual([]);
    expect(await result.current.fetchConversationMessages('c1')).toEqual([]);
    expect(h.tables).toEqual([]);
  });

  it('a grown-up profile does', async () => {
    const { useAIConversations } = await import('./useAIConversations');
    const { result } = renderHook(() => useAIConversations());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.conversations.map((c) => c.id)).toEqual(['c1']);
  });
});
