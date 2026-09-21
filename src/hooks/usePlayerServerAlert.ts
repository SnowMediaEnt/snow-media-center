import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';

export const PLAYER_SERVER_ALERT_SOURCE = 'player_server';
const DISMISS_KEY = 'snow-player-server-alert-dismissed-v1';

export interface PlayerServerAlert {
  id: string;
  app_match: string;   // 'Dreamstreams' | 'Vibez' | 'all' — or an app name for an admin app alert
  source?: string | null;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  active: boolean;
  updated_at: string;
}

type DismissMap = Record<string, string>; // alert id -> updated_at that was dismissed

const readDismissed = (): DismissMap => {
  try { const r = localStorage.getItem(DISMISS_KEY); if (r) return JSON.parse(r) as DismissMap; } catch { /* ignore */ }
  return {};
};
const writeDismissed = (m: DismissMap) => {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(m)); } catch { /* ignore */ }
};

/**
 * Live alert for the Player.
 *
 * Two kinds of row reach here. A Player server notice (source
 * `player_server`) targets Dreamstreams / Vibez / all and matches the
 * signed-in line's server. An ordinary app alert (source `admin`, the one
 * the admin puts on an app tile) ALSO shows here when its app is the
 * server the line is on — a Vibez alert reaches Vibez viewers whether they
 * open the Vibez app or the Player — or when it names one of `extraLabels`,
 * which the Player passes as "Plex" while the Plex section is open. Before
 * this, an app alert never reached the Player and Plex could not be
 * targeted at all. Broadcast app alerts (app_match 'all') stay boot
 * popups only, as they are in Main Apps.
 */
export function usePlayerServerAlert(serverLabel: string | null | undefined, extraLabels: string[] = []) {
  const [rows, setRows] = useState<PlayerServerAlert[]>([]);
  const [dismissed, setDismissed] = useState<DismissMap>(() => readDismissed());

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_alerts')
      .select('id,app_match,title,message,severity,active,updated_at,source')
      .in('source', [PLAYER_SERVER_ALERT_SOURCE, 'admin'])
      .eq('active', true);
    if (error) { console.warn('[PlayerServerAlert] fetch failed:', error.message); setRows([]); return; }
    setRows((data || []) as PlayerServerAlert[]);
  }, []);

  useEffect(() => {
    const cancelIdle = runWhenIdle(() => { void fetchRows(); }, 1500);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const cancelFirst = onFirstInteraction(() => {
      channel = supabase
        .channel('player_server_alert_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_alerts' }, () => fetchRows())
        .subscribe();
    });
    return () => { cancelIdle(); cancelFirst(); if (channel) supabase.removeChannel(channel); };
  }, [fetchRows]);

  const extraKey = extraLabels.map((l) => l.trim().toLowerCase()).filter(Boolean).join('|');
  const alert = useMemo<PlayerServerAlert | null>(() => {
    const label = (serverLabel ?? '').trim().toLowerCase();
    const extras = extraKey ? extraKey.split('|') : [];
    if (!label && !extras.length) return null;
    const sevRank: Record<PlayerServerAlert['severity'], number> = { critical: 3, warning: 2, info: 1 };
    // App names and server labels are not spelled identically ("Vibez TV" on
    // the tile, "Vibez" on the line), so either containing the other counts.
    const names = (m: string, n: string) => !!m && !!n && (m.includes(n) || n.includes(m));
    const matches = rows
      .filter(a => {
        const m = (a.app_match || '').trim().toLowerCase();
        if (a.source === PLAYER_SERVER_ALERT_SOURCE) return !!label && (m === 'all' || m === label);
        return names(m, label) || extras.some((x) => names(m, x));
      })
      .filter(a => dismissed[a.id] !== a.updated_at) // show unless dismissed at this exact version
      .sort((a, b) => (sevRank[b.severity] - sevRank[a.severity]) || b.updated_at.localeCompare(a.updated_at));
    return matches[0] ?? null;
  }, [rows, serverLabel, extraKey, dismissed]);

  const dismiss = useCallback(() => {
    if (!alert) return;
    const next = { ...readDismissed(), [alert.id]: alert.updated_at };
    writeDismissed(next);
    setDismissed(next);
  }, [alert]);

  return { alert, dismiss };
}
