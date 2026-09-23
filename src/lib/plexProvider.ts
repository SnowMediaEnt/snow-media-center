// Client half of the Plex provider link: a box that is signed into Live TV
// (DreamStreams or Vibez) asks plex-provider-token for the provider's Plex
// token and connects with it — no PIN, no "send the code to your provider".
//
// The server re-verifies the line against the panel and only answers an
// active line. Every failure is a soft { ok:false, reason }; the caller
// decides what to show. Outcomes are remembered per line for a while so a
// remount or a second screen does not re-issue the same request — the
// function mints nothing, but it does hit the panel and it is throttled.
import { supabase } from '@/integrations/supabase/client';
import { loadPlayerAccount, type XtreamCreds } from '@/lib/xtream';

export interface ProviderPlexResult {
  ok: boolean;
  token?: string;
  /** 'disabled' | 'auth_failed' | 'line_inactive' | 'panel_unreachable' | 'rate_limited' | 'network' | ... */
  reason?: string;
  /** Panel status string when reason is 'line_inactive' ('expired', 'disabled', 'banned'). */
  status?: string;
}

const PROVIDER_FLAG_KEY = 'snow-plex-provider-v1';

// A Plex server name that belongs to the provider. Used to tell "the provider's
// token died on this box" from "a member's personal server is unreachable" —
// only the former is ours to repair.
const PROVIDER_SERVER_RE = /snow[\s\-_]*media/i;
export const isProviderServer = (name?: string | null): boolean => !!name && PROVIDER_SERVER_RE.test(name);

const HARD_TTL_MS = 10 * 60 * 1000;
const SOFT_TTL_MS = 60 * 1000;
const HARD_REASONS = new Set(['disabled', 'auth_failed', 'line_inactive', 'rate_limited', 'host_not_allowed', 'provider_misconfigured', 'not_customer', 'plex_disabled']);

const inflight = new Map<string, Promise<ProviderPlexResult>>();

const bareHost = (host: string): string => host.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const lineOf = (creds: XtreamCreds): string => `${bareHost(creds.host)}|${creds.username.trim().toLowerCase()}`;
const cacheKey = (line: string) => `plex-provider:${line}`;

const readCached = (line: string): ProviderPlexResult | null => {
  try {
    const raw = sessionStorage.getItem(cacheKey(line));
    if (!raw) return null;
    const { reason, status, until } = JSON.parse(raw) as { reason?: string; status?: string; until?: number };
    if (typeof until !== 'number' || until <= Date.now()) return null;
    return { ok: false, reason: reason || 'error', status };
  } catch {
    return null;
  }
};

const writeCached = (line: string, reason: string, status?: string): void => {
  const ttl = HARD_REASONS.has(reason) ? HARD_TTL_MS : SOFT_TTL_MS;
  try { sessionStorage.setItem(cacheKey(line), JSON.stringify({ reason, status, until: Date.now() + ttl })); } catch { /* ignore */ }
};

async function requestProviderToken(creds: XtreamCreds): Promise<ProviderPlexResult> {
  try {
    const { data, error } = await supabase.functions.invoke('plex-provider-token', {
      body: { host: bareHost(creds.host), username: creds.username.trim(), password: creds.password.trim() },
    });
    if (error) return { ok: false, reason: 'network' };
    const payload = data as { ok?: boolean; token?: string; reason?: string; status?: string } | null;
    if (!payload?.ok || typeof payload.token !== 'string' || !payload.token) {
      return { ok: false, reason: payload?.reason || 'error', status: payload?.status };
    }
    return { ok: true, token: payload.token };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * Ask for the provider's Plex token on behalf of this line. One in-flight
 * request per line; a non-ok outcome is cached (ten minutes for definitive
 * answers, one minute for transient ones). Pass `force` to skip the cache —
 * used when the token we hold has just been rejected and a fresh one is the
 * only fix.
 */
export function fetchProviderPlexToken(creds: XtreamCreds, opts?: { force?: boolean }): Promise<ProviderPlexResult> {
  const line = lineOf(creds);
  const existing = inflight.get(line);
  if (existing) return existing;
  if (!opts?.force) {
    const cached = readCached(line);
    if (cached) return Promise.resolve(cached);
  }
  const p = requestProviderToken(creds)
    .then((r) => {
      if (r.ok) {
        try { sessionStorage.removeItem(cacheKey(line)); } catch { /* ignore */ }
      } else {
        writeCached(line, r.reason || 'error', r.status);
      }
      return r;
    })
    .finally(() => { inflight.delete(line); });
  inflight.set(line, p);
  return p;
}

/** Human text for a failed provider link, or null when there is nothing to say. */
export function providerLinkMessage(r: ProviderPlexResult): string | null {
  switch (r.reason) {
    case 'disabled': return null; // feature off — behave exactly as before
    case 'auth_failed': return 'Your Live TV sign-in was rejected by the panel. Sign into Live TV again, then come back.';
    case 'line_inactive': return `Your Live TV subscription is ${r.status || 'inactive'}. Renew it to keep Plex.`;
    case 'panel_unreachable': return "Couldn't verify your Live TV account right now. Try again in a minute.";
    case 'rate_limited': return 'Too many attempts. Try again in a few minutes.';
    case 'network': return 'No connection to Snow Media. Check the internet and try again.';
    case 'provider_misconfigured': return 'Plex is not set up correctly on the provider side yet. Ask your provider.';
    case 'not_customer': return "This Live TV account isn't on file with your provider yet. Ask them to add it, then try again.";
    case 'plex_disabled': return 'Plex has been turned off for this account. Ask your provider.';
    default: return "Couldn't connect Plex through your Live TV account.";
  }
}

// ── line expiry ────────────────────────────────────────────────────────────
// A provider-linked Plex lives as long as the line does. The Player refreshes
// the saved account from the panel every time it opens (LiveTV.tsx), so the
// status here is at most one Player launch old. Returns the panel status
// ('expired' | 'disabled' | 'banned') when the line is no longer active,
// null when it is active or there is no line at all — signing OUT of Live TV
// is not expiry and leaves Plex alone.
const INACTIVE = new Set(['expired', 'disabled', 'banned']);
export async function providerLineInactive(): Promise<string | null> {
  const acc = await loadPlayerAccount();
  if (!acc) return null;
  const status = String(acc.status || '').toLowerCase();
  if (INACTIVE.has(status)) return status;
  if (typeof acc.expDate === 'number' && acc.expDate > 0 && acc.expDate * 1000 < Date.now()) return 'expired';
  return null;
}

// ── "this token came from the line" flag ──────────────────────────────────
// Stored beside the Plex token so the hook knows the token is the provider's:
// on a 401 it may replace it, and a Live TV sign-out takes it with it. A token
// a member linked by PIN never carries the flag and is never touched.

export async function markPlexProviderLinked(on: boolean): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    if (on) await Preferences.set({ key: PROVIDER_FLAG_KEY, value: '1' });
    else await Preferences.remove({ key: PROVIDER_FLAG_KEY });
  } catch { /* not native */ }
  try {
    if (on) localStorage.setItem(PROVIDER_FLAG_KEY, '1');
    else localStorage.removeItem(PROVIDER_FLAG_KEY);
  } catch { /* ignore */ }
}

export async function isPlexProviderLinked(): Promise<boolean> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: PROVIDER_FLAG_KEY });
    if (value === '1') return true;
  } catch { /* not native */ }
  try { return localStorage.getItem(PROVIDER_FLAG_KEY) === '1'; } catch { return false; }
}

// ── whose Plex account is this box on? ─────────────────────────────────────
//
// Plex keeps resume points and On Deck per ACCOUNT, not per device token. The
// Hub links each box's plex.tv/link code to one account (your owner account
// or the Hub's link account), and the provider link hands out the provider
// account — so those boxes each have their own token but share one account
// and one viewing history. Their progress must not be reported to Plex (the
// app keeps it per viewer instead, see plexProgress). A box on none of those
// accounts is on the customer's own Plex account and can report it.
const SHARED_ACCOUNTS_KEY = 'snow-plex-shared-accounts-v2';
const SHARED_ACCOUNTS_TTL_MS = 24 * 3600_000;

interface SharedAccounts { uuid: string; usernames: string[] }

/** The accounts many boxes share (cached a day), or null if unknown. */
export async function sharedPlexAccounts(): Promise<SharedAccounts | null> {
  try {
    const cached = JSON.parse(localStorage.getItem(SHARED_ACCOUNTS_KEY) || 'null') as (SharedAccounts & { at?: number }) | null;
    if (cached?.uuid && Array.isArray(cached.usernames) && Date.now() - (cached.at ?? 0) < SHARED_ACCOUNTS_TTL_MS) return cached;
  } catch { /* ask */ }
  try {
    const { data, error } = await supabase.functions.invoke('plex-provider-token', { body: { action: 'account' } });
    // An answer without the Hub's accounts is incomplete: treat as unknown.
    if (error || !data?.ok || typeof data.uuid !== 'string' || !Array.isArray(data.usernames)) return null;
    const out: SharedAccounts = { uuid: data.uuid, usernames: (data.usernames as unknown[]).map((u) => String(u).toLowerCase()) };
    try { localStorage.setItem(SHARED_ACCOUNTS_KEY, JSON.stringify({ ...out, at: Date.now() })); } catch { /* ignore */ }
    return out;
  } catch {
    return null;
  }
}

/** True only when this box's Plex account is known to be the viewer's own:
 *  not provider-linked, and neither the provider account nor one of the
 *  Hub's accounts. Anything unknown counts as shared (nothing is reported). */
export async function isOwnPlexAccount(account: { uuid?: string; username?: string } | null | undefined): Promise<boolean> {
  if (!account?.uuid || !account.username) return false;
  if (await isPlexProviderLinked()) return false;
  const shared = await sharedPlexAccounts();
  if (!shared) return false;
  if (shared.uuid === account.uuid) return false;
  return !shared.usernames.includes(account.username.toLowerCase());
}
