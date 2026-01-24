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
 */
export const invokeEdgeFunction = async <T = unknown>(
  functionName: string,
  options: InvokeOptions = {}
): Promise<InvokeResult<T>> => {
  const {
    body,
    timeout = 15000,
    retries = 2,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`Invoking ${functionName} (attempt ${attempt + 1}/${retries})...`);

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.warn(`Edge function ${functionName} timed out after ${timeout}ms`);
        controller.abort();
      }, timeout);

      // Invoke the function
      const invokePromise = supabase.functions.invoke(functionName, {
        body,
      });

      // Race between the invoke and a timeout rejection
      const result = await Promise.race([
        invokePromise,
        new Promise<never>((_, reject) => {
          const checkAbort = setInterval(() => {
            if (controller.signal.aborted) {
              clearInterval(checkAbort);
              reject(new Error(`Request timeout after ${timeout}ms`));
            }
          }, 100);
          // Clean up interval after timeout
          setTimeout(() => clearInterval(checkAbort), timeout + 1000);
        })
      ]);

      clearTimeout(timeoutId);

      if (result.error) {
        throw new Error(result.error.message || 'Edge function error');
      }

      console.log(`Edge function ${functionName} succeeded`);
      return { data: result.data as T, error: null };

    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Edge function ${functionName} attempt ${attempt + 1} failed:`, lastError.message);

      // Don't retry on certain errors
      if (lastError.message.includes('not found') || 
          lastError.message.includes('unauthorized')) {
        break;
      }

      // Wait before retry with exponential backoff
      if (attempt < retries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.log(`Retrying ${functionName} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return { data: null, error: lastError };
};

/**
 * Fetch Wix products with robust error handling
 */
export const fetchWixProducts = async () => {
  return invokeEdgeFunction('wix-integration', {
    body: { action: 'get-products' },
    timeout: 20000,
    retries: 2,
  });
};

/**
 * Fetch Vimeo videos with robust error handling
 */
export const fetchVimeoVideos = async () => {
  return invokeEdgeFunction('vimeo-videos', {
    timeout: 20000,
    retries: 2,
  });
};

/**
 * Verify Wix member with robust error handling
 */
export const verifyWixMember = async (email: string) => {
  return invokeEdgeFunction('wix-integration', {
    body: { action: 'verify-member', email },
    timeout: 15000,
    retries: 2,
  });
};
