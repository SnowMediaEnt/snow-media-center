import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface App {
  id: string;
  name: string;
  description: string;
  size: string;
  category: string;
  icon_url: string | null;
  download_url: string | null;
  is_installed: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
}

export const useApps = () => {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApps = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('apps')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setApps(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch apps');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (app: App) => {
    if (app.download_url) {
      // Create a temporary link and trigger download
      const link = document.createElement('a');
      link.href = `http://${app.download_url}`;
      link.download = `${app.name}.apk`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  useEffect(() => {
    fetchApps();
  }, []);

  return {
    apps,
    loading,
    error,
    refetch: fetchApps,
    handleDownload
  };
};