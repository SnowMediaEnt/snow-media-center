// Account-claim flow for player-only users (Xtream panel sign-in, no SMC
// account). Purely additive: it changes nothing about Player sign-in or the
// expiry warnings — it only gives us a way to reach those customers.
//
// TV side: creates a short-lived claim session carrying the panel identity and
// renders a QR of the claim URL. The phone opens /claim, signs in or creates an
// account, and completes the claim server-side (customers + customer_services
// upsert + player_signins stamping + optional customer_devices row).
// "Enter email here" on the TV is the no-phone fallback and writes the same
// records via claim_account_manual (requires a captured panel sign-in).

import { supabase } from '@/integrations/supabase/client';
import { expDateToMs, type PlayerAccount } from '@/lib/xtream';

/** Public URL the phone opens. The claim page is a route in the published app. */
export const CLAIM_PAGE_URL = 'https://snow-tv-hub-center.lovable.app/claim';

const DISMISS_KEY = 'snow-claim-dismissed-at';
const DONE_PREFIX = 'snow-claim-done-v1::';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// --- local gating (7-day "Not now" suppression + per-account claimed flag) ---

export const claimDoneKey = (host: string, username: string): string =>
  DONE_PREFIX + `${host.trim().toLowerCase()}::${username.trim().toLowerCase()}`;

export const isClaimDone = (
  account: Pick<PlayerAccount, 'host' | 'username'> | null | undefined,
): boolean => {
  if (!account?.host || !account?.username) return false;
  try { return !!localStorage.getItem(claimDoneKey(account.host, account.username)); } catch { return false; }
};

export const markClaimDone = (host: string, username: string, email: string): void => {
  try { localStorage.setItem(claimDoneKey(host, username), email); } catch { /* ignore */ }
};

/** True while the 7-day "Not now" suppression is active. */
export const isClaimDismissed = (): boolean => {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < SEVEN_DAYS_MS;
  } catch { return false; }
};

export const markClaimDismissed = (): void => {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
};

// --- URLs + dates --------------------------------------------------------------

export const buildClaimUrl = (token: string): string =>
  `${CLAIM_PAGE_URL}?token=${encodeURIComponent(token)}`;

const expIsoDate = (expDate: number | null): string | null => {
  const ms = expDateToMs(expDate);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

// --- RPC wrappers ----------------------------------------------------------------

export interface ClaimSessionSnapshot {
  token: string;
  panel_username: string;
  server_label: string | null;
  expiration_date: string | null;
  completed_at: string | null;
  claimed_email: string | null;
  expires_at: string;
}

export interface ClaimResult {
  ok: boolean;
  reason?: string;
  email?: string;
  already_completed?: boolean;
}

/** TV: create a pending claim session; returns the token to encode in the QR. */
export const createClaimSession = async (account: PlayerAccount): Promise<string> => {
  const { data, error } = await supabase.rpc('create_claim_session', {
    p_panel_username: account.username.trim().toLowerCase(),
    p_panel_host: account.host,
    p_server_label: account.serverLabel,
    p_expiration_date: expIsoDate(account.expDate) ?? undefined,
    p_max_connections: account.maxConnections ?? undefined,
    p_is_trial: account.isTrial,
  });
  if (error) throw error;
  return data;
};

/** TV (polling) + phone (form): read a session by token. Null = unknown/expired. */
export const getClaimSession = async (token: string): Promise<ClaimSessionSnapshot | null> => {
  const { data, error } = await supabase.rpc('get_claim_session', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return (row as ClaimSessionSnapshot | undefined) ?? null;
};

/**
 * Phone (signed in): complete the claim — ensures the customers row, upserts
 * customer_services in the syncPlayerAccountToCloud shape, stamps
 * player_signins (matched_customer_id + supabase_user_id), and records the
 * optional device type into customer_devices.
 */
export const completeAccountClaim = async (
  token: string,
  name: string | null,
  deviceType: string | null,
): Promise<ClaimResult> => {
  const { data, error } = await supabase.rpc('complete_account_claim', {
    p_token: token,
    p_name: name ?? undefined,
    p_device_type: deviceType ?? undefined,
  });
  if (error) throw error;
  return data as unknown as ClaimResult;
};

/** TV manual fallback (anonymous): email-only claim writing the same records. */
export const claimAccountManual = async (
  account: PlayerAccount,
  email: string,
): Promise<ClaimResult> => {
  const { data, error } = await supabase.rpc('claim_account_manual', {
    p_panel_username: account.username.trim().toLowerCase(),
    p_panel_host: account.host,
    p_server_label: account.serverLabel,
    // These columns accept NULL at runtime; the generated types mark them
    // required because the function declares no DEFAULTs.
    p_expiration_date: expIsoDate(account.expDate) as string,
    p_max_connections: account.maxConnections as number,
    p_is_trial: account.isTrial,
    p_email: email.trim().toLowerCase(),
  });
  if (error) throw error;
  return data as unknown as ClaimResult;
};
