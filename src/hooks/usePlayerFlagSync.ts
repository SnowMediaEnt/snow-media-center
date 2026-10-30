// Keeps the native player's remote kill switches (lib/playerFlags) fresh in
// the flag cache. They come with the app's one shared read of feature_flags
// and its one realtime channel (lib/featureFlagStore), which write every row
// to the cache and clear a missing player switch (its default applies).
// Mounted once, in the app shell (Index), so the shared read is live for the
// whole session; each player load() reads the cache.
import { useEffect } from 'react';
import { featureFlagsQuery } from '@/lib/featureFlagStore';
import { mirrorKeyboardVoiceFlag } from '@/lib/keyboardVoice';

export function usePlayerFlagSync(): void {
  useEffect(() => {
    // The cached value first (a box offline at start keeps its last switch).
    void mirrorKeyboardVoiceFlag();
    return featureFlagsQuery.subscribe(() => { /* the store writes the cache */ });
  }, []);
}
