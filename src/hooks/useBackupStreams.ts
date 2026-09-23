// ============= Backup streams (admin-published fallback links) =============
// Delivery mechanism mirrors usePlayerServerAlert exactly — the house pattern
// for admin-published content:
//   1. First fetch via runWhenIdle (kept off the boot path).
//   2. Realtime subscription armed inside onFirstInteraction — NOT at mount.
//      Deferring the websocket handshake stops two channels racing during
//      boot on Android TV WebViews.
//   3. setPausableInterval as a 60s safety net — skipped while a backup
//      stream is playing, so the list never competes with playback.
// RLS already filters to active rows inside their start/end window, so no
// client-side filtering on active/starts_at/ends_at here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';
import { setPausableInterval } from '@/utils/pausableInterval';
import { keepIfSame } from '@/lib/keepIfSame';

export interface BackupStream {
  id: string;
  kind: 'live' | 'vod';
  title: string;
  subtitle: string | null;
  url: string;
  poster_url: string | null;
  server_label: string | null;
  reseller_id: string | null;
  sort: number;
  updated_at: string;
}

const SELECT = 'id,kind,title,subtitle,url,poster_url,server_label,reseller_id,sort,updated_at';

let _channelSeq = 0;

export function useBackupStreams(serverLabel: string | null, paused = false) {
  const [rows, setRows] = useState<BackupStream[]>([]);
  const [loading, setLoading] = useState(true);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase
      .from('backup_streams')
      .select(SELECT)
      .order('sort', { ascending: true });
    if (error) { console.warn('[BackupStreams] fetch failed:', error.message); setLoading(false); return; }
    // Same list back → same array, so the section does not re-render.
    setRows((prev) => keepIfSame(prev, (data || []) as BackupStream[]));
    setLoading(false);
  }, []);

  useEffect(() => {
    const cancelIdle = runWhenIdle(() => { void fetchRows(); }, 1500);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const cancelFirst = onFirstInteraction(() => {
      // Unique name: re-entering Backups before the old channel's leave is
      // acknowledged would otherwise hand back that dying channel.
      channel = supabase
        .channel(`backup_streams_changes_${++_channelSeq}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'backup_streams' }, () => { void fetchRows(); })
        .subscribe();
    });
    // Essential: this list lives inside the Player, where quiet mode is on.
    const cancelInterval = setPausableInterval(() => { if (!pausedRef.current) void fetchRows(); }, 60_000, { essential: true });
    return () => { cancelIdle(); cancelFirst(); cancelInterval(); if (channel) supabase.removeChannel(channel); };
  }, [fetchRows]);

  const refresh = useCallback(() => { void fetchRows(); }, [fetchRows]);

  const { live, vod } = useMemo(() => {
    const label = (serverLabel ?? '').trim().toLowerCase();
    const matches = rows.filter((r) => {
      // Server targeting — same convention as app_alerts.
      const s = (r.server_label ?? '').trim().toLowerCase();
      if (s && s !== 'all' && s !== label) return false;
      // Tenant targeting — this is the Snow Media app.
      if (r.reseller_id && r.reseller_id !== 'all' && r.reseller_id !== 'snowmedia') return false;
      return true;
    });
    return {
      live: matches.filter((r) => r.kind === 'live'),
      vod: matches.filter((r) => r.kind === 'vod'),
    };
  }, [rows, serverLabel]);

  return { live, vod, loading, refresh };
}
