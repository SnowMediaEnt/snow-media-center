// The words a parent sees on a Kids profile's AI (AI Chat, the voice bar, the
// profile editor). The server enforces the same limits (_shared/kidsSafe.ts).
// Functions, not constants: the text is looked up when it is drawn, so it
// follows the language.
import i18n from '@/i18n';

export const kidsAiTitle = (): string => i18n.t('ai.kids.title');
export const kidsAiNotice = (): string => i18n.t('ai.kids.notice');
export const kidsAiShort = (): string => i18n.t('ai.kids.short');

// The same for the background maker (Settings → Media). The server rewrites
// or turns down the prompt for the profile's level (_shared/kidsSafe.ts).
export const kidsImageTitle = (): string => i18n.t('ai.kids.imageTitle');
export const kidsImageNotice = (level: 'little' | 'kids' | 'teen'): string =>
  i18n.t(`ai.kids.imageNotice.${level}`);

// Old names, kept so MediaManager.tsx (not part of this item) still compiles.
// It should switch to kidsImageTitle().
export const KIDS_IMAGE_TITLE = 'Kids-safe pictures'; // i18n-ignore
