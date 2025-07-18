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
        
        // Transform the data to match our App interface
        const transformedApps = appsArray.map((app: any) => ({
          ...app,
          downloadUrl: app.apk || app.downloadUrl,
          packageName: app.packageName || `com.${app.name.toLowerCase().replace(/\s+/g, '')}.app`,
          category: app.category || 'streaming',
          featured: app.featured || false,
          size: app.size || '25MB', // Default size if not provided
          version: app.version || '1.0',
          name: app.name || 'Unknown App',
          description: app.description || 'No description available'
        }));
        
        console.log('Transformed apps:', transformedApps);
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