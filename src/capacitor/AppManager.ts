import { registerPlugin, Capacitor } from "@capacitor/core";

export interface AppManagerPlugin {
  isInstalled(options: { packageName: string }): Promise<{ installed: boolean }>;
  installApk(options: { filePath: string }): Promise<void>;
  launch(options: { packageName: string }): Promise<void>;
  uninstall(options: { packageName: string }): Promise<void>;
  openAppSettings(options: { packageName: string }): Promise<void>;
}

// Sentinel string callers can match on to show a friendlier toast
// instead of the raw "AppManager plugin not implemented" message.
export const WEB_UNSUPPORTED_MSG =
  "This action only works inside the installed Snow Media Center app on your Android device.";

// Web fallback — used in the browser preview where the native Kotlin
// plugin obviously can't run. We return safe defaults for read-only
// queries and throw a clear, user-readable message for write actions
// so the UI can show a friendly toast (instead of "plugin not implemented").
const webFallback: AppManagerPlugin = {
  async isInstalled() {
    // In the browser we can't see what's installed on the user's TV,
    // so report "not installed" — the device will report the truth.
    console.log('[AppManager] Web preview: isInstalled → false (real check happens on device)');
    return { installed: false };
  },
  async installApk() {
    throw new Error(WEB_UNSUPPORTED_MSG);
  },
  async launch() {
    throw new Error(WEB_UNSUPPORTED_MSG);
  },
  async uninstall() {
    throw new Error(WEB_UNSUPPORTED_MSG);
  },
  async openAppSettings() {
    throw new Error(WEB_UNSUPPORTED_MSG);
  },
};

// Helper so callers can detect "this is just the web fallback" cleanly,
// covering both our friendly message and Capacitor's built-in
// "plugin not implemented" wording.
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
