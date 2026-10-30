// Every remote feature flag (public.feature_flags), read once for the app.
//
// useFeatureFlag used to run one select and open one realtime channel per
// flag per mount, and usePlayerFlagSync another for the player switches:
// feature_flags was fetched 4x at start-up. This is one select of the whole
// table (a few dozen tiny rows) and one channel on it, shared by every flag
// hook and the player switches (lib/playerFlags reads them from the cache).
//
// Every row read or pushed is written to the flag cache (lib/featureFlagCache)
// so the next start shows the right value on its first frame. A player
// switch whose row is missing or deleted is cleared from the cache: its
// default applies. Other flags keep their last value in that case, as
// useFeatureFlag always did.
import { supabase } from '@/integrations/supabase/client';
import { createSharedQuery } from '@/lib/sharedQuery';
import { clearCachedFlag, writeCachedFlag } from '@/lib/featureFlagCache';
import { PLAYER_FLAG_KEYS } from '@/lib/playerFlags';
import { mirrorKeyboardVoiceFlag } from '@/lib/keyboardVoice';

/** key → enabled, for the rows that exist. */
export type FlagRows = Record<string, boolean>;

export const featureFlagsQuery = createSharedQuery<FlagRows>({
  name: 'feature_flags_changes',
  table: 'feature_flags',
  initial: {},
  firstDelayMs: 1800,
  // No poll and no foreground re-read, as before: realtime carries changes
  // (a box offline keeps its cached values).
  pollMs: 0,
  refetchOnVisible: false,
  fetch: async () => {
    const { data, error } = await supabase.from('feature_flags').select('key, enabled');
    if (error || !Array.isArray(data)) throw error ?? new Error('no rows');
    const rows: FlagRows = {};
    for (const row of data as Array<{ key?: unknown; enabled?: unknown }>) {
      if (typeof row.key !== 'string' || typeof row.enabled !== 'boolean') continue;
      rows[row.key] = row.enabled;
      writeCachedFlag(row.key, row.enabled);
    }
    for (const k of PLAYER_FLAG_KEYS) if (!(k in rows)) clearCachedFlag(k);
    void mirrorKeyboardVoiceFlag();
    return rows;
  },
  onChange: (payload, api) => {
    // A delete carries the row in `old` (`new` is an empty object).
    const isDelete = payload.eventType === 'DELETE';
    const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as { key?: unknown; enabled?: unknown } | null;
    if (!row || typeof row.key !== 'string') return;
    const key = row.key;
    const next = { ...api.get().data };
    if (isDelete) {
      delete next[key];
      if (PLAYER_FLAG_KEYS.includes(key)) clearCachedFlag(key);
    } else if (typeof row.enabled === 'boolean') {
      next[key] = row.enabled;
      writeCachedFlag(key, row.enabled);
    } else {
      return;
    }
    api.set(next);
    if (PLAYER_FLAG_KEYS.includes(key)) void mirrorKeyboardVoiceFlag();
  },
});
