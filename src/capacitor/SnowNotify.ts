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
  /** Alerts are on for this device. Defaults to TRUE on a fresh install. */
  enabled: boolean;
  /**
   * enable() has run at least once here. Until it has, the poll is not armed
   * and the native side has no Supabase credentials — so `enabled && !configured`
   * is the first-launch state the hook auto-enables from, exactly once.
   */
  configured?: boolean;
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
  /** Plex requests from this box: while `pending`, the alert job also asks
   *  whether they have arrived and posts "Now on Plex" when they have. */
  watchRequests(options: { deviceKey: string; pending: boolean }): Promise<void>;
  /**
   * The language picked in SMC ('en' | 'es' | 'fr' | 'de' | 'ar'). The native side keeps it for
   * every text it writes itself (notifications, the news widget, player and billing errors, the
   * speech prompt), because those run while the WebView is not there. Rejects on an app build
   * older than this method: callers ignore that.
   */
  setLanguage(options: { lang: string }): Promise<{ lang?: string }>;
}

const unavailable: SnowNotifyPlugin = {
  status: async () => ({ enabled: false, configured: true, permission: 'denied', channelBlocked: true }),
  enable: async () => ({ enabled: false, configured: true, permission: 'denied' }),
  disable: async () => ({ enabled: false }),
  pollNow: async () => ({ enabled: false }),
  watchRequests: async () => undefined,
  setLanguage: async () => ({}),
};

export const SnowNotify = registerPlugin<SnowNotifyPlugin>('SnowNotify', { web: unavailable });

/** Device alerts only exist on the native Android build. */
export const deviceAlertsSupported = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
