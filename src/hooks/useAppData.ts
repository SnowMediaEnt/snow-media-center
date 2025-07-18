import { useState, useEffect } from 'react';

interface AppData {
  id: string;
  name: string;
  version: string;
  size: string;
  description: string;
  icon: string;
  apk: string;
  downloadUrl: string;
  packageName: string;
  featured: boolean;
  category: 'streaming' | 'support';
}

export const useAppData = () => {
  const [apps, setApps] = useState<AppData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchApps = async () => {
      try {
        setLoading(true);
        const response = await fetch('http://104.168.157.178/apps/apps.json.php');
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Transform the data to match our App interface
        const transformedApps = data.map((app: any) => ({
          ...app,
          downloadUrl: app.apk || app.downloadUrl,
          packageName: app.packageName || `com.${app.name.toLowerCase().replace(/\s+/g, '')}.app`,
          category: app.category || 'streaming',
          featured: app.featured || false
        }));
        
        setApps(transformedApps);
        setError(null);
      } catch (err) {
        console.error('Error fetching app data:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch app data');
      } finally {
        setLoading(false);
      }
    };

    fetchApps();
  }, []);

  return { apps, loading, error };
};