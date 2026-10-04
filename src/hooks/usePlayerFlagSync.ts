// Keeps the native player's remote kill switches (lib/playerFlags) fresh in
// the flag cache: one read of all of them once the app is idle, and one
// realtime channel for changes. Mounted once, in the app shell (Index), so
// no player opens a subscription of its own; each load() reads the cache.
// A row that does not exist is cleared from the cache: its default applies.
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';
import { clearCachedFlag, writeCachedFlag } from '@/lib/featureFlagCache';
import { PLAYER_FLAG_KEYS } from '@/lib/playerFlags';

export function usePlayerFlagSync(): void {
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const { data, error } = await supabase
          .from('feature_flags')
          .select('key, enabled')
          .in('key', PLAYER_FLAG_KEYS);
        if (cancelled || error || !Array.isArray(data)) return;
        const seen = new Set<string>();
        for (const row of data as Array<{ key?: string; enabled?: boolean }>) {
          if (typeof row.key !== 'string' || typeof row.enabled !== 'boolean') continue;
          seen.add(row.key);
          writeCachedFlag(row.key, row.enabled);
        }
        for (const k of PLAYER_FLAG_KEYS) if (!seen.has(k)) clearCachedFlag(k);
      } catch { /* offline: the cached values stand */ }
    };
    const cancelIdle = runWhenIdle(() => { void fetchAll(); }, 2500);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const cancelFirst = onFirstInteraction(() => {
      if (cancelled) return;
      channel = supabase
        .channel('feature_flags:player')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'feature_flags', filter: `key=in.(${PLAYER_FLAG_KEYS.join(',')})` },
          (payload) => {
            // A delete carries the row in `old` (`new` is an empty object).
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as { key?: string; enabled?: boolean } | null;
            if (!row || typeof row.key !== 'string' || !PLAYER_FLAG_KEYS.includes(row.key)) return;
            if (payload.eventType === 'DELETE') clearCachedFlag(row.key);
            else if (typeof row.enabled === 'boolean') writeCachedFlag(row.key, row.enabled);
          },
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      cancelIdle();
      cancelFirst();
      if (channel) supabase.removeChannel(channel);
    };
  }, []);
}
