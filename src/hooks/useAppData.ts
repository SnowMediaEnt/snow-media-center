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

  const fetchApps = async (retryCount = 0) => {
    try {
      console.log('Fetching apps from endpoint...');
      
      // Fetch both remote and local apps
      const [remoteApps, localSupportApps] = await Promise.all([
        fetchRemoteApps(),
        fetchLocalSupportApps()
      ]);
      
      // Combine both app sources
      const allApps = [...remoteApps, ...localSupportApps];
      setApps(allApps);
      setError(null);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching app data:', err);
      
      // Retry logic - try up to 3 times with exponential backoff
      if (retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        console.log(`Retrying in ${delay}ms... (attempt ${retryCount + 1}/3)`);
        setTimeout(() => {
          fetchApps(retryCount + 1);
        }, delay);
        return;
      }
      
      // After all retries failed, use fallback data
      console.log('All retries failed, using fallback app data');
      const fallbackApps = [
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
          category: 'streaming' as const
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
          category: 'support' as const
        }
      ];
      
      setApps(fallbackApps);
      setError('Using offline app data - server connection failed');
      setLoading(false);
    }
  };

  const fetchLocalSupportApps = async () => {
    try {
      const response = await fetch('/apps/support.json');
      if (!response.ok) {
        console.log('Local support.json not found, skipping');
        return [];
      }
      
      const data = await response.json();
      console.log('Loaded local support apps:', data);
      
      // Transform the data to match our App interface
      const appsArray = Array.isArray(data) ? data : (data.apps ? data.apps : []);
      
      return appsArray.map((app: any) => {
        const downloadUrl = app.downloadUrl || app.apk || app.url || app.file ? 
          (app.downloadUrl || app.apk || app.url || `https://snowmediaapps.com/apps/${app.file}`) : '';
        
        const cleanName = (app.name || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
        
        return {
          id: app.id || app.packageName || cleanName || 'unknown',
          name: app.name || 'Unknown App',
          version: app.version || '1.0',
          size: app.size || '25MB',
          description: app.description || 'No description available',
          icon: app.icon || 'https://snowmediaapps.com/apps/icons/default.png',
          apk: downloadUrl,
          downloadUrl,
          packageName: app.packageName || `com.${cleanName}.app`,
          featured: app.featured || false,
          category: 'support' as const // Local apps are support category
        };
      });
    } catch (err) {
      console.log('Failed to load local support apps:', err);
      return [];
    }
  };

  const fetchRemoteApps = async () => {
    // Cache-bust URL to always get fresh data
    const timestamp = Date.now();
    const baseUrl = 'https://snowmediaapps.com/apps/apps.json.php';
    
    // Import Capacitor to check if we're on native platform
    const isNative = typeof window !== 'undefined' && 
      (window as any).Capacitor?.isNativePlatform?.() === true;
    
    // On native platforms, try direct access first (no CORS restrictions)
    // On web, use CORS proxies
    const endpoints = isNative ? [
      // Direct access on native - no CORS needed
      `${baseUrl}?ts=${timestamp}`,
      // HTTP fallback for older Android/cleartext
      `http://snowmediaapps.com/apps/apps.json.php?ts=${timestamp}`,
    ] : [
      // Web needs CORS proxies
      `https://api.allorigins.win/get?url=${encodeURIComponent(`${baseUrl}?ts=${timestamp}`)}`,
      `https://corsproxy.io/?${encodeURIComponent(`${baseUrl}?ts=${timestamp}`)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(`${baseUrl}?ts=${timestamp}`)}`
    ];
    
    let response = null;
    let lastError = null;
    
    // Try each proxy until one works
    for (const proxyUrl of endpoints) {
      try {
        console.log(`Trying proxy: ${proxyUrl}`);
        
        // Create AbortController for timeout (compatible with older browsers)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        response = await fetch(proxyUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          cache: 'no-store', // Ensure fresh fetch
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          console.log('Successfully connected via proxy');
          break;
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (err) {
        console.warn(`Proxy failed: ${proxyUrl}`, err);
        lastError = err;
        response = null;
      }
    }
    
    if (!response || !response.ok) {
      throw new Error(lastError?.message || `All proxies failed`);
    }
    
    // Get the response text first to validate it
    const responseText = await response.text();
    console.log('Raw response text:', responseText.substring(0, 200));
    
    // Check if the response is HTML (error page)
    if (responseText.trim().startsWith('<!DOCTYPE html') || responseText.trim().startsWith('<html')) {
      throw new Error('Server returned HTML instead of JSON - API may be down');
    }
    
    // Handle allorigins.win wrapped response
    let actualJsonData = responseText;
    try {
      const wrappedResponse = JSON.parse(responseText);
      // If it's an allorigins response, extract the contents
      if (wrappedResponse.contents) {
        actualJsonData = wrappedResponse.contents;
        console.log('Extracted contents from wrapped response');
      }
    } catch (e) {
      // If parsing fails, use original response text
      console.log('Not a wrapped response, using original text');
    }
    
    // Check if the response is valid JSON
    let data;
    try {
      data = JSON.parse(actualJsonData);
      console.log('Parsed JSON response:', data);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      throw new Error(`Invalid JSON response received`);
    }
    
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
    
    // Transform the data to match our App interface with tolerant schema
    const transformedApps = appsArray.map((app: any) => {
      // Tolerant URL extraction - try multiple fields
      const downloadUrl = app.downloadUrl || app.apk || app.url || app.file ? 
        (app.downloadUrl || app.apk || app.url || `https://snowmediaapps.com/apps/${app.file}`) : '';
      
      // Generate package name from app name
      const cleanName = (app.name || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
      
        return {
          id: app.id || app.packageName || cleanName || 'unknown',
          name: app.name || 'Unknown App',
          version: app.version || '1.0',
          size: app.size || '25MB',
          description: app.description || 'No description available',
          icon: app.icon || 'https://snowmediaapps.com/apps/icons/default.png',
          apk: downloadUrl,
          downloadUrl,
          packageName: app.packageName || `com.${cleanName}.app`,
          featured: app.featured || false,
          category: (app.support === true ? 'support' : 'streaming') as 'streaming' | 'support'
        };
    });
    
    console.log('Transformed remote apps:', transformedApps);
    return transformedApps;
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