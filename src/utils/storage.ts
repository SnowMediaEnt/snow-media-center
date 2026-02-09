// Cross-platform storage persistence for Supabase auth on Android/FireTV
// Simplified version - directly restore tokens on import

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// The auth token key used by Supabase
const AUTH_KEY = 'sb-falmwzhvxoefvkfsiylp-auth-token';

let isReady = false;
let initPromise: Promise<void> | null = null;

// Check if running on native platform
const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

// Restore auth token from Preferences to localStorage
const restoreToken = async (): Promise<void> => {
  if (!isNative()) {
    console.log('[Storage] Web platform, skipping restoration');
    isReady = true;
    return;
  }

  try {
    console.log('[Storage] Restoring auth token from Preferences...');
    const { value } = await Preferences.get({ key: AUTH_KEY });
    
    if (value) {
      const currentValue = localStorage.getItem(AUTH_KEY);
      if (!currentValue) {
        console.log('[Storage] Restored auth token to localStorage');
        localStorage.setItem(AUTH_KEY, value);
      } else {
        console.log('[Storage] Auth token already in localStorage');
      }
    } else {
      console.log('[Storage] No saved auth token in Preferences');
    }
  } catch (error) {
    console.error('[Storage] Failed to restore token:', error);
  }
  
  isReady = true;
};

// Setup sync: mirror localStorage writes to Preferences
const setupSync = (): void => {
  if (!isNative()) return;
  
  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);
  
  localStorage.setItem = (key: string, value: string) => {
    originalSetItem(key, value);
    if (key === AUTH_KEY) {
      console.log('[Storage] Persisting auth token to Preferences');
      Preferences.set({ key, value }).catch(console.warn);
    }
  };
  
  localStorage.removeItem = (key: string) => {
    originalRemoveItem(key);
    if (key === AUTH_KEY) {
      console.log('[Storage] Removing auth token from Preferences');
      Preferences.remove({ key }).catch(console.warn);
    }
  };
  
  console.log('[Storage] Sync enabled');
};

// Initialize storage - runs immediately on import
const init = async (): Promise<void> => {
  console.log('[Storage] Initializing...');
  await restoreToken();
  setupSync();
  console.log('[Storage] Ready');
};

// Start initialization immediately
initPromise = init();

// Wait for storage to be ready
export const waitForStorageReady = async (): Promise<void> => {
  if (isReady) return;
  if (initPromise) await initPromise;
  
  // Timeout fallback
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      isReady = true;
      resolve();
    }, 2000);
  });
  
  await Promise.race([initPromise, timeout]);
};

export const isStorageReady = (): boolean => isReady;
