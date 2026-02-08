import { registerPlugin, Capacitor } from "@capacitor/core";

export interface AppManagerPlugin {
  isInstalled(options: { packageName: string }): Promise<{ installed: boolean }>;
  installApk(options: { filePath: string }): Promise<void>;
  launch(options: { packageName: string }): Promise<void>;
  uninstall(options: { packageName: string }): Promise<void>;
  openAppSettings(options: { packageName: string }): Promise<void>;
}

// Create a web fallback that returns sensible defaults
const webFallback: AppManagerPlugin = {
  async isInstalled() {
    console.log('[AppManager] Web fallback: isInstalled returning false');
    return { installed: false };
  },
  async installApk() {
    console.log('[AppManager] Web fallback: installApk not supported');
    throw new Error('APK installation not supported on web');
  },
  async launch() {
    console.log('[AppManager] Web fallback: launch not supported');
    throw new Error('App launching not supported on web');
  },
  async uninstall() {
    console.log('[AppManager] Web fallback: uninstall not supported');
    throw new Error('App uninstallation not supported on web');
  },
  async openAppSettings() {
    console.log('[AppManager] Web fallback: openAppSettings not supported');
    throw new Error('App settings not supported on web');
  },
};

// Register the plugin with a web fallback
export const AppManager = registerPlugin<AppManagerPlugin>("AppManager", {
  web: webFallback,
});