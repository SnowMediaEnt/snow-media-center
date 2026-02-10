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

// Download APK using native Filesystem.downloadFile (bypasses CORS entirely)
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

  // Report initial progress
  onProgress?.(0);

  // Ensure apk directory exists
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

  onProgress?.(5);

  // Use Filesystem.downloadFile - this makes a NATIVE HTTP request
  // completely bypassing the WebView's CORS restrictions
  console.log('[APK] Using native Filesystem.downloadFile...');
  
  try {
    const result = await Filesystem.downloadFile({
      url: downloadUrl,
      path,
      directory: Directory.Cache,
      progress: true,
    });

    console.log('[APK] Download complete, path:', result.path);
    console.log('[APK] Download blob size:', result.blob?.size);
    
    onProgress?.(95);

    // Get the file URI
    const uri = await Filesystem.getUri({
      directory: Directory.Cache,
      path
    });

    console.log('[APK] Saved to:', uri.uri);
    onProgress?.(100);

    return uri.uri;
  } catch (error) {
    console.error('[APK] Native download failed:', error);
    throw new Error(`Download failed: ${error instanceof Error ? error.message : 'Native download error'}`);
  }
}

export function generateFileName(appName: string, version?: string): string {
  const sanitizedName = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${sanitizedName}-${version || 'latest'}.apk`;
}

export function generatePackageName(appName: string): string {
  const sanitizedName = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `com.${sanitizedName}.app`;
}
