import { useCallback, useEffect, useMemo, useState } from 'react';
import { runWhenIdle } from '@/utils/idle';
import { useSharedQuery } from '@/lib/sharedQuery';
import { appAlertsQuery } from '@/lib/appAlertsStore';

export const PLAYER_SERVER_ALERT_SOURCE = 'player_server';
/** Pre-event steps have their own dialog; everything else can reach here. */
const OWN_DIALOG_SOURCES = ['pre_event'];
/** A visit reads the alerts again unless they were read this recently. */
const VISIT_FRESH_MS = 10_000;

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

/**
 * Live alert for the Player.
 *
 * Two kinds of row reach here. A Player server notice (source
 * `player_server`) targets Dreamstreams / Vibez / all and matches the
 * signed-in line's server. Any other app alert (the one the admin puts on an
 * app, or one raised from an email) shows when its app is the server the line
 * is on — a Vibez alert reaches Vibez viewers whether they open the Vibez app
 * or the Player — or when it names one of `extraLabels`, which the Player
 * passes as "Plex" while Plex is open. Broadcast app alerts (app_match 'all')
 * stay boot popups only, as they are in Main Apps.
 *
 * Like the popup Main Apps shows when an app is launched, it shows every time
 * the section is opened: "Got it" puts it away for this visit only. `visit`
 * changes each time Live TV or Plex is entered. (It used to be put away for
 * good on that box, so after one "Got it" an alert on Plex never showed
 * again.)
 */
export function usePlayerServerAlert(serverLabel: string | null | undefined, extraLabels: string[] = [], visit: string | number = 0) {
  // The shared app_alerts read (lib/appAlertsStore): its realtime channel
  // covers changes during a visit and its one-minute poll a channel that
  // never connected.
  const { data: all } = useSharedQuery(appAlertsQuery);
  const rows = useMemo(
    () => (all as PlayerServerAlert[]).filter((a) => a.active === true && !OWN_DIALOG_SOURCES.includes(String(a.source ?? ''))),
    [all],
  );
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  useEffect(() => { setDismissed({}); }, [visit]);

  // Fresh on every visit, so an alert posted a minute ago is there when
  // Plex opens. Rows read in the last few seconds (Home's, at start-up) are
  // fresh enough.
  useEffect(() => {
    const cancelIdle = runWhenIdle(() => { void appAlertsQuery.ensureFresh(VISIT_FRESH_MS); }, 800);
    return cancelIdle;
  }, [visit]);

  const extraKey = extraLabels.map((l) => l.trim().toLowerCase()).filter(Boolean).join('|');
  const match = useMemo<{ alert: PlayerServerAlert; label: string } | null>(() => {
    const label = (serverLabel ?? '').trim().toLowerCase();
    const extras = extraKey ? extraKey.split('|') : [];
    if (!label && !extras.length) return null;
    const sevRank: Record<PlayerServerAlert['severity'], number> = { critical: 3, warning: 2, info: 1 };
    // App names and server labels are not spelled identically ("Vibez TV" on
    // the tile, "Vibez" on the line), so either containing the other counts.
    const names = (m: string, n: string) => !!m && !!n && (m.includes(n) || n.includes(m));
    const found = rows
      .map((a) => {
        const m = (a.app_match || '').trim().toLowerCase();
        if (m === 'all' && a.source !== PLAYER_SERVER_ALERT_SOURCE) return null;
        if (a.source === PLAYER_SERVER_ALERT_SOURCE) return label && (m === 'all' || m === label) ? { alert: a, label: '' } : null;
        const extra = extras.find((x) => names(m, x));
        if (extra) return { alert: a, label: extraLabels.find((l) => l.trim().toLowerCase() === extra) ?? '' };
        return names(m, label) ? { alert: a, label: '' } : null;
      })
      .filter((x): x is { alert: PlayerServerAlert; label: string } => !!x)
      .filter((x) => dismissed[x.alert.id] !== x.alert.updated_at) // put away this visit, unless edited since
      .sort((a, b) => (sevRank[b.alert.severity] - sevRank[a.alert.severity]) || b.alert.updated_at.localeCompare(a.alert.updated_at));
    return found[0] ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, serverLabel, extraKey, dismissed]);

  const alert = match?.alert ?? null;
  const dismiss = useCallback(() => {
    if (!alert) return;
    setDismissed((d) => ({ ...d, [alert.id]: alert.updated_at }));
  }, [alert]);

  /** The app the alert is about when it is one of `extraLabels` ("Plex"). */
  return { alert, dismiss, appLabel: match?.label || null };
}
