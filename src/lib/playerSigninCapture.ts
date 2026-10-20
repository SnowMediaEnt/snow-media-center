// Fire-and-forget capture of every Xtream Player sign-in to Supabase via the
// `capture-player-signin` edge function. Unlike `syncPlayerAccountToCloud`,
// this runs REGARDLESS of whether a Supabase user is signed in — the edge
// function accepts anonymous callers so we can track "leads".
//
// Never throws. Errors are console.warn'd only.

import { supabase } from '@/integrations/supabase/client';
import { getDeviceId } from '@/lib/analytics';
import type { PlayerAccount } from '@/lib/xtream';
import { isOutsideLine } from '@/lib/outsideSource';

export type CaptureReason = 'signin' | 'reconcile';

export async function capturePlayerSignin(
  account: PlayerAccount,
  serverLabel: string,
  reason: CaptureReason = 'signin',
): Promise<void> {
  // Our lines only: a service added from elsewhere (lib/outsideSource) is
  // never signed in as a line, and never reaches our servers.
  if (isOutsideLine(account)) return;
  // Every Live TV sign-in comes through here (the form, Switch Account, the
  // billing and automatic sign-ins): register this box for the line's
  // messages (lib/deviceInbox) at once. Loaded on demand; never waited on.
  if (reason === 'signin') {
    void import('@/lib/deviceInbox')
      .then((m) => m.registerLine(account, { force: true }))
      .catch(() => { /* the next check-in registers it */ });
  }
  try {
    let deviceId: string | null = null;
    try { deviceId = getDeviceId(); } catch { /* ignore */ }

    await supabase.functions.invoke('capture-player-signin', {
      body: {
        host: account.host,
        username: account.username,
        password: account.password,
        // Xtream user_info shape — expDate is unix seconds (matches raw exp_date).
        exp_date: account.expDate,
        status: account.status,
        max_connections: account.maxConnections,
        is_trial: account.isTrial,
        device_id: deviceId,
        // server_label is recomputed server-side from the allowlisted host;
        // sent here purely for observability, ignored by the edge function.
        server_label: serverLabel ?? account.serverLabel,
        reason,
      },
    });
  } catch (e) {
    console.warn('[playerSigninCapture] failed:', e);
  }
}
