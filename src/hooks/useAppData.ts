import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
  category: 'streaming' | 'support' | 'media' | 'iptv' | 'main';
}

// Known package name mappings for installed apps
const KNOWN_PACKAGE_NAMES: Record<string, string> = {
  'dreamstreams': 'com.dreamstreams.app',
  'vibeztv': 'com.vibeztv.app',
  'plex': 'com.plexapp.android',
  'ipvanish': 'com.ixonn.ipvanish',
  'cinemahd': 'com.cinemahdv2',
  'cinema hd': 'com.cinemahdv2',
  'stremio': 'com.stremio.one',
  'kodi': 'org.xbmc.kodi',
  'tivimate': 'ar.tvplayer.tv',
  'xciptv': 'com.xciptv.player',
  'downloader': 'com.esaba.downloader',
};

function resolvePackageName(name: string, dbPackageName?: string | null): string {
  if (dbPackageName) return dbPackageName;
  const key = name.toLowerCase().trim();
  return KNOWN_PACKAGE_NAMES[key] || `com.${key.replace(/[^a-z0-9]/g, '')}.app`;
}

// Hardcoded fallback apps for when all else fails
const fallbackApps: AppData[] = [
  {
    id: 'dreamstreams',
    name: 'Dreamstreams',
    version: '3.0',
    size: '45MB',
    description: 'Premium streaming service',
    icon: 'https://snowmediaapps.com/apps/icons/dreamstreams.png',
    apk: 'https://104.168.147.178/apps/dreamstreams.apk',
    downloadUrl: 'https://104.168.147.178/apps/dreamstreams.apk',
    packageName: 'com.dreamstreams.app',
    featured: true,
    category: 'streaming'
  },
  {
    id: 'vibeztv',
    name: 'VibezTV',
    version: '2.0',
    size: '35MB',
    description: 'Live TV streaming',
    icon: 'https://snowmediaapps.com/apps/icons/vibeztv.png',
    apk: 'https://104.168.147.178/apps/vibeztv.apk',
    downloadUrl: 'https://104.168.147.178/apps/vibeztv.apk',
    packageName: 'com.vibeztv.app',
    featured: true,
    category: 'streaming'
  }
];

const REMOTE_APPS_URL = 'https://snowmediaapps.com/apps/apps.json.php';

export const useAppData = () => {
  const [apps, setApps] = useState<AppData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // PRIMARY: Fetch apps from Supabase database
  const fetchSupabaseApps = async (): Promise<AppData[]> => {
    try {
      console.log('[AppData] Fetching apps from Supabase...');
      const { data, error } = await supabase
        .from('apps')
        .select('*')
        .order('is_featured', { ascending: false });

      if (error) {
        console.error('[AppData] Supabase query error:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        console.log('[AppData] No apps in Supabase');
        return [];
      }

      console.log(`[AppData] Loaded ${data.length} apps from Supabase`);

      return data.map((app) => {
        // Build download URL with proper protocol
        let downloadUrl = app.download_url || '';
        if (downloadUrl && !downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
          downloadUrl = `https://${downloadUrl}`;
        }

        // Build icon URL - prepend domain if it's a relative path
        let iconUrl = app.icon_url || '';
        if (iconUrl && iconUrl.startsWith('/icons/')) {
          iconUrl = `https://snowmediaapps.com${iconUrl}`;
        } else if (!iconUrl) {
          iconUrl = 'https://snowmediaapps.com/icons/default.png';
        }

        const category = (app.category || 'streaming').toLowerCase() as AppData['category'];

        return {
          id: app.id,
          name: app.name,
          version: '1.0',
          size: app.size || '25MB',
          description: app.description || 'No description available',
          icon: iconUrl,
          apk: downloadUrl,
          downloadUrl,
          packageName: resolvePackageName(app.name, (app as any).package_name),
          featured: app.is_featured || false,
          category: category === 'main' ? 'streaming' : category
        };
      });
    } catch (error) {
      console.error('[AppData] Supabase fetch failed:', error);
      throw error;
    }
  };

  // SECONDARY: Fetch apps from remote URL (original source)
  const fetchRemoteApps = async (): Promise<AppData[]> => {
    const isNative = isNativePlatform();
    const timestamp = Date.now();
    const url = `${REMOTE_APPS_URL}?ts=${timestamp}`;
    
    console.log(`[AppData] Fetching remote apps (native: ${isNative}) from: ${url}`);
    
    try {
      const response = await robustFetch(url, {
        timeout: 15000,
        retries: 2,
        retryDelay: 1000,
        useCorsProxy: false, // Let robustFetch handle native vs web logic
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      const responseText = await response.text();
      console.log('[AppData] Remote response length:', responseText.length);
      
      if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
        throw new Error('Server returned HTML instead of JSON');
      }
      
      // Handle wrapped responses (from CORS proxies)
      let actualJson = responseText;
      try {
        const parsed = JSON.parse(responseText);
        if (parsed.contents && typeof parsed.contents === 'string') {
          actualJson = parsed.contents;
        }
      } catch {
        // Use original text
      }
      
      const data = JSON.parse(actualJson);
      
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

      console.log(`[AppData] Processing ${appsArray.length} apps from remote`);

      return appsArray.map((app: any, index: number) => {
        let downloadUrl = app.downloadUrl || app.download_url || app.apk || app.url || '';
        if (!downloadUrl && app.file) {
          downloadUrl = `https://snowmediaapps.com/apps/${app.file}`;
        }
        if (downloadUrl && !downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
          downloadUrl = `https://${downloadUrl}`;
        }
        if (downloadUrl.startsWith('http://')) {
          downloadUrl = downloadUrl.replace('http://', 'https://');
        }
        
        const cleanName = (app.name || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');

        return {
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
          category: (app.support === true || app.category === 'support' ? 'support' : 'streaming') as AppData['category']
        };
      });
    } catch (error) {
      console.error('[AppData] Remote fetch failed:', error);
      throw error;
    }
  };

  const fetchApps = async () => {
    setLoading(true);
    setError(null);

    console.log('[AppData] Starting fetch...');

    try {
      // Try Supabase first (most reliable)
      const supabaseApps = await fetchSupabaseApps();
      
      if (supabaseApps.length > 0) {
        console.log(`[AppData] Using ${supabaseApps.length} apps from Supabase`);
        setApps(supabaseApps);
        setError(null);
        setLoading(false);
        return;
      }
    } catch (err) {
      console.warn('[AppData] Supabase failed, trying remote:', err);
    }

    // Fallback to remote URL
    try {
      const remoteApps = await fetchRemoteApps();
      
      if (remoteApps.length > 0) {
        console.log(`[AppData] Using ${remoteApps.length} apps from remote`);
        setApps(remoteApps);
        setError(null);
        setLoading(false);
        return;
      }
    } catch (err) {
      console.warn('[AppData] Remote failed:', err);
    }

    // Use fallback data
    console.warn('[AppData] All sources failed, using fallback apps');
    setApps(fallbackApps);
    setError('Unable to fetch apps. Using offline data.');
    setLoading(false);
  };

  useEffect(() => {
    console.log('[AppData] useEffect mounting, calling fetchApps...');
    fetchApps();
    
    // Safety fallback: if loading takes too long
    const safetyTimeout = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
          console.warn('[AppData] Safety timeout triggered');
          setApps(fallbackApps);
          setError('Loading timed out. Using offline data.');
          return false;
        }
        return prev;
      });
    }, 25000);
    
    // Poll every 60 seconds
    const interval = setInterval(() => {
      console.log('[AppData] Polling for updates...');
      fetchApps();
    }, 60000);
    
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
