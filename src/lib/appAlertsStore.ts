// Every app_alerts row the app shows, read once for all of its surfaces:
// the per-app launch popup (useAppAlerts), the boot broadcast
// (useBroadcastAlert), the Player's server notice (usePlayerServerAlert) and
// the Pre-Event Steps popup (usePreEventAlert). Each of those used to run its
// own select, realtime channel and 60 s poll on the same table; each now
// filters this one list.
//
// The read is the active rows plus the Pre-Event row whether it is on or off
// (the admin panel shows and toggles it while it is off).
import { supabase } from '@/integrations/supabase/client';
import { createSharedQuery } from '@/lib/sharedQuery';

export const PRE_EVENT_MATCH = '__pre_event__';
export const PRE_EVENT_SOURCE = 'pre_event';

export interface AppAlertRow {
  id: string;
  app_match: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  active: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

export const appAlertsQuery = createSharedQuery<AppAlertRow[]>({
  name: 'app_alerts_changes',
  table: 'app_alerts',
  initial: [],
  // What every hook did before: a failed read shows no alerts.
  onError: () => [],
  firstDelayMs: 1500,
  pollMs: 60_000,
  fetch: async () => {
    const { data, error } = await supabase
      .from('app_alerts')
      .select('*')
      .or(`active.eq.true,source.eq.${PRE_EVENT_SOURCE}`);
    if (error) throw error;
    return (data || []) as AppAlertRow[];
  },
});

/** The rows that are on. */
export const activeAlertRows = (rows: AppAlertRow[]): AppAlertRow[] => rows.filter((r) => r.active === true);

/** The Pre-Event Steps row (on or off), the newest when there are several. */
export const preEventRowOf = (rows: AppAlertRow[]): AppAlertRow | null => {
  let best: AppAlertRow | null = null;
  for (const r of rows) {
    if (r.source !== PRE_EVENT_SOURCE || r.app_match !== PRE_EVENT_MATCH) continue;
    if (!best || (r.updated_at || '') > (best.updated_at || '')) best = r;
  }
  return best;
};
