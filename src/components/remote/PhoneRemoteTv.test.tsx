import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// The TV side of pairing: the QR's code, "Unpair all", and "Allow this phone?".
const h = vi.hoisted(() => {
  type Handler = (m: { payload: unknown }) => void;
  const channels: Array<{ topic: string; handlers: Record<string, Handler>; removed: boolean }> = [];
  const calls: Array<Record<string, unknown>> = [];
  let n = 0;
  const codes = ['BCDFGHJK', 'LMNPQRST', 'VWXZBCDF', 'GHJKLMNP'];
  const answer = (body: Record<string, unknown>) => {
    if (body.op === 'pair') {
      const secret = typeof body.secret === 'string' ? body.secret : String(n + 1).repeat(64).slice(0, 64);
      return { ok: true, secret: /^[0-9a-f]{64}$/.test(secret) ? secret : 'c'.repeat(64), code: codes[n++ % codes.length], expires_in: 600 };
    }
    return { ok: true };
  };
  const supabase = {
    channel: (topic: string) => {
      const c = { topic, handlers: {} as Record<string, Handler>, removed: false };
      channels.push(c);
      const api = {
        on: (_t: string, f: { event: string }, fn: Handler) => { c.handlers[f.event] = fn; return api; },
        subscribe: () => api,
        send: () => Promise.resolve('ok'),
        __c: c,
      };
      return api;
    },
    removeChannel: (api: { __c: { removed: boolean } }) => { api.__c.removed = true; return Promise.resolve('ok'); },
    functions: { invoke: async (_name: string, o: { body: Record<string, unknown> }) => { calls.push(o.body); return { data: answer(o.body), error: null }; } },
  };
  return { channels, calls, supabase, reset: () => { n = 0; channels.length = 0; calls.length = 0; } };
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: h.supabase }));
vi.mock('@/capacitor/AppManager', () => ({ AppManager: { injectKey: async () => { throw new Error('web'); } } }));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-12345678', trackEvent: vi.fn() }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => false }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('qrcode', () => ({ default: { toDataURL: async (s: string) => `data:image/png;base64,${btoa(s)}` } }));

import PairingQR from './PairingQR';
import PhoneRequestPrompt from './PhoneRequestPrompt';
import { __phoneRemoteForTests, isPaired, unpairAllPhones } from '@/lib/phoneRemote';

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const request = (rid: string) => act(() => {
  h.channels.filter((c) => !c.removed).slice(-1)[0].handlers.server({ payload: { t: 'request', rid, device: 'An iPhone' } });
});

beforeEach(() => {
  __phoneRemoteForTests.reset();
  h.reset();
  localStorage.clear();
});

describe('the pairing QR', () => {
  it('shows the 8-letter code, and a new pairing and code at once after "Unpair all phones"', async () => {
    render(<PairingQR size={150} />);
    await screen.findByText('BCDF-GHJK');
    await act(async () => { await unpairAllPhones(); });
    await screen.findByText('LMNP-QRST');
    const pairs = h.calls.filter((c) => c.op === 'pair');
    expect(pairs).toHaveLength(2);
    expect(pairs[1].secret).toBeUndefined(); // a brand-new pairing, not the old secret
    expect(h.calls.some((c) => c.op === 'reset')).toBe(true);
  });

  it('moves on to a new code once a phone has used the one on screen', async () => {
    render(<><PairingQR size={150} /><PhoneRequestPrompt /></>);
    await screen.findByText('BCDF-GHJK');
    request('0123456789abcdef');
    await screen.findByText('LMNP-QRST');
    expect(screen.getByRole('dialog', { name: 'Allow this phone?' })).toBeTruthy();
  });
});

describe('Allow this phone?', () => {
  it('OK on Allow (focused first) lets the phone in and keeps the box listening', async () => {
    render(<><PairingQR size={150} /><PhoneRequestPrompt /></>);
    await screen.findByText('BCDF-GHJK');
    request('0123456789abcdef');
    expect(screen.getByText(/An iPhone entered this TV's code/)).toBeTruthy();
    // The rest of the app doesn't see the keys while it asks.
    const below = vi.fn();
    window.addEventListener('keydown', below);
    key('Enter');
    window.removeEventListener('keydown', below);
    expect(below).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(isPaired()).toBe(true));
    expect(h.calls.find((c) => c.op === 'answer')).toMatchObject({ rid: '0123456789abcdef', allow: true });
  });

  it('Back turns the phone away; so does Right then OK', async () => {
    render(<><PairingQR size={150} /><PhoneRequestPrompt /></>);
    await screen.findByText('BCDF-GHJK');
    request('0123456789abcdef');
    key('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    await screen.findByText('LMNP-QRST');
    request('fedcba9876543210');
    key('ArrowRight');
    key('Enter');
    await waitFor(() => expect(h.calls.filter((c) => c.op === 'answer')).toHaveLength(2));
    expect(h.calls.filter((c) => c.op === 'answer').map((c) => c.allow)).toEqual([false, false]);
    expect(isPaired()).toBe(false);
  });

  it('closes the TV keyboard for the question, then puts focus back in the text box', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    render(<><PairingQR size={150} /><PhoneRequestPrompt /></>);
    await screen.findByText('BCDF-GHJK');
    input.focus();
    request('0123456789abcdef');
    expect(document.activeElement).not.toBe(input);
    key('Escape');
    await waitFor(() => expect(document.activeElement).toBe(input));
    input.remove();
  });
});
