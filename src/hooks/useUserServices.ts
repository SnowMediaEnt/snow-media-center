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
 */
export const useMyUserServices = () => {
  const [state, setState] = useState<UserServicesState>({
    customerId: null,
    devices: [],
    services: [],
  });
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        setState({ customerId: null, devices: [], services: [] });
        return;
      }
      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!customer?.id) {
        setState({ customerId: null, devices: [], services: [] });
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
      setState({
        customerId: customer.id,
        devices: (devRes.data as UserDevice[]) || [],
        services: ((svcRes.data as any[]) || []).map((s) => ({
          ...s,
          tied_apps: Array.isArray(s.tied_apps) ? s.tied_apps : [],
        })) as UserService[],
      });
    } catch (e) {
      console.warn('[useMyUserServices] failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const onRefresh = () => refetch();
    window.addEventListener('userServicesRefresh', onRefresh);
    return () => window.removeEventListener('userServicesRefresh', onRefresh);
  }, [refetch]);

  return { ...state, loading, refetch };
};

export const SERVICE_WARN_DAYS = 7;

/** Returns the most urgent service that needs an alert, or null. */
export const findUrgentService = (services: UserService[]): UserService | null => {
  let urgent: UserService | null = null;
  let bestScore = Infinity;
  for (const s of services) {
    const d = daysUntil(s.expiration_date);
    if (d === null) continue;
    if (d > SERVICE_WARN_DAYS) continue;
    // lower d = more urgent (expired = negative = even more urgent)
    if (d < bestScore) {
      bestScore = d;
      urgent = s;
    }
  }
  return urgent;
};
