import i18n, { getAppLanguage } from './index';

/**
 * Dates, times, numbers, money and "5 minutes ago" in the app's language.
 *
 * Rules that come from the boxes and the owner's answers:
 * - Chrome 66 WebView: only the old Intl.DateTimeFormat / NumberFormat options. No dateStyle,
 *   timeStyle, RelativeTimeFormat, ListFormat, Locale or DisplayNames (the guard tests reject them).
 * - 12-hour clock in every language.
 * - Arabic shows digits 0-9 (channel numbers match the remote's number keys): ar-u-nu-latn.
 * - One formatter per language and kind, kept for reuse (creating one is slow on weak boxes).
 * Every function takes an optional `lang`; by default it is the language shown right now.
 */

type Input = Date | number | string;

const intlLocale = (lang: string): string => (lang === 'ar' ? 'ar-u-nu-latn' : lang);

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();

function dateFormatter(lang: string, kind: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${kind}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(lang), options);
    cache.set(key, f);
  }
  return f as Intl.DateTimeFormat;
}

function numberFormatter(lang: string, kind: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}|${kind}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(intlLocale(lang), options);
    cache.set(key, f);
  }
  return f as Intl.NumberFormat;
}

const toDate = (value: Input): Date => (value instanceof Date ? value : new Date(value));
const valid = (d: Date) => !Number.isNaN(d.getTime());
const currentLang = (lang?: string): string => lang || getAppLanguage();

/** "10:30 PM" */
export function formatTime(value: Input, lang?: string): string {
  const d = toDate(value);
  if (!valid(d)) return '';
  return dateFormatter(currentLang(lang), 'time', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}

export type DateStyle = 'short' | 'medium' | 'long';

/** short "Sep 29", medium "Sep 29, 2026" (default), long "Tuesday, September 29, 2026" */
export function formatDate(value: Input, style: DateStyle = 'medium', lang?: string): string {
  const d = toDate(value);
  if (!valid(d)) return '';
  const options: Intl.DateTimeFormatOptions =
    style === 'short' ? { month: 'short', day: 'numeric' }
    : style === 'long' ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return dateFormatter(currentLang(lang), `date-${style}`, options).format(d);
}

/** "Sep 29, 2026, 10:30 PM" */
export function formatDateTime(value: Input, lang?: string): string {
  const d = toDate(value);
  if (!valid(d)) return '';
  return dateFormatter(currentLang(lang), 'datetime', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

/** 1,234.5 (digits 0-9 in every language, grouping follows the language) */
export function formatNumber(value: number, lang?: string): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return numberFormatter(currentLang(lang), 'number').format(value);
}

/** $4.99 */
export function formatCurrency(value: number, currency = 'USD', lang?: string): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return numberFormatter(currentLang(lang), `currency-${currency}`, { style: 'currency', currency }).format(value);
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * "5 minutes ago" / "in 2 hours" from the plural keys in common.relative.*
 * (Intl.RelativeTimeFormat does not exist on Chrome 66). Under a minute is "Just now",
 * for both past and future. `now` is only for tests.
 */
export function formatRelative(value: Input, now: Input = Date.now(), lang?: string): string {
  const d = toDate(value);
  const ref = toDate(now);
  if (!valid(d) || !valid(ref)) return '';
  const diff = d.getTime() - ref.getTime();
  const past = diff <= 0;
  const ms = Math.abs(diff);
  const lng = currentLang(lang);
  const key = (unit: string, count: number) =>
    i18n.t(`common.relative.${past ? `${unit}Ago` : `in${unit[0].toUpperCase()}${unit.slice(1)}`}`, { count, lng });

  if (ms < MINUTE) return i18n.t('common.relative.justNow', { lng });
  if (ms < HOUR) return key('minutes', Math.floor(ms / MINUTE));
  if (ms < DAY) return key('hours', Math.floor(ms / HOUR));
  if (ms < MONTH) return key('days', Math.floor(ms / DAY));
  if (ms < YEAR) return key('months', Math.floor(ms / MONTH));
  return key('years', Math.floor(ms / YEAR));
}

