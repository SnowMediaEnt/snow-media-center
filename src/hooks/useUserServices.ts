import { useCallback, useEffect, useState } from 'react';
import i18n from '@/i18n';
import { supabase } from '@/integrations/supabase/client';
import { runAfter } from '@/utils/idle';

export interface UserDevice {
  id: string;
  device_type: string;
  label: string | null;
  notes: string | null;
}

export interface UserService {
  id: string;
  service_type: string;
  service_name: string | null;
  expiration_date: string | null;
  tied_apps: string[];
  renewal_status: string | null;
  notes: string | null;
}

export interface UserServicesState {
  customerId: string | null;
  devices: UserDevice[];
  services: UserService[];
}

/** Returns days until the given ISO date. Negative = expired. */
export const daysUntil = (iso?: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
};

// A user's customer row id, looked up once. At start-up the services read
// below and the Player's cloud sync (lib/playerAccountSync →
// ensureCustomerRow) each looked it up; they now share one request.
const customerIds = new Map<string, string>();
const customerLookups = new Map<string, Promise<string | null>>();

/** The customer row id of `userId`, or null when there is none. Throws on a failed read. */
export const findCustomerId = (userId: string): Promise<string | null> => {
  const known = customerIds.get(userId);
  if (known) return Promise.resolve(known);
  let p = customerLookups.get(userId);
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (data?.id) customerIds.set(userId, data.id);
      return data?.id ?? null;
    })().finally(() => { customerLookups.delete(userId); });
    customerLookups.set(userId, p);
  }
  return p;
};

/** Ensure a customer row exists for the given user. Returns the id. */
export const ensureCustomerRow = async (
  userId: string,
  email: string,
  isAdminMode = false
): Promise<string> => {
  const existingId = await findCustomerId(userId);
  if (existingId) return existingId;

  // Also try linking by email (admin may have pre-created)
  const { data: byEmail } = await supabase
    .from('customers')
    .select('id, user_id')
    .ilike('email', email)
    .maybeSingle();
  if (byEmail?.id) {
    if (!byEmail.user_id) {
      await supabase.from('customers').update({ user_id: userId }).eq('id', byEmail.id);
      customerIds.set(userId, byEmail.id);
    }
    return byEmail.id;
  }

  const { data: created, error: insErr } = await supabase
    .from('customers')
    .insert({ user_id: userId, email })
    .select('id')
    .single();
  if (insErr) throw insErr;
  customerIds.set(userId, created.id);
  return created.id;
};

/**
 * Hook for the signed-in user to read their own devices + services.
 * Used by the Home banner and the app-launch popup matcher.
 *
 * Module-level singleton: the chain (session + customers + customer_devices +
 * customer_services) runs ONCE shared across every consumer (useAppAlerts,
 * ServiceExpirationBanner, …), and not at start-up: the first read waits
 * ~2.5 s and for a quiet moment (an app launched before then asks for it with
 * ensureLoaded). The `userServicesRefresh` event still triggers a refetch.
 *
 * The user comes from the stored session (no auth/v1/user round-trip): the
 * rows are only ever the signed-in user's own, which RLS enforces anyway.
 */

const EMPTY_STATE: UserServicesState = { customerId: null, devices: [], services: [] };
const FIRST_READ_DELAY_MS = 2500;
/** The longest the first read waits for a cloud write already under way. */
const WRITE_WAIT_MS = 8000;

let svcState: UserServicesState = EMPTY_STATE;
let svcLoading = true;
let svcInflight: Promise<void> | null = null;
let svcQueued: Promise<void> | null = null;
let svcHasFetched = false;
let svcFirstScheduled: (() => void) | null = null;
let svcWaitingForWrites = false;
const svcListeners = new Set<() => void>();
let svcRefreshBound = false;

// Writes to customer_services under way (the Player's cloud sync at start-up).
// The first read waits for them, so it sees what they wrote and the refresh
// they ask for afterwards is not a second read of the same rows.
const pendingWrites = new Set<Promise<unknown>>();
/** Register a write to the viewer's services; the first read waits for it. */
export const trackServicesWrite = (p: Promise<unknown>): void => {
  const done = p.catch(() => undefined).finally(() => { pendingWrites.delete(done); });
  pendingWrites.add(done);
};

const emitServices = () => svcListeners.forEach((l) => l());

const readServices = (customerId: string) =>
  supabase
    .from('customer_services')
    .select('id, service_type, service_name, expiration_date, tied_apps, renewal_status, notes')
    .eq('customer_id', customerId);

const toServices = (rows: unknown): UserService[] =>
  (((rows as any[]) || []).map((s) => ({
    ...s,
    tied_apps: Array.isArray(s.tied_apps) ? s.tied_apps : [],
  }))) as UserService[];

const runUserServicesFetch = (opts: { servicesOnly?: boolean } = {}): Promise<void> => {
  if (svcInflight) {
    // A refresh asked for during a read: one more read after it, since the
    // rows may have changed after the running one read them.
    if (!svcQueued) svcQueued = svcInflight.then(() => { svcQueued = null; return runUserServicesFetch(opts); });
    return svcQueued;
  }
  svcFirstScheduled?.(); svcFirstScheduled = null;
  svcLoading = true;
  const p = (async () => {
    try {
      if (!svcHasFetched && pendingWrites.size) {
        svcWaitingForWrites = true;
        await Promise.race([
          Promise.all([...pendingWrites]),
          new Promise((r) => setTimeout(r, WRITE_WAIT_MS)),
        ]);
        svcWaitingForWrites = false;
      }
      // Only the services changed (the Player's sync wrote one): the
      // customer and the devices are what they were.
      if (opts.servicesOnly && svcState.customerId) {
        const { data, error } = await readServices(svcState.customerId);
        if (!error) svcState = { ...svcState, services: toServices(data) };
        return;
      }
      const { data: auth } = await supabase.auth.getSession();
      const user = auth?.session?.user;
      if (!user) {
        svcState = EMPTY_STATE;
        return;
      }
      const customerId = await findCustomerId(user.id);
      if (!customerId) {
        svcState = EMPTY_STATE;
        return;
      }
      const [devRes, svcRes] = await Promise.all([
        supabase
          .from('customer_devices')
          .select('id, device_type, label, notes')
          .eq('customer_id', customerId),
        readServices(customerId),
      ]);
      svcState = {
        customerId,
        devices: (devRes.data as UserDevice[]) || [],
        services: toServices(svcRes.data),
      };
    } catch (e) {
      console.warn('[useMyUserServices] failed:', e);
    } finally {
      svcWaitingForWrites = false;
      svcLoading = false;
      svcHasFetched = true;
    }
  })();
  const tracked: Promise<void> = p.finally(() => {
    if (svcInflight === tracked) svcInflight = null;
    emitServices();
  });
  svcInflight = tracked;
  return tracked;
};

/** Read now unless a read has happened or is under way. */
const ensureUserServicesLoaded = (): void => {
  if (!svcHasFetched && !svcInflight) void runUserServicesFetch();
};

if (typeof window !== 'undefined' && !svcRefreshBound) {
  svcRefreshBound = true;
  window.addEventListener('userServicesRefresh', (e) => {
    // Not read yet, or the first read is still waiting for this very write:
    // that read will see it.
    if (!svcHasFetched && (svcFirstScheduled || svcWaitingForWrites || !svcListeners.size)) return;
    const detail = (e as CustomEvent<{ servicesOnly?: boolean } | null>).detail;
    void runUserServicesFetch({ servicesOnly: !!detail?.servicesOnly });
  });
}

export const useMyUserServices = () => {
  const [, setTick] = useState(0);
  const refetch = useCallback(async () => {
    await runUserServicesFetch();
  }, []);

  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    svcListeners.add(listener);
    if (!svcHasFetched && !svcInflight && !svcFirstScheduled) {
      svcFirstScheduled = runAfter(FIRST_READ_DELAY_MS, () => {
        svcFirstScheduled = null;
        ensureUserServicesLoaded();
      });
    }
    return () => { svcListeners.delete(listener); };
  }, []);

  return { ...svcState, loading: svcLoading, refetch, ensureLoaded: ensureUserServicesLoaded };
};

/** Tests only. */
export const __resetUserServicesForTests = (): void => {
  svcFirstScheduled?.(); svcFirstScheduled = null;
  svcState = EMPTY_STATE; svcLoading = true; svcInflight = null; svcQueued = null;
  svcHasFetched = false; svcWaitingForWrites = false;
  svcListeners.clear(); pendingWrites.clear();
  customerIds.clear(); customerLookups.clear();
};

export const SERVICE_WARN_DAYS = 30;

export type ExpirySeverity = 'info' | 'warning' | 'critical';
export interface ExpiryState {
  show: boolean;
  severity: ExpirySeverity;
  label: string;          // e.g. "expires in 12 days", "expires today", "expired 3 days ago"
  daysUntil: number | null;
}

/**
 * Tiered expiration state, used by both the home banner and the per-app popup.
 *   > 30 days   → hidden
 *   8..30 days  → info
 *   2..7 days   → warning
 *   1 / 0       → critical (tomorrow / today)
 *   < 0         → critical (expired N days ago) — keeps showing daily after expiry
 */
export const expiryState = (days: number | null): ExpiryState => {
  if (days === null) {
    return { show: false, severity: 'info', label: '', daysUntil: null };
  }
  // The label is written in the app's language when this runs; callers compute it while drawing.
  if (days > 30) {
    return { show: false, severity: 'info', label: i18n.t('account.expiry.inDays', { count: days }), daysUntil: days };
  }
  if (days >= 8) {
    return { show: true, severity: 'info', label: i18n.t('account.expiry.inDays', { count: days }), daysUntil: days };
  }
  if (days >= 2) {
    return { show: true, severity: 'warning', label: i18n.t('account.expiry.inDays', { count: days }), daysUntil: days };
  }
  if (days === 1) {
    return { show: true, severity: 'critical', label: i18n.t('account.expiry.tomorrow'), daysUntil: days };
  }
  if (days === 0) {
    return { show: true, severity: 'critical', label: i18n.t('account.expiry.today'), daysUntil: days };
  }
  return {
    show: true,
    severity: 'critical',
    label: i18n.t('account.expiry.expiredAgo', { count: Math.abs(days) }),
    daysUntil: days,
  };
};

/** Returns the most urgent service that needs an alert, or null. */
export const findUrgentService = (services: UserService[]): UserService | null => {
  let urgent: UserService | null = null;
  let bestScore = Infinity;
  for (const s of services) {
    const d = daysUntil(s.expiration_date);
    if (d === null) continue;
    const state = expiryState(d);
    if (!state.show) continue;
    // lower d = more urgent (expired = negative = even more urgent)
    if (d < bestScore) {
      bestScore = d;
      urgent = s;
    }
  }
  return urgent;
};
