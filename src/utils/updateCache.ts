import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
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
 * Records the version we last handed to the Android installer.
 *
 * WHY: the cache is keyed on the version STRING, so `snow_media_center_1.7.apk`
 * means "some build that called itself 1.7" and nothing more. If a bad 1.7 is
 * published and then CORRECTED at the same URL, every device that already
 * downloaded the bad one keeps serving it from cache forever — the metadata
 * still matches, so the hit is accepted and the server is never contacted
 * again. Re-uploading a fix cannot reach those devices.
 *
 * We cannot simply delete the file right after installApk(): that call returns
 * as soon as the installer Intent is fired, and the installer still needs to
 * read the file through the FileProvider URI. So instead we leave a marker. If
 * we are still running the OLD version next time an update for that same
 * version is prepared, the previous attempt demonstrably did not take — so the
 * cached bytes are suspect and get thrown away and re-fetched.
 */
const ATTEMPT_KEY = 'smc-update-install-attempt';

async function readAttemptMarker(): Promise<string | null> {
  try { return (await Preferences.get({ key: ATTEMPT_KEY })).value ?? null; } catch { return null; }
}

async function writeAttemptMarker(version: string): Promise<void> {
  try { await Preferences.set({ key: ATTEMPT_KEY, value: version }); } catch { /* ignore */ }
}

export async function clearAttemptMarker(): Promise<void> {
  try { await Preferences.remove({ key: ATTEMPT_KEY }); } catch { /* ignore */ }
}

/** Remove a cached APK by version, so the next prepare re-downloads it. */
export async function deleteCachedApk(version: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path: `apk/${apkFileName(version)}`, directory: Directory.Cache });
  } catch { /* not there — fine */ }
}

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
  // If we already handed this exact version to the installer and we are STILL
  // running, that install did not take. The cached bytes are the prime suspect
  // (wrong signature, corrupt, or a superseded upload at the same URL), so bin
  // them and go back to the server rather than replaying the same failure.
  const lastAttempt = await readAttemptMarker();
  if (lastAttempt === info.version) {
    console.warn(`[update] Previous install of v${info.version} did not take — discarding the cached APK and re-downloading`);
    await deleteCachedApk(info.version);
    await clearAttemptMarker();
  } else {
    const cached = await findCachedSmcApk(info);
    if (cached) {
      onProgress?.(100);
      return cached;
    }
  }
  const fileName = apkFileName(info.version);

  // Two attempts, and the FIRST is byte-identical to the request a browser or
  // Downloader makes — bare URL, no query string. Only if that yields
  // something that is not a parseable APK do we retry with the cache-buster.
  //
  // The validation is the native package parser (getPackageArchiveInfo), and a
  // failure here is now FATAL. It used to be swallowed, which meant a hotlink
  // block page or a 404 body was written to the cache, left apkVersionCode and
  // apkPackageName undefined, sailed past BOTH guards in installPreparedUpdate
  // (they are gated on those very values) and was handed to the Android
  // installer, which silently did nothing. That is exactly the reported
  // "update.json says there's an update but it installs the same old version".
  let lastErr: string | null = null;
  for (const cacheBust of [false, true]) {
    const filePath = await downloadApkToCache(info.downloadUrl, fileName, onProgress, { cacheBust });
    try {
      const apkInfo = await AppManager.getApkInfo({ filePath });
      if (!apkInfo?.packageName) throw new Error('APK has no package name');
      return {
        filePath,
        apkVersionName: apkInfo.versionName,
        apkVersionCode: apkInfo.versionCode,
        apkPackageName: apkInfo.packageName,
        fromCache: false,
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[update] Downloaded file is not a valid APK (cacheBust=${cacheBust}): ${lastErr}`);
      try { await Filesystem.deleteFile({ path: `apk/${fileName}`, directory: Directory.Cache }); } catch { /* ignore */ }
    }
  }
  throw new Error(
    `The update server did not return an installable APK. ${lastErr ?? ''} ` +
    `Open ${info.downloadUrl} in a browser — if it downloads the app, the server is ` +
    `treating this device's request differently (hotlink protection or a bot rule).`,
  );
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
  // Marker BEFORE the hand-off: if the install succeeds this process is
  // replaced and the marker is irrelevant; if it fails we are still here and
  // the next prepare will treat the cached file as suspect.
  if (prepared.apkVersionName) await writeAttemptMarker(prepared.apkVersionName);
  await AppManager.installApk({ filePath: prepared.filePath });
}

export { cleanupOldApks, apkFileName };
