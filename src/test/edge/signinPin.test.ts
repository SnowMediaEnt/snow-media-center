// _shared/signinPin.ts: the PIN itself (digits, lookup key, ciphertext), and
// requestGuard's fail-closed throttle that pin-signin relies on.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TEST_PANEL_KEY, loadShared } from './fakePinStore';

// Typed here, not imported: the app's type check must not follow the shared
// files into Deno code.
type PinMod = {
  normalizePin: (raw: unknown) => string | null;
  isWeakPin: (pin: string) => boolean;
  newPin: () => string;
  pinHmac: (pin: string) => Promise<string | null>;
  encPin: (pin: string) => Promise<string | null>;
  decPin: (enc: string | null | undefined) => Promise<string | null>;
};
type ThrottleDb = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
type GuardMod = {
  throttle: (db: ThrottleDb, key: string | null, max: number, windowMs: number, failure?: 'allow' | 'deny') => Promise<boolean>;
};

let pins: PinMod;
let guard: GuardMod;
const env: Record<string, string | undefined> = { PANEL_CRED_KEY: TEST_PANEL_KEY };

beforeAll(async () => {
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };
  pins = await loadShared<PinMod>('signinPin.ts');
  guard = await loadShared<GuardMod>('requestGuard.ts');
});

describe('normalizePin', () => {
  it('keeps exactly 10 digits once spaces and dashes are gone', () => {
    expect(pins.normalizePin('123 456-7890')).toBe('1234567890');
    expect(pins.normalizePin(' 0012345678 ')).toBe('0012345678');
    expect(pins.normalizePin('١٢٣٤٥٦٧٨٩٠')).toBe('1234567890');
  });

  it.each([['123456789'], ['12345678901'], ['12345abcde'], [''], [1234567890], [null], ['1'.repeat(70)]])(
    'refuses %s',
    (raw) => expect(pins.normalizePin(raw)).toBeNull(),
  );
});

describe('newPin', () => {
  it('gives 10 digits and never a repeated or sequential one', () => {
    for (let i = 0; i < 500; i++) {
      const p = pins.newPin();
      expect(p).toMatch(/^\d{10}$/);
      expect(pins.isWeakPin(p)).toBe(false);
    }
    expect(new Set(Array.from({ length: 200 }, () => pins.newPin())).size).toBe(200);
  });

  it('calls repeated digits and straight runs weak', () => {
    for (const weak of ['0000000000', '7777777777', '1234567890', '0123456789', '9876543210', '8901234567']) {
      expect(pins.isWeakPin(weak)).toBe(true);
    }
    expect(pins.isWeakPin('4071953862')).toBe(false);
  });

  it('uses every digit in every position', () => {
    const seen = Array.from({ length: 10 }, () => new Set<string>());
    for (let i = 0; i < 400; i++) [...pins.newPin()].forEach((d, j) => seen[j].add(d));
    for (const s of seen) expect(s.size).toBe(10);
  });
});

describe('pinHmac', () => {
  it('is 64 lowercase hex, the same for the same PIN, and different for another', async () => {
    const a = await pins.pinHmac('4071953862');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await pins.pinHmac('4071953862')).toBe(a);
    expect(await pins.pinHmac('4071953863')).not.toBe(a);
  });

  it('is not a plain SHA-256 of the PIN (a copy of the database must not give PINs away)', async () => {
    const plain = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('4071953862'));
    const hex = Array.from(new Uint8Array(plain)).map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await pins.pinHmac('4071953862')).not.toBe(hex);
  });

  it('depends on PANEL_CRED_KEY, and is null without a usable one', async () => {
    const a = await pins.pinHmac('4071953862');
    env.PANEL_CRED_KEY = btoa(String.fromCharCode(...new Array(32).fill(9)));
    expect(await pins.pinHmac('4071953862')).not.toBe(a);
    env.PANEL_CRED_KEY = '';
    expect(await pins.pinHmac('4071953862')).toBeNull();
    env.PANEL_CRED_KEY = btoa('short');
    expect(await pins.pinHmac('4071953862')).toBeNull();
    env.PANEL_CRED_KEY = TEST_PANEL_KEY;
    expect(await pins.pinHmac('4071953862')).toBe(a);
  });
});

describe('encPin / decPin', () => {
  it('round-trips through enc:v1 with a fresh IV each time', async () => {
    const a = await pins.encPin('4071953862');
    const b = await pins.encPin('4071953862');
    expect(a).toMatch(/^enc:v1:[A-Za-z0-9+/]{39,}={0,2}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('4071953862');
    expect(await pins.decPin(a)).toBe('4071953862');
  });

  it('reads nothing that is not enc:v1 ciphertext', async () => {
    expect(await pins.decPin('4071953862')).toBeNull();
    expect(await pins.decPin('enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
    expect(await pins.decPin(null)).toBeNull();
  });
});

describe("throttle's fail-closed mode", () => {
  const db = (reply: { data: unknown; error: unknown } | Error) => ({
    rpc: vi.fn(async () => { if (reply instanceof Error) throw reply; return reply; }),
  });

  it('refuses on a database error, a missing count or a thrown call in deny mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await guard.throttle(db({ data: null, error: { message: 'down' } }), 'k', 5, 1000, 'deny')).toBe(false);
      expect(await guard.throttle(db({ data: '3', error: null }), 'k', 5, 1000, 'deny')).toBe(false);
      expect(await guard.throttle(db(new Error('boom')), 'k', 5, 1000, 'deny')).toBe(false);
      expect(warn.mock.calls.every((c) => String(c[0]).includes('fail-closed'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('still lets the call through on an outage by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await guard.throttle(db({ data: null, error: { message: 'down' } }), 'k', 5, 1000)).toBe(true);
      expect(await guard.throttle(db(new Error('boom')), 'k', 5, 1000, 'allow')).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('counts the same either way when the database answers', async () => {
    expect(await guard.throttle(db({ data: 5, error: null }), 'k', 5, 1000, 'deny')).toBe(true);
    expect(await guard.throttle(db({ data: 6, error: null }), 'k', 5, 1000, 'deny')).toBe(false);
    expect(await guard.throttle(db({ data: 6, error: null }), 'k', 5, 1000)).toBe(false);
  });
});
