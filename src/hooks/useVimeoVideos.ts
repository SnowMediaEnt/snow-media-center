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

      console.log('Fetching Vimeo videos...');
      
      // Get the current session to include auth token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        console.log('No active session, user needs to sign in for Vimeo videos');
        setError('Please sign in to view support videos');
        setLoading(false);
        return;
      }

      const { data, error: functionError } = await supabase.functions.invoke('vimeo-videos');

      if (functionError) {
        console.error('Vimeo function error:', functionError);
        throw new Error(functionError.message);
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