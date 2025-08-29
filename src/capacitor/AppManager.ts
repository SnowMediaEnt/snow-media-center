import { registerPlugin } from "@capacitor/core";

export interface AppManagerPlugin {
  isInstalled(options: { packageName: string }): Promise<{ installed: boolean }>;
  installApk(options: { filePath: string }): Promise<void>;
  launch(options: { packageName: string }): Promise<void>;
  uninstall(options: { packageName: string }): Promise<void>;
  openAppSettings(options: { packageName: string }): Promise<void>;
}

export const AppManager = registerPlugin<AppManagerPlugin>("AppManager");