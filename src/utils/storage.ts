// Cross-platform storage adapter for Supabase auth
// Uses Capacitor Preferences on native, localStorage on web
// CRITICAL: Uses synchronous localStorage for initial reads, async Preferences for persistence

import { isNativePlatform } from './platform';

// Lazy-loaded Preferences module for native
let PreferencesModule: any = null;
let preferencesReady = false;

// Pre-initialize Preferences on native platforms
const initPreferences = async () => {
  if (preferencesReady) return;
  
  if (isNativePlatform()) {
    try {
      console.log('[Storage] Initializing Capacitor Preferences...');
      const module = await import('@capacitor/preferences');
      PreferencesModule = module.Preferences;
      preferencesReady = true;
      console.log('[Storage] Capacitor Preferences ready');
      
      // Migrate any localStorage items to Preferences
      await migrateToPreferences();
    } catch (error) {
      console.warn('[Storage] Failed to load Capacitor Preferences, using localStorage:', error);
      preferencesReady = true; // Mark as ready even on failure to prevent infinite loading
    }
  } else {
    preferencesReady = true;
  }
};

// Migrate localStorage auth tokens to Capacitor Preferences
const migrateToPreferences = async () => {
  if (!PreferencesModule) return;
  
  try {
    const keysToMigrate = [
      'sb-falmwzhvxoefvkfsiylp-auth-token',
      'supabase.auth.token'
    ];
    
    for (const key of keysToMigrate) {
      const value = localStorage.getItem(key);
      if (value) {
        console.log(`[Storage] Migrating ${key} to Preferences`);
        await PreferencesModule.set({ key, value });
      }
    }
  } catch (error) {
    console.warn('[Storage] Migration failed:', error);
  }
};

// Start initialization immediately
initPreferences();

// Wait for storage to be ready (for components that need to ensure it's loaded)
export const waitForStorageReady = (): Promise<void> => {
  return new Promise((resolve) => {
    if (preferencesReady) {
      resolve();
      return;
    }
    
    const check = setInterval(() => {
      if (preferencesReady) {
        clearInterval(check);
        resolve();
      }
    }, 50);
    
    // Safety timeout - don't wait forever
    setTimeout(() => {
      clearInterval(check);
      preferencesReady = true;
      resolve();
    }, 5000);
  });
};

// Check if storage is ready
export const isStorageReady = (): boolean => preferencesReady;

// Storage adapter that Supabase auth can use
// CRITICAL: Uses synchronous localStorage for getItem (Supabase requirement)
// Then persists to Capacitor Preferences asynchronously for native
export const createStorageAdapter = () => {
  const isNative = isNativePlatform();
  console.log(`[Storage] Creating adapter for platform: ${isNative ? 'native' : 'web'}`);
  
  return {
    // SYNCHRONOUS getItem using localStorage (required by Supabase for session restore)
    getItem: (key: string): string | null => {
      try {
        const value = localStorage.getItem(key);
        console.log(`[Storage] getItem(${key.substring(0, 20)}...): ${value ? 'found' : 'null'}`);
        return value;
      } catch (error) {
        console.warn('[Storage] getItem failed:', error);
        return null;
      }
    },
    
    // setItem: Write to localStorage AND async to Preferences on native
    setItem: (key: string, value: string): void => {
      try {
        // Always write to localStorage first (synchronous, immediate)
        localStorage.setItem(key, value);
        console.log(`[Storage] setItem(${key.substring(0, 20)}...): saved to localStorage`);
        
        // Also persist to Capacitor Preferences on native (async, fire-and-forget)
        if (isNative && PreferencesModule) {
          PreferencesModule.set({ key, value }).catch((err: any) => {
            console.warn('[Storage] Preferences set failed:', err);
          });
        }
      } catch (error) {
        console.warn('[Storage] setItem failed:', error);
      }
    },
    
    // removeItem: Remove from both localStorage and Preferences
    removeItem: (key: string): void => {
      try {
        localStorage.removeItem(key);
        console.log(`[Storage] removeItem(${key.substring(0, 20)}...): removed from localStorage`);
        
        // Also remove from Capacitor Preferences on native
        if (isNative && PreferencesModule) {
          PreferencesModule.remove({ key }).catch((err: any) => {
            console.warn('[Storage] Preferences remove failed:', err);
          });
        }
      } catch (error) {
        console.warn('[Storage] removeItem failed:', error);
      }
    },
  };
};

// Pre-initialize storage adapter
export const storageAdapter = createStorageAdapter();
