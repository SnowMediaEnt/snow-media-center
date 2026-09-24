import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, clientIpKey, newCode, normalizeCode, phoneKind } from '../../supabase/functions/phone-remote/pairing';

const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe('phone remote pairing codes (edge function helpers)', () => {
  it('makes 8-letter codes from the unambiguous consonants only', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = newCode();
      expect(c).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/);
      for (const ch of c) seen.add(ch);
    }
    // Every letter turns up (no letter is left out by the byte mapping).
    expect(seen.size).toBe(CODE_ALPHABET.length);
    expect(CODE_ALPHABET).not.toMatch(/[AEIOU0-9]/);
  });

  it('reads what a phone typed, whatever the case and separators', () => {
    expect(normalizeCode('bcdf-ghjk')).toBe('BCDFGHJK');
    expect(normalizeCode(' BCDF GHJK ')).toBe('BCDFGHJK');
    expect(normalizeCode('BCDFGHJ')).toBeNull();
    expect(normalizeCode('BCDFGHJA')).toBeNull(); // a vowel is never in a code
    expect(normalizeCode('123456')).toBeNull(); // the old 6-digit codes
    expect(normalizeCode(undefined)).toBeNull();
  });
});

describe('the caller address the join limit counts', () => {
  it('never uses the first X-Forwarded-For entry, which the caller writes', () => {
    const a = clientIpKey(headers({ 'x-forwarded-for': '203.0.113.7, 81.2.69.160', 'cf-connecting-ip': '81.2.69.160' }));
    const b = clientIpKey(headers({ 'x-forwarded-for': '198.51.100.9, 81.2.69.160', 'cf-connecting-ip': '81.2.69.160' }));
    expect(a).toBe('81.2.69.160');
    expect(b).toBe(a);
  });

  it('without cf-connecting-ip, takes the right-most public hop, skipping the platform’s own', () => {
    expect(clientIpKey(headers({ 'x-forwarded-for': '203.0.113.7, 81.2.69.160' }))).toBe('81.2.69.160');
    expect(clientIpKey(headers({ 'x-forwarded-for': '203.0.113.7, 81.2.69.160, 10.0.0.4' }))).toBe('81.2.69.160');
    expect(clientIpKey(headers({ 'x-forwarded-for': '81.2.69.160, 172.70.1.1' }))).toBe('81.2.69.160'); // a Cloudflare hop
    expect(clientIpKey(headers({ 'cf-connecting-ip': '10.1.2.3', 'x-forwarded-for': '81.2.69.160' }))).toBe('81.2.69.160');
    expect(clientIpKey(headers({}))).toBe('unknown');
  });

  it('counts an IPv6 /64 as one caller', () => {
    const one = clientIpKey(headers({ 'cf-connecting-ip': '2001:db8:1:2:aaaa::1' }));
    const two = clientIpKey(headers({ 'cf-connecting-ip': '2001:db8:1:2:ffff:1:2:3' }));
    const other = clientIpKey(headers({ 'cf-connecting-ip': '2001:db8:1:3::1' }));
    expect(one).toBe('2001:db8:1:2::/64');
    expect(two).toBe(one);
    expect(other).not.toBe(one);
    expect(clientIpKey(headers({ 'cf-connecting-ip': '::ffff:81.2.69.160' }))).toBe('81.2.69.160');
  });
});

describe('what the TV is told about the phone', () => {
  it('is one of a few fixed phrases from the User-Agent', () => {
    expect(phoneKind('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe('An iPhone');
    expect(phoneKind('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36')).toBe('An Android phone');
    expect(phoneKind('Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/128.0 Safari/537.36')).toBe('An Android tablet');
    expect(phoneKind('<script>Your account is locked</script>')).toBe('A phone or computer');
    expect(phoneKind(null)).toBe('A phone or computer');
  });
});
