// Fire-and-forget helpers that mirror the locally-stored PlayerAccount into
// the user's customer_services row when a main Supabase account is signed in.
// All errors are swallowed — sync is a best-effort background task and must
// never block the player UI.

import { supabase } from '@/integrations/supabase/client';
import { ensureCustomerRow } from '@/hooks/useUserServices';
import { expDateToMs, type PlayerAccount } from '@/lib/xtream';

const serviceNameForServer = (serverLabel: string): string =>
  serverLabel?.toLowerCase().includes('vibez') ? 'VibezTV' : 'Dreamstreams';

const expIsoDate = (expDate: number | null): string | null => {
  const ms = expDateToMs(expDate);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const renewalFromStatus = (status: string): string => {
  const s = (status || '').toLowerCase();
  if (s === 'active' || s === 'trial') return 'active';
  if (!s) return 'active';
  return 'expired';
};

/**
 * Upsert a customer_services row representing the player account. Matches
 * existing rows by (customer_id, service_name) so a re-login UPDATES rather
 * than duplicates.
 */
export async function syncPlayerAccountToCloud(
  userId: string,
  email: string,
  account: PlayerAccount,
): Promise<void> {
  try {
    const customerId = await ensureCustomerRow(userId, email);
    const service_name = serviceNameForServer(account.serverLabel);
    // The DB trigger lower(trims) panel_username; sending it pre-normalized keeps
    // the race-recovery lookup below an exact match.
    const normalizedUsername = account.username.trim().toLowerCase();
    const payload = {
      customer_id: customerId,
      service_type: 'IPTV',
      service_name,
      panel_username: normalizedUsername,
      panel_password: account.password,
      panel_host: account.host,
      expiration_date: expIsoDate(account.expDate),
      max_connections: account.maxConnections,
      is_trial: account.isTrial,
      renewal_status: renewalFromStatus(account.status),
    };

    // Race-safe against customer_services_customer_panel_key (partial unique
    // index on (customer_id, panel_username)). PostgREST upsert cannot target a
    // partial index, so keep select-then-write but convert a unique-violation
    // (lost race with the concurrent SQL linker) into an update of the winning
    // row — a race must never produce a second row.
    const isUniqueViolation = (e: { code?: string } | null) => e?.code === '23505';
    const updateConflictingRow = () =>
      supabase
        .from('customer_services')
        .update(payload)
        .eq('customer_id', customerId)
        .eq('panel_username', normalizedUsername);

    const { data: existing } = await supabase
      .from('customer_services')
      .select('id')
      .eq('customer_id', customerId)
      .ilike('service_name', service_name)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase.from('customer_services').update(payload).eq('id', existing.id);
      if (isUniqueViolation(error)) await updateConflictingRow();
    } else {
      const { error } = await supabase.from('customer_services').insert(payload);
      if (isUniqueViolation(error)) await updateConflictingRow();
    }

    try { window.dispatchEvent(new CustomEvent('userServicesRefresh')); } catch { /* ignore */ }
  } catch (e) {
    console.warn('[playerAccountSync] failed:', e);
  }
}
