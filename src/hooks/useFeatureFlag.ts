import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';
import { readCachedFlag, writeCachedFlag } from '@/lib/featureFlagCache';

// Globally-persisted, admin-controlled feature flags stored in
// public.feature_flags. Reads are public; writes are admin-only via RLS.
// The last-known value is cached in localStorage to avoid UI flashes on boot.

const readCached = readCachedFlag;
const writeCached = writeCachedFlag;

export function useFeatureFlag(key: string, defaultValue = true) {
  const [enabled, setEnabled] = useState<boolean>(() => readCached(key, defaultValue));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchFlag = async () => {
      const { data, error } = await supabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', key)
        .maybeSingle();
      if (cancelled) return;
      if (!error && data) {
        setEnabled(!!data.enabled);
        writeCached(key, !!data.enabled);
      }
      setLoading(false);
    };

    // Phase 7: cached value already showing — defer the network read so the
    // home cards aren't blocked behind a Supabase round-trip on boot.
    const cancelIdle = runWhenIdle(() => { void fetchFlag(); }, 1800);

    // Defer the realtime websocket handshake until the user interacts so two
    // channels don't race at boot (app_alerts + feature_flags).
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const cancelFirstInteraction = onFirstInteraction(() => {
      channel = supabase
        .channel(`feature_flags:${key}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'feature_flags', filter: `key=eq.${key}` },
          (payload) => {
            const row = (payload.new ?? payload.old) as { enabled?: boolean } | null;
            if (row && typeof row.enabled === 'boolean') {
              setEnabled(row.enabled);
              writeCached(key, row.enabled);
            }
          }
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      cancelIdle();
      cancelFirstInteraction();
      if (channel) supabase.removeChannel(channel);
    };
  }, [key]);

  return { enabled, loading };
}

export async function setFeatureFlag(key: string, value: boolean): Promise<void> {
  const { error } = await supabase
    .from('feature_flags')
    .upsert({ key, enabled: value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  writeCachedFlag(key, value);
}
