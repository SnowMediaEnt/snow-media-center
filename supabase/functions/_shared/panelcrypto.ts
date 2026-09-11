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
