/**
 * SMC translations. Read this before you touch any text.
 *
 * CONVENTIONS (every work item follows these)
 *
 * Files
 * - One file per area and language: src/i18n/locales/<lang>/<area>.json for en, es, fr, de, ar.
 *   The single top-level key equals the area name ("plex.json" starts with { "plex": { ... } }).
 *   The builder below loads every file and merges them into one `translation` namespace, so
 *   call sites stay t('plex.detail.play'). New area = 5 new files, all with the same keys
 *   (src/i18n/locales.parity.test.ts fails otherwise). Never edit another item's area files.
 * - locales/<lang>.json (no folder) holds only `games.*` for the Game Lounge. Do not touch it.
 * - `common.*` is for true universals only (OK, Cancel, Back, Close, Retry, Save, Delete, Yes, No,
 *   Loading, Try again, Sign in/out, relative time). Do not add to it; put text in your own area.
 * - Fixed wording (Live TV, Guide, Favorites, Record, Rewind, Settings, ...) and the words that stay
 *   in English (Snow Media, Plex, 4K, ...) are in src/i18n/glossary.json. Use them.
 *
 * Keys
 * - <area>.<screen>.<element> in camelCase: plex.detail.playBtn, live.player.channelLabel.
 * - Toasts: <area>.toast.<name>Title and <area>.toast.<name>Desc. Errors: <area>.errors.<code>.
 * - Short button, tab and chip labels end in Btn, Tab or Chip. They get a length budget
 *   (English x 1.4 + 4 characters) so they fit on a 960x540 TV. Write them short in every language.
 * - Plurals: <key>_one and <key>_other, called with t(key, { count }). es and fr also need _many
 *   (copy of _other). ar needs _zero, _one, _two, _few, _many and _other.
 * - Values are inserted as {{name}}. Format numbers and dates first (format.ts), pass the string.
 *
 * Writing text
 * - English is moved over word for word, so the existing English tests keep passing.
 * - Never build a sentence from fragments ("Delete " + name + "?"). One key, with {{name}}.
 *   For bold text or links inside a sentence use <Trans> with numbered tags.
 * - Dates, times, numbers, money and "5 minutes ago": use src/i18n/format.ts, never
 *   toLocaleString, toLocaleDateString, date-fns formatDistanceToNow or raw Intl.
 *   Chrome 66 has no Intl.RelativeTimeFormat, ListFormat, DisplayNames, Locale or dateStyle/timeStyle.
 * - Never compare translated text, store it, or use it as an analytics name or storage value.
 *
 * Where to call t()
 * - Components: const { t } = useTranslation().
 * - Never call t() at module top level (constant arrays, module-level objects): it runs once and
 *   goes stale when the language changes. Store a `labelKey: 'area.screen.element'` and call
 *   t(item.labelKey) when drawing. Translate in the parent of long virtual lists, not per row.
 * - lib/ and hooks (no React): import i18n from '@/i18n' and call i18n.t('key') at the moment of use.
 * - A function whose result is stored (state, cache, storage) returns { key, params }, and the
 *   screen calls t(key, params) when it shows it.
 *
 * Guards
 * - Add src/i18n/guard/covered/<item>.txt (one file per item, e.g. live.txt) listing the files and
 *   folders you converted, one path per line ("#" starts a comment). hardcoded.guard.test.ts then
 *   fails on any leftover English in JSX text, label/placeholder/aria-label/title props and toast
 *   title/description in them. Mark an intended exception with an "i18n-ignore" comment on the
 *   same or the previous line.
 *
 * LOADING
 * - English is bundled. Another language (and its games.*) is loaded from the APK before the
 *   first render (main.tsx awaits i18nReady, giving up after 1.5 s and showing English). Changing
 *   language later loads the files first, then switches, so Home and Settings update live.
 * - English is the default. The choice is kept in localStorage under smc_lang.
 * - Arabic is text only: the page stays left to right (dir="ltr" always). Only lang changes.
 */
import i18n from 'i18next';
import type { BackendModule } from 'i18next';
import { initReactI18next } from 'react-i18next';

import enGames from './locales/en.json';
import { syncNativeLanguage } from './nativeLanguage';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', nativeName: 'English' },
  { code: 'es', nativeName: 'Español' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'ar', nativeName: 'العربية' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const LANG_STORAGE_KEY = 'smc_lang';

type Json = { [key: string]: unknown };

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge of `from` into `into`. Area files have different top keys, so nothing is overwritten. */
export function mergeDeep(into: Json, from: Json): Json {
  for (const key of Object.keys(from)) {
    const value = from[key];
    const current = into[key];
    into[key] = isObject(value) && isObject(current) ? mergeDeep(current, value) : value;
  }
  return into;
}

// English: every area file, bundled with the app.
const enAreas = import.meta.glob<Json>('./locales/en/*.json', { eager: true, import: 'default' });
// The other four: one loader per file, run only for the language in use.
const areaLoaders = import.meta.glob<Json>('./locales/{es,fr,de,ar}/*.json', { import: 'default' });
const gamesLoaders = import.meta.glob<Json>('./locales/{es,fr,de,ar}.json', { import: 'default' });

const en = Object.keys(enAreas)
  .sort()
  .reduce<Json>((all, path) => mergeDeep(all, enAreas[path]), mergeDeep({}, enGames as Json));

/** Loads and merges every area file of one non-English language, plus its games.* file. */
async function loadLanguage(lng: string): Promise<Json> {
  const paths = [
    ...Object.keys(gamesLoaders).filter((p) => p === `./locales/${lng}.json`),
    ...Object.keys(areaLoaders).filter((p) => p.startsWith(`./locales/${lng}/`)).sort(),
  ];
  const files = await Promise.all(paths.map((p) => (gamesLoaders[p] || areaLoaders[p])()));
  return files.reduce<Json>((all, file) => mergeDeep(all, file), {});
}

const lazyBackend: BackendModule = {
  type: 'backend',
  init: () => {},
  read: (lng: string, _ns: string) => loadLanguage(lng),
} as unknown as BackendModule;

const isSupported = (code: unknown): code is LanguageCode =>
  SUPPORTED_LANGUAGES.some((l) => l.code === code);

const getInitialLang = (): LanguageCode => {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (isSupported(stored)) return stored;
  } catch { /* ignore */ }
  return 'en';
};

/** The language the app is showing now: one of the five codes, English if unsure. */
export function getAppLanguage(): LanguageCode {
  const current = (i18n.language || '').slice(0, 2);
  return isSupported(current) ? current : 'en';
}

// Arabic changes the text only. The layout, menus and arrow keys never flip.
const applyDocumentLang = (lng: string) => {
  try {
    const html = document.documentElement;
    html.lang = lng;
    html.dir = 'ltr';
  } catch { /* ignore */ }
};

/** Resolves when the chosen language is loaded (English is always ready). */
export const i18nReady: Promise<unknown> = i18n
  .use(lazyBackend)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    lng: getInitialLang(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
    // Tests need a synchronous start; the app loads its language before first render.
    initAsync: import.meta.env.MODE !== 'test',
  })
  .catch(() => undefined);

applyDocumentLang(i18n.language);
syncNativeLanguage(getAppLanguage());

i18n.on('languageChanged', (lng) => {
  try { localStorage.setItem(LANG_STORAGE_KEY, lng); } catch { /* ignore */ }
  applyDocumentLang(lng);
  syncNativeLanguage(getAppLanguage());
});

export default i18n;
