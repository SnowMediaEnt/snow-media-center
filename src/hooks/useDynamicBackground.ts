import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Fetches background assets ONCE per section + realtime change, then rotates
 * through them client-side every 30s without hitting Supabase each tick.
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

    // Refetch when the tab/app regains focus so signed-out viewers
    // pick up deactivations they couldn't receive via realtime (RLS).
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchBackgrounds();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleBackgroundRefresh);

    // Periodic poll fallback (60s) — covers anon clients where realtime
    // UPDATE/DELETE events are filtered out by RLS.
    const pollId = setInterval(fetchBackgrounds, 60000);

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
      window.removeEventListener('focus', handleBackgroundRefresh);
      clearInterval(pollId);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [fetchBackgrounds]);


  // Local rotation — no network traffic
  useEffect(() => {
    if (backgrounds.length <= 1) return;
    const id = setInterval(() => {
      setRotationIndex(prev => (prev + 1) % backgrounds.length);
    }, 30000);
    return () => clearInterval(id);
  }, [backgrounds.length]);

  const currentBackground = backgrounds[rotationIndex] ?? null;

  return {
    backgroundUrl: currentBackground,
    hasBackground: currentBackground !== null,
    refresh: fetchBackgrounds,
  };
};

