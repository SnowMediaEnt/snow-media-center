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
      
      // Try multiple endpoints - prioritize the PHP file that exists
      const endpoints = [
        // Try direct access first with domain
        'http://snowmediaapps.com/apps/apps.json.php',
        // Try PHP file with CORS proxies as fallback
        `https://api.allorigins.win/get?url=${encodeURIComponent('http://snowmediaapps.com/apps/apps.json.php')}`,
        `https://corsproxy.io/?${encodeURIComponent('http://snowmediaapps.com/apps/apps.json.php')}`,
        `https://thingproxy.freeboard.io/fetch/http://snowmediaapps.com/apps/apps.json.php`,
        // Try raw versions
        `https://api.allorigins.win/raw?url=${encodeURIComponent('http://snowmediaapps.com/apps/apps.json.php')}`
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
      
      // Transform the data to match our App interface
      const transformedApps = appsArray.map((app: any) => ({
        id: app.id || app.name?.toLowerCase().replace(/\s+/g, '') || 'unknown',
        name: app.name || 'Unknown App',
        version: app.version || '1.0',
        size: app.size || '25MB',
        description: app.description || 'No description available',
        icon: app.icon || 'https://snowmediaapps.com/apps/icons/default.png',
        apk: app.url || app.apk || app.downloadUrl || '',
        downloadUrl: app.url || app.apk || app.downloadUrl || '',
        packageName: app.packageName || `com.${(app.name || 'unknown').toLowerCase().replace(/\s+/g, '')}.app`,
        featured: app.featured || false,
        category: (app.category as 'streaming' | 'support') || 'streaming'
      }));
      
      console.log('Transformed apps:', transformedApps);
      transformedApps.forEach(app => {
        console.log(`App: ${app.name}, downloadUrl: ${app.downloadUrl}`);
      });
      setApps(transformedApps);
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