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

/** An in-memory player_login_throttle. */
function fakeDb(fail = false) {
  const rows = new Map<string, { count: number; window_start: string }>();
  const db: ThrottleDb = {
    from: () => ({
      select: () => ({
        eq: (_c: string, key: string) => ({
          maybeSingle: async () => {
            if (fail) throw new Error('table missing');
            return { data: rows.get(key) ?? null };
          },
        }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        rows.set(String(row.ip_hash), { count: Number(row.count), window_start: String(row.window_start) });
      },
      update: (row: Record<string, unknown>) => ({
        eq: async (_c: string, key: string) => {
          const r = rows.get(key);
          if (r) r.count = Number(row.count);
        },
      }),
    }),
  };
  return { db, rows };
}

describe('throttle', () => {
  const HOUR = 3600_000;
  it('allows up to the limit per window, then refuses', async () => {
    const { db } = fakeDb();
    const t0 = Date.parse('2026-09-24T10:00:00Z');
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push(await throttle(db, 'rc:abc', 3, HOUR, t0 + i * 1000));
    expect(results).toEqual([true, true, true, false]);
  });
  it('starts a fresh window once the old one has passed', async () => {
    const { db } = fakeDb();
    const t0 = Date.parse('2026-09-24T10:00:00Z');
    for (let i = 0; i < 3; i++) await throttle(db, 'k', 2, HOUR, t0);
    expect(await throttle(db, 'k', 2, HOUR, t0 + 30 * 60_000)).toBe(false);
    expect(await throttle(db, 'k', 2, HOUR, t0 + HOUR + 1)).toBe(true);
  });
  it('keeps keys apart', async () => {
    const { db } = fakeDb();
    expect(await throttle(db, 'a', 1, HOUR)).toBe(true);
    expect(await throttle(db, 'a', 1, HOUR)).toBe(false);
    expect(await throttle(db, 'b', 1, HOUR)).toBe(true);
  });
  it('lets a call through with no key, or when the table fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await throttle(fakeDb().db, null, 0, HOUR)).toBe(true);
    expect(await throttle(fakeDb(true).db, 'k', 1, HOUR)).toBe(true);
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
