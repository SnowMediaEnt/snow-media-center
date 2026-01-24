import { useState, useEffect } from 'react';
import { invokeEdgeFunction } from '@/utils/edgeFunctions';

export interface VimeoVideo {
  id: string;
  title: string;
  description: string;
  duration: string;
  thumbnail: string;
  embed_url: string;
  created_at: string;
  tags: string[];
}

export const useVimeoVideos = () => {
  const [videos, setVideos] = useState<VimeoVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVideos = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('Fetching Vimeo videos (public access)...');

      const { data, error: funcError } = await invokeEdgeFunction<{ videos: VimeoVideo[]; error?: string }>('vimeo-videos', {
        timeout: 20000,
        retries: 2,
      });

      if (funcError) {
        console.error('Vimeo function error:', funcError);
        throw funcError;
      }

      if (data?.error) {
        console.error('Vimeo API error:', data.error);
        throw new Error(data.error);
      }

      console.log(`Loaded ${data?.videos?.length || 0} videos from Vimeo`);
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
