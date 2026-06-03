import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { setPausableInterval } from '@/utils/pausableInterval';

/**
 * Fetches background assets ONCE per section + realtime change, then rotates
 * through them client-side every 30s without hitting Supabase each tick.
 *
 * Refresh triggers (kept minimal):
 *  - mount
 *  - Supabase realtime channel on `media_assets`
 *  - explicit `backgroundRefresh` window event (fired after admin mutations)
 *  - app/tab resume (one lightweight refetch when coming back to foreground)
 */
export const useDynamicBackground = (section: string = 'home') => {
  const [backgrounds, setBackgrounds] = useState<string[]>([]);
  const [rotationIndex, setRotationIndex] = useState(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const getAssetUrl = useCallback((filePath: string) => {
    const { data: { publicUrl } } = supabase.storage
      .from('media-assets')
      .getPublicUrl(filePath);
    return publicUrl;
  }, []);

  const fetchBackgrounds = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('media_assets')
        .select('file_path')
        .eq('asset_type', 'background')
        .eq('section', section)
        .eq('is_active', true)
        .order('rotation_order', { ascending: true });

      if (error) {
        console.error('Error fetching backgrounds:', error);
        return;
      }

      const urls = (data || []).map(row => getAssetUrl(row.file_path));
      setBackgrounds(urls);
      setRotationIndex(0);
    } catch (err) {
      console.error('Error in fetchBackgrounds:', err);
    }
  }, [section, getAssetUrl]);

  // Fetch once on mount + subscribe to changes
  useEffect(() => {
    fetchBackgrounds();

    const handleBackgroundRefresh = () => fetchBackgrounds();
    window.addEventListener('backgroundRefresh', handleBackgroundRefresh);

    // One lightweight refresh-on-resume covers signed-out viewers who miss
    // RLS-filtered realtime UPDATE/DELETE events.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchBackgrounds();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    channelRef.current = supabase
      .channel('media_assets_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'media_assets',
          filter: `asset_type=eq.background`,
        },
        () => fetchBackgrounds()
      )
      .subscribe();

    return () => {
      window.removeEventListener('backgroundRefresh', handleBackgroundRefresh);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [fetchBackgrounds]);


  // Local rotation — no network traffic. Pauses when app is backgrounded
  // to avoid wasted GPU/CPU on Android TV / STB devices.
  useEffect(() => {
    if (backgrounds.length <= 1) return;
    const lowMem = typeof document !== 'undefined' &&
      document.documentElement.classList.contains('native-low-memory');
    const rotateMs = lowMem ? 120000 : 30000; // slow rotation on low-memory boxes
    return setPausableInterval(() => {
      setRotationIndex(prev => (prev + 1) % backgrounds.length);
    }, rotateMs);
  }, [backgrounds.length]);

  const currentBackground = backgrounds[rotationIndex] ?? null;

  return {
    backgroundUrl: currentBackground,
    hasBackground: currentBackground !== null,
    refresh: fetchBackgrounds,
  };
};
