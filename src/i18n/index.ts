import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ar from './locales/ar.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', nativeName: 'English' },
  { code: 'es', nativeName: 'Español' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'ar', nativeName: 'العربية' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const LANG_STORAGE_KEY = 'smc_lang';
const RTL_LANGS = new Set(['ar']);

const getInitialLang = (): LanguageCode => {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY) as LanguageCode | null;
    if (stored && SUPPORTED_LANGUAGES.some((l) => l.code === stored)) return stored;
  } catch { /* ignore */ }
  return 'en';
};

const applyDocumentLang = (lng: string) => {
  try {
    const html = document.documentElement;
    html.lang = lng;
    html.dir = RTL_LANGS.has(lng) ? 'rtl' : 'ltr';
  } catch { /* ignore */ }
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      ar: { translation: ar },
    },
    lng: getInitialLang(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });

applyDocumentLang(i18n.language);

i18n.on('languageChanged', (lng) => {
  try { localStorage.setItem(LANG_STORAGE_KEY, lng); } catch { /* ignore */ }
  applyDocumentLang(lng);
});

export default i18n;
