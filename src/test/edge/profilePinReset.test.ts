// profile-pin-reset: "Forgot PIN?" can be pressed by anyone at the TV, so a
// support clear always tells the account's own email, and the ticket asks
// the admin to confirm with the account holder first.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEdgeFunction, opArg, userToken, type FakeHandlers, type QueryCall } from './fakeSupabase';
import { sentEmails } from './resend';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers, queries: [] as QueryCall[] }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return {
    createClient: () => fakeSupabase({
      ...state.handlers,
      onQuery: (q) => { if (!state.queries.includes(q)) state.queries.push(q); return state.handlers.onQuery?.(q); },
    }).client,
  };
});

const ADMIN = { id: '44444444-4444-4444-8444-444444444444', email: 'support@example.com' };
const OWNER = { id: '55555555-5555-4555-8555-555555555555', email: 'owner@example.com' };
let handler: (req: Request) => Promise<Response> | Response;

beforeAll(async () => {
  handler = await loadEdgeFunction('profile-pin-reset', { RESEND_API_KEY: 'resend-key' });
});

beforeEach(() => {
  sentEmails.length = 0;
  state.queries.length = 0;
  state.handlers = {
    userForToken: (t) => (t === userToken(ADMIN.id) ? ADMIN : t === userToken(OWNER.id) ? OWNER : null),
    userById: (id) => (id === OWNER.id ? OWNER : null),
    onRpc: (c) => (c.name === 'has_role' ? { data: c.args._user_id === ADMIN.id } : undefined),
    onQuery: (q) => {
      if (q.table === 'viewer_profiles') return { data: { id: 'kid1', name: 'Grown-ups', pin_hash: 'x' } };
      if (q.table === 'profile_pin_resets') return { data: null, count: 0 };
      if (q.table === 'support_tickets') return { data: { id: '66666666-6666-4666-8666-666666666666' } };
      return undefined;
    },
  };
});

const call = async (as: string, body: Record<string, unknown>) => {
  const res = await handler(new Request('http://fn.test/profile-pin-reset', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken(as)}` }, body: JSON.stringify(body),
  }));
  return (await res.json()) as Record<string, unknown>;
};

describe('profile-pin-reset', () => {
  it('emails the account address when support clears a PIN', async () => {
    const out = await call(ADMIN.id, { action: 'admin_clear', user_id: OWNER.id, profile_id: 'kid1' });
    expect(out).toEqual({ ok: true, notified: true });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toEqual([OWNER.email]);
    expect(sentEmails[0].html).toContain('Grown-ups');
  });

  it('tells the admin to confirm with the account holder before clearing', async () => {
    await call(OWNER.id, { action: 'request', profile_id: 'kid1' });
    const note = state.queries
      .filter((q) => q.table === 'support_messages')
      .map((q) => opArg(q, 'insert') as { message?: string } | undefined)
      .find((m) => m?.message?.includes('Forgot the PIN'));
    expect(note?.message).toMatch(/only once the account holder has confirmed/);
    expect(note?.message).not.toMatch(/If they can't get it, clear the PIN/);
  });
});
