// AES-256-GCM for the panel credentials held in the CRM.
// The key lives ONLY in edge-function env (PANEL_CRED_KEY) — never in the
// database and never in a client, because the threat being defended against is
// a copy of the database itself.
// Wire format: enc:v1:<base64( iv(12 bytes) || ciphertext+tag )>
// decryptMaybe() returns a value without the prefix untouched, so readers can
// be migrated BEFORE any row is encrypted.

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;

let cached: CryptoKey | null = null;

function b64decode(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(): Promise<CryptoKey> {
  if (cached) return cached;
  const raw = (Deno.env.get('PANEL_CRED_KEY') ?? '').trim();
  if (!raw) throw new Error('PANEL_CRED_KEY is not set on this project.');
  const bytes = b64decode(raw);
  if (bytes.length !== 32) throw new Error(`PANEL_CRED_KEY must decode to 32 bytes, got ${bytes.length}.`);
  cached = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return cached;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export async function decryptMaybe(value: string | null | undefined): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null;
  if (!isEncrypted(value)) return value;
  const joined = b64decode(value.slice(PREFIX.length));
  const iv = joined.slice(0, IV_BYTES);
  const ct = joined.slice(IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(), ct);
  return new TextDecoder().decode(plain);
}

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * The mirror of decryptMaybe: enc:v1 ciphertext of `plain` (a fresh random
 * IV every time), or null when PANEL_CRED_KEY is missing or unusable. Callers
 * that must never store a value in the clear (signin_pins.pin_enc) refuse on
 * null.
 */
export async function encryptForStorage(plain: string): Promise<string | null> {
  let k: CryptoKey;
  try {
    k = await key();
  } catch {
    return null;
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plain)));
  const joined = new Uint8Array(iv.length + ct.length);
  joined.set(iv);
  joined.set(ct, iv.length);
  return PREFIX + b64encode(joined);
}
