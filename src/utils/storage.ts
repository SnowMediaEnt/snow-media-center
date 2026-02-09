// Cross-platform storage persistence for Supabase auth on Android/FireTV
// CRITICAL: On Android/FireTV, WebView often clears localStorage on app restart.
// This module restores auth tokens from Capacitor Preferences to localStorage
// BEFORE Supabase tries to read them.

import { Capacitor } from '@capacitor/core';

// Storage keys that need to persist for auth
const AUTH_STORAGE_KEYS = [
  'sb-falmwzhvxoefvkfsiylp-auth-token',
  'supabase.auth.token'
];

// Lazy-loaded Preferences module for native
let PreferencesModule: any = null;
let initializationPromise: Promise<void> | null = null;
let isInitialized = false;

// Check if we're on a native platform
const checkIsNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

// Initialize and restore auth tokens from Preferences
const initializeStorage = async (): Promise<void> => {
  if (isInitialized) return;
  
  const isNative = checkIsNative();
  console.log('[Storage] Initializing for platform:', isNative ? 'native' : 'web');
  
  if (!isNative) {
    isInitialized = true;
    return;
  }
  
  try {
    // Load Capacitor Preferences
    const module = await import('@capacitor/preferences');
    PreferencesModule = module.Preferences;
    console.log('[Storage] Capacitor Preferences loaded');
    
    // CRITICAL: Restore auth tokens from Preferences to localStorage
    // This must happen BEFORE Supabase reads from localStorage
    await restoreAuthTokens();
    
    // Set up listener to persist future localStorage writes to Preferences
    setupStorageSync();
    
    isInitialized = true;
    console.log('[Storage] Initialization complete');
  } catch (error) {
    console.error('[Storage] Failed to initialize:', error);
    isInitialized = true; // Mark as done to prevent hanging
  }
};

// Restore auth tokens from Capacitor Preferences to localStorage
const restoreAuthTokens = async (): Promise<void> => {
  if (!PreferencesModule) return;
  
  console.log('[Storage] Restoring auth tokens from Preferences...');
  
  for (const key of AUTH_STORAGE_KEYS) {
    try {
      const { value } = await PreferencesModule.get({ key });
      
      if (value) {
        const existingValue = localStorage.getItem(key);
        
        if (!existingValue) {
          console.log(`[Storage] Restored ${key.substring(0, 30)}... from Preferences`);
          localStorage.setItem(key, value);
        } else if (existingValue !== value) {
          // Compare timestamps to use the newer token
          try {
            const prefData = JSON.parse(value);
            const localData = JSON.parse(existingValue);
            
            if (prefData.expires_at && localData.expires_at) {
              if (new Date(prefData.expires_at) > new Date(localData.expires_at)) {
                console.log(`[Storage] Using newer token from Preferences for ${key.substring(0, 30)}...`);
                localStorage.setItem(key, value);
              }
            }
          } catch {
            // Can't parse, prefer Preferences as it's the persistent store
            localStorage.setItem(key, value);
          }
        }
      }
    } catch (error) {
      console.warn(`[Storage] Failed to restore ${key}:`, error);
    }
  }
  
  console.log('[Storage] Token restoration complete');
};

// Persist localStorage auth writes to Capacitor Preferences
const setupStorageSync = (): void => {
  if (!PreferencesModule) return;
  
  // Override localStorage.setItem to also persist to Preferences
  const originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key: string, value: string) => {
    originalSetItem(key, value);
    
    // Async persist to Preferences for auth keys
    if (AUTH_STORAGE_KEYS.includes(key)) {
      PreferencesModule.set({ key, value }).catch((err: any) => {
        console.warn('[Storage] Failed to persist to Preferences:', err);
      });
    }
  };
  
  // Override localStorage.removeItem to also remove from Preferences
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);
  localStorage.removeItem = (key: string) => {
    originalRemoveItem(key);
    
    if (AUTH_STORAGE_KEYS.includes(key)) {
      PreferencesModule.remove({ key }).catch((err: any) => {
        console.warn('[Storage] Failed to remove from Preferences:', err);
      });
    }
  };
  
  console.log('[Storage] Storage sync enabled');
};

// Start initialization immediately on import
initializationPromise = initializeStorage();

// Wait for storage to be ready (auth hook should call this before checking session)
export const waitForStorageReady = async (): Promise<void> => {
  if (isInitialized) return;
  if (initializationPromise) {
    await initializationPromise;
    return;
  }
  // Fallback timeout to prevent hanging
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (isInitialized) {
        clearInterval(check);
        resolve();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(check);
      isInitialized = true;
      resolve();
    }, 3000);
  });
};

// Check if storage is ready (synchronous check)
export const isStorageReady = (): boolean => isInitialized;

// Force restore from Preferences (useful for debugging)
export const forceRestoreFromPreferences = async (): Promise<void> => {
  if (checkIsNative() && PreferencesModule) {
    await restoreAuthTokens();
  }
};

// Legacy export for compatibility - no longer needed as we use native localStorage
export const createStorageAdapter = () => {
  console.log('[Storage] Using native localStorage with Preferences backup');
  return window.localStorage;
};

export const storageAdapter = typeof window !== 'undefined' ? window.localStorage : null;
