// Network utilities for robust cross-platform fetching
import { isNativePlatform } from './platform';
import { CapacitorHttp } from '@capacitor/core';

// Hosts whose responses we should bypass the WebView for on native, to dodge
// CORS restrictions. CapacitorHttp does the request from the native layer.
const NATIVE_BYPASS_HOSTS = ['snowmediaapps.com'];

const shouldUseCapacitorHttp = (url: string): boolean => {
  if (!isNativePlatform()) return false;
  try {
    const u = new URL(url);
    return NATIVE_BYPASS_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
};

const capacitorHttpToResponse = async (url: string, opts: RequestInit, timeout: number): Promise<Response> => {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = (opts.headers as Record<string, string> | undefined) || {};
  const res = await CapacitorHttp.request({
    url,
    method,
    headers,
    data: opts.body as any,
    connectTimeout: timeout,
    readTimeout: timeout,
    responseType: 'text',
  });
  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
  return new Response(body, {
    status: res.status,
    headers: res.headers as any,
  });
};

// Third-party CORS proxies, for the web preview only. Whoever runs one sees
// the request and writes the answer, so the TV never uses them (it has no
// CORS problem, and update.json must come from our own server), and a
// request that carries a key, a token or a password never goes through one.
const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

/** Headers a plain public GET may carry; anything else (Authorization, an
 *  apikey, a cookie, an admin or internal secret) keeps the request direct. */
const PROXY_SAFE_HEADERS = new Set(['accept', 'accept-language', 'cache-control', 'pragma']);
/** Query names that carry a credential ("?k=", "&password=", "access_token"). */
const SECRET_PARAM = /^(k|key|apikey|api[-_]?key|token|access[-_]?token|refresh[-_]?token|id[-_]?token|auth|authorization|code|password|pass|passwd|pwd|secret|sig|signature|session|sid|username|user)$/i;

const headerNames = (headers: HeadersInit | undefined): string[] => {
  if (!headers) return [];
  if (Array.isArray(headers)) return headers.map(([k]) => String(k).toLowerCase());
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const names: string[] = [];
    headers.forEach((_v, k) => { names.push(k.toLowerCase()); });
    return names;
  }
  return Object.keys(headers).map((k) => k.toLowerCase());
};

/** Whether a request may go through a third-party proxy: a GET with no body,
 *  no credentials in its headers, its URL or its query, and not to Supabase. */
export const isProxySafe = (url: string, opts: RequestInit = {}): boolean => {
  const method = (opts.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (opts.body != null || opts.credentials === 'include') return false;
  if (headerNames(opts.headers).some((h) => !PROXY_SAFE_HEADERS.has(h))) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  if (/(^|\.)supabase\.co$/i.test(u.hostname)) return false;
  let secret = false;
  u.searchParams.forEach((_v, k) => { if (SECRET_PARAM.test(k)) secret = true; });
  return !secret;
};

/** Scheme, host and path only: a query can carry a key, and a log is no place for it. */
const forLog = (url: string): string => {
  try { const u = new URL(url); return `${u.protocol}//${u.host}${u.pathname}`; } catch { return '(bad url)'; }
};

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
  
  let urlsToTry: string[];
  
  if (isNative || !isProxySafe(url, fetchOptions)) {
    // Native (no CORS to dodge, and a proxy must never write what the box
    // trusts, like update.json), or a request with a credential in it:
    // direct only.
    urlsToTry = [url];
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
        console.log(`[Network] Fetching (attempt ${attempt + 1}/${retries}, ${isProxy ? 'proxy' : 'direct'}): ${forLog(url)}`);

        let response: Response;
        if (!isProxy && shouldUseCapacitorHttp(tryUrl)) {
          // Bypass WebView (and CORS) via the native HTTP layer
          response = await capacitorHttpToResponse(tryUrl, fetchOptions as RequestInit, timeout);
        } else {
          response = await fetch(tryUrl, {
            ...fetchOptions,
            signal: controller.signal,
          });
        }

        clearTimeout(timeoutId);

        if (response.ok) {
          console.log(`[Network] Success (${isProxy ? 'proxy' : 'direct'}): ${forLog(url)}`);
          return response;
        }
        
        // If not ok but got a response, throw to try next URL
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error as Error;
        const errorName = (error as Error).name;
        const errorMsg = (error as Error).message;
        
        if (errorName === 'AbortError') {
          console.warn(`[Network] Timeout after ${timeout}ms: ${forLog(url)}`);
        } else {
          console.warn(`[Network] Failed: ${forLog(url)} - ${errorMsg}`);
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
