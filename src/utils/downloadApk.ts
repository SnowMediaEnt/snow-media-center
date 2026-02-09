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

// Convert Uint8Array to base64 in memory-safe chunks for 32-bit devices
// CRITICAL: Must convert the ENTIRE binary data at once, not append chunks independently
function uint8ArrayToBase64(bytes: Uint8Array): string {
  // For 32-bit devices, we need to build the binary string in chunks
  // to avoid stack overflow, then convert to base64 once
  const chunkSize = 8192; // 8KB chunks for string building
  let binaryString = '';
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (let j = 0; j < chunk.length; j++) {
      binaryString += String.fromCharCode(chunk[j]);
    }
  }
  
  return btoa(binaryString);
}

// Download APK with progress - optimized for 32-bit Android/FireTV
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
  
  // Report initial 0% progress
  if (onProgress) {
    onProgress(0);
  }
  
  // Collect all chunks - we need to process the entire binary at once for base64
  // For 32-bit: Use array of chunks, then combine at the end
  const chunks: Uint8Array[] = [];
  let receivedLength = 0;
  let lastReportedProgress = -1;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    chunks.push(value);
    receivedLength += value.length;
    
    // Calculate and report progress during download
    if (onProgress) {
      let progressPercent: number;
      if (totalSize > 0) {
        progressPercent = Math.min(99, Math.round((receivedLength / totalSize) * 100));
      } else {
        progressPercent = Math.min(95, Math.round((receivedLength / estimatedSize) * 100));
      }
      
      // Update every 2% change to reduce UI load
      if (progressPercent >= lastReportedProgress + 2) {
        console.log('[APK] Download progress:', progressPercent, '%');
        onProgress(progressPercent);
        lastReportedProgress = progressPercent;
      }
    }
  }
  
  console.log('[APK] Download complete, received:', receivedLength, 'bytes');
  console.log('[APK] Processing binary data for 32-bit device...');
  
  // Combine all chunks into a single Uint8Array
  // For 32-bit: Do this carefully to avoid memory issues
  const allBytes = new Uint8Array(receivedLength);
  let offset = 0;
  for (const chunk of chunks) {
    allBytes.set(chunk, offset);
    offset += chunk.length;
  }
  
  // Clear chunks array to free memory before base64 conversion
  chunks.length = 0;
  
  console.log('[APK] Converting to base64...');
  
  // Convert to base64 - this is the critical step that must be done correctly
  const base64Data = uint8ArrayToBase64(allBytes);
  
  console.log('[APK] Base64 conversion complete, length:', base64Data.length);
  
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
  
  // Write the complete file at once
  console.log('[APK] Writing file to cache...');
  await Filesystem.writeFile({
    path,
    data: base64Data,
    directory: Directory.Cache
  });
  
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
