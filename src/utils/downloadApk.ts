import { Directory, Filesystem } from "@capacitor/filesystem";
import { isNativePlatform } from "@/utils/platform";

// CORS proxies for APK downloads on Android
const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

// Clean up old APK files from cache to prevent storage bloat
export async function cleanupOldApks(keepFilename?: string): Promise<void> {
  try {
    const result = await Filesystem.readdir({
      path: 'apk',
      directory: Directory.Cache
    });
    
    for (const file of result.files) {
      if (file.name.endsWith('.apk') && file.name !== keepFilename) {
        await Filesystem.deleteFile({
          path: `apk/${file.name}`,
          directory: Directory.Cache
        });
        console.log('Cleaned up old APK:', file.name);
      }
    }
  } catch (e) {
    // Directory might not exist yet, that's fine
    console.log('No APK cache to clean');
  }
}

// Try fetch with multiple URL strategies (direct + CORS proxies)
async function fetchWithFallback(url: string): Promise<Response> {
  const urlsToTry = [
    url,
    ...CORS_PROXIES.map(proxy => proxy + encodeURIComponent(url))
  ];
  
  let lastError: Error | null = null;
  
  for (const tryUrl of urlsToTry) {
    try {
      console.log('[APK Download] Trying:', tryUrl.substring(0, 80) + '...');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for large files
      
      const response = await fetch(tryUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.android.package-archive,application/octet-stream,*/*',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        console.log('[APK Download] Success with:', tryUrl.substring(0, 50));
        return response;
      }
      
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      console.warn('[APK Download] Failed:', response.status, response.statusText);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn('[APK Download] Error with URL:', err);
    }
  }
  
  throw lastError || new Error('All download attempts failed');
}

export async function downloadApkToCache(
  url: string, 
  filename: string, 
  onProgress?: (progress: number) => void
): Promise<string> {
  const isNative = isNativePlatform();
  
  console.log('=== APK Download Debug ===');
  console.log('Is Native Platform:', isNative);
  console.log('Download URL:', url);
  console.log('Filename:', filename);
  
  if (!isNative) {
    throw new Error('APK downloads are only available on Android devices');
  }

  // Clean up old APKs before downloading new one
  await cleanupOldApks(filename);

  console.log('Starting APK download with fallback...');
  
  // Use our fallback fetch that tries CORS proxies
  const response = await fetchWithFallback(url);
  
  const contentLength = response.headers.get('content-length');
  const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
  
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response reader');
  }
  
  const chunks: Uint8Array[] = [];
  let receivedLength = 0;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    chunks.push(value);
    receivedLength += value.length;
    
    if (totalSize > 0 && onProgress) {
      onProgress(Math.round((receivedLength / totalSize) * 100));
    }
  }
  
  // Combine chunks into single array
  const allChunks = new Uint8Array(receivedLength);
  let position = 0;
  for (const chunk of chunks) {
    allChunks.set(chunk, position);
    position += chunk.length;
  }
  
  // Convert to base64 in chunks to avoid memory issues
  const chunkSize = 32768;
  let base64 = '';
  for (let i = 0; i < allChunks.length; i += chunkSize) {
    const chunk = allChunks.subarray(i, Math.min(i + chunkSize, allChunks.length));
    base64 += btoa(String.fromCharCode.apply(null, Array.from(chunk)));
  }
  
  const path = `apk/${filename}`;
  
  // Ensure directory exists
  try {
    await Filesystem.mkdir({
      path: 'apk',
      directory: Directory.Cache,
      recursive: true
    });
  } catch (e) {
    // Directory might already exist
  }
  
  await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Cache
  });
  
  const uri = await Filesystem.getUri({
    directory: Directory.Cache,
    path
  });
  
  console.log('APK saved to:', uri.uri);
  
  return uri.uri;
}

export function generateFileName(appName: string, version?: string): string {
  const sanitizedName = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${sanitizedName}-${version || 'latest'}.apk`;
}

export function generatePackageName(appName: string): string {
  const sanitizedName = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `com.${sanitizedName}.app`;
}
