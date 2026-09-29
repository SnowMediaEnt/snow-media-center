import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { supabase } from '@/integrations/supabase/client';
import { useMyUserServices, daysUntil, expiryState, type UserService } from '@/hooks/useUserServices';
import { setPausableInterval } from '@/utils/pausableInterval';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';
import { keepIfSame } from '@/lib/keepIfSame';

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
 * Builds a synthetic AppAlert from an expiring service tied to the given app.
 * Uses the shared tiered cadence (30 / 7 / 1 / daily-after) via expiryState().
 */
const buildServiceAlert = (service: UserService, app: string): AppAlert => {
  const d = daysUntil(service.expiration_date);
  const state = expiryState(d);
  const name = service.service_name || service.service_type || i18n.t('popups.serviceAlert.yourService');
  let title: string;
  let message: string;
  let severity: AppAlert['severity'] = state.severity;

  if (d === null) {
    title = i18n.t('popups.serviceAlert.unknownTitle');
    message = i18n.t('popups.serviceAlert.unknownMsg', { name });
    severity = 'info';
  } else if (d < 0) {
    title = i18n.t('popups.serviceAlert.expiredTitle');
    message = i18n.t('popups.serviceAlert.expiredMsg', { name, count: Math.abs(d) });
  } else if (d === 0) {
    title = i18n.t('popups.serviceAlert.todayTitle');
    message = i18n.t('popups.serviceAlert.todayMsg', { name });
  } else if (d === 1) {
    title = i18n.t('popups.serviceAlert.tomorrowTitle');
    message = i18n.t('popups.serviceAlert.tomorrowMsg', { name });
  } else {
    title = i18n.t('popups.serviceAlert.soonTitle', { count: d });
    message = i18n.t('popups.serviceAlert.soonMsg', { name, count: d });
  }

  return {
    id: `svc-${service.id}-${app}`,
    app_match: app,
    title,
    message,
    severity,
    active: true,
    source: 'user_service',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
};

/**
 * Fetches active app alerts and exposes a matcher.
 * An alert matches an app if `app_match` is a case-insensitive substring of the app name.
 *
 * Also merges in synthetic alerts derived from the signed-in user's expiring services
 * tied to specific IPTV apps (Dashboard → Edit).
 */
export const useAppAlerts = () => {
  const [alerts, setAlerts] = useState<AppAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const { services: userServices } = useMyUserServices();
  // These alerts are written here, not by the Hub: written again when the language changes.
  const { i18n: i18nInstance } = useTranslation();
  const language = i18nInstance.language;

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
        setAlerts((prev) => keepIfSame(prev, (data || []) as AppAlert[]));
      }
    } catch (e) {
      console.warn('[AppAlerts] fetch threw:', e);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Phase 7: defer first fetch off boot path.
    const cancelIdle = runWhenIdle(() => { void fetchAlerts(); }, 1500);

    // Realtime subscription — defer the websocket handshake until the user
    // actually interacts so two channels don't race during boot.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const cancelFirstInteraction = onFirstInteraction(() => {
      channel = supabase
        .channel('app_alerts_changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'app_alerts' },
          () => fetchAlerts()
        )
        .subscribe();
    });

    // Re-fetch every 60s as a safety net (paused while backgrounded)
    const cancelInterval = setPausableInterval(fetchAlerts, 60_000);

    return () => {
      cancelIdle();
      cancelFirstInteraction();
      if (channel) supabase.removeChannel(channel);
      cancelInterval();
    };
  }, [fetchAlerts]);

  /** Synthetic alerts derived from user's tracked services tied to specific apps. */
  const serviceAlerts = useMemo<AppAlert[]>(() => {
    const out: AppAlert[] = [];
    for (const svc of userServices) {
      const d = daysUntil(svc.expiration_date);
      const state = expiryState(d);
      if (!state.show) continue; // tiered 30/7/1/daily-after gate
      for (const app of svc.tied_apps || []) {
        if (!app) continue;
        out.push(buildServiceAlert(svc, app));
      }
    }
    return out;
    // `language` is not read inside: it makes the texts be written again in the new language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userServices, language]);

  const getAlertForApp = useCallback(
    (appName: string): AppAlert | null => {
      if (!appName) return null;
      const lower = appName.toLowerCase();
      // Broadcast rows (app_match = 'all') are boot popups only — never per-app.
      const notBroadcast = (a: AppAlert) => (a.app_match || '').trim().toLowerCase() !== 'all';
      // Service alerts take precedence (they're personal + critical)
      const svc = serviceAlerts.filter(notBroadcast).find((a) => lower.includes(a.app_match.toLowerCase()));
      if (svc) return svc;
      return (
        alerts.filter(notBroadcast).find((a) => lower.includes(a.app_match.toLowerCase())) || null
      );
    },
    [alerts, serviceAlerts]
  );


  return { alerts, loading, getAlertForApp, refetch: fetchAlerts };
};
