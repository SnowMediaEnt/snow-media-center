// email-line-credentials keys its per-IP limit on the caller's real address
// (cf-connecting-ip, or x-forwarded-for read from the right), never on the
// first forwarded hop the caller chooses, and stores only its sha256.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEdgeFunction, type FakeHandlers } from './fakeSupabase';
import { sentEmails } from './resend';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase: make } = await import('./fakeSupabase');
  return { createClient: () => make(state.handlers).client };
});

let handler: (req: Request) => Promise<Response> | Response;
const fetchMock = vi.fn();

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  handler = await loadEdgeFunction('email-line-credentials', { RESEND_API_KEY: 'resend-key' });
});

const sha256 = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const line = { email: 'viewer@example.com', host: 'panel.example:8080', username: 'viewer1', password: 'pw' };

/** The emailip: keys counted, in order. */
let ipKeys: string[];
/** What throttle_hit answers for an emailip: key (the key's count in its window). */
let ipCount: number;

beforeEach(() => {
  ipKeys = [];
  ipCount = 1;
  sentEmails.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify({ user_info: { auth: 1 }, server_info: {} }), { status: 200 }));
  state.handlers = {
    onRpc: (c) => {
      const k = c.args.p_key;
      if (c.name === 'throttle_hit' && typeof k === 'string' && k.startsWith('emailip:')) {
        ipKeys.push(k);
        return { data: ipCount };
      }
      return undefined;
    },
  };
});

const send = async (headers: Record<string, string>) => {
  const res = await handler(new Request('http://fn.test/email-line-credentials', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(line),
  }));
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } };
};

describe('email-line-credentials per-IP key', () => {
  it('gives one key for one cf-connecting-ip whatever first forwarded hop the caller sends, and the key holds no raw IP', async () => {
    await send({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 203.0.113.7' });
    await send({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '9.9.9.9, 203.0.113.7' });
    await send({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '45.33.32.156' });
    expect(ipKeys).toHaveLength(3);
    expect(new Set(ipKeys).size).toBe(1);
    expect(ipKeys[0]).toBe(`emailip:${await sha256('203.0.113.7')}`);
    for (const k of ipKeys) {
      expect(k).toMatch(/^emailip:[0-9a-f]{64}$/);
      for (const raw of ['203.0.113.7', '1.1.1.1', '9.9.9.9', '45.33.32.156']) expect(k).not.toContain(raw);
    }
  });

  it('without cf-connecting-ip reads x-forwarded-for from the right, past private and Cloudflare hops', async () => {
    await send({ 'x-forwarded-for': '1.1.1.1, 198.51.100.4' });
    await send({ 'x-forwarded-for': '9.9.9.9, 198.51.100.4, 10.0.0.1' });
    await send({ 'x-forwarded-for': '8.8.8.8, 198.51.100.4, 172.70.1.1' });
    expect(ipKeys).toHaveLength(3);
    expect(new Set(ipKeys)).toEqual(new Set([`emailip:${await sha256('198.51.100.4')}`]));
  });

  it('keys IPv6 by its /64', async () => {
    await send({ 'cf-connecting-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' });
    await send({ 'cf-connecting-ip': '2001:db8:1:2::1' });
    expect(ipKeys).toHaveLength(2);
    expect(new Set(ipKeys)).toEqual(new Set([`emailip:${await sha256('2001:db8:1:2::/64')}`]));
  });

  it('falls back to x-real-ip when nothing else names a caller', async () => {
    await send({ 'x-forwarded-for': '10.0.0.1', 'x-real-ip': '198.51.100.9' });
    expect(ipKeys).toEqual([`emailip:${await sha256('198.51.100.9')}`]);
  });

  it('skips the per-IP limit when there is no caller address, but still counts the line', async () => {
    const lineKeys: string[] = [];
    const answer = state.handlers.onRpc!;
    state.handlers.onRpc = (c) => {
      if (typeof c.args.p_key === 'string' && c.args.p_key.startsWith('emailline:')) lineKeys.push(c.args.p_key);
      return answer(c);
    };
    const out = await send({ 'x-forwarded-for': '10.0.0.1' });
    expect(out.status).toBe(200);
    expect(ipKeys).toEqual([]);
    expect(lineKeys).toEqual(['emailline:panel.example:8080|viewer1']);
  });

  it('still allows 10 per IP per window and refuses the 11th', async () => {
    ipCount = 10;
    expect((await send({ 'cf-connecting-ip': '203.0.113.7' })).status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    ipCount = 11;
    const out = await send({ 'cf-connecting-ip': '203.0.113.7' });
    expect(out).toEqual({ status: 429, body: { error: 'rate_limited' } });
    expect(sentEmails).toHaveLength(1);
  });

  it('keeps the per-line limit at 3 and both counts in a 5-minute window', async () => {
    const windows: unknown[] = [];
    let lineCount = 3;
    const answer = state.handlers.onRpc!;
    state.handlers.onRpc = (c) => {
      windows.push(c.args.p_window_ms);
      if (typeof c.args.p_key === 'string' && c.args.p_key.startsWith('emailline:')) return { data: lineCount };
      return answer(c);
    };
    expect((await send({ 'cf-connecting-ip': '203.0.113.7' })).status).toBe(200);
    lineCount = 4;
    expect((await send({ 'cf-connecting-ip': '203.0.113.7' })).status).toBe(429);
    expect(windows).toEqual([300000, 300000, 300000, 300000]);
  });
});
