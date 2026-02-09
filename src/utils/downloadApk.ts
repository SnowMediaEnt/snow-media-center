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

// Download APK with progress - simplified for 32-bit Android/FireTV
export async function downloadApkToCache(
  url: string, 
  filename: string, 
  onProgress?: (progress: number) => void
): Promise<string> {
  const isNative = isNativePlatform();
  
  console.log('[APK] Starting download...');
  console.log('[APK] URL:', url);
  console.log('[APK] Native:', isNative);
  
  if (!isNative) {
    throw new Error('APK downloads are only available on Android devices');
  }

  // Clean up old APKs first
  await cleanupOldApks(filename);

  // Ensure URL has https://
  let downloadUrl = url;
  if (!downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
    downloadUrl = `https://${downloadUrl}`;
  }
  
  console.log('[APK] Final download URL:', downloadUrl);

  // Report 0% progress
  onProgress?.(0);

  // Simple direct fetch - no CORS issues on native Android
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 min timeout
  
  let response: Response;
  try {
    console.log('[APK] Fetching...');
    response = await fetch(downloadUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    console.log('[APK] Response status:', response.status);
    console.log('[APK] Response type:', response.headers.get('content-type'));
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Check if we got HTML instead of APK (server error)
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const preview = await response.clone().text();
      console.error('[APK] Got HTML instead of APK:', preview.substring(0, 200));
      throw new Error('Server returned HTML error page instead of APK file');
    }
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('[APK] Fetch failed:', error);
    throw new Error(`Download failed: ${error instanceof Error ? error.message : 'Network error'}`);
  }

  // Get total size for progress
  const contentLength = response.headers.get('content-length');
  const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
  console.log('[APK] Content-Length:', totalSize);

  // Read the response as array buffer directly (simpler for 32-bit)
  console.log('[APK] Reading response body...');
  onProgress?.(5);
  
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  console.log('[APK] Downloaded bytes:', bytes.length);
  
  onProgress?.(50);

  // Convert to base64 in small chunks to avoid stack overflow on 32-bit
  console.log('[APK] Converting to base64...');
  let binaryString = '';
  const chunkSize = 4096; // Small chunks for 32-bit memory
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (let j = 0; j < chunk.length; j++) {
      binaryString += String.fromCharCode(chunk[j]);
    }
    
    // Report progress during conversion
    if (i % (chunkSize * 50) === 0) {
      const convProgress = 50 + Math.round((i / bytes.length) * 40);
      onProgress?.(convProgress);
    }
  }
  
  const base64Data = btoa(binaryString);
  console.log('[APK] Base64 length:', base64Data.length);
  
  onProgress?.(95);

  // Ensure directory exists
  const path = `apk/${filename}`;
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

  // Write the file
  console.log('[APK] Writing to cache...');
  await Filesystem.writeFile({
    path,
    data: base64Data,
    directory: Directory.Cache
  });

  // Get the file URI
  const uri = await Filesystem.getUri({
    directory: Directory.Cache,
    path
  });

  console.log('[APK] Saved to:', uri.uri);
  onProgress?.(100);

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
