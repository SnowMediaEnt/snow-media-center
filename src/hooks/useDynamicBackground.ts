import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const useDynamicBackground = (section: string = 'home') => {
  const [currentBackground, setCurrentBackground] = useState<string | null>(null);
  const [rotationIndex, setRotationIndex] = useState(0);

  const getAssetUrl = useCallback((filePath: string) => {
    const { data: { publicUrl } } = supabase.storage
      .from('media-assets')
      .getPublicUrl(filePath);
    return publicUrl;
  }, []);

  const fetchAndUpdateBackground = useCallback(async () => {
    try {
      const { data: backgrounds, error } = await supabase
        .from('media_assets')
        .select('*')
        .eq('asset_type', 'background')
        .eq('section', section)
        .eq('is_active', true)
        .order('rotation_order', { ascending: true });

      if (error) {
        console.error('Error fetching backgrounds:', error);
        return;
      }

      if (backgrounds && backgrounds.length > 0) {
        const selectedBackground = backgrounds[rotationIndex % backgrounds.length];
        setCurrentBackground(getAssetUrl(selectedBackground.file_path));
      } else {
        setCurrentBackground(null);
      }
    } catch (err) {
      console.error('Error in fetchAndUpdateBackground:', err);
    }
  }, [section, rotationIndex, getAssetUrl]);

  useEffect(() => {
    fetchAndUpdateBackground();

    // Listen for immediate refresh events
    const handleBackgroundRefresh = () => {
      console.log('Background refresh event received');
      fetchAndUpdateBackground();
    };
    
    window.addEventListener('backgroundRefresh', handleBackgroundRefresh);

    // Set up realtime subscription for instant updates
    const channel = supabase
      .channel('media_assets_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'media_assets',
          filter: `asset_type=eq.background`
        },
        (payload) => {
          console.log('Media asset changed:', payload);
          fetchAndUpdateBackground();
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener('backgroundRefresh', handleBackgroundRefresh);
      supabase.removeChannel(channel);
    };
  }, [fetchAndUpdateBackground]);

  // Set up rotation interval for multiple backgrounds
  useEffect(() => {
    const rotationInterval = setInterval(() => {
      setRotationIndex(prev => prev + 1);
    }, 30000); // Change every 30 seconds

    return () => clearInterval(rotationInterval);
  }, []);

  return {
    backgroundUrl: currentBackground,
    hasBackground: currentBackground !== null,
    refresh: fetchAndUpdateBackground
  };
};
