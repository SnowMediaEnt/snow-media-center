import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';

// Globally-persisted, admin-controlled feature flags stored in
// public.feature_flags. Reads are public; writes are admin-only via RLS.
// The last-known value is cached in localStorage to avoid UI flashes on boot.

const cacheKey = (key: string) => `snow-feature-flag:${key}`;

const readCached = (key: string, fallback: boolean): boolean => {
  try {
    const raw = localStorage.getItem(cacheKey(key));
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch { /* ignore */ }
  return fallback;
};

const writeCached = (key: string, value: boolean) => {
  try { localStorage.setItem(cacheKey(key), value ? '1' : '0'); } catch { /* ignore */ }
};

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
    fetchFlag();

    const channel = supabase
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

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [key]);

  return { enabled, loading };
}

export async function setFeatureFlag(key: string, value: boolean): Promise<void> {
  const { error } = await supabase
    .from('feature_flags')
    .upsert({ key, enabled: value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  try { localStorage.setItem(cacheKey(key), value ? '1' : '0'); } catch { /* ignore */ }
}
