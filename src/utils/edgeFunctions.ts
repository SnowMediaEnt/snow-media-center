// Edge function utilities with robust timeout and retry handling for Android
import { supabase } from '@/integrations/supabase/client';

interface InvokeOptions {
  body?: Record<string, unknown>;
  timeout?: number;
  retries?: number;
}

interface InvokeResult<T = unknown> {
  data: T | null;
  error: Error | null;
}

/**
 * Robust edge function invocation with timeout and retry support.
 * Designed to handle Android WebView network issues.
 * 
 * Uses Promise.race with a simple timeout since supabase.functions.invoke
 * doesn't accept AbortController signal directly.
 */
export const invokeEdgeFunction = async <T = unknown>(
  functionName: string,
  options: InvokeOptions = {}
): Promise<InvokeResult<T>> => {
  const {
    body,
    timeout = 20000, // Increased default timeout for Android
    retries = 3, // Increased retries for unreliable connections
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`[EdgeFn] Invoking ${functionName} (attempt ${attempt + 1}/${retries}, timeout: ${timeout}ms)...`);
      const startTime = Date.now();

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Edge function ${functionName} timed out after ${timeout}ms`));
        }, timeout);
      });

      // Invoke the function - supabase client handles the actual fetch
      const invokePromise = supabase.functions.invoke(functionName, {
        body,
      });

      // Race between the invoke and timeout
      const result = await Promise.race([invokePromise, timeoutPromise]);

      const elapsed = Date.now() - startTime;
      console.log(`[EdgeFn] ${functionName} completed in ${elapsed}ms`);

      if (result.error) {
        throw new Error(result.error.message || 'Edge function error');
      }

      console.log(`[EdgeFn] ${functionName} succeeded`);
      return { data: result.data as T, error: null };

    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[EdgeFn] ${functionName} attempt ${attempt + 1} failed:`, lastError.message);

      // Don't retry on certain errors
      if (lastError.message.includes('not found') || 
          lastError.message.includes('unauthorized') ||
          lastError.message.includes('401') ||
          lastError.message.includes('404')) {
        console.log(`[EdgeFn] Not retrying ${functionName} due to error type`);
        break;
      }

      // Wait before retry with exponential backoff
      if (attempt < retries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        console.log(`[EdgeFn] Retrying ${functionName} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`[EdgeFn] ${functionName} failed after ${retries} attempts:`, lastError?.message);
  return { data: null, error: lastError };
};

/**
 * Fetch Wix products with robust error handling
 */
export const fetchWixProducts = async () => {
  return invokeEdgeFunction('wix-integration', {
    body: { action: 'get-products' },
    timeout: 25000, // Increased for product catalog
    retries: 3,
  });
};

/**
 * Fetch Vimeo videos with robust error handling
 */
export const fetchVimeoVideos = async () => {
  return invokeEdgeFunction('vimeo-videos', {
    timeout: 25000, // Increased for video catalog
    retries: 3,
  });
};

/**
 * Verify Wix member with robust error handling
 */
export const verifyWixMember = async (email: string) => {
  return invokeEdgeFunction('wix-integration', {
    body: { action: 'verify-member', email },
    timeout: 20000,
    retries: 3,
  });
};
