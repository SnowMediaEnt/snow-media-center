// lib/pinSignIn: one call to pin-signin with the digits, the line that comes
// back mapped onto the app's own server entry, every refusal as its reason,
// and the PIN going nowhere but that one call.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: h.invoke } } }));

import { formatPin, pinDigits, pinSignIn, serverForLine } from './pinSignIn';
import { SERVERS } from './servers';

const DS = SERVERS.find((s) => s.label === 'Dreamstreams')!;
const VZ = SERVERS.find((s) => s.label === 'Vibez')!;

/** The shape supabase-js gives a non-2xx answer: no data, an error carrying the Response. */
const httpError = (status: number, body?: unknown) => ({
  data: null,
  error: { context: new Response(body === undefined ? 'nope' : JSON.stringify(body), { status }) },
});

beforeEach(() => { h.invoke.mockReset(); });

describe('PIN digits and grouping', () => {
  it('keeps digits only, at most 10', () => {
    expect(pinDigits('12345 67890')).toBe('1234567890');
    expect(pinDigits('12-34a5678901234')).toBe('1234567890');
    expect(pinDigits('')).toBe('');
  });
  it('shows a space after the fifth digit once there is a sixth', () => {
    expect(formatPin('12345')).toBe('12345');
    expect(formatPin('123456')).toBe('12345 6');
    expect(formatPin('1234567890')).toBe('12345 67890');
  });
});

describe('the line\'s service', () => {
  it('comes from the host the function returned', () => {
    expect(serverForLine('http://dstreams.xyz:8080', 'Vibez')).toBe(DS);
    // pin-signin says http; the app's Vibez entry is https: same host, ours wins.
    expect(serverForLine('http://strmz.xyz', 'DreamStreams')).toBe(VZ);
  });
  it('falls back to the server name, and is null for anything else', () => {
    expect(serverForLine('', 'DreamStreams')).toBe(DS);
    expect(serverForLine(null, 'Vibez')).toBe(VZ);
    expect(serverForLine('http://evil.example', 'Other')).toBeNull();
  });
});

describe('pinSignIn', () => {
  it('sends the 10 digits to pin-signin and returns the line on the app\'s server', async () => {
    h.invoke.mockResolvedValue({
      data: { ok: true, line: { server: 'Vibez', host: 'http://strmz.xyz', username: 'jane', password: 'pw1' } },
      error: null,
    });
    const r = await pinSignIn('12345 67890');
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith('pin-signin', { body: { pin: '1234567890' } });
    expect(r).toEqual({ ok: true, line: { server: VZ, username: 'jane', password: 'pw1' } });
  });

  it.each(['', '123', '123456789', '12345678901', 'abcdefghij'])('"%s" is invalid_pin and never leaves the box', async (raw) => {
    expect(await pinSignIn(raw)).toEqual({ ok: false, reason: 'invalid_pin' });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it.each(['invalid_pin', 'not_found', 'expired', 'rate_limited', 'error'] as const)('passes on reason %s', async (reason) => {
    h.invoke.mockResolvedValue({ data: { ok: false, reason }, error: null });
    expect(await pinSignIn('1234567890')).toEqual({ ok: false, reason });
  });

  it('reads the reason from a non-2xx answer\'s body', async () => {
    h.invoke.mockResolvedValue(httpError(429, { ok: false, reason: 'rate_limited' }));
    expect(await pinSignIn('1234567890')).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('a 429 without a body is rate_limited; any other failure is error', async () => {
    h.invoke.mockResolvedValueOnce(httpError(429));
    expect(await pinSignIn('1234567890')).toEqual({ ok: false, reason: 'rate_limited' });
    h.invoke.mockResolvedValueOnce(httpError(500));
    expect(await pinSignIn('1234567890')).toEqual({ ok: false, reason: 'error' });
    h.invoke.mockRejectedValueOnce(new Error('offline'));
    expect(await pinSignIn('1234567890')).toEqual({ ok: false, reason: 'error' });
  });

  it('an unknown reason, or a line it cannot use, is error', async () => {
    h.invoke.mockResolvedValueOnce({ data: { ok: false, reason: 'weird' }, error: null });
    expect(await pinSignIn('1234567890')).toEqual({ ok: false, reason: 'error' });
    h.invoke.mockResolvedValueOnce({ data: { ok: true, line: { server: 'Other', host: 'http://x.example', username: 'a', password: 'b' } }, error: null });
    expect(await pinSignIn('1234567890')).toEqual({ ok: false, reason: 'error' });
    h.invoke.mockResolvedValueOnce({ data: { ok: true, line: { server: 'Vibez', host: 'http://strmz.xyz', username: '', password: 'b' } }, error: null });
    expect(await pinSignIn('1234567890')).toEqual({ ok: false, reason: 'error' });
    h.invoke.mockResolvedValueOnce({ data: null, error: null });
    expect(await pinSignIn('1234567890')).toEqual({ ok: false, reason: 'error' });
  });

  it('never logs, stores or sends the PIN anywhere else', async () => {
    const spies = [
      vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info'),
      vi.spyOn(Storage.prototype, 'setItem'),
    ];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    h.invoke.mockResolvedValueOnce({ data: { ok: true, line: { server: 'DreamStreams', host: 'http://dstreams.xyz:8080', username: 'a', password: 'b' } }, error: null });
    await pinSignIn('9876543210');
    h.invoke.mockRejectedValueOnce(new Error('offline'));
    await pinSignIn('9876543210');
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain('9876543210');
    expect(fetchSpy).not.toHaveBeenCalled();
    [...spies, fetchSpy].forEach((s) => s.mockRestore());
  });
});
