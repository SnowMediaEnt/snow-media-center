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

// Download APK with streaming progress - optimized for 32-bit Android/FireTV
export async function downloadApkToCache(
  url: string, 
  filename: string, 
  onProgress?: (progress: number) => void
): Promise<string> {
  const isNative = isNativePlatform();
  
  console.log('=== APK Download Debug (32-bit optimized) ===');
  console.log('Is Native Platform:', isNative);
  console.log('Download URL:', url);
  console.log('Filename:', filename);
  
  if (!isNative) {
    throw new Error('APK downloads are only available on Android devices');
  }

  // Clean up old APKs before downloading new one
  await cleanupOldApks(filename);

  console.log('[APK] Starting download...');
  
  // On native Android, fetch directly - no CORS issues
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 min timeout for slow connections
  
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
  
  // If no content-length header, estimate based on typical APK sizes (25MB default)
  const estimatedSize = totalSize > 0 ? totalSize : 25 * 1024 * 1024;
  
  console.log('[APK] Content-Length:', contentLength, 'Using size:', estimatedSize);
  
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response reader');
  }
  
  // For 32-bit devices: Process and write in chunks to avoid memory pressure
  // Instead of accumulating all chunks then converting, we'll write incrementally
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
  
  // Delete existing file if present
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Cache });
  } catch (e) {
    // File might not exist
  }
  
  let receivedLength = 0;
  let lastReportedProgress = -1;
  let isFirstChunk = true;
  
  // Report initial 0% progress
  if (onProgress) {
    onProgress(0);
  }
  
  // Process in streaming fashion - write each chunk as we receive it
  // This keeps memory usage low on 32-bit devices
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    receivedLength += value.length;
    
    // Convert chunk to base64 using loop (safe for 32-bit)
    // Use smaller 4KB chunks for base64 conversion
    let chunkBase64 = '';
    const conversionChunkSize = 4096; // 4KB - very safe for 32-bit
    for (let i = 0; i < value.length; i += conversionChunkSize) {
      const slice = value.subarray(i, Math.min(i + conversionChunkSize, value.length));
      let binary = '';
      for (let j = 0; j < slice.length; j++) {
        binary += String.fromCharCode(slice[j]);
      }
      chunkBase64 += btoa(binary);
    }
    
    // Append to file (Capacitor Filesystem handles this)
    if (isFirstChunk) {
      await Filesystem.writeFile({
        path,
        data: chunkBase64,
        directory: Directory.Cache
      });
      isFirstChunk = false;
    } else {
      await Filesystem.appendFile({
        path,
        data: chunkBase64,
        directory: Directory.Cache
      });
    }
    
    // Calculate and report progress
    if (onProgress) {
      let progressPercent: number;
      if (totalSize > 0) {
        progressPercent = Math.min(99, Math.round((receivedLength / totalSize) * 100));
      } else {
        progressPercent = Math.min(95, Math.round((receivedLength / estimatedSize) * 100));
      }
      
      // Update every 2% change to reduce UI load
      if (progressPercent >= lastReportedProgress + 2 || progressPercent === 99) {
        console.log('[APK] Progress:', progressPercent, '%');
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
