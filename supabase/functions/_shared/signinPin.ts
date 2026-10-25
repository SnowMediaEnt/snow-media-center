// Sign-in PINs (owner, 2026-10-24; 20261025120000_signin_pins.sql): every
// DreamStreams / Vibez line gets one 10-digit PIN, and a customer signs in to
// Live TV with the PIN instead of the line's username and password
// (pin-signin). This file is the PIN itself; signinPinLines.ts is the table.
// Ported from Tronix (omniplayer b48 _shared/signinPin.ts), which is in
// production:
//
//   normalizePin   what was typed -> exactly 10 ASCII digits, or null. Spaces
//                  and dashes go; Arabic-Indic digits count as digits.
//   newPin         10 random digits (uniform; repeated or sequential skipped).
//   pinHmac        the lookup key stored in signin_pins.pin_hmac.
//   encPin/decPin  signin_pins.pin_enc (enc:v1), only so the hub can show the
//                  PIN again.
//
// The lookup key is HMAC-SHA256 over the 10 digits with a key DERIVED from
// PANEL_CRED_KEY (HKDF-SHA256, info "smc-signin-pin-v1"), not a plain hash:
// there are only 10^10 PINs, so a SHA-256 of one is reversed by trying them
// all, and a copy of the database alone must not give the PINs away. No new
// secret: PANEL_CRED_KEY is already on the project (it encrypts the stored
// line passwords), and HKDF with its own info string gives an HMAC key that
// is independent of the AES key it comes from.
//
// Never log a PIN, its HMAC or the key. Deno is only reached through
// globalThis, so the app's tests can load this file.

import { decryptMaybe, encryptForStorage, isEncrypted } from './panelcrypto.ts';

export const PIN_LENGTH = 10;
export const PIN_HMAC_INFO = 'smc-signin-pin-v1';

const env = (name: string): string | undefined =>
  (globalThis as { Deno?: { env?: { get: (k: string) => string | undefined } } }).Deno?.env?.get(name);

// Spaces (any kind), dashes and the hyphen-like characters a phone keyboard
// may put in instead.
const SEPARATORS = /[\s\-‐-―−﹘﹣－]+/g;

/** Exactly 10 digits once spaces and dashes are gone, else null. */
export function normalizePin(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const s = raw
    .replace(SEPARATORS, '')
    // Arabic-Indic (U+0660-0669) and Eastern Arabic-Indic (U+06F0-06F9) digits.
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  return s.length === PIN_LENGTH && /^[0-9]+$/.test(s) ? s : null;
}

/** One digit repeated, or a straight run up or down (1234567890, 9876543210). */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  let up = true;
  let down = true;
  for (let i = 1; i < pin.length; i++) {
    const step = (Number(pin[i]) - Number(pin[i - 1]) + 10) % 10;
    if (step !== 1) up = false;
    if (step !== 9) down = false;
  }
  return up || down;
}

/** 10 random digits, uniform over 0000000000-9999999999 (minus the weak ones). */
export function newPin(): string {
  const buf = new Uint8Array(32);
  for (;;) {
    let pin = '';
    while (pin.length < PIN_LENGTH) {
      crypto.getRandomValues(buf);
      // Each digit on its own: a byte under 250 (25 x 10), so no digit is
      // likelier than another and every PIN as likely as every other.
      for (let i = 0; i < buf.length && pin.length < PIN_LENGTH; i++) {
        if (buf[i] < 250) pin += String(buf[i] % 10);
      }
    }
    if (!isWeakPin(pin)) return pin;
  }
}

function b64decode(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const keys = new Map<string, Promise<CryptoKey>>();

/** The HMAC key, or null when PANEL_CRED_KEY is missing or not 32 bytes. */
export function pinHmacKey(): Promise<CryptoKey | null> {
  const raw = (env('PANEL_CRED_KEY') ?? '').trim();
  if (!raw) return Promise.resolve(null);
  let k = keys.get(raw);
  if (!k) {
    k = (async () => {
      const bytes = b64decode(raw);
      if (bytes.length !== 32) throw new Error('bad key length');
      const base = await crypto.subtle.importKey('raw', bytes.buffer as ArrayBuffer, 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(PIN_HMAC_INFO) },
        base,
        { name: 'HMAC', hash: 'SHA-256', length: 256 },
        false,
        ['sign'],
      );
    })();
    keys.set(raw, k);
    k.catch(() => keys.delete(raw));
  }
  return k.catch(() => null);
}

/** signin_pins.pin_hmac for a normalised PIN (64 lowercase hex), or null without a usable key. */
export async function pinHmac(pin: string): Promise<string | null> {
  const key = await pinHmacKey();
  if (!key) return null;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** signin_pins.pin_enc for a PIN, or null without a usable key (never stored in the clear). */
export async function encPin(pin: string): Promise<string | null> {
  return encryptForStorage(pin);
}

/** The PIN back out of pin_enc, or null when it can't be read (not enc:v1, key changed). */
export async function decPin(enc: string | null | undefined): Promise<string | null> {
  if (!isEncrypted(enc)) return null;
  try {
    return normalizePin(await decryptMaybe(enc));
  } catch {
    return null;
  }
}
