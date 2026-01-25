import { useState, useEffect } from 'react';
import { isNativePlatform } from '@/utils/platform';
import { robustFetch, isOnline } from '@/utils/network';

export interface AppData {
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

// Hardcoded fallback apps for when all else fails
const fallbackApps: AppData[] = [
  {
    id: 'snow-tv',
    name: 'Snow TV',
    version: '2.1.0',
    size: '45MB',
    description: 'Premium streaming application with live TV and on-demand content',
    icon: 'https://snowmediaapps.com/apps/icons/snow-tv.png',
    apk: 'https://snowmediaapps.com/apps/snow-tv.apk',
    downloadUrl: 'https://snowmediaapps.com/apps/snow-tv.apk',
    packageName: 'com.snowtv.app',
    featured: true,
    category: 'streaming'
  },
  {
    id: 'support-app',
    name: 'Support Center',
    version: '1.5.0',
    size: '25MB',
    description: 'Customer support and help center application',
    icon: 'https://snowmediaapps.com/apps/icons/support.png',
    apk: 'https://snowmediaapps.com/apps/support.apk',
    downloadUrl: 'https://snowmediaapps.com/apps/support.apk',
    packageName: 'com.support.app',
    featured: false,
    category: 'support'
  }
];

const REMOTE_APPS_URL = 'https://snowmediaapps.com/apps/apps.json.php';
const LOCAL_SUPPORT_URL = '/apps/support.json';

export const useAppData = () => {
  const [apps, setApps] = useState<AppData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLocalSupportApps = async (): Promise<AppData[]> => {
    try {
      const response = await fetch(LOCAL_SUPPORT_URL);
      if (!response.ok) {
        console.log('Local support.json not found, skipping');
        return [];
      }
      
      const data = await response.json();
      console.log('Loaded local support apps:', data);
      
      const appsArray = Array.isArray(data) ? data : (data.apps ? data.apps : []);
      
      return appsArray.map((app: any, index: number) => {
        const downloadUrl = app.downloadUrl || app.apk || app.url || 
          (app.file ? `https://snowmediaapps.com/apps/${app.file}` : '');
        const cleanName = (app.name || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
        
        return {
          id: app.id || app.packageName || `support-${index}`,
          name: app.name || 'Unknown App',
          version: app.version || '1.0',
          size: app.size || '25MB',
          description: app.description || 'No description available',
          icon: app.icon || 'https://snowmediaapps.com/apps/icons/default.png',
          apk: downloadUrl,
          downloadUrl,
          packageName: app.packageName || `com.${cleanName}.app`,
          featured: Boolean(app.featured),
          category: 'support' as const
        };
      });
    } catch (err) {
      console.warn('Failed to load local support apps:', err);
      return [];
    }
  };

  const fetchRemoteApps = async (): Promise<AppData[]> => {
    const isNative = isNativePlatform();
    const timestamp = Date.now();
    const url = `${REMOTE_APPS_URL}?ts=${timestamp}`;
    
    console.log(`Fetching remote apps (native: ${isNative}) from: ${url}`);
    
    try {
      // Use robustFetch with CORS proxy fallback enabled for all platforms
      // This ensures Android WebView can fall back to proxies if direct fails
      const response = await robustFetch(url, {
        timeout: 20000,
        retries: 3,
        retryDelay: 1500,
        useCorsProxy: true, // Enable CORS proxy fallback for Android
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      const responseText = await response.text();
      console.log('Apps raw response length:', responseText.length);
      console.log('Apps raw response preview:', responseText.substring(0, 300));
      
      // Check for HTML error pages
      if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
        console.error('Server returned HTML instead of JSON');
        throw new Error('Server returned HTML instead of JSON');
      }
      
      // Handle wrapped responses (from CORS proxies)
      let actualJson = responseText;
      try {
        const parsed = JSON.parse(responseText);
        if (parsed.contents && typeof parsed.contents === 'string') {
          console.log('Unwrapping CORS proxy response');
          actualJson = parsed.contents;
        }
      } catch {
        // Use original text
      }
      
      const data = JSON.parse(actualJson);
      console.log('Parsed apps data type:', typeof data, Array.isArray(data) ? `array(${data.length})` : '');
      
      // Handle different response formats
      let appsArray: any[] = [];
      if (Array.isArray(data)) {
        appsArray = data;
      } else if (data?.apps && Array.isArray(data.apps)) {
        appsArray = data.apps;
      } else if (typeof data === 'object') {
        appsArray = Object.values(data).filter(
          item => typeof item === 'object' && item !== null && 'name' in item
        );
      }

      console.log(`Processing ${appsArray.length} apps from remote`);

      return appsArray.map((app: any, index: number) => {
        // Build download URL - try multiple fields
        let downloadUrl = app.downloadUrl || app.download_url || app.apk || app.url || '';
        
        // If we have a file field, construct the full URL
        if (!downloadUrl && app.file) {
          downloadUrl = `https://snowmediaapps.com/apps/${app.file}`;
        }
        
        // Ensure URL has protocol
        if (downloadUrl && !downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
          downloadUrl = `https://${downloadUrl}`;
        }
        
        // Normalize to HTTPS
        if (downloadUrl.startsWith('http://')) {
          downloadUrl = downloadUrl.replace('http://', 'https://');
        }
        
        const cleanName = (app.name || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');

        const appData: AppData = {
          id: app.id || app.packageName || `remote-${index}`,
          name: app.name || 'Unknown App',
          version: app.version || '1.0',
          size: app.size || '25MB',
          description: app.description || 'No description available',
          icon: app.icon || 'https://snowmediaapps.com/apps/icons/default.png',
          apk: downloadUrl,
          downloadUrl,
          packageName: app.packageName || app.package_name || `com.${cleanName}.app`,
          featured: Boolean(app.featured || app.is_featured),
          category: (app.support === true || app.category === 'support' ? 'support' : 'streaming') as 'streaming' | 'support'
        };
        
        console.log(`App: ${appData.name} -> ${appData.downloadUrl}`);
        return appData;
      });
    } catch (error) {
      console.error('Failed to fetch remote apps:', error);
      throw error;
    }
  };

  const fetchApps = async () => {
    setLoading(true);
    setError(null);

    // Check network first
    if (!isOnline()) {
      console.warn('No network connection detected');
      setError('No internet connection. Using cached data.');
      setApps(fallbackApps);
      setLoading(false);
      return;
    }

    try {
      // Fetch both sources in parallel
      const [remoteResult, localResult] = await Promise.allSettled([
        fetchRemoteApps(),
        fetchLocalSupportApps()
      ]);

      const combinedApps: AppData[] = [];

      if (remoteResult.status === 'fulfilled') {
        combinedApps.push(...remoteResult.value);
        console.log(`Loaded ${remoteResult.value.length} remote apps`);
      } else {
        console.warn('Remote apps failed:', remoteResult.reason);
      }

      if (localResult.status === 'fulfilled') {
        combinedApps.push(...localResult.value);
        console.log(`Loaded ${localResult.value.length} local apps`);
      }

      if (combinedApps.length > 0) {
        // Remove duplicates by package name or id
        const uniqueApps = combinedApps.reduce((acc, app) => {
          const key = app.packageName || app.id;
          if (!acc.find(a => (a.packageName || a.id) === key)) {
            acc.push(app);
          }
          return acc;
        }, [] as AppData[]);

        setApps(uniqueApps);
        setError(null);
      } else {
        console.warn('No apps loaded, using fallback');
        setApps(fallbackApps);
        setError('Unable to fetch apps. Using offline data.');
      }
    } catch (error) {
      console.error('Error in fetchApps:', error);
      setApps(fallbackApps);
      setError('Connection failed. Using offline data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('[AppData] useEffect mounting, calling fetchApps...');
    fetchApps();
    
    // Safety fallback: if loading takes too long, show fallback apps
    const safetyTimeout = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
          console.warn('[AppData] Safety timeout - loading took too long, showing fallback');
          setApps(fallbackApps);
          setError('Loading timed out. Using offline data.');
          return false;
        }
        return prev;
      });
    }, 30000);
    
    // Poll every 30 seconds
    const interval = setInterval(() => {
      console.log('[AppData] Polling for app updates...');
      fetchApps();
    }, 30000);
    
    // Refresh when coming back online
    const handleOnline = () => {
      console.log('[AppData] Network restored, refreshing...');
      fetchApps();
    };
    window.addEventListener('online', handleOnline);
    
    return () => {
      clearTimeout(safetyTimeout);
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return { apps, loading, error, refetch: fetchApps };
};
