import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';

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

export const PRE_EVENT_MATCH = '__pre_event__';
export const PRE_EVENT_SOURCE = 'pre_event';
export const DEFAULT_PRE_EVENT_HEADLINE = 'PPV Tonight! Do the Pre-Event Steps BEFORE start time.';

export interface PreEventAlertRow {
  id: string;
  title: string;
  active: boolean;
  updated_at: string;
}

export const PRE_EVENT_STEPS: string[] = [
  "Make sure you aren't expired",
  'Update Playlist / Update Channels',
  'Restart router and device',
  'Have a VPN ready',
  'Enjoy!',
];

export function usePreEventAlert() {
  const [row, setRow] = useState<PreEventAlertRow | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRow = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_alerts')
      .select('id,title,active,updated_at')
      .eq('source', PRE_EVENT_SOURCE)
      .eq('app_match', PRE_EVENT_MATCH)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('[PreEventAlert] fetch failed:', error.message);
      setRow(null);
    } else {
      setRow((data as PreEventAlertRow | null) ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const cancelIdle = runWhenIdle(() => { void fetchRow(); }, 1800);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    const cancelFirstInteraction = onFirstInteraction(() => {
      channel = supabase
        .channel('pre_event_alert_changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'app_alerts', filter: `source=eq.${PRE_EVENT_SOURCE}` },
          () => fetchRow()
        )
        .subscribe();
    });

    return () => {
      cancelIdle();
      cancelFirstInteraction();
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchRow]);

  return { row, loading, refetch: fetchRow };
}
