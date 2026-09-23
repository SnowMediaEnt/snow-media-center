import {
  SERVERS,
  authenticate,
  normalizeCreds,
  saveCreds,
  savePlayerAccount,
  buildPlayerAccount,
  upsertSavedAccount,
  savedAccountId,
  daysUntilExp,
  type XtreamCreds,
  type XtreamServer,
  type XtreamUserInfo,
} from '@/lib/xtream';
import { capturePlayerSignin } from '@/lib/playerSigninCapture';
import { signInWithPlayerCredentials } from '@/lib/playerLogin';
import { SmcBilling } from '@/capacitor/SmcBilling';
import { trackEvent } from '@/lib/analytics';
import type { BillingCredentials, BillingPlan, BillingService } from '@/capacitor/SmcBilling';

/** The customer-facing billing site, for the cases the app cannot handle itself. */
export const BILLING_SITE = 'https://billing.smcdreamstreams.store';

// ── errors ──────────────────────────────────────────────────────────────────

export interface BillingErrorInfo {
  /** Stable code from docs/billing/API.md, or network / bad_response / not_available / internal. */
  code: string;
  message: string;
  status: number;
  details: Record<string, unknown> | null;
  /** 429: seconds the server asked us to wait. */
  retryAfter: number | null;
  /** 422: which field was wrong. */
  field: string | null;
  /** The token is dead: the plugin has already cleared it; show sign-in. */
  isAuthError: boolean;
}

/**
 * Normalise whatever the bridge rejected with. Native rejections are
 * CapacitorExceptions carrying `code` and `data: {code, status, details}`;
 * anything else becomes `internal` with its message.
 */
export function toBillingError(e: unknown): BillingErrorInfo {
  const err = (e ?? {}) as { code?: unknown; message?: unknown; data?: unknown };
  const data = (err.data && typeof err.data === 'object' ? err.data : {}) as { code?: unknown; status?: unknown; details?: unknown };
  const code = String(data.code ?? err.code ?? 'internal');
  const status = typeof data.status === 'number' ? data.status : 0;
  const details = data.details && typeof data.details === 'object' ? (data.details as Record<string, unknown>) : null;
  const retryAfterRaw = details?.retry_after;
  const retryAfter = typeof retryAfterRaw === 'number' ? retryAfterRaw : (typeof retryAfterRaw === 'string' ? parseInt(retryAfterRaw, 10) || null : null);
  const field = typeof details?.field === 'string' ? (details.field as string) : null;
  const message = typeof err.message === 'string' && err.message ? err.message : 'Something went wrong. Please try again.';
  return {
    code,
    message,
    status,
    details,
    retryAfter,
    field,
    isAuthError: status === 401 && (code === 'invalid_token' || code === 'token_expired' || code === 'missing_token'),
  };
}

/**
 * The sentence the viewer sees. The API's own message is right for most codes;
 * these are the ones the spec wants worded differently, or where the API's
 * text assumes a website the viewer is not looking at.
 */
export function billingErrorText(err: BillingErrorInfo): string {
  switch (err.code) {
    case 'network': return 'Could not reach the billing server. Check the internet connection and try again.';
    case 'bad_response': return 'The billing server sent an unexpected reply. Please try again in a minute.';
    case 'invalid_app_key': return 'This version of the app can no longer talk to billing. Please update the app.';
    case 'two_factor_required': return `This account uses two-factor sign-in. Please log in at ${BILLING_SITE.replace('https://', '')} instead.`;
    case 'account_closed': return 'This billing account is closed. Contact support if you think that is a mistake.';
    case 'invalid_credentials': return 'Wrong email or password.';
    case 'trial_already_used': return 'Trial already used. Pick a plan instead.';
    case 'not_renewable': return 'This service cannot be renewed here. Choose a plan instead.';
    case 'plan_unavailable': return 'That plan is no longer available. The list has been refreshed.';
    case 'provisioning_failed': return 'Your order was created but the panel is slow. Check My Account in a minute.';
    case 'rate_limited': return err.retryAfter ? `Too many attempts. Please wait ${err.retryAfter} seconds.` : 'Too many attempts. Please wait a moment.';
    case 'invalid_token':
    case 'token_expired':
    case 'missing_token': return 'Please sign in again.';
    default: return err.message;
  }
}

// ── formatting ──────────────────────────────────────────────────────────────

/** Money from the API's numeric amount + currency code, never from a string. */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  const cur = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${cur} ${amount.toFixed(2)}`;
  }
}

/** "1 month", "3 months", "12 months" — the group headings on the plan screen. */
export function termLabel(months: number): string {
  if (!months || months <= 0) return 'Other';
  if (months === 12) return '12 months';
  return months === 1 ? '1 month' : `${months} months`;
}

export function connectionsLabel(n: number): string {
  return n === 1 ? '1 connection' : `${n} connections`;
}

const parseDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  // Date-only strings are UTC per spec; render them as calendar days.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function formatDate(iso: string | null | undefined): string {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = parseDate(iso);
  return d ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

// ── plans / services ────────────────────────────────────────────────────────

export interface PlanGroup { term: number; label: string; plans: BillingPlan[] }

/** Only orderable plans, grouped by term (1, 3, 6, 12 months …), cheapest first within a group. */
export function groupPlans(plans: BillingPlan[]): PlanGroup[] {
  const map = new Map<number, BillingPlan[]>();
  for (const p of plans) {
    if (!p.orderable || p.trial) continue;
    const term = p.term_months > 0 ? p.term_months : 0;
    if (!map.has(term)) map.set(term, []);
    map.get(term)!.push(p);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] || 999) - (b[0] || 999))
    .map(([term, list]) => ({
      term,
      label: termLabel(term),
      plans: list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.connections - b.connections),
    }));
}

export type ServiceChip = { label: string; className: string };

export function serviceStatusChip(status: string): ServiceChip {
  const s = (status || '').toLowerCase();
  if (s === 'active') return { label: 'Active', className: 'bg-emerald-600/30 text-emerald-100 border-emerald-400/40' };
  if (s === 'pending') return { label: 'Pending', className: 'bg-amber-600/30 text-amber-100 border-amber-400/40' };
  if (s === 'suspended') return { label: 'Suspended', className: 'bg-orange-600/30 text-orange-100 border-orange-400/40' };
  if (s === 'terminated' || s === 'cancelled') return { label: s === 'terminated' ? 'Terminated' : 'Cancelled', className: 'bg-red-600/30 text-red-100 border-red-400/40' };
  return { label: status || 'Unknown', className: 'bg-slate-600/40 text-slate-100 border-slate-400/40' };
}

/** RENEW is offered only here (trial, terminated/cancelled or free → 409 not_renewable). */
export function isRenewable(s: BillingService): boolean {
  const st = (s.status || '').toLowerCase();
  return !s.plan?.trial && (st === 'active' || st === 'suspended') && (s.amount ?? 0) > 0;
}

/** A paid order whose invoice is still open: show "Finish payment". */
export function needsPayment(s: BillingService): boolean {
  return (s.status || '').toLowerCase() === 'pending' && (s.amount ?? 0) > 0;
}

/** The panel login, or null when the service has none (or blanks) yet. */
export function credentialsOf(s: BillingService): BillingCredentials | null {
  const c = s.credentials;
  return c && c.host && c.username && c.password ? c : null;
}

export function hasCredentials(s: BillingService): boolean {
  return credentialsOf(s) !== null;
}

/** "This device": the service whose username is the one the player is signed in with. Nothing else. */
export function isThisDevice(s: BillingService, playerUsername: string | null | undefined): boolean {
  if (!playerUsername || !s.credentials?.username) return false;
  return s.credentials.username.trim().toLowerCase() === playerUsername.trim().toLowerCase();
}

// ── player sign-in ──────────────────────────────────────────────────────────

const hostKey = (h: string) => h.trim().replace(/\/+$/, '').toLowerCase();

const serverForHost = (host: string): XtreamServer =>
  SERVERS.find((s) => hostKey(s.host) === hostKey(host)) ?? { label: 'Dreamstreams', host: host.trim().replace(/\/+$/, '') };

/** Which of our servers a service's host belongs to — for labels and emails. */
export const serverLabelForHost = (host: string): string => serverForHost(host).label;

/* ---------------------------------------------------------------------------
 * What the member typed on the account screen
 *
 * The email and password on that screen are first and foremost the member's
 * Snow Media account: the customer record in the hub and the website login
 * the admin side works from. The billing account uses the same pair, so one
 * email and one password work in both places.
 *
 * The billing plugin keeps only a token, so the details are held here, in
 * memory, for the few seconds between the form and the line being
 * provisioned, and handed to the hub once. Memory only, never storage: an
 * APK is not a safe place to keep a password, and this one has no reason to
 * outlive the sign-up it belongs to. It is cleared when used, when the flow
 * is left, and after half an hour regardless.
 * ------------------------------------------------------------------------- */

const SIGNUP_TTL_MS = 30 * 60 * 1000;

interface PendingSignup { email: string | null; name: string | null; password: string | null; at: number }

let pendingSignup: PendingSignup | null = null;

/** Called by the account form with what the member typed. */
export function rememberAccountSignup(details: { email?: string; name?: string; password?: string }): void {
  const email = (details.email ?? '').trim();
  const name = (details.name ?? '').trim();
  const password = details.password ?? '';
  pendingSignup = {
    email: email || null,
    name: name || null,
    password: password.length >= 8 && password.length <= 72 ? password : null,
    at: Date.now(),
  };
}

/** Reads it once. A second read, or a stale one, gets nothing. */
function takeAccountSignup(): PendingSignup | null {
  const held = pendingSignup;
  pendingSignup = null;
  if (!held) return null;
  return Date.now() - held.at <= SIGNUP_TTL_MS ? held : null;
}

/** Called when the sign-up flow is left, so nothing lingers. */
export function forgetAccountSignup(): void {
  pendingSignup = null;
}

export type ApplyResult = { ok: true; creds: XtreamCreds; probed: boolean } | { ok: false; error: string };

/**
 * Sign the player in with a service's panel credentials — the same sequence
 * CredentialsForm runs on a manual sign-in, minus the username-based server
 * guess: the API already told us the host. A line that was provisioned a
 * second ago is sometimes not yet visible to the panel's API, so a probe
 * that cannot reach the panel does not block the sign-in; the player will
 * re-check when it opens.
 */
export async function applyServiceToPlayer(
  c: BillingCredentials,
  /** Which path signed them in, so Vibez hand-offs are distinguishable in analytics. */
  via: string = 'billing',
): Promise<ApplyResult> {
  const server = serverForHost(c.host);
  const creds = normalizeCreds({ host: server.host, username: c.username, password: c.password, output: 'm3u8', serverLabel: server.label });
  if (!creds.username || !creds.password) return { ok: false, error: 'This service has no login details yet.' };

  let info: { user_info?: XtreamUserInfo } | null = null;
  let probed = false;
  for (let attempt = 0; attempt < 2 && !info; attempt++) {
    try {
      info = await authenticate(creds);
      probed = true;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  const ui = info?.user_info;
  if (probed) {
    const auth = ui?.auth;
    const authed = auth === 1 || auth === '1' || auth === true;
    if (!authed) return { ok: false, error: 'The panel did not accept these login details yet. Please try again in a minute.' };
  }

  await saveCreds(creds);
  // Signed in again: a later empty Player may sign itself in from the account.
  try { localStorage.removeItem('smc-player-signed-out'); } catch { /* ignore */ }
  const acc = buildPlayerAccount(server, creds, ui);
  await savePlayerAccount(acc);
  void upsertSavedAccount({
    id: savedAccountId(creds.host, creds.username),
    serverLabel: server.label,
    host: creds.host,
    username: creds.username,
    password: creds.password,
    output: creds.output,
    addedAt: Date.now(),
  });
  void capturePlayerSignin(acc, server.label, 'signin');
  // The person behind this line is known here — they just registered or
  // signed into billing with a name and an email — so the hub gets a real
  // customer with the line under it, and the website account is created for
  // that email, the same "finish your account" path the Player offers by
  // hand. Best-effort and off the critical path: a hub hiccup never delays
  // the sign-in the member is waiting for.
  void recordMemberInHub(creds.username, creds.password);
  try {
    trackEvent('livetv_signin', 'player', { server: server.label, username: acc.username, is_trial: acc.isTrial, days_left: daysUntilExp(acc), via });
  } catch { /* ignore */ }
  return { ok: true, creds, probed };
}

/**
 * Records the member in the hub: the customer, the line under them, and the
 * website account for their email, carrying the password they chose.
 *
 * What they typed is the primary source — the hub record must not depend on
 * the billing session still being alive — and the billing account is asked
 * as well, since it is authoritative for the email once it exists. One
 * retry, because this is the record the admin side works from and a single
 * dropped request should not lose it. Off the critical path either way: the
 * member is watching while this runs.
 */
async function recordMemberInHub(username: string, password: string): Promise<void> {
  const typed = takeAccountSignup();
  let name = typed?.name ?? '';
  let email = typed?.email ?? '';
  try {
    const { client } = await SmcBilling.me();
    const billingName = (client.name || [client.first_name, client.last_name].filter(Boolean).join(' ')).trim();
    const billingEmail = (client.email || '').trim();
    if (billingName) name = billingName;
    if (billingEmail) email = billingEmail;
  } catch { /* the billing session may be gone, or this is the web build */ }
  if (!name && !email) return;

  const profile = {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    // So the website account is born with the same password as the billing
    // one. The hub only ever uses it for an account it is creating; an email
    // that already has a website account keeps its own password.
    ...(typed?.password ? { accountPassword: typed.password } : {}),
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await signInWithPlayerCredentials(username, password, profile);
      // ok, or recorded without a session (no email, or that email already
      // has an account of its own) — either way the hub has the member.
      if (res.ok || res.saved) return;
      if (res.reason && !['network', 'error', 'panel_unreachable'].includes(res.reason)) return;
    } catch { /* fall through to the retry */ }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
  }
}

// ── clipboard ───────────────────────────────────────────────────────────────

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
