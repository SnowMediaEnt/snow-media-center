// Sign the Player in by itself when the box has no line saved but the
// viewer's accounts already know it:
//   1. the billing account (signed in on this box): a service with a login;
//   2. the Snow Media account (signed in): the line saved on their customer
//      record (customer_services), which the Player writes whenever they sign
//      in on any box.
// Each candidate goes through applyServiceToPlayer, which checks it with the
// panel before saving. If nothing works the sign-in form shows as before.
// Never after a deliberate sign-out on this box (see markPlayerSignedOut).
import { supabase } from '@/integrations/supabase/client';
import { SmcBilling, type BillingCredentials } from '@/capacitor/SmcBilling';
import { applyServiceToPlayer, credentialsOf } from '@/lib/billing';
import type { XtreamCreds } from '@/lib/xtream';
import { trackEvent } from '@/lib/analytics';

const SIGNED_OUT_KEY = 'smc-player-signed-out';

/** The viewer signed out of the Player on purpose: don't sign them back in. */
export const markPlayerSignedOut = (): void => {
  try { localStorage.setItem(SIGNED_OUT_KEY, '1'); } catch { /* ignore */ }
};
/** A sign-in happened (by hand or automatically): auto sign-in may run again later. */
export const clearPlayerSignedOut = (): void => {
  try { localStorage.removeItem(SIGNED_OUT_KEY); } catch { /* ignore */ }
};
const signedOutOnPurpose = (): boolean => {
  try { return localStorage.getItem(SIGNED_OUT_KEY) === '1'; } catch { return false; }
};

async function fromBilling(): Promise<BillingCredentials[]> {
  try {
    const st = await SmcBilling.getState();
    if (!st.signedIn) return [];
    const { services } = await SmcBilling.services();
    const active = (s: { status?: string }) => (s.status || '').toLowerCase() === 'active';
    return [...services.filter(active), ...services.filter((s) => !active(s))]
      .map(credentialsOf)
      .filter((c): c is BillingCredentials => !!c);
  } catch {
    return [];
  }
}

async function fromAccount(userId: string | null | undefined): Promise<BillingCredentials[]> {
  if (!userId) return [];
  try {
    const { data: customer } = await supabase.from('customers').select('id').eq('user_id', userId).maybeSingle();
    if (!customer?.id) return [];
    const { data } = await supabase
      .from('customer_services')
      .select('panel_username, panel_password, panel_host, expiration_date')
      .eq('customer_id', customer.id)
      .not('panel_username', 'is', null)
      .not('panel_password', 'is', null)
      .not('panel_host', 'is', null)
      .order('expiration_date', { ascending: false, nullsFirst: false });
    return ((data as Array<{ panel_username: string; panel_password: string; panel_host: string }> | null) ?? [])
      .map((r) => ({ host: r.panel_host, username: r.panel_username, password: r.panel_password }))
      .filter((c) => c.host && c.username && c.password);
  } catch {
    return [];
  }
}

/** Try the viewer's saved lines; the first the panel accepts signs the Player in. */
export async function autoSignInPlayer(
  userId: string | null | undefined,
  /** True once the Player stopped waiting (timeout, a manual sign-in, closed):
   *  nothing may be saved after that. */
  isCancelled: () => boolean = () => false,
): Promise<XtreamCreds | null> {
  if (signedOutOnPurpose()) return null;
  const seen = new Set<string>();
  const candidates = [...(await fromBilling()), ...(await fromAccount(userId))].filter((c) => {
    const k = `${c.host.trim().toLowerCase()}|${c.username.trim().toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const c of candidates.slice(0, 3)) {
    if (isCancelled()) return null;
    // Only a line the panel actually confirmed, and never once the Player
    // has moved on (a manual sign-in must not be overwritten).
    const res = await applyServiceToPlayer(c, 'auto', { requireProbe: true, shouldSave: () => !isCancelled() });
    if (isCancelled()) return null;
    if (res.ok) {
      try { trackEvent('player_auto_signin', 'player', { ok: true }); } catch { /* ignore */ }
      return res.creds;
    }
  }
  if (candidates.length) { try { trackEvent('player_auto_signin', 'player', { ok: false }); } catch { /* ignore */ } }
  return null;
}
