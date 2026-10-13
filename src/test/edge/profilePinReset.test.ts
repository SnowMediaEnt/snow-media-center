// profile-pin-reset: "Forgot PIN?" can be pressed by anyone at the TV, so a
// support clear always tells the account's own email, and the ticket asks
// the admin to confirm with the account holder first.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eqValue, loadEdgeFunction, opArg, userToken, type FakeHandlers, type QueryCall } from './fakeSupabase';
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

describe('profile-pin-reset: the Parent PIN', () => {
  const HASH = 'a'.repeat(64);
  const parentQuery = (op: string) => state.queries.find((q) => q.table === 'viewer_parent_pin' && q.ops.some((o) => o.op === op));

  it('emails a code for the Parent PIN, with its own wording, under the same hourly limit', async () => {
    state.handlers.onQuery = (q) => {
      if (q.table === 'viewer_parent_pin') return { data: { pin_hash: HASH } };
      if (q.table === 'profile_pin_resets') return { data: null, count: 0 };
      if (q.table === 'support_tickets') return { data: { id: '66666666-6666-4666-8666-666666666666' } };
      return undefined;
    };
    const out = await call(OWNER.id, { action: 'request', profile_id: '__parent__' });
    expect(out).toMatchObject({ ok: true, emailed: true });
    expect(sentEmails[0].subject).toBe('Your Snow Media parent PIN reset code');
    const reset = state.queries.find((q) => q.table === 'profile_pin_resets' && q.ops.some((o) => o.op === 'insert'));
    expect((opArg(reset!, 'insert') as { profile_id: string }).profile_id).toBe('__parent__');
    const note = state.queries
      .filter((q) => q.table === 'support_messages')
      .map((q) => opArg(q, 'insert') as { message?: string } | undefined)
      .find((m) => m?.message?.includes('parent PIN'));
    expect(note?.message).toMatch(/only once the account holder has confirmed/);

    // Three an hour, Parent PIN or profile: the hourly count (the one query
    // that counts) says three were sent, and nothing more is.
    sentEmails.length = 0;
    state.queries.length = 0;
    state.handlers.onQuery = (q) => {
      if (q.table === 'viewer_parent_pin') return { data: { pin_hash: HASH } };
      if (q.table === 'profile_pin_resets') return q.ops.some((o) => o.op === 'gte') ? { data: null, count: 3 } : { data: null };
      return undefined;
    };
    expect(await call(OWNER.id, { action: 'request', profile_id: '__parent__' })).toEqual({ ok: false, reason: 'too_many' });
    expect(sentEmails).toHaveLength(0);
    const counted = state.queries.find((q) => q.table === 'profile_pin_resets' && q.ops.some((o) => o.op === 'gte'));
    expect(eqValue(counted!, 'user_id')).toBe(OWNER.id);
    // Counted for the account, not for the Parent PIN alone: the limit is shared.
    expect(eqValue(counted!, 'profile_id')).toBeUndefined();
    expect(state.queries.some((q) => q.table === 'profile_pin_resets' && q.ops.some((o) => o.op === 'insert'))).toBe(false);
    // Under the limit, the same account gets its code.
    state.handlers.onQuery = (q) => {
      if (q.table === 'viewer_parent_pin') return { data: { pin_hash: HASH } };
      if (q.table === 'profile_pin_resets') return q.ops.some((o) => o.op === 'gte') ? { data: null, count: 2 } : { data: null };
      return undefined;
    };
    expect(await call(OWNER.id, { action: 'request', profile_id: '__parent__' })).toMatchObject({ ok: true });
  });

  it('no Parent PIN yet: the code is the proof for making the first one (its own email, no support ticket)', async () => {
    state.handlers.onQuery = (q) => (q.table === 'viewer_parent_pin' ? { data: null } : q.table === 'profile_pin_resets' && q.ops.some((o) => o.op === 'gte') ? { data: null, count: 0 } : undefined);
    const out = await call(OWNER.id, { action: 'request', profile_id: '__parent__' });
    expect(out).toEqual({ ok: true, emailed: true, email: 'ow•••••@example.com', ticket: false });
    expect(sentEmails[0].subject).toBe('Your Snow Media parent PIN setup code');
    expect(state.queries.some((q) => q.table === 'support_tickets' || q.table === 'support_messages')).toBe(false);
  });

  it('verify needs the new PIN with the code, and puts it in place of the old one only when the code is right', async () => {
    const reset = { id: '77777777-7777-4777-8777-777777777777', attempts: 0, expires_at: new Date(Date.now() + 60_000).toISOString(), ticket_id: null };
    const codeHash = async (code: string) => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${reset.id}:${code}`));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    const code_hash = await codeHash('123456');
    state.handlers.onQuery = (q) => {
      if (q.table === 'viewer_parent_pin') return { data: { pin_hash: HASH } };
      if (q.table === 'profile_pin_resets') return { data: { ...reset, code_hash } };
      return undefined;
    };
    // Without a new PIN (or a malformed one) the code isn't even tried.
    expect(await call(OWNER.id, { action: 'verify', profile_id: '__parent__', code: '123456' })).toEqual({ ok: false, reason: 'bad_pin' });
    expect(await call(OWNER.id, { action: 'verify', profile_id: '__parent__', code: '123456', new_pin_hash: 'nope' })).toEqual({ ok: false, reason: 'bad_pin' });
    expect(state.queries.some((q) => q.table === 'profile_pin_resets')).toBe(false);

    const NEW = 'b'.repeat(64);
    expect(await call(OWNER.id, { action: 'verify', profile_id: '__parent__', code: '000000', new_pin_hash: NEW })).toMatchObject({ ok: false, reason: 'wrong_code' });
    expect(parentQuery('upsert')).toBeUndefined();

    state.queries.length = 0;
    const before = state.handlers.onQuery;
    state.handlers.onQuery = (q) => (q.table === 'viewer_parent_pin' && q.ops.some((o) => o.op === 'upsert') ? { data: { updated_at: '2030-01-01T00:00:05.123456+00:00' } } : before?.(q));
    // Made or replaced, with the table's own time sent back for the box's next compare-and-swap.
    expect(await call(OWNER.id, { action: 'verify', profile_id: '__parent__', code: '123456', new_pin_hash: NEW })).toEqual({ ok: true, updated_at: '2030-01-01T00:00:05.123456+00:00' });
    const up = parentQuery('upsert')!;
    expect(opArg(up, 'upsert')).toEqual({ user_id: OWNER.id, pin_hash: NEW });
    // Never a delete: the account is not left without one.
    expect(parentQuery('delete')).toBeUndefined();
  });

  it('support can clear it from a ticket; the account address is told', async () => {
    state.handlers.onQuery = (q) => (q.table === 'viewer_parent_pin' ? { data: { user_id: OWNER.id } } : undefined);
    const out = await call(ADMIN.id, { action: 'admin_clear', user_id: OWNER.id, profile_id: '__parent__' });
    expect(out).toEqual({ ok: true, notified: true });
    expect(parentQuery('delete')).toBeTruthy();
    expect(sentEmails[0].subject).toBe('The parent PIN on your Snow Media account was removed');
    // Not an admin: no.
    expect(await call(OWNER.id, { action: 'admin_clear', user_id: OWNER.id, profile_id: '__parent__' })).toEqual({ ok: false, reason: 'forbidden' });
  });
});
