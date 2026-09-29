import type { LanguageCode } from './index';

/**
 * Placeholder for work item 10 (Android native text). index.ts calls this once at start and on
 * every language change, so item 10 only has to fill in the body: save the language for the
 * Kotlin side (SnowNotify.setLanguage), for example with a dynamic import of the plugin so the
 * web bundle and tests stay light. It must never throw.
 */
export function syncNativeLanguage(_lang: LanguageCode): void {
  // Filled in by work item 10.
}
