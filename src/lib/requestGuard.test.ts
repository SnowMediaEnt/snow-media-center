import { describe, expect, it, vi } from 'vitest';
import { clientIp, escapeHtml, hashIp, htmlToText, internalSecretOk, throttle, type ThrottleDb } from '../../supabase/functions/_shared/requestGuard';

describe('internalSecretOk (server-to-server edge function calls)', () => {
  it('matches the configured secret, trimmed on both sides', () => {
    expect(internalSecretOk('s3cret', 's3cret')).toBe(true);
    expect(internalSecretOk(' s3cret\n', 's3cret\n')).toBe(true);
  });
  it('refuses a wrong, missing or unset secret', () => {
    expect(internalSecretOk('s3creT', 's3cret')).toBe(false);
    expect(internalSecretOk('s3cret!', 's3cret')).toBe(false);
    expect(internalSecretOk(null, 's3cret')).toBe(false);
    expect(internalSecretOk('', '')).toBe(false);
    expect(internalSecretOk('anything', undefined)).toBe(false);
  });
});

describe('clientIp', () => {
  it('prefers cf-connecting-ip, which the caller cannot set', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }))).toBe('198.51.100.7');
  });
  it('otherwise takes the last x-forwarded-for hop, not the caller-chosen first one', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
  });
  it('falls back to x-real-ip, then nothing', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '192.0.2.1' }))).toBe('192.0.2.1');
    expect(clientIp(new Headers())).toBeNull();
  });
  it('skips platform hops (private, carrier NAT, Cloudflare) instead of lumping every caller together', () => {
    // A gateway that appended its own private address after the caller's.
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 10.0.3.7' }))).toBe('203.0.113.9');
    // cf-connecting-ip holding a Cloudflare or private address is not the caller.
    expect(clientIp(new Headers({ 'cf-connecting-ip': '172.70.1.2', 'x-forwarded-for': '198.51.100.7, 162.158.4.4' }))).toBe('198.51.100.7');
    expect(clientIp(new Headers({ 'cf-connecting-ip': '127.0.0.1', 'x-forwarded-for': '100.64.0.9' }))).toBeNull();
    expect(clientIp(new Headers({ 'x-forwarded-for': 'unknown, not-an-ip' }))).toBeNull();
    // IPv4 written as IPv6 is still IPv4.
    expect(clientIp(new Headers({ 'cf-connecting-ip': '::ffff:198.51.100.7' }))).toBe('198.51.100.7');
    expect(clientIp(new Headers({ 'cf-connecting-ip': '::ffff:192.168.1.5', 'x-real-ip': '192.0.2.1' }))).toBe('192.0.2.1');
  });
  it('counts IPv6 by its /64, so one machine cannot rotate through its own block', () => {
    const a = clientIp(new Headers({ 'cf-connecting-ip': '2001:db8:1234:5678::1' }));
    const b = clientIp(new Headers({ 'cf-connecting-ip': '2001:0db8:1234:5678:ffff:eeee:dddd:cccc' }));
    expect(a).toBe('2001:db8:1234:5678::/64');
    expect(b).toBe(a);
    expect(clientIp(new Headers({ 'cf-connecting-ip': '2001:db8:1234:5679::1' }))).not.toBe(a);
    expect(clientIp(new Headers({ 'cf-connecting-ip': 'fe80::1', 'x-forwarded-for': '2606:4700::1111' }))).toBeNull();
  });
});

describe('hashIp', () => {
  it('never hands back the address itself', async () => {
    const h = await hashIp('203.0.113.9');
    if (h !== null) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(h).not.toContain('203');
    }
    expect(await hashIp(null)).toBeNull();
  });
});

/** An in-memory public.throttle_hit (one atomic hit on a
 *  player_login_throttle row), on a clock the test moves. */
function fakeDb(fail: false | 'error' | 'throw' = false) {
  const clock = { now: Date.parse('2026-09-24T10:00:00Z') };
  const rows = new Map<string, { count: number; window_start: number }>();
  const db: ThrottleDb = {
    rpc: async (_fn, { p_key, p_window_ms }) => {
      if (fail === 'throw') throw new Error('fetch failed');
      if (fail === 'error') return { data: null, error: { message: 'function public.throttle_hit does not exist' } };
      const r = rows.get(p_key);
      const next = !r || r.window_start < clock.now - p_window_ms
        ? { count: 1, window_start: clock.now }
        : { count: r.count + 1, window_start: r.window_start };
      rows.set(p_key, next);
      return { data: next.count, error: null };
    },
  };
  return { db, rows, clock };
}

describe('throttle', () => {
  const HOUR = 3600_000;
  it('allows up to the limit per window, then refuses', async () => {
    const { db, clock } = fakeDb();
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) { results.push(await throttle(db, 'rc:abc', 3, HOUR)); clock.now += 1000; }
    expect(results).toEqual([true, true, true, false]);
  });
  it('gives calls that arrive together a count each, so only the limit pass', async () => {
    const { db } = fakeDb();
    const results = await Promise.all(Array.from({ length: 10 }, () => throttle(db, 'rc:all', 3, HOUR)));
    expect(results.filter(Boolean)).toHaveLength(3);
  });
  it('starts a fresh window once the old one has passed', async () => {
    const { db, clock } = fakeDb();
    const t0 = clock.now;
    for (let i = 0; i < 3; i++) await throttle(db, 'k', 2, HOUR);
    clock.now = t0 + 30 * 60_000;
    expect(await throttle(db, 'k', 2, HOUR)).toBe(false);
    clock.now = t0 + HOUR + 1;
    expect(await throttle(db, 'k', 2, HOUR)).toBe(true);
  });
  it('keeps keys apart', async () => {
    const { db } = fakeDb();
    expect(await throttle(db, 'a', 1, HOUR)).toBe(true);
    expect(await throttle(db, 'a', 1, HOUR)).toBe(false);
    expect(await throttle(db, 'b', 1, HOUR)).toBe(true);
  });
  it('lets a call through with no key, or when the database fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await throttle(fakeDb().db, null, 0, HOUR)).toBe(true);
    expect(await throttle(fakeDb('error').db, 'k', 1, HOUR)).toBe(true);
    expect(await throttle(fakeDb('throw').db, 'k', 1, HOUR)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('htmlToText / escapeHtml (customer email bodies)', () => {
  it('keeps the words and line breaks of the html older apps send, and drops tags and links', () => {
    const html = `
      <h3>New Support Message</h3>
      <p><strong>From:</strong> a@b.com</p>
      <div style="x"><p>Line one<br>Line &amp; two</p></div>
      <a href="https://evil.example">Click here</a><script>alert(1)</script>`;
    expect(htmlToText(html)).toBe('New Support Message\nFrom: a@b.com\nLine one\nLine & two\n\nClick here');
  });
  it('escapes text for an HTML email', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
