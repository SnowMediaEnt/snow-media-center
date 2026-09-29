import { Capacitor } from '@capacitor/core';
import type { LanguageCode } from './index';

/**
 * Tells the Android side which language the viewer picked (SnowNotify.setLanguage), so the text it
 * writes itself (notifications, the news widget, player and billing errors, the speech prompt) is
 * in that language and not the box's. index.ts calls this once at start and on every change.
 *
 * Only the Android app has anything to tell: on the web this does nothing. The plugin is loaded
 * with a dynamic import to keep the start light. It never throws: an app build older than
 * setLanguage rejects the call, and the native side then stays in English.
 */
export function syncNativeLanguage(lang: LanguageCode): void {
  try {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    import('@/capacitor/SnowNotify')
      .then(({ SnowNotify }) => SnowNotify.setLanguage({ lang }))
      .catch(() => { /* older app build, or the plugin is not ready: the native text stays as it was */ });
  } catch { /* never let this stop the app starting */ }
}
