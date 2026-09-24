import { describe, expect, it } from 'vitest';
import { clientIpKey, ipBucket, isCallerAddress, parseIp } from '../../../supabase/functions/_shared/clientIp';

const headers = (h: Record<string, string>) => new Headers(h);

describe('clientIpKey (per-caller limits in the edge functions)', () => {
  it('uses cf-connecting-ip, so a forged first x-forwarded-for hop changes nothing', () => {
    const a = clientIpKey(headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 203.0.113.7' }));
    const b = clientIpKey(headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '8.8.8.8, 203.0.113.7' }));
    expect(a).toBe('203.0.113.7');
    expect(b).toBe(a);
  });

  it('keeps the old order when cf-connecting-ip is missing', () => {
    expect(clientIpKey(headers({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }))).toBe('198.51.100.4');
    expect(clientIpKey(headers({ 'x-real-ip': '198.51.100.5' }))).toBe('198.51.100.5');
    expect(clientIpKey(headers({}))).toBeNull();
  });

  it('passes over a private or Cloudflare cf-connecting-ip rather than lumping every viewer together', () => {
    expect(clientIpKey(headers({ 'cf-connecting-ip': '10.1.2.3', 'x-forwarded-for': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIpKey(headers({ 'cf-connecting-ip': '172.70.1.1', 'x-forwarded-for': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIpKey(headers({ 'cf-connecting-ip': '2a06:98c0:3600::103', 'x-forwarded-for': '198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('keys IPv6 by its /64', () => {
    const one = clientIpKey(headers({ 'cf-connecting-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }));
    const two = clientIpKey(headers({ 'cf-connecting-ip': '2001:db8:1:2::1' }));
    const other = clientIpKey(headers({ 'cf-connecting-ip': '2001:db8:1:3::1' }));
    expect(one).toBe('2001:db8:1:2::/64');
    expect(two).toBe(one);
    expect(other).not.toBe(one);
  });

  it('reads IPv4-mapped IPv6 as IPv4', () => {
    expect(clientIpKey(headers({ 'cf-connecting-ip': '::ffff:203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('parses and classifies addresses', () => {
    expect(parseIp('256.1.1.1')).toBeNull();
    expect(parseIp('1::2::3')).toBeNull();
    expect(parseIp('not an ip')).toBeNull();
    expect(isCallerAddress(parseIp('127.0.0.1')!)).toBe(false);
    expect(isCallerAddress(parseIp('fd00::1')!)).toBe(false);
    expect(isCallerAddress(parseIp('104.26.1.1')!)).toBe(false);
    expect(isCallerAddress(parseIp('81.2.69.160')!)).toBe(true);
    expect(ipBucket(parseIp('fe80::1%eth0')!)).toBe('fe80:0:0:0::/64');
  });
});
