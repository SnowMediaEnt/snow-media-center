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
    console.log('[Vimeo] Starting video fetch...');
    try {
      setLoading(true);
      setError(null);

      const { data, error: funcError } = await invokeEdgeFunction<{ videos: VimeoVideo[]; error?: string }>('vimeo-videos', {
        timeout: 20000, // 20s timeout
        retries: 2,
      });

      if (funcError) {
        console.error('[Vimeo] Function error:', funcError);
        throw funcError;
      }

      if (data?.error) {
        console.error('[Vimeo] API error:', data.error);
        throw new Error(data.error);
      }

      console.log(`[Vimeo] Loaded ${data?.videos?.length || 0} videos`);
      setVideos(data?.videos || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch videos';
      setError(errorMessage);
      console.error('[Vimeo] Error fetching videos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('[Vimeo] useEffect mounting, calling fetchVideos...');
    fetchVideos();
    
    // Safety fallback: if loading takes too long, stop spinner
    const safetyTimeout = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
          console.warn('[Vimeo] Safety timeout - loading took too long');
          setError('Loading timed out. Please try again.');
          return false;
        }
        return prev;
      });
    }, 25000);
    
    return () => clearTimeout(safetyTimeout);
  }, []);

  return {
    videos,
    loading,
    error,
    refetch: fetchVideos
  };
};
