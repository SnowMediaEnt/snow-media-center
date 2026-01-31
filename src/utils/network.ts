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
    timeout = 15000,
    retries = 2,
    retryDelay = 1000,
    useCorsProxy = false,
    ...fetchOptions
  } = options;

  const isNative = isNativePlatform();
  
  // CRITICAL FIX: On native platforms, ALWAYS try direct URLs first
  // CORS proxies are only needed for web browsers, not for native WebView
  let urlsToTry: string[];
  
  if (isNative) {
    // Native: Direct URL first, proxies only as last resort fallback
    console.log('[Network] Native platform detected - trying direct URL first');
    urlsToTry = [url, ...CORS_PROXIES.map(proxy => proxy + encodeURIComponent(url))];
  } else if (useCorsProxy) {
    // Web with CORS proxy requested: try proxies first, then direct
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

        const isProxy = tryUrl !== url;
        console.log(`[Network] Fetching (attempt ${attempt + 1}/${retries}, ${isProxy ? 'proxy' : 'direct'}): ${tryUrl.substring(0, 80)}...`);

        const response = await fetch(tryUrl, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          console.log(`[Network] Success: ${tryUrl.substring(0, 50)}...`);
          return response;
        }
        
        // If not ok but got a response, throw to try next URL
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error as Error;
        const errorName = (error as Error).name;
        const errorMsg = (error as Error).message;
        
        if (errorName === 'AbortError') {
          console.warn(`[Network] Timeout after ${timeout}ms: ${tryUrl.substring(0, 50)}...`);
        } else {
          console.warn(`[Network] Failed: ${tryUrl.substring(0, 50)}... - ${errorMsg}`);
        }
        
        // Continue to next URL in the list
        continue;
      }
    }

    // Wait before retry
    if (attempt < retries - 1) {
      console.log(`[Network] Retrying in ${retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
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
