import { registerPlugin, Capacitor } from "@capacitor/core";

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

export interface AppManagerPlugin {
  isInstalled(options: { packageName: string }): Promise<{ installed: boolean }>;
  getInstalledApps(): Promise<{ apps: InstalledAppInfo[] }>;
  listCachedApks(): Promise<{ files: CachedApkInfo[]; totalBytes: number; count: number }>;
  deleteCachedApk(options: { name: string }): Promise<{ deleted: boolean }>;
  clearOwnCache(): Promise<{ freedBytes: number }>;
  installApk(options: { filePath: string }): Promise<void>;
  launch(options: { packageName: string }): Promise<void>;
  uninstall(options: { packageName: string }): Promise<{ started: boolean; uninstalled?: boolean; cancelled?: boolean; packageName?: string }>;
  openAppSettings(options: { packageName: string }): Promise<void>;
  isAccessibilityEnabled(): Promise<{ enabled: boolean }>;
  openAccessibilitySettings(): Promise<void>;
  /** Auto-taps Storage → Clear cache for the given package via Accessibility Service. */
  clearAppCache(options: { packageName: string }): Promise<void>;
}

export const WEB_UNSUPPORTED_MSG =
  "This action only works inside the installed Snow Media Center app on your Android device.";

const webFallback: AppManagerPlugin = {
  async isInstalled() { return { installed: false }; },
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
  async clearAppCache() { throw new Error(WEB_UNSUPPORTED_MSG); },
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
