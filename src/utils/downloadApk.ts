import { Directory, Filesystem } from "@capacitor/filesystem";
import { isNativePlatform } from "@/utils/platform";

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

// Download APK with streaming progress - optimized for Android/FireTV
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

  console.log('[APK] Starting download (direct HTTPS, no CORS proxy on native)...');
  
  // On native Android, fetch directly - no CORS issues
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min timeout for large APKs
  
  let response: Response;
  
  try {
    console.log('[APK] Fetching:', url);
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.android.package-archive,application/octet-stream,*/*',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (fetchError) {
    clearTimeout(timeoutId);
    console.error('[APK] Fetch failed:', fetchError);
    throw new Error(`Download failed: ${fetchError instanceof Error ? fetchError.message : 'Network error'}`);
  }
  
  const contentLength = response.headers.get('content-length');
  let totalSize = contentLength ? parseInt(contentLength, 10) : 0;
  
  // If no content-length header, estimate based on typical APK sizes (30MB default)
  const estimatedSize = totalSize > 0 ? totalSize : 30 * 1024 * 1024;
  
  console.log('[APK] Content-Length:', contentLength, 'Using size:', estimatedSize);
  
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response reader');
  }
  
  const chunks: Uint8Array[] = [];
  let receivedLength = 0;
  let lastReportedProgress = -1;
  
  // Report initial 0% progress
  if (onProgress) {
    onProgress(0);
  }
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    chunks.push(value);
    receivedLength += value.length;
    
    // Calculate and report progress
    if (onProgress) {
      let progressPercent: number;
      if (totalSize > 0) {
        progressPercent = Math.min(99, Math.round((receivedLength / totalSize) * 100));
      } else {
        // Estimate progress based on expected size, cap at 95% until done
        progressPercent = Math.min(95, Math.round((receivedLength / estimatedSize) * 100));
      }
      
      // Only update on change (avoid flooding with identical updates)
      if (progressPercent !== lastReportedProgress) {
        console.log('[APK] Progress:', progressPercent, '% (', receivedLength, 'bytes)');
        onProgress(progressPercent);
        lastReportedProgress = progressPercent;
      }
    }
  }
  
  // Final progress update to 100%
  if (onProgress) {
    console.log('[APK] Complete! Total:', receivedLength, 'bytes');
    onProgress(100);
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
  
  console.log('[APK] Saved to:', uri.uri);
  
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
