import { Directory, Filesystem } from '@capacitor/filesystem';
import { isNativePlatform } from '@/utils/platform';
import { AppManager } from '@/capacitor/AppManager';
import { downloadApkToCache, cleanupOldApks } from '@/utils/downloadApk';

export interface SmcUpdateInfo {
  version: string;
  versionCode?: number;
  downloadUrl: string;
}

export interface PreparedUpdate {
  filePath: string;
  apkVersionName?: string;
  apkVersionCode?: number;
  apkPackageName?: string;
  fromCache: boolean;
}

const apkFileName = (version: string) => `snow_media_center_${version}.apk`;

/**
 * Look for a previously-downloaded SMC APK in the cache that matches the
 * target versionCode (or versionName, as a fallback). Returns a file URI
 * suitable for AppManager.installApk, or null if nothing usable is cached.
 */
export async function findCachedSmcApk(info: SmcUpdateInfo): Promise<PreparedUpdate | null> {
  if (!isNativePlatform()) return null;
  const target = apkFileName(info.version);
  try {
    const listing = await AppManager.listCachedApks();
    const match = listing.files.find((f) => f.name === target);
    if (!match) return null;

    let filePath = match.path;
    if (!filePath || !filePath.startsWith('file:') && !filePath.startsWith('content:')) {
      try {
        const uri = await Filesystem.getUri({
          directory: Directory.Cache,
          path: `apk/${target}`,
        });
        filePath = uri.uri;
      } catch { /* keep raw path */ }
    }

    try {
      const apkInfo = await AppManager.getApkInfo({ filePath });
      // Only trust the cached APK if it actually advertises the right version.
      const codeOk = info.versionCode
        ? !!apkInfo.versionCode && apkInfo.versionCode === info.versionCode
        : true;
      const nameOk = apkInfo.versionName
        ? apkInfo.versionName === info.version
        : true;
      if (!codeOk && !nameOk) return null;
      return {
        filePath,
        apkVersionName: apkInfo.versionName,
        apkVersionCode: apkInfo.versionCode,
        apkPackageName: apkInfo.packageName,
        fromCache: true,
      };
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Ensure the APK for `info` is available on local cache, downloading it if
 * necessary. Reuses an existing cached APK that matches versionCode.
 */
export async function prepareSmcUpdate(
  info: SmcUpdateInfo,
  onProgress?: (pct: number) => void,
): Promise<PreparedUpdate> {
  if (!isNativePlatform()) {
    throw new Error('APK downloads are only available on Android devices');
  }
  const cached = await findCachedSmcApk(info);
  if (cached) {
    onProgress?.(100);
    return cached;
  }
  const fileName = apkFileName(info.version);
  const filePath = await downloadApkToCache(info.downloadUrl, fileName, onProgress);
  let apkInfo: { versionName?: string; versionCode?: number; packageName?: string } = {};
  try {
    apkInfo = await AppManager.getApkInfo({ filePath });
  } catch { /* ignore - install will surface real errors */ }
  return {
    filePath,
    apkVersionName: apkInfo.versionName,
    apkVersionCode: apkInfo.versionCode,
    apkPackageName: apkInfo.packageName,
    fromCache: false,
  };
}

/**
 * Final-stage guard before handing off to the Android package installer.
 * - APK packageName must match the installed app (same signing identity is
 *   then enforced by Android itself at install time).
 * - APK versionCode must be strictly greater than the installed versionCode.
 */
export async function installPreparedUpdate(prepared: PreparedUpdate): Promise<void> {
  const installed = await AppManager.getAppInfo({});
  if (
    prepared.apkPackageName &&
    installed.packageName &&
    prepared.apkPackageName !== installed.packageName
  ) {
    throw new Error(
      `Downloaded APK is for ${prepared.apkPackageName}, not ${installed.packageName}`,
    );
  }
  if (
    prepared.apkVersionCode &&
    installed.versionCode &&
    prepared.apkVersionCode <= installed.versionCode
  ) {
    throw new Error(
      `Downloaded APK is not newer than installed v${installed.versionName || installed.versionCode}.`,
    );
  }
  await AppManager.installApk({ filePath: prepared.filePath });
}

export { cleanupOldApks, apkFileName };
