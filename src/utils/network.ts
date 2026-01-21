// Network utilities for robust cross-platform fetching
import { isNativePlatform } from './platform';

const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

export interface FetchOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  useCorsProxy?: boolean;
}

// Robust fetch with retries, timeout, and CORS proxy fallback
export const robustFetch = async (
  url: string,
  options: FetchOptions = {}
): Promise<Response> => {
  const {
    timeout = 20000,
    retries = 3,
    retryDelay = 1000,
    useCorsProxy = false,
    ...fetchOptions
  } = options;

  const isNative = isNativePlatform();
  
  // On native platforms, ALWAYS use direct fetch - no CORS issues exist
  // On web, try direct first, then CORS proxies if that fails
  let urlsToTry: string[];
  
  if (isNative) {
    // Native: only use direct URL, no proxies needed
    urlsToTry = [url];
  } else if (useCorsProxy) {
    // Web with explicit CORS proxy request: try proxies first
    urlsToTry = [...CORS_PROXIES.map(proxy => proxy + encodeURIComponent(url)), url];
  } else {
    // Web default: try direct first, then proxies as fallback
    urlsToTry = [url, ...CORS_PROXIES.map(proxy => proxy + encodeURIComponent(url))];
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    for (const tryUrl of urlsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        console.log(`Fetching (attempt ${attempt + 1}/${retries}): ${tryUrl.substring(0, 100)}...`);

        const response = await fetch(tryUrl, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          console.log(`Fetch successful: ${tryUrl.substring(0, 50)}...`);
          return response;
        }
        
        // If not ok but got a response, throw to try next URL
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error as Error;
        // Only log on non-abort errors to reduce noise
        if ((error as Error).name !== 'AbortError') {
          console.warn(`Fetch attempt failed for ${tryUrl.substring(0, 50)}...`, 
            (error as Error).message);
        }
      }
    }

    // Wait before retry
    if (attempt < retries - 1) {
      console.log(`Retrying in ${retryDelay * (attempt + 1)}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
    }
  }

  throw lastError || new Error('All fetch attempts failed');
};

// Fetch JSON with robust error handling
export const fetchJSON = async <T>(
  url: string,
  options: FetchOptions = {}
): Promise<T> => {
  const response = await robustFetch(url, options);
  return response.json();
};

// Check network connectivity
export const isOnline = (): boolean => {
  return navigator.onLine;
};

// Wait for network to be available
export const waitForNetwork = (timeoutMs = 30000): Promise<boolean> => {
  return new Promise((resolve) => {
    if (navigator.onLine) {
      resolve(true);
      return;
    }

    const timeout = setTimeout(() => {
      window.removeEventListener('online', onOnline);
      resolve(false);
    }, timeoutMs);

    const onOnline = () => {
      clearTimeout(timeout);
      window.removeEventListener('online', onOnline);
      resolve(true);
    };

    window.addEventListener('online', onOnline);
  });
};
