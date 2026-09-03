import { registerPlugin, Capacitor } from '@capacitor/core';

/**
 * Device alerts — notifications that reach the viewer when SMC is closed or
 * they are watching something else.
 *
 * The heavy lifting is native (see com.snowmedia.notify): a chain of one-shot
 * WorkManager jobs polls Supabase every five minutes, posts anything new as a
 * high-priority notification, and clears anything that has stopped being
 * active. That last part is what makes an alert vanish from every TV by itself
 * when it is switched off in the hub.
 *
 * Web and non-Android builds get a no-op that always reports "unavailable", so
 * callers never need to branch on the platform.
 */
export interface SnowNotifyStatus {
  /** The viewer has alerts switched on for this device. */
  enabled: boolean;
  /** 'granted' | 'denied' — Android 13+ only; always 'granted' below that. */
  permission: string;
  /** Notifications are off for the whole app in system settings. */
  channelBlocked?: boolean;
}

export interface SnowNotifyPlugin {
  status(): Promise<SnowNotifyStatus>;
  enable(options: { supabaseUrl: string; supabaseKey: string }): Promise<SnowNotifyStatus>;
  disable(): Promise<{ enabled: boolean }>;
  pollNow(): Promise<{ enabled: boolean }>;
}

const unavailable: SnowNotifyPlugin = {
  status: async () => ({ enabled: false, permission: 'denied', channelBlocked: true }),
  enable: async () => ({ enabled: false, permission: 'denied' }),
  disable: async () => ({ enabled: false }),
  pollNow: async () => ({ enabled: false }),
};

export const SnowNotify = registerPlugin<SnowNotifyPlugin>('SnowNotify', { web: unavailable });

/** Device alerts only exist on the native Android build. */
export const deviceAlertsSupported = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
