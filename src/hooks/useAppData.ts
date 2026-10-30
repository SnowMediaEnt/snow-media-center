import { useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isNativePlatform } from '@/utils/platform';
import { robustFetch, isOnline } from '@/utils/network';
import { setPausableInterval } from '@/utils/pausableInterval';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';
import { keepIfSame } from '@/lib/keepIfSame';
import { isDemo } from '@/lib/demoMode';
import i18n from '@/i18n';

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
  'ipvanish': 'com.ixolit.ipvanish',
  'surfshark': 'com.surfshark.vpnclient.android',
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
    apk: 'https://snowmediaapps.com/guesswhat/download.php?file=dreamstreams.apk&k=tJIso9tAokZ937fFcnpWT6YL0oJQ',
    downloadUrl: 'https://snowmediaapps.com/guesswhat/download.php?file=dreamstreams.apk&k=tJIso9tAokZ937fFcnpWT6YL0oJQ',
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
    apk: 'https://snowmediaapps.com/guesswhat/download.php?file=vibeztv.apk&k=tJIso9tAokZ937fFcnpWT6YL0oJQ',
    downloadUrl: 'https://snowmediaapps.com/guesswhat/download.php?file=vibeztv.apk&k=tJIso9tAokZ937fFcnpWT6YL0oJQ',
    packageName: 'com.vibeztv.app',
    featured: true,
    category: 'streaming'
  }
];

const REMOTE_APPS_URL = 'https://snowmediaapps.com/guesswhat/apps.json.php';

// Demo mode: the only installer feed we have is the keyed `guesswhat` one, so
// rather than expose the full private catalogue in the website embed we filter
// the loaded list down to the public SMC / Canvas installers. Downloads still
// work (the browser just opens the URL).
const DEMO_APP_NAME_RE = /(snow\s*media|smc|canvas)/i;
// A Snow Media Center entry in the feed is for boxes still on 1.6.6: their
// Main Apps is the easiest place to uninstall the old copy from before the
// one-time reinstall (see the steps at the top of public/update.json). On
// this version that entry is this app itself — Launch would do nothing and
// Uninstall would remove the app — so it is not listed here.
const OWN_PACKAGE = 'app.lovable.f44324110df840aea0a1fb97cafa76e7';
const filterAppsForDemo = (list: AppData[]): AppData[] =>
  isDemo()
    ? list.filter((a) => DEMO_APP_NAME_RE.test(a.name))
    : list.filter((a) => a.packageName !== OWN_PACKAGE);
const REMOTE_APPS_KEY = 'tJIso9tAokZ937fFcnpWT6YL0oJQ';

const sortApps = (items: AppData[]) =>
  [...items].sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

// Supabase fallback: cached copy of the PHP feed
const fetchSupabaseApps = async (): Promise<AppData[]> => {
  try {
    console.log('[AppData] Fetching apps from Supabase...');
    const { data, error } = await supabase
      .from('apps')
      .select('*, package_name, version, external_id, is_available')
      .eq('is_available', true)
      .order('is_featured', { ascending: false })
      .order('name', { ascending: true });

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

      const rawCategory = (app.category || 'main').toLowerCase();
      const category = (['streaming', 'support', 'media', 'iptv', 'main'].includes(rawCategory)
        ? rawCategory
        : 'main') as AppData['category'];

      return {
        id: app.id,
        name: app.name,
        version: (app as any).version || '1.0',
        size: app.size || '25MB',
        description: app.description || i18n.t('apps.data.noDescription'),
        icon: iconUrl,
        apk: downloadUrl,
        downloadUrl,
        packageName: resolvePackageName(app.name, (app as any).package_name),
        featured: app.is_featured || false,
        category
      };
    });
  } catch (error) {
    console.error('[AppData] Supabase fetch failed:', error);
    throw error;
  }
};

// SECONDARY: Fetch apps from remote URL (original source)
// Not used at the moment; kept as the original source's reader.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const fetchRemoteApps = async (): Promise<AppData[]> => {
  const isNative = isNativePlatform();
  const timestamp = Date.now();
  const url = `${REMOTE_APPS_URL}?k=${REMOTE_APPS_KEY}&ts=${timestamp}`;
  
  console.log(`[AppData] Fetching remote apps (native: ${isNative}) from: ${REMOTE_APPS_URL}`);
  
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
        downloadUrl = `https://snowmediaapps.com/guesswhat/download.php?file=${encodeURIComponent(app.file)}&k=${REMOTE_APPS_KEY}`;
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
        name: app.name || i18n.t('apps.data.unknownApp'),
        version: app.version || '1.0',
        size: app.size || '25MB',
        description: app.description || i18n.t('apps.data.noDescription'),
        icon: app.icon || 'https://snowmediaapps.com/apps/icons/default.png',
        apk: downloadUrl,
        downloadUrl,
        packageName: resolvePackageName(app.name || '', app.packageName || app.package_name),
        featured: Boolean(app.featured || app.is_featured),
        category: (app.support === true || app.category === 'support' ? 'support' : 'streaming') as AppData['category']
      };
    });
  } catch (error) {
    console.error('[AppData] Remote fetch failed:', error);
    throw error;
  }
};

// Background sync — triggers PHP→Supabase sync without blocking the UI.
const triggerBackgroundSync = async (): Promise<boolean> => {
  try {
    console.log('[AppData] Triggering background PHP→DB sync...');
    const { data, error } = await supabase.functions.invoke('sync-apps-from-php', {
      body: {},
    });
    if (error) {
      console.warn('[AppData] Background sync failed:', error.message);
      return false;
    }
    const result = data as { ok?: boolean; added?: number; removed?: number } | null;
    console.log('[AppData] Background sync result:', result);
    // Re-fetch from Supabase only if something actually changed
    return Boolean(result?.ok && ((result.added ?? 0) + (result.removed ?? 0) > 0));
  } catch (err) {
    console.warn('[AppData] Background sync threw:', err);
    return false;
  }
};


// ---------------------------------------------------------------------------
// One catalog for the whole app.
//
// Home, Main Apps, Support and the admin alert panel each mounted their own
// copy of this hook: each re-ran the select and the sync-apps-from-php edge
// call and added its own 5-minute poll, and every poll set a fresh array, so
// Home re-rendered every five minutes for nothing. Now the first subscriber
// starts one shared loader:
//   - the cached Supabase copy, read when the box is idle;
//   - the PHP → DB sync, after the first interaction, at most every
//     SYNC_EVERY_MS (it rewrites the table only when the feed changed);
//   - one pausable 5-minute poll and one `online` listener;
// and a refetch that returns the same list keeps the same array.
// ---------------------------------------------------------------------------

interface AppDataState {
  apps: AppData[];
  loading: boolean;
  error: string | null;
}

/** The PHP → DB sync runs at most this often (the first interaction, then on a later mount or refetch). */
const SYNC_EVERY_MS = 30 * 60 * 1000;
const POLL_MS = 5 * 60 * 1000;

let state: AppDataState = { apps: [], loading: true, error: null };
const listeners = new Set<() => void>();
let refs = 0;
let teardown: (() => void) | null = null;
let lastLoadAt = 0;
let lastSyncAt = 0;
let syncInflight: Promise<void> | null = null;
let loadInflight: Promise<boolean> | null = null;

const setState = (patch: Partial<AppDataState>) => {
  const next: AppDataState = {
    apps: patch.apps !== undefined ? keepIfSame(state.apps, patch.apps) : state.apps,
    loading: patch.loading !== undefined ? patch.loading : state.loading,
    error: patch.error !== undefined ? patch.error : state.error,
  };
  if (next.apps === state.apps && next.loading === state.loading && next.error === state.error) return;
  state = next;
  listeners.forEach((l) => l());
};

// PHASE A: read cached Supabase copy — fast, no PHP / sync. Used for boot and the poll.
const loadFromCache = (): Promise<boolean> => {
  if (loadInflight) return loadInflight;
  loadInflight = (async () => {
    try {
      const supabaseApps = await fetchSupabaseApps();
      lastLoadAt = Date.now();
      if (supabaseApps.length > 0) {
        setState({ apps: filterAppsForDemo(sortApps(supabaseApps)), error: null, loading: false });
        return true;
      }
    } catch (err) {
      console.warn('[AppData] Supabase cache miss:', err);
    }
    return false;
  })().finally(() => { loadInflight = null; });
  return loadInflight;
};

// PHASE B: trigger PHP→Supabase sync edge function, then refresh.
// This is the expensive one — gated behind first interaction.
const runBackgroundSyncAndRefresh = async (shownFromCache: boolean) => {
  try {
    lastSyncAt = Date.now();
    const changed = await triggerBackgroundSync();
    if (changed || !shownFromCache) {
      const refreshed = await fetchSupabaseApps();
      if (refreshed.length > 0) {
        lastLoadAt = Date.now();
        setState({ apps: filterAppsForDemo(sortApps(refreshed)), error: null, loading: false });
        return;
      }
    }
  } catch (err) {
    console.warn('[AppData] Background sync/refresh failed:', err);
    if (shownFromCache) return;
  }
  if (shownFromCache) return;

  console.warn('[AppData] All sources failed, using fallback apps');
  setState({ apps: filterAppsForDemo(fallbackApps), error: i18n.t('apps.data.fetchFailed'), loading: false });
};

/** The sync, unless one ran in the last SYNC_EVERY_MS (or `force`). */
const syncOnce = (cachePromise: Promise<boolean>, force = false): Promise<void> => {
  if (syncInflight) return syncInflight;
  if (!force && lastSyncAt && Date.now() - lastSyncAt < SYNC_EVERY_MS) return Promise.resolve();
  syncInflight = (async () => {
    const shown = await cachePromise.catch(() => false);
    await runBackgroundSyncAndRefresh(shown || state.apps.length > 0);
  })().finally(() => { syncInflight = null; });
  return syncInflight;
};

// Full fetch — kept exported as `refetch` for callers that need a hard refresh.
const fetchApps = async () => {
  await syncOnce(loadFromCache(), true);
};

function start(): () => void {
  console.log('[AppData] first subscriber — deferring first fetch off boot path');
  // The cache load, as a PROMISE rather than a boolean.
  //
  // It used to be a `let shownFromCache = false` that the idle task assigned
  // to. First interaction is a key press, which easily beats a 1200ms idle
  // deferral, so the background sync was routinely told "nothing came from
  // cache" while the cache load was still in flight — and a failed sync then
  // replaced a perfectly good catalog with the two-item hardcoded fallback,
  // banner and all. Awaiting the same promise removes the race instead of
  // narrowing it.
  let cachePromise: Promise<boolean> | null = null;
  // A catalog read in the last poll period (an earlier subscriber's) stands.
  if (state.apps.length && Date.now() - lastLoadAt < POLL_MS) cachePromise = Promise.resolve(true);

  // Phase 7: defer the FIRST Supabase select so the home cards have
  // a chance to paint and become focusable before any network work.
  const cancelIdle = runWhenIdle(() => {
    if (!cachePromise) cachePromise = loadFromCache();
  }, 1200);

  // Push the expensive PHP-sync + refetch behind first interaction.
  // (Falls back to a 5s timer in onFirstInteraction if user never moves.)
  const cancelFirstInteraction = onFirstInteraction(() => {
    // Beat the idle task to it? Then do the cache load now and wait for it.
    if (!cachePromise) cachePromise = loadFromCache();
    void syncOnce(cachePromise);
  });

  // Safety fallback: if loading takes too long
  const safetyTimeout = setTimeout(() => {
    if (state.loading && !state.apps.length) {
      console.warn('[AppData] Safety timeout triggered');
      setState({ apps: filterAppsForDemo(fallbackApps), error: i18n.t('apps.data.timedOut'), loading: false });
    }
  }, 25000);

  // Poll every 5 minutes — Supabase realtime already covers most updates.
  // Pauses while the app is backgrounded (and in quiet mode).
  const cancelInterval = setPausableInterval(() => {
    void loadFromCache();
  }, POLL_MS);

  const handleOnline = () => {
    console.log('[AppData] Network restored, refreshing...');
    void loadFromCache();
  };
  window.addEventListener('online', handleOnline);

  return () => {
    cancelIdle();
    cancelFirstInteraction();
    clearTimeout(safetyTimeout);
    cancelInterval();
    window.removeEventListener('online', handleOnline);
  };
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (refs++ === 0) teardown = start();
  return () => {
    listeners.delete(listener);
    if (--refs === 0) { teardown?.(); teardown = null; }
  };
};
const getState = () => state;

/** Tests only. */
export const __resetAppDataForTests = (): void => {
  teardown?.(); teardown = null;
  listeners.clear(); refs = 0;
  state = { apps: [], loading: true, error: null };
  lastLoadAt = 0; lastSyncAt = 0; syncInflight = null; loadInflight = null;
};

export const useAppData = () => {
  const { apps, loading, error } = useSyncExternalStore(subscribe, getState, getState);
  return { apps, loading, error, refetch: fetchApps };
};
