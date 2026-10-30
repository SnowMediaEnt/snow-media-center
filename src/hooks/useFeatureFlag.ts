import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { readCachedFlag, writeCachedFlag } from '@/lib/featureFlagCache';
import { useSharedQuery } from '@/lib/sharedQuery';
import { featureFlagsQuery } from '@/lib/featureFlagStore';

// Globally-persisted, admin-controlled feature flags stored in
// public.feature_flags. Reads are public; writes are admin-only via RLS.
// The last-known value is cached in localStorage to avoid UI flashes on boot.
//
// Every flag comes from one shared read of the table and one realtime channel
// (lib/featureFlagStore), however many flags and components there are. The
// read waits for an idle moment after start-up; until then (and for a flag
// with no row) the cached value, or `defaultValue`, shows.
export function useFeatureFlag(key: string, defaultValue = true) {
  const { data, loading } = useSharedQuery(featureFlagsQuery);
  const has = Object.prototype.hasOwnProperty.call(data, key);
  const value = has ? data[key] : undefined;
  const enabled = useMemo(
    () => (value !== undefined ? value : readCachedFlag(key, defaultValue)),
    [value, key, defaultValue],
  );
  return { enabled, loading };
}

export async function setFeatureFlag(key: string, value: boolean): Promise<void> {
  const { error } = await supabase
    .from('feature_flags')
    .upsert({ key, enabled: value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  writeCachedFlag(key, value);
  featureFlagsQuery.set({ ...featureFlagsQuery.get().data, [key]: value });
}
