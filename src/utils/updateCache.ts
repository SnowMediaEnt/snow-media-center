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

  // 1) Resolve a file URI for the target APK. Prefer Filesystem (that's where
  //    downloadApkToCache writes); fall back to the native plugin listing.
  let filePath: string | null = null;
  try {
    await Filesystem.stat({ directory: Directory.Cache, path: `apk/${target}` });
    const uri = await Filesystem.getUri({
      directory: Directory.Cache,
      path: `apk/${target}`,
    });
    filePath = uri.uri;
  } catch { /* not in Filesystem cache */ }

  if (!filePath) {
    try {
      const listing = await AppManager.listCachedApks();
      const match = listing.files.find((f) => f.name === target);
      if (match?.path) filePath = match.path;
    } catch { /* no plugin listing */ }
  }

  if (!filePath) return null;

  try {
    const apkInfo = await AppManager.getApkInfo({ filePath });
    const codeOk = info.versionCode
      ? !!apkInfo.versionCode && apkInfo.versionCode === info.versionCode
      : true;
    const nameOk = apkInfo.versionName
      ? apkInfo.versionName === info.version
      : true;
    // BOTH must hold. This was `!codeOk && !nameOk`, i.e. either one was
    // enough — and since the cache file is named after the version string, a
    // stale APK with the right name but the wrong versionCode was reused on
    // every retry, so re-downloading could never fix anything.
    if (!codeOk || !nameOk) {
      console.warn(
        `[update] Ignoring cached APK: it reports v${apkInfo.versionName}/${apkInfo.versionCode}, ` +
        `expected v${info.version}/${info.versionCode}`,
      );
      try { await Filesystem.deleteFile({ path: `apk/${target}`, directory: Directory.Cache }); } catch { /* ignore */ }
      return null;
    }
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
    // Android enforces versionCode, and it reads it from the APK's OWN
    // manifest — not from update.json and not from the file name. When those
    // disagree it is almost always because the APK was built from a checkout
    // that predates the version bump, so the file is named for the new release
    // while its manifest still carries the old code. Say all of that, because
    // "not newer than installed" sends you looking in the wrong place.
    throw new Error(
      `The downloaded APK reports versionCode ${prepared.apkVersionCode}` +
      `${prepared.apkVersionName ? ` (v${prepared.apkVersionName})` : ''}, but this ` +
      `device already has ${installed.versionCode}` +
      `${installed.versionName ? ` (v${installed.versionName})` : ''}. ` +
      `Android only installs a HIGHER versionCode over an existing app. ` +
      `The APK on the server was most likely built before the version bump — ` +
      `rebuild it from the current source and re-upload.`,
    );
  }
  await AppManager.installApk({ filePath: prepared.filePath });
}

export { cleanupOldApks, apkFileName };
