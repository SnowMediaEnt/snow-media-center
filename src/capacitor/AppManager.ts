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
  installApk(options: { filePath: string }): Promise<void>;
  launch(options: { packageName: string }): Promise<void>;
  uninstall(options: { packageName: string }): Promise<void>;
  openAppSettings(options: { packageName: string }): Promise<void>;
}

export const WEB_UNSUPPORTED_MSG =
  "This action only works inside the installed Snow Media Center app on your Android device.";

const webFallback: AppManagerPlugin = {
  async isInstalled() {
    console.log('[AppManager] Web preview: isInstalled → false (real check happens on device)');
    return { installed: false };
  },
  async getInstalledApps() {
    console.log('[AppManager] Web preview: getInstalledApps → [] (real check happens on device)');
    return { apps: [] };
  },
  async listCachedApks() {
    console.log('[AppManager] Web preview: listCachedApks → empty (no APK cache in browser)');
    return { files: [], totalBytes: 0, count: 0 };
  },
  async deleteCachedApk() {
    return { deleted: false };
  },
  async installApk() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async launch() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async uninstall() { throw new Error(WEB_UNSUPPORTED_MSG); },
  async openAppSettings() { throw new Error(WEB_UNSUPPORTED_MSG); },
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
