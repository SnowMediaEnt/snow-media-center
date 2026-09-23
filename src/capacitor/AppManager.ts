import { registerPlugin, Capacitor, type PluginListenerHandle } from "@capacitor/core";

export interface InstalledAppInfo {
  packageName: string;
  appName: string;
  versionName: string;
  versionCode: number;
  isLaunchable: boolean;
}

export interface CachedApkInfo {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: number;
}

/** Storage and memory as the system reports them, for the cleaner's headline. */
export interface DeviceStorageInfo {
  totalBytes: number;
  freeBytes: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  lowMemory: boolean;
}

/** One third-party app as the cleaner sees it. Sizes are -1 and lastUsedAt is
 *  0 when the device has not granted usage access, which is a normal state. */
export interface DeviceAppInfo {
  packageName: string;
  appName: string;
  isLaunchable: boolean;
  /** Package that installed it: a store id, or "" for a sideload. */
  installer: string;
  installedAt: number;
  updatedAt: number;
  lastUsedAt: number;
  appBytes: number;
  dataBytes: number;
  cacheBytes: number;
}

export interface CacheClearProgress {
  packageName: string;
  status: 'cleared' | 'skipped';
  done: number;
  total: number;
}

export interface CacheClearDone {
  done: number;
  total: number;
}

export interface AppPackageInfo {
  installed?: boolean;
  packageName: string;
  appName?: string;
  versionName: string;
  versionCode: number;
}

export interface AppManagerPlugin {
  isInstalled(options: { packageName: string }): Promise<{ installed: boolean }>;
  getAppInfo(options?: { packageName?: string }): Promise<AppPackageInfo>;
  getApkInfo(options: { filePath: string }): Promise<AppPackageInfo>;
  getInstalledApps(): Promise<{ apps: InstalledAppInfo[] }>;
  listCachedApks(): Promise<{ files: CachedApkInfo[]; totalBytes: number; count: number }>;
  deleteCachedApk(options: { name: string }): Promise<{ deleted: boolean }>;
  clearOwnCache(): Promise<{ freedBytes: number }>;
  installApk(options: { filePath: string }): Promise<void>;
  launch(options: { packageName: string }): Promise<void>;
  uninstall(options: { packageName: string }): Promise<{ started: boolean; uninstalled?: boolean; cancelled?: boolean; packageName?: string }>;
  openAppSettings(options: { packageName: string; appName?: string }): Promise<void>;
  isAccessibilityEnabled(): Promise<{ enabled: boolean }>;
  openAccessibilitySettings(): Promise<void>;
  /** Opens the system's own installed-apps list (on Fire TV: Manage Installed
   *  Applications, where each app has its Clear cache). `opened` is false when
   *  the box has no such screen. */
  openManageApps(): Promise<{ opened: boolean }>;
  /** Auto-taps Storage → Clear cache for the given package via Accessibility Service. */
  clearAppCache(options: { packageName: string }): Promise<void>;
  /** Opens a URL with Android ACTION_VIEW, optionally targeting a specific package. */
  openUrl(options: { url: string; packageName?: string }): Promise<void>;
  /** Checks whether Android has a speech recognizer service installed. */
  isSpeechRecognitionAvailable(): Promise<{ available: boolean }>;
  /** Opens native Android speech input and returns the recognized text. */
  startVoiceInput(options?: { prompt?: string }): Promise<{ text: string }>;
  /** Cancels any pending native speech input session. */
  cancelVoiceInput(): Promise<void>;
  /** Phone remote: press a remote key (Android KeyEvent code) as the box's own remote would. */
  injectKey(options: { keyCode: number }): Promise<void>;

  // ---- Device Cleaner ----
  /** Free and total space on the data partition, plus memory. */
  getStorageInfo(): Promise<DeviceStorageInfo>;
  /** Whether the device has granted usage access (needed for sizes and last-used). */
  hasUsageAccess(): Promise<{ enabled: boolean }>;
  /** Opens the usage-access screen. `opened: false` means this device has none. */
  openUsageAccessSettings(): Promise<{ opened: boolean }>;
  /** Every third-party app with what the cleaner needs to judge it. */
  getDeviceApps(): Promise<{ apps: DeviceAppInfo[]; usageAccess: boolean }>;
  /** Asks the system to drop every third-party app's background processes. */
  closeBackgroundApps(): Promise<{ asked: number; freedMemoryBytes: number; freeMemoryBytes: number; totalMemoryBytes: number }>;
  /** Clears the cache of many apps in one run. Rejects with ACCESSIBILITY_DISABLED
   *  when the service is off and the device is not rooted. */
  clearCacheForApps(options: { packages: string[] }): Promise<{ method: 'root' | 'accessibility'; queued: number; rootCleared: number }>;
  /** Stops a queued cache-clear run after the app that is on screen. */
  cancelCacheClear(): Promise<void>;
  addListener(
    eventName: 'cacheClearProgress',
    listener: (data: CacheClearProgress) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'cacheClearDone',
    listener: (data: CacheClearDone) => void,
  ): Promise<PluginListenerHandle>;

}

export const WEB_UNSUPPORTED_MSG =
  "This action only works inside the installed Snow Media Center app on your Android device.";

const webFallback: AppManagerPlugin = {
  async isInstalled() { return { installed: false }; },
  async getAppInfo() { return { installed: false, packageName: '', versionName: '', versionCode: 0 }; },
  async getApkInfo() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async getInstalledApps() { return { apps: [] }; },
  async listCachedApks() { return { files: [], totalBytes: 0, count: 0 }; },
  async deleteCachedApk() { return { deleted: false }; },
  async clearOwnCache() { return { freedBytes: 0 }; },
  async installApk() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async launch() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async uninstall() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async openAppSettings() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async isAccessibilityEnabled() { return { enabled: false }; },
  async openAccessibilitySettings() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async openManageApps() { return { opened: false }; },
  async clearAppCache() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async openUrl({ url }) { window.open(url, '_blank', 'noopener,noreferrer'); },
  async isSpeechRecognitionAvailable() { return { available: false }; },
  async startVoiceInput() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async cancelVoiceInput() { /* no-op on web */ },
  async injectKey() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async getStorageInfo() { return { totalBytes: 0, freeBytes: 0, totalMemoryBytes: 0, freeMemoryBytes: 0, lowMemory: false }; },
  async hasUsageAccess() { return { enabled: false }; },
  async openUsageAccessSettings() { return { opened: false }; },
  async getDeviceApps() { return { apps: [], usageAccess: false }; },
  async closeBackgroundApps() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async clearCacheForApps() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async cancelCacheClear() { /* no-op on web */ },
  async addListener() { return { remove: async () => { /* no-op */ } } as PluginListenerHandle; },
};


export function isWebUnsupportedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg === WEB_UNSUPPORTED_MSG ||
    /not implemented/i.test(msg) ||
    /not available/i.test(msg)
  );
}

export const AppManager = registerPlugin<AppManagerPlugin>("AppManager", {
  web: webFallback,
});
