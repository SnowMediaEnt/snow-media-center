import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

/** Ensure a customer row exists for the given user. Returns the id. */
export const ensureCustomerRow = async (
  userId: string,
  email: string,
  isAdminMode = false
): Promise<string> => {
  const { data: existing, error: selErr } = await supabase
    .from('customers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing?.id) return existing.id;

  // Also try linking by email (admin may have pre-created)
  const { data: byEmail } = await supabase
    .from('customers')
    .select('id, user_id')
    .ilike('email', email)
    .maybeSingle();
  if (byEmail?.id) {
    if (!byEmail.user_id) {
      await supabase.from('customers').update({ user_id: userId }).eq('id', byEmail.id);
    }
    return byEmail.id;
  }

  const { data: created, error: insErr } = await supabase
    .from('customers')
    .insert({ user_id: userId, email })
    .select('id')
    .single();
  if (insErr) throw insErr;
  return created.id;
};

/**
 * Hook for the signed-in user to read their own devices + services.
 * Used by the Home banner and the app-launch popup matcher.
 *
 * Phase 7: module-level singleton — the chain (auth.getUser + customers +
 * customer_devices + customer_services) runs ONCE shared across every consumer
 * (useAppAlerts, ServiceExpirationBanner, …). The `userServicesRefresh` event
 * still triggers an explicit refetch.
 */

const EMPTY_STATE: UserServicesState = { customerId: null, devices: [], services: [] };

let svcState: UserServicesState = EMPTY_STATE;
let svcLoading = true;
let svcInflight: Promise<void> | null = null;
let svcHasFetched = false;
const svcListeners = new Set<() => void>();
let svcRefreshBound = false;

const runUserServicesFetch = async (): Promise<void> => {
  if (svcInflight) return svcInflight;
  svcLoading = true;
  svcInflight = (async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        svcState = EMPTY_STATE;
        return;
      }
      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!customer?.id) {
        svcState = EMPTY_STATE;
        return;
      }
      const [devRes, svcRes] = await Promise.all([
        supabase
          .from('customer_devices')
          .select('id, device_type, label, notes')
          .eq('customer_id', customer.id),
        supabase
          .from('customer_services')
          .select('id, service_type, service_name, expiration_date, tied_apps, renewal_status, notes')
          .eq('customer_id', customer.id),
      ]);
      svcState = {
        customerId: customer.id,
        devices: (devRes.data as UserDevice[]) || [],
        services: ((svcRes.data as any[]) || []).map((s) => ({
          ...s,
          tied_apps: Array.isArray(s.tied_apps) ? s.tied_apps : [],
        })) as UserService[],
      };
    } catch (e) {
      console.warn('[useMyUserServices] failed:', e);
    } finally {
      svcLoading = false;
      svcHasFetched = true;
      svcInflight = null;
      svcListeners.forEach((l) => l());
    }
  })();
  return svcInflight;
};

if (typeof window !== 'undefined' && !svcRefreshBound) {
  svcRefreshBound = true;
  window.addEventListener('userServicesRefresh', () => {
    void runUserServicesFetch();
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
    if (!svcHasFetched && !svcInflight) {
      void runUserServicesFetch();
    }
    return () => { svcListeners.delete(listener); };
  }, []);

  return { ...svcState, loading: svcLoading, refetch };
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
  if (days > 30) {
    return { show: false, severity: 'info', label: `expires in ${days} days`, daysUntil: days };
  }
  if (days >= 8) {
    return { show: true, severity: 'info', label: `expires in ${days} days`, daysUntil: days };
  }
  if (days >= 2) {
    return { show: true, severity: 'warning', label: `expires in ${days} days`, daysUntil: days };
  }
  if (days === 1) {
    return { show: true, severity: 'critical', label: 'expires tomorrow', daysUntil: days };
  }
  if (days === 0) {
    return { show: true, severity: 'critical', label: 'expires today', daysUntil: days };
  }
  const ago = Math.abs(days);
  return {
    show: true,
    severity: 'critical',
    label: `expired ${ago} day${ago === 1 ? '' : 's'} ago`,
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
