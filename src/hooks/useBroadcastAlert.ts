import { useCallback, useMemo, useState } from 'react';
import { useSharedQuery } from '@/lib/sharedQuery';
import { appAlertsQuery } from '@/lib/appAlertsStore';

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
  // The shared app_alerts read (lib/appAlertsStore), which also polls every
  // 60 s (paused in the background and in quiet mode) and reads again on the
  // return to the foreground: a TV that was already on when the admin posted
  // a broadcast still gets it without a restart.
  const { data: all } = useSharedQuery(appAlertsQuery);
  const rows = useMemo(() => (all as BroadcastAlert[]).filter(isBroadcastAlert), [all]);
  const [dismissed, setDismissed] = useState<DismissMap>(() => readDismissed());

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
