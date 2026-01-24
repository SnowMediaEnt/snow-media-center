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
    timeout = 15000, // Reduced from 20s to 15s for faster failover
    retries = 2, // Reduced retries, rely on multiple URLs instead
    retryDelay = 1000,
    useCorsProxy = false,
    ...fetchOptions
  } = options;

  const isNative = isNativePlatform();
  
  // IMPORTANT: On Android/native, network requests can fail for various reasons
  // (SSL issues, DNS, firewall). Always include CORS proxies as fallback for ALL platforms.
  let urlsToTry: string[];
  
  if (useCorsProxy) {
    // Explicit CORS proxy request: try proxies first, then direct
    urlsToTry = [...CORS_PROXIES.map(proxy => proxy + encodeURIComponent(url)), url];
  } else {
    // Default: try direct first, then proxies as fallback (works for both native and web)
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
        const errorName = (error as Error).name;
        const errorMsg = (error as Error).message;
        
        // Log with more context
        if (errorName === 'AbortError') {
          console.warn(`Timeout after ${timeout}ms: ${tryUrl.substring(0, 50)}...`);
        } else {
          console.warn(`Fetch failed: ${tryUrl.substring(0, 50)}... - ${errorMsg}`);
        }
        
        // Continue to next URL in the list
        continue;
      }
    }

    // Wait before retry
    if (attempt < retries - 1) {
      console.log(`Retrying in ${retryDelay}ms...`);
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
