import { Directory, Filesystem } from "@capacitor/filesystem";
import { isNativePlatform } from "@/utils/platform";
import { CapacitorHttp, type PluginListenerHandle } from "@capacitor/core";

const MB = (bytes: number) => `${(bytes / 1048576).toFixed(1)}MB`;

/**
 * Ask the server what it intends to send before we pull tens of megabytes onto
 * a TV box, so a truncated transfer can be recognised later.
 *
 * This is ADVISORY ONLY and must never abort the download. It used to throw on
 * any non-2xx, which made the whole update fail whenever the host did not
 * answer HEAD the same way it answers GET — hotlink protection, a WAF, and
 * plain `.apk` files behind some static hosts all commonly return 403/404/405
 * to HEAD while serving the file perfectly over GET. That produced exactly the
 * report "a fresh install from the same link works, the in-app update never
 * does", because a browser or Downloader only ever issues a GET.
 *
 * The GET below is the real test. The status is returned so that if the GET
 * *also* fails, the error can still mention what the server said.
 */
async function preflightApk(url: string): Promise<{ expected: number | null; status: number | null }> {
  try {
    const res = await CapacitorHttp.request({
      url,
      method: 'HEAD',
      connectTimeout: 15000,
      readTimeout: 15000,
    });
    if (res.status < 200 || res.status >= 300) {
      console.warn(`[APK] Preflight HEAD returned ${res.status} — continuing, GET is authoritative`);
      return { expected: null, status: res.status };
    }
    const headers = (res.headers || {}) as Record<string, string>;
    const raw = headers['content-length'] ?? headers['Content-Length'];
    const len = raw ? Number(raw) : NaN;
    const expected = Number.isFinite(len) && len > 0 ? len : null;
    console.log('[APK] Preflight OK, expected size:', expected);
    return { expected, status: res.status };
  } catch (e) {
    // No HEAD support, transient DNS, blocked method — none of these should
    // stop us trying the actual download.
    console.warn('[APK] Preflight inconclusive:', e);
    return { expected: null, status: null };
  }
}

/**
 * Turn the Filesystem plugin's opaque failure into something actionable.
 * The bytes actually written are the key signal: 0 means the transfer never
 * started (blocked/refused), while a partial file means the connection died
 * mid-stream — usually origin throttling or weak device wifi.
 */
async function describeDownloadFailure(
  path: string,
  expectedBytes: number | null,
  error: unknown,
): Promise<string> {
  const base = error instanceof Error ? error.message : 'Native download error';

  let written: number | null = null;
  try {
    const stat = await Filesystem.stat({ path, directory: Directory.Cache });
    written = typeof stat.size === 'number' ? stat.size : null;
  } catch {
    // No partial file at all — nothing was ever written.
    written = 0;
  }

  if (written !== null && expectedBytes) {
    if (written === 0) {
      return `Download failed: no data received (expected ${MB(expectedBytes)}). ${base}`;
    }
    const pct = Math.round((written / expectedBytes) * 100);
    return `Download failed: connection dropped at ${MB(written)} of ${MB(expectedBytes)} (${pct}%). ${base}`;
  }
  if (written) {
    return `Download failed after ${MB(written)}. ${base}`;
  }
  return `Download failed: ${base}`;
}


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

  // Cache-bust the APK URL so Cloudflare / Hostwinds / WebView cache can't
  // hand us yesterday's binary when the publisher just replaced the file.
  try {
    const u = new URL(downloadUrl);
    u.searchParams.set('ts', String(Date.now()));
    downloadUrl = u.toString();
  } catch {
    downloadUrl += (downloadUrl.includes('?') ? '&' : '?') + 'ts=' + Date.now();
  }

  console.log('[APK] Final download URL:', downloadUrl);

  // Report initial progress
  onProgress?.(0);

  // Confirm the server will serve this before committing to the transfer, and
  // remember the advertised size so a truncated download can be identified.
  const { expected: expectedBytes, status: preflightStatus } = await preflightApk(downloadUrl);

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
  
  // Subscribe to native progress events for accurate %
  let progressListener: PluginListenerHandle | undefined;
  try {
    if (onProgress) {
      progressListener = await (Filesystem as any).addListener?.(
        'progress',
        (e: { contentLength?: number; bytes?: number }) => {
          if (e?.contentLength && e.contentLength > 0 && typeof e.bytes === 'number') {
            const pct = Math.min(94, Math.max(5, Math.round((e.bytes / e.contentLength) * 90) + 5));
            onProgress(pct);
          }
        }
      );
    }

    const result = await Filesystem.downloadFile({
      url: downloadUrl,
      path,
      directory: Directory.Cache,
      progress: true,
    });

    console.log('[APK] Download complete, path:', result.path);
    console.log('[APK] Download blob size:', result.blob?.size);

    // A stream that dies cleanly can still land here with a short file, which
    // would otherwise fail much later as an opaque "parse error" in the
    // Android installer. Catch it while we still know what went wrong.
    if (expectedBytes) {
      const stat = await Filesystem.stat({ path, directory: Directory.Cache });
      if (typeof stat.size === 'number' && stat.size < expectedBytes) {
        try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch { /* ignore */ }
        throw new Error(
          `Download incomplete: got ${MB(stat.size)} of ${MB(expectedBytes)}. Check your connection and try again.`,
        );
      }
    }

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
    // Already a specific, actionable message — don't bury it in a second wrapper.
    if (error instanceof Error && error.message.startsWith('Download incomplete')) throw error;
    let msg = await describeDownloadFailure(path, expectedBytes, error);
    // If HEAD was also refused, name the status — it usually IS the cause.
    if (preflightStatus !== null && (preflightStatus < 200 || preflightStatus >= 300)) {
      msg += ` (the server also answered HTTP ${preflightStatus} to a HEAD request for this URL)`;
    }
    throw new Error(msg);
  } finally {
    try { await progressListener?.remove(); } catch {}
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

/**
 * Look for a previously-downloaded APK in the cache. Returns the file URI
 * if found (so we can jump straight to install) or null.
 *
 * Also cleans up any older versioned APKs for the same app (different
 * version number) so the cache doesn't grow forever.
 */
export async function findCachedApk(
  appName: string,
  version?: string
): Promise<string | null> {
  if (!isNativePlatform()) return null;
  const target = generateFileName(appName, version);
  const sanitizedName = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
  try {
    const result = await Filesystem.readdir({
      path: 'apk',
      directory: Directory.Cache,
    });
    let found: string | null = null;
    for (const file of result.files) {
      if (!file.name.endsWith('.apk')) continue;
      // Stale version for the same app — remove it.
      if (file.name.startsWith(`${sanitizedName}-`) && file.name !== target) {
        try {
          await Filesystem.deleteFile({
            path: `apk/${file.name}`,
            directory: Directory.Cache,
          });
        } catch { /* ignore */ }
        continue;
      }
      if (file.name === target) {
        const uri = await Filesystem.getUri({
          directory: Directory.Cache,
          path: `apk/${target}`,
        });
        found = uri.uri;
      }
    }
    return found;
  } catch {
    return null;
  }
}

