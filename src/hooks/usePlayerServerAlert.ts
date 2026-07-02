import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';

export const PLAYER_SERVER_ALERT_SOURCE = 'player_server';
const DISMISS_KEY = 'snow-player-server-alert-dismissed-v1';

export interface PlayerServerAlert {
  id: string;
  app_match: string;   // 'Dreamstreams' | 'Vibez' | 'all'
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

/** Live alert targeted at the currently signed-in server (or 'all'). */
export function usePlayerServerAlert(serverLabel: string | null | undefined) {
  const [rows, setRows] = useState<PlayerServerAlert[]>([]);
  const [dismissed, setDismissed] = useState<DismissMap>(() => readDismissed());

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_alerts')
      .select('id,app_match,title,message,severity,active,updated_at')
      .eq('source', PLAYER_SERVER_ALERT_SOURCE)
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
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_alerts', filter: `source=eq.${PLAYER_SERVER_ALERT_SOURCE}` }, () => fetchRows())
        .subscribe();
    });
    return () => { cancelIdle(); cancelFirst(); if (channel) supabase.removeChannel(channel); };
  }, [fetchRows]);

  const alert = useMemo<PlayerServerAlert | null>(() => {
    if (!serverLabel) return null;
    const label = serverLabel.trim().toLowerCase();
    const sevRank: Record<PlayerServerAlert['severity'], number> = { critical: 3, warning: 2, info: 1 };
    const matches = rows
      .filter(a => { const m = (a.app_match || '').trim().toLowerCase(); return m === 'all' || m === label; })
      .filter(a => dismissed[a.id] !== a.updated_at) // show unless dismissed at this exact version
      .sort((a, b) => (sevRank[b.severity] - sevRank[a.severity]) || b.updated_at.localeCompare(a.updated_at));
    return matches[0] ?? null;
  }, [rows, serverLabel, dismissed]);

  const dismiss = useCallback(() => {
    if (!alert) return;
    const next = { ...readDismissed(), [alert.id]: alert.updated_at };
    writeDismissed(next);
    setDismissed(next);
  }, [alert]);

  return { alert, dismiss };
}
