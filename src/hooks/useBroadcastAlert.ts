import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';

const DISMISS_KEY = 'snow-broadcast-alert-dismissed-v1';

/** Sources that own their own dedicated surfaces and must never broadcast here. */
const EXCLUDED_SOURCES = ['player_server', 'pre_event'];

export interface BroadcastAlert {
  id: string;
  app_match: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  active: boolean;
  source: string;
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

export const isBroadcastAlert = (a: { app_match?: string | null; source?: string | null; active?: boolean }) =>
  a.active !== false &&
  (a.app_match || '').trim().toLowerCase() === 'all' &&
  !EXCLUDED_SOURCES.includes((a.source || '').trim().toLowerCase());

/** Admin alert aimed at every device — shown as a boot popup on the home screen. */
export function useBroadcastAlert() {
  const [rows, setRows] = useState<BroadcastAlert[]>([]);
  const [dismissed, setDismissed] = useState<DismissMap>(() => readDismissed());

  const fetchRows = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_alerts')
        .select('id,app_match,title,message,severity,active,source,updated_at')
        .eq('active', true);
      if (error) { console.warn('[BroadcastAlert] fetch failed:', error.message); setRows([]); return; }
      setRows(((data || []) as BroadcastAlert[]).filter(isBroadcastAlert));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    const cancelIdle = runWhenIdle(() => { void fetchRows(); }, 2000);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const cancelFirst = onFirstInteraction(() => {
      channel = supabase
        .channel('broadcast_alert_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_alerts' }, () => fetchRows())
        .subscribe();
    });
    return () => { cancelIdle(); cancelFirst(); if (channel) supabase.removeChannel(channel); };
  }, [fetchRows]);

  const alert = useMemo<BroadcastAlert | null>(() => {
    const sevRank: Record<BroadcastAlert['severity'], number> = { critical: 3, warning: 2, info: 1 };
    const matches = rows
      .filter((a) => dismissed[a.id] !== a.updated_at)
      .sort((a, b) => (sevRank[b.severity] - sevRank[a.severity]) || (b.updated_at || '').localeCompare(a.updated_at || ''));
    return matches[0] ?? null;
  }, [rows, dismissed]);

  const dismiss = useCallback(() => {
    if (!alert) return;
    const next = { ...readDismissed(), [alert.id]: alert.updated_at };
    writeDismissed(next);
    setDismissed(next);
  }, [alert]);

  return { alert, dismiss };
}
