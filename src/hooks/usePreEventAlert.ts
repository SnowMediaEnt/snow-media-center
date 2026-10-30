import { useCallback, useMemo } from 'react';
import { useSharedQuery } from '@/lib/sharedQuery';
import { appAlertsQuery, preEventRowOf, PRE_EVENT_MATCH, PRE_EVENT_SOURCE } from '@/lib/appAlertsStore';

/**
 * Singleton "Pre-Event Steps" alert. Stored as a single row in the existing
 * `app_alerts` table with `source='pre_event'` and `app_match='__pre_event__'`
 * so we don't need a new table — the admin panel just toggles `active` and
 * edits `title` (which we render as the headline).
 *
 * Body is rendered client-side as a fixed numbered list of steps so the
 * messaging is consistent across PPV nights; the admin only controls
 * on/off + the headline (event name).
 */

export { PRE_EVENT_MATCH, PRE_EVENT_SOURCE };
export const DEFAULT_PRE_EVENT_HEADLINE = 'PPV Tonight! Do the Pre-Event Steps BEFORE start time.';

export interface PreEventAlertRow {
  id: string;
  title: string;
  active: boolean;
  updated_at: string;
}

// English text for the admin panel (AppAlertsManager), which stays English. Customers see the
// same five steps in their language: PreEventStepsDialog reads popups.preEvent.step1..5.
export const PRE_EVENT_STEPS: string[] = [
  "Make sure you aren't expired",
  'Update Playlist / Update Channels',
  'Restart router and device',
  'Have a VPN ready',
  'Enjoy!',
];

export function usePreEventAlert() {
  // Picked out of the shared app_alerts read (lib/appAlertsStore), which keeps
  // this row whether it is on or off. That read also has the realtime
  // channel and the 60 s poll this hook used to run on its own.
  const { data: rows, loading } = useSharedQuery(appAlertsQuery);
  const found = useMemo(() => preEventRowOf(rows), [rows]);
  // A new object only when a field this hook shows changed.
  const row = useMemo<PreEventAlertRow | null>(
    () => (found ? { id: found.id, title: found.title, active: found.active, updated_at: found.updated_at } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [found?.id, found?.title, found?.active, found?.updated_at],
  );
  const refetch = useCallback(() => appAlertsQuery.refetch(), []);
  return { row, loading, refetch };
}
