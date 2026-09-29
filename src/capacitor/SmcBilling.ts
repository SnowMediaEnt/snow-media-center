import { registerPlugin, Capacitor } from '@capacitor/core';

/**
 * Bridge to the native billing account plugin (com.snowmedia.billing).
 *
 * The plugin owns the token (EncryptedSharedPreferences), the per-install
 * device id, the HTTP client and the polling loops; every method here resolves
 * with the API's own JSON shape (docs/billing/API.md) so these types mirror the
 * contract field for field. A failed call rejects with a CapacitorException
 * whose `code` is the API's stable error code and whose `data` carries
 * `{code, status, details}` — see toBillingError() in lib/billing.ts.
 *
 * Nothing secret ever passes through this file except in transit: the token
 * stays native, and the web layer only ever sees `signedIn` and the email.
 */

export interface BillingClient {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  email: string;
  trial_used?: boolean;
}

export interface BillingPlan {
  id: number;
  name: string;
  connections: number;
  term_months: number;
  /** null when the product has no enabled billing cycle. */
  cycle: string | null;
  /** null when the product has no enabled billing cycle; may be 0. */
  price: number | null;
  currency: string;
  trial: boolean;
  hidden: boolean;
  orderable: boolean;
}

export interface BillingPlansResponse {
  currency: string;
  plans: BillingPlan[];
}

export interface BillingCredentials {
  host: string;
  username: string;
  password: string;
  m3u_url?: string | null;
}

export type BillingServiceStatus = 'pending' | 'active' | 'suspended' | 'terminated' | 'cancelled' | string;

export interface BillingService {
  id: number;
  plan: { id: number; name: string; cycle: string | null; term_months: number; trial: boolean };
  status: BillingServiceStatus;
  active: boolean;
  connections: number;
  billing_cycle?: string | null;
  amount: number | null;
  currency: string;
  registered_at?: string | null;
  next_due?: string | null;
  expires_at?: string | null;
  panel_line_id?: string | null;
  /** null until the line exists (a pending paid order). */
  credentials: BillingCredentials | null;
}

export interface BillingTrialResult {
  order_id: number;
  service: BillingService;
}

export interface BillingRenewResult {
  invoice_id: number;
  amount: number | null;
  currency: string;
  due_date: string | null;
  /** "paid" with a null pay_url means account credit covered it. */
  status: 'unpaid' | 'paid' | string;
  pay_url: string | null;
}

export interface BillingOrderResult {
  order_id: number;
  service_id: number;
  /** null for a 0.00 plan — nothing to pay, the operator activates it. */
  invoice_id: number | null;
  amount: number | null;
  currency: string;
  /** true when an earlier unfinished order for the same plan was returned. */
  reused: boolean;
  plan: BillingPlan | null;
  pay_url: string | null;
}

export interface BillingInvoice {
  invoice_id: number;
  status: 'unpaid' | 'paid' | 'cancelled' | 'refunded' | string;
  total: number | null;
  currency: string;
  due_date?: string | null;
  paid_at?: string | null;
}

export interface BillingPayUrlResult {
  invoice_id: number;
  status: string;
  total: number | null;
  currency: string;
  pay_url: string;
}

export interface BillingRedeemResult {
  ok: boolean;
  result: {
    message?: string;
    credit?: unknown;
    amount?: number;
    currency?: string;
    balance?: number;
    plan?: string;
    expires_at?: string;
  };
}

export interface BillingPendingInvoice {
  invoice_id: number;
  kind: 'renew' | 'order';
  service_id: number | null;
  plan_name: string | null;
  created_at: number;
}

export interface BillingState {
  /** The build has an app key; false means the feature cannot work here. */
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  tokenExpiresAt: string | null;
  pendingInvoice: BillingPendingInvoice | null;
}

export interface BillingSession {
  client: BillingClient;
  expiresAt: string | null;
}

export interface InvoicePollOutcome {
  outcome: 'paid' | 'closed' | 'timeout' | 'cancelled';
  invoice: BillingInvoice | null;
  ticks: number;
}

export interface ServicePollOutcome {
  outcome: 'active' | 'terminal' | 'timeout' | 'cancelled';
  service: BillingService | null;
  ticks: number;
}

export interface SmcBillingPlugin {
  getState(): Promise<BillingState>;
  /** Whether anything on this device can open an https link (Custom Tab). */
  canOpenUrl(options?: { url?: string }): Promise<{ available: boolean }>;
  register(options: { email: string; password: string; firstName: string; lastName: string; phone?: string; country?: string }): Promise<BillingSession>;
  login(options: { email: string; password: string }): Promise<BillingSession>;
  logout(): Promise<BillingState>;
  me(): Promise<{ client: BillingClient }>;
  plans(): Promise<BillingPlansResponse>;
  startTrial(): Promise<BillingTrialResult>;
  services(): Promise<{ services: BillingService[] }>;
  service(options: { serviceId: number }): Promise<{ service: BillingService }>;
  renew(options: { serviceId: number }): Promise<BillingRenewResult>;
  order(options: { planId: number }): Promise<BillingOrderResult>;
  invoice(options: { invoiceId: number }): Promise<BillingInvoice>;
  /** Mints a fresh one-time pay_url. Open it at once; never keep it. */
  payUrl(options: { invoiceId: number }): Promise<BillingPayUrlResult>;
  redeem(options: { code: string }): Promise<BillingRedeemResult>;
  pendingInvoice(): Promise<{ pending: BillingPendingInvoice | null }>;
  clearPendingInvoice(): Promise<void>;
  /** Polls every 3 s for up to 2 min. Resolves on paid/closed/timeout/cancelled. */
  pollInvoice(options: { invoiceId: number; pollId?: string }): Promise<InvoicePollOutcome>;
  pollServiceActive(options: { serviceId: number; pollId?: string }): Promise<ServicePollOutcome>;
  cancelPoll(options?: { pollId?: string }): Promise<void>;
}

// The screens show billingErrorText(), which words 'not_available' in the app's language.
class NotAvailable extends Error {
  code = 'not_available';
  data = { code: 'not_available', status: 0, details: null };
  constructor() { super('Billing is only available in the Snow Media Center app.'); }
}

const offState: BillingState = { configured: false, signedIn: false, email: null, tokenExpiresAt: null, pendingInvoice: null };

const unavailable: SmcBillingPlugin = {
  getState: async () => offState,
  canOpenUrl: async () => ({ available: false }),
  register: async () => { throw new NotAvailable(); },
  login: async () => { throw new NotAvailable(); },
  logout: async () => offState,
  me: async () => { throw new NotAvailable(); },
  plans: async () => { throw new NotAvailable(); },
  startTrial: async () => { throw new NotAvailable(); },
  services: async () => { throw new NotAvailable(); },
  service: async () => { throw new NotAvailable(); },
  renew: async () => { throw new NotAvailable(); },
  order: async () => { throw new NotAvailable(); },
  invoice: async () => { throw new NotAvailable(); },
  payUrl: async () => { throw new NotAvailable(); },
  redeem: async () => { throw new NotAvailable(); },
  pendingInvoice: async () => ({ pending: null }),
  clearPendingInvoice: async () => undefined,
  pollInvoice: async () => { throw new NotAvailable(); },
  pollServiceActive: async () => { throw new NotAvailable(); },
  cancelPoll: async () => undefined,
};

export const SmcBilling = registerPlugin<SmcBillingPlugin>('SmcBilling', { web: unavailable });

/** The native plugin is present (Android app build with the plugin registered). */
export const isBillingAvailable = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SmcBilling');
