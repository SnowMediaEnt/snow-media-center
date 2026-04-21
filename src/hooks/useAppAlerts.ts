import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AppAlert {
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

/**
 * Fetches active app alerts and exposes a matcher.
 * An alert matches an app if `app_match` is a case-insensitive substring of the app name.
 */
export const useAppAlerts = () => {
  const [alerts, setAlerts] = useState<AppAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_alerts')
        .select('*')
        .eq('active', true);
      if (error) {
        console.warn('[AppAlerts] fetch failed:', error.message);
        setAlerts([]);
      } else {
        setAlerts((data || []) as AppAlert[]);
      }
    } catch (e) {
      console.warn('[AppAlerts] fetch threw:', e);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();

    // Realtime subscription so alerts appear/disappear instantly
    const channel = supabase
      .channel('app_alerts_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_alerts' },
        () => fetchAlerts()
      )
      .subscribe();

    // Re-fetch every 60s as a safety net
    const interval = setInterval(fetchAlerts, 60_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [fetchAlerts]);

  const getAlertForApp = useCallback(
    (appName: string): AppAlert | null => {
      if (!appName) return null;
      const lower = appName.toLowerCase();
      return (
        alerts.find((a) => lower.includes(a.app_match.toLowerCase())) || null
      );
    },
    [alerts]
  );

  return { alerts, loading, getAlertForApp, refetch: fetchAlerts };
};
