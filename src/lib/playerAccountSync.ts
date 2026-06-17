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
    const payload = {
      customer_id: customerId,
      service_type: 'IPTV',
      service_name,
      panel_username: account.username,
      panel_password: account.password,
      panel_host: account.host,
      expiration_date: expIsoDate(account.expDate),
      max_connections: account.maxConnections,
      is_trial: account.isTrial,
      renewal_status: renewalFromStatus(account.status),
    };

    const { data: existing } = await supabase
      .from('customer_services')
      .select('id')
      .eq('customer_id', customerId)
      .ilike('service_name', service_name)
      .maybeSingle();

    if (existing?.id) {
      await supabase.from('customer_services').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('customer_services').insert(payload);
    }

    try { window.dispatchEvent(new CustomEvent('userServicesRefresh')); } catch { /* ignore */ }
  } catch (e) {
    console.warn('[playerAccountSync] failed:', e);
  }
}
