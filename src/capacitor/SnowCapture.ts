import { registerPlugin, Capacitor } from '@capacitor/core';

/**
 * Screen capture, for attaching what the customer is looking at to a support
 * ticket.
 *
 * Native only. Video cannot be captured — the player draws on its own surface
 * beneath the app window, so a capture taken during playback has a black
 * rectangle where the picture is. Everything support actually needs to see
 * (menus, errors, the Plex grid, Settings) captures fine.
 */
export interface SnowCaptureResult {
  /** JPEG bytes, base64, no data: prefix. */
  base64: string;
  mime: string;
  bytes: number;
}

export interface SnowCapturePlugin {
  captureScreen(options?: { quality?: number; maxWidth?: number }): Promise<SnowCaptureResult>;
  isAvailable(): Promise<{ available: boolean }>;
}

const unavailable: SnowCapturePlugin = {
  captureScreen: async () => { throw new Error('Screen capture is only available in the app.'); },
  isAvailable: async () => ({ available: false }),
};

export const SnowCapture = registerPlugin<SnowCapturePlugin>('SnowCapture', { web: unavailable });

export const screenCaptureSupported = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
