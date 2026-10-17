// check-account-email answers only 'app' or 'none', and counts each probe
// against the caller's IP in one call (email_check_throttle_hit).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEdgeFunction, type FakeHandlers } from './fakeSupabase';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers, fake: null as null | ReturnType<typeof import('./fakeSupabase').fakeSupabase> }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase: make } = await import('./fakeSupabase');
  return {
    createClient: () => {
      state.fake = make(state.handlers);
      return state.fake.client;
    },
  };
});

let handler: (req: Request) => Promise<Response> | Response;

beforeAll(async () => {
  handler = await loadEdgeFunction('check-account-email');
});

beforeEach(() => {
  state.handlers = { onRpc: (c) => (c.name === 'account_email_exists' ? { data: true } : undefined) };
  state.fake = null;
});

const probe = async (email: string, headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.7' }) => {
  const res = await handler(new Request('http://fn.test/check-account-email', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ email }),
  }));
  return (await res.json()) as { exists: string; throttled?: boolean };
};

const throttleHits = () => state.fake!.rpcs.filter((c) => c.name === 'email_check_throttle_hit');

describe('check-account-email', () => {
  it('lets the 20th probe in a 5-minute window through, in one call per probe', async () => {
    const answer = state.handlers.onRpc!;
    state.handlers.onRpc = (c) => (c.name === 'email_check_throttle_hit' ? { data: 20 } : answer(c));
    expect(await probe('someone@example.com')).toEqual({ exists: 'app' });
    expect(throttleHits()).toHaveLength(1);
    expect(throttleHits()[0].args).toMatchObject({ p_window_ms: 5 * 60 * 1000 });
    expect(state.fake!.queries.some((q) => q.table === 'email_check_throttle')).toBe(false);
  });

  it('counts each caller under its own key, the same one on every probe', async () => {
    const keys: unknown[] = [];
    const answer = state.handlers.onRpc!;
    state.handlers.onRpc = (c) => {
      if (c.name === 'email_check_throttle_hit') keys.push(c.args.p_key);
      return answer(c);
    };
    await probe('a@example.com', { 'cf-connecting-ip': '203.0.113.7' });
    await probe('b@example.com', { 'cf-connecting-ip': '203.0.113.7' });
    await probe('a@example.com', { 'cf-connecting-ip': '198.51.100.4' });
    expect(keys).toHaveLength(3);
    expect(typeof keys[0]).toBe('string');
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(String(keys[0])).not.toContain('203.0.113.7'); // hashed, never the address
  });

  it('answers none, throttled, from the 21st probe on, without looking the email up', async () => {
    state.handlers.onRpc = (c) => (c.name === 'email_check_throttle_hit' ? { data: 21 } : { data: true });
    expect(await probe('someone@example.com')).toEqual({ exists: 'none', throttled: true });
    expect(state.fake!.rpcs.some((c) => c.name === 'account_email_exists')).toBe(false);
  });

  it.each([
    ['an error', { data: null, error: { message: 'boom' } }],
    ['no count', { data: null }],
    ['a count that is not a number', { data: '99' }],
  ])('lets the probe through when the throttle answers with %s', async (_what, reply) => {
    const answer = state.handlers.onRpc!;
    state.handlers.onRpc = (c) => (c.name === 'email_check_throttle_hit' ? reply : answer(c));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await probe('someone@example.com')).toEqual({ exists: 'app' });
      expect(warn.mock.calls.some((a) => String(a[0]).includes('throttle fail-open'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not count a caller it cannot place', async () => {
    expect(await probe('someone@example.com', {})).toEqual({ exists: 'app' });
    expect(throttleHits()).toHaveLength(0);
  });
});
