import { afterEach, describe, expect, it } from 'vitest';
import i18n from './index';
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatRelative, formatTime } from './format';

// 2026-09-29 22:30 local time
const D = new Date(2026, 8, 29, 22, 30, 0);
const LANGS = ['en', 'es', 'fr', 'de', 'ar'];

afterEach(async () => { await i18n.changeLanguage('en'); });

describe('format: 12-hour clock and digits 0-9', () => {
  it('English', () => {
    expect(formatTime(D, 'en')).toBe('10:30 PM');
    expect(formatDate(D, 'medium', 'en')).toBe('Sep 29, 2026');
    expect(formatDate(D, 'short', 'en')).toBe('Sep 29');
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatCurrency(4.99, 'USD', 'en')).toBe('$4.99');
  });

  it.each(LANGS)('%s: 12-hour time with 0-9 digits', (lang) => {
    const time = formatTime(D, lang).replace(/[\u2068\u2069]/g, '');
    expect(time).toMatch(/^10[:.]30/);
    expect(time).not.toMatch(/22/); // never 24-hour
    for (const s of [time, formatDate(D, 'medium', lang), formatDateTime(D, lang), formatNumber(1234567, lang)]) {
      expect(s).not.toMatch(/[٠-٩۰-۹]/); // no Arabic-Indic digits
      expect(s).toMatch(/[0-9]/);
    }
  });

  it('Arabic times and dates are bidi-isolated, so they stay whole inside left-to-right screens', () => {
    expect(formatTime(D, 'ar')).toMatch(/^\u2068.*\u2069$/);
    expect(formatDateTime(D, 'ar')).toMatch(/^\u2068.*\u2069$/);
    expect(formatTime(D, 'en')).not.toMatch(/[\u2068\u2069]/);
  });

  it('Arabic uses Arabic words but Latin digits', () => {
    const date = formatDate(D, 'long', 'ar');
    expect(date).toMatch(/[؀-ۿ]/);
    expect(date).toMatch(/2026/);
  });

  it('follows the app language by default', async () => {
    await i18n.changeLanguage('de');
    expect(formatDate(D, 'long')).toBe(formatDate(D, 'long', 'de'));
    expect(formatDate(D, 'long', 'de')).toContain('September');
  });

  it('reuses one formatter and survives bad input', () => {
    expect(formatTime(D, 'en')).toBe(formatTime(D, 'en'));
    expect(formatTime('nonsense')).toBe('');
    expect(formatRelative(NaN)).toBe('');
    expect(formatNumber(NaN)).toBe('');
  });
});

describe('formatRelative', () => {
  const now = new Date(2026, 8, 29, 12, 0, 0).getTime();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('English past and future, singular and plural', () => {
    expect(formatRelative(now - 10_000, now, 'en')).toBe('Just now');
    expect(formatRelative(now - MIN, now, 'en')).toBe('1 minute ago');
    expect(formatRelative(now - 5 * MIN, now, 'en')).toBe('5 minutes ago');
    expect(formatRelative(now - 3 * HOUR, now, 'en')).toBe('3 hours ago');
    expect(formatRelative(now - 2 * DAY, now, 'en')).toBe('2 days ago');
    expect(formatRelative(now - 65 * DAY, now, 'en')).toBe('2 months ago');
    expect(formatRelative(now - 400 * DAY, now, 'en')).toBe('1 year ago');
    expect(formatRelative(now + 2 * HOUR, now, 'en')).toBe('in 2 hours');
    expect(formatRelative(now + DAY, now, 'en')).toBe('in 1 day');
  });

  it.each(['es', 'fr', 'de', 'ar'])('%s: every unit resolves to a real phrase, never a key', async (lang) => {
    await i18n.loadLanguages(lang);
    for (const count of [1, 2, 3, 5, 11, 30]) {
      for (const unit of [MIN, HOUR, DAY, 31 * DAY, 400 * DAY]) {
        for (const sign of [-1, 1]) {
          const s = formatRelative(now + sign * count * unit, now, lang);
          expect(s, `${lang} ${sign * count} x ${unit}`).not.toMatch(/common\.relative/);
          expect(s.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('Arabic keeps 0-9 digits and uses the dual form for two', async () => {
    await i18n.loadLanguages('ar');
    expect(formatRelative(now - 5 * HOUR, now, 'ar')).toBe('منذ 5 ساعات');
    expect(formatRelative(now - 2 * HOUR, now, 'ar')).toBe('منذ ساعتين');
  });

  it('Spanish plural', async () => {
    await i18n.loadLanguages('es');
    expect(formatRelative(now - 5 * MIN, now, 'es')).toBe('hace 5 minutos');
    expect(formatRelative(now - MIN, now, 'es')).toBe('hace 1 minuto');
  });
});

describe('document language', () => {
  it('stays left to right in Arabic, before and after switching', async () => {
    await i18n.changeLanguage('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('ltr');
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('loads a language lazily and translates Home and Settings text', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.t('home.liveTv.title')).toBe('TV en vivo');
    expect(i18n.t('settings.title')).toBe('Ajustes');
  });
});
