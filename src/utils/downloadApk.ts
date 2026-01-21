import { Directory, Filesystem } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";

export async function downloadApkToCache(url: string, filename: string, onProgress?: (progress: number) => void): Promise<string> {
  try {
    // On native platform, fetch directly (no CORS issues)
    // On web, we can't download APKs anyway
    if (!Capacitor.isNativePlatform()) {
      throw new Error('APK downloads are only available on Android devices');
    }

    console.log('Starting APK download from:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.android.package-archive,*/*',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }
    
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
  } catch (error) {
    console.error('APK download failed:', error);
    throw new Error(`Failed to download APK: ${error}`);
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