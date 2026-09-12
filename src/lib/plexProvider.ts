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
import type { XtreamCreds } from '@/lib/xtream';

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
const HARD_REASONS = new Set(['disabled', 'auth_failed', 'line_inactive', 'rate_limited', 'host_not_allowed', 'provider_misconfigured']);

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
    default: return "Couldn't connect Plex through your Live TV account.";
  }
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
