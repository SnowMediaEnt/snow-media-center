import { Directory, Filesystem } from "@capacitor/filesystem";
import { Http } from "@capacitor-community/http";

export async function downloadApkToCache(url: string, filename: string): Promise<string> {
  try {
    // Use Filesystem API instead of Http for better compatibility
    const response = await fetch(url);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    const path = `apk/${filename}`;
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache
    });
    
    const uri = await Filesystem.getUri({
      directory: Directory.Cache,
      path
    });
    
    return uri.uri; // return URI for installer
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