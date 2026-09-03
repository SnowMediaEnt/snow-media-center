import { useCallback, useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { SnowNotify, deviceAlertsSupported, type SnowNotifyStatus } from '@/capacitor/SnowNotify';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/client';

/**
 * The switch behind Settings → "Alerts on this device".
 *
 * Turning it on hands the native side the Supabase URL and anon key so the
 * background poll reads the same project the app does — the values are not
 * duplicated into Kotlin, so a build pointed at a different project needs no
 * native change.
 */
export function useDeviceAlerts() {
  const supported = deviceAlertsSupported();
  const [status, setStatus] = useState<SnowNotifyStatus>({ enabled: false, permission: 'granted' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported) return;
    try { setStatus(await SnowNotify.status()); } catch { /* plugin missing on an old APK */ }
  }, [supported]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Coming back to the app is the cheapest moment to reconcile: the shade must
  // not still be showing an alert the app itself already knows has been pulled.
  useEffect(() => {
    if (!supported) return;
    let handle: { remove: () => void } | null = null;
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      void SnowNotify.pollNow().catch(() => undefined);
      void refresh();
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, [supported, refresh]);

  const setEnabled = useCallback(async (next: boolean): Promise<SnowNotifyStatus> => {
    if (!supported) return status;
    setBusy(true);
    try {
      const result = next
        ? await SnowNotify.enable({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_ANON_KEY })
        : { ...(await SnowNotify.disable()), permission: status.permission };
      setStatus(result as SnowNotifyStatus);
      return result as SnowNotifyStatus;
    } finally {
      setBusy(false);
    }
  }, [supported, status]);

  return { supported, status, busy, setEnabled, refresh };
}
