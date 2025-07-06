import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface VimeoVideo {
  id: string;
  title: string;
  description: string;
  duration: string;
  thumbnail: string;
  embed_url: string;
  created_at: string;
}

export const useVimeoVideos = () => {
  const [videos, setVideos] = useState<VimeoVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVideos = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: functionError } = await supabase.functions.invoke('vimeo-videos');

      if (functionError) {
        throw new Error(functionError.message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setVideos(data?.videos || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch videos';
      setError(errorMessage);
      console.error('Error fetching Vimeo videos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  return {
    videos,
    loading,
    error,
    refetch: fetchVideos
  };
};