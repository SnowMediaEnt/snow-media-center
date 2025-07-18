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

  const fetchApps = async () => {
    try {
      console.log('Fetching apps from endpoint...');
      const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent('http://104.168.157.178/apps/apps.json.php')}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Raw JSON response:', data);
      
      // Handle different response formats
      let appsArray = [];
      if (Array.isArray(data)) {
        appsArray = data;
      } else if (data && typeof data === 'object' && data.apps && Array.isArray(data.apps)) {
        appsArray = data.apps;
      } else if (data && typeof data === 'object') {
        // If it's an object with app data, convert to array
        appsArray = Object.values(data);
      } else {
        throw new Error('Invalid JSON format - expected array or object with apps');
      }
      
      console.log('Apps array before transformation:', appsArray);
      
      // Transform the data to match our App interface
      const transformedApps = appsArray.map((app: any) => ({
        id: app.id || app.name?.toLowerCase().replace(/\s+/g, '') || 'unknown',
        name: app.name || 'Unknown App',
        version: app.version || '1.0',
        size: app.size || '25MB',
        description: app.description || 'No description available',
        icon: app.icon || 'http://104.168.157.178/apps/icons/default.png',
        apk: app.apk || app.downloadUrl || '',
        downloadUrl: app.apk || app.downloadUrl || '',
        packageName: app.packageName || `com.${(app.name || 'unknown').toLowerCase().replace(/\s+/g, '')}.app`,
        featured: app.featured || false,
        category: (app.category as 'streaming' | 'support') || 'streaming'
      }));
      
      console.log('Transformed apps:', transformedApps);
      setApps(transformedApps);
      setError(null);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching app data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch app data');
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchApps();
    
    // Set up polling every 30 seconds
    const pollInterval = setInterval(() => {
      console.log('Polling for app updates...');
      fetchApps();
    }, 30000); // 30 seconds
    
    // Cleanup interval on unmount
    return () => clearInterval(pollInterval);
  }, []);

  return { apps, loading, error, refetch: fetchApps };
};