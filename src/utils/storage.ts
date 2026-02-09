// Cross-platform storage adapter for Supabase auth
// Uses Capacitor Preferences on native, localStorage on web
// CRITICAL FIX: On Android/FireTV, localStorage is often cleared on app restart
// We must restore from Capacitor Preferences before Supabase initializes

import { isNativePlatform } from './platform';

// Lazy-loaded Preferences module for native
let PreferencesModule: any = null;
let preferencesReady = false;
let restoredFromPreferences = false;

// Storage keys that need to persist for auth
const AUTH_STORAGE_KEYS = [
  'sb-falmwzhvxoefvkfsiylp-auth-token',
  'supabase.auth.token'
];

// Pre-initialize Preferences on native platforms
const initPreferences = async () => {
  if (preferencesReady) return;
  
  if (isNativePlatform()) {
    try {
      console.log('[Storage] Initializing Capacitor Preferences for native platform...');
      const module = await import('@capacitor/preferences');
      PreferencesModule = module.Preferences;
      
      // CRITICAL: Restore auth tokens from Preferences BEFORE marking ready
      // Android WebView often clears localStorage on app restart
      await restoreFromPreferences();
      
      preferencesReady = true;
      console.log('[Storage] Capacitor Preferences ready, auth tokens restored');
    } catch (error) {
      console.warn('[Storage] Failed to load Capacitor Preferences:', error);
      preferencesReady = true; // Mark as ready even on failure to prevent infinite loading
    }
  } else {
    preferencesReady = true;
  }
};

// Restore localStorage auth tokens from Capacitor Preferences
// This is critical for Android/FireTV where localStorage gets cleared
const restoreFromPreferences = async () => {
  if (!PreferencesModule || restoredFromPreferences) return;
  
  try {
    console.log('[Storage] Restoring auth tokens from Preferences to localStorage...');
    
    for (const key of AUTH_STORAGE_KEYS) {
      try {
        const { value } = await PreferencesModule.get({ key });
        
        if (value) {
          // Check if localStorage is missing this key
          const existingValue = localStorage.getItem(key);
          
          if (!existingValue) {
            console.log(`[Storage] Restoring ${key.substring(0, 30)}... to localStorage`);
            localStorage.setItem(key, value);
          } else if (existingValue !== value) {
            // Preferences might have newer token (e.g., after refresh)
            // Compare timestamps if possible, otherwise use Preferences as source of truth
            try {
              const prefData = JSON.parse(value);
              const localData = JSON.parse(existingValue);
              
              // Use whichever has more recent timestamp
              if (prefData.expires_at && localData.expires_at) {
                if (new Date(prefData.expires_at) > new Date(localData.expires_at)) {
                  console.log(`[Storage] Preferences has newer token for ${key.substring(0, 30)}...`);
                  localStorage.setItem(key, value);
                }
              }
            } catch (parseError) {
              // If can't parse, use Preferences as authoritative
              localStorage.setItem(key, value);
            }
          }
        }
      } catch (keyError) {
        console.warn(`[Storage] Failed to restore key ${key}:`, keyError);
      }
    }
    
    restoredFromPreferences = true;
    console.log('[Storage] Auth token restoration complete');
  } catch (error) {
    console.warn('[Storage] Failed to restore from Preferences:', error);
    restoredFromPreferences = true; // Don't retry
  }
};

// Migrate localStorage auth tokens to Capacitor Preferences (one-way sync)
const migrateToPreferences = async () => {
  if (!PreferencesModule) return;
  
  try {
    for (const key of AUTH_STORAGE_KEYS) {
      const value = localStorage.getItem(key);
      if (value) {
        console.log(`[Storage] Migrating ${key.substring(0, 30)}... to Preferences`);
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
    
    // Safety timeout - don't wait forever (3 seconds max)
    setTimeout(() => {
      clearInterval(check);
      preferencesReady = true;
      resolve();
    }, 3000);
  });
};

// Check if storage is ready
export const isStorageReady = (): boolean => preferencesReady;

// Force a restore from Preferences (useful on app resume)
export const forceRestoreFromPreferences = async (): Promise<void> => {
  if (isNativePlatform() && PreferencesModule) {
    restoredFromPreferences = false;
    await restoreFromPreferences();
  }
};

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
        if (isNative && AUTH_STORAGE_KEYS.includes(key)) {
          console.log(`[Storage] getItem(${key.substring(0, 25)}...): ${value ? 'found' : 'null'}`);
        }
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
        
        if (isNative && AUTH_STORAGE_KEYS.includes(key)) {
          console.log(`[Storage] setItem(${key.substring(0, 25)}...): saved`);
        }
        
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
        
        if (isNative && AUTH_STORAGE_KEYS.includes(key)) {
          console.log(`[Storage] removeItem(${key.substring(0, 25)}...): removed`);
        }
        
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
