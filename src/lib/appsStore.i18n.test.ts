import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { retiredAppMessage } from '@/lib/retiredApps';
import { durationText, quoteSetup, type StoreProduct, type TextRef } from '@/lib/store';
import { phoneKindKey } from '@/lib/phoneRemote';

const text = (x: string | TextRef) => (typeof x === 'string' ? x : i18n.t(x.key, x.params));

const plan = (slug: string): StoreProduct => ({
  id: slug, name: slug, slug, description: null, features: [], price: 10, currency: 'USD', category: 'plan',
  image_url: null, featured: false, sort: 0,
  variants: [{ label: '12 months', price: 100, choices: { duration: '12 months', connections: '2' } }],
});

afterEach(() => { void i18n.changeLanguage('en'); });

describe('Main Apps / Store / Phone remote text', () => {
  it('names the app and where it went, in the language shown', async () => {
    const info = { where: 'Live TV', screen: 'live_tv' } as const;
    expect(retiredAppMessage('VibezTV', info)).toContain('Plex is in Plex');
    await i18n.changeLanguage('es');
    const es = retiredAppMessage('VibezTV', info);
    expect(es).toContain('VibezTV');
    expect(es).toContain('TV en vivo');
    expect(es).not.toContain('We no longer');
  });

  it('shows catalog durations in the language, and anything else as it is', async () => {
    expect(text(durationText('12 months'))).toBe('12 months');
    expect(text(durationText('1 month'))).toBe('1 month');
    await i18n.changeLanguage('de');
    expect(text(durationText('12 months'))).toBe('12 Monate');
    expect(text(durationText('1 month'))).toBe('1 Monat');
    await i18n.changeLanguage('ar');
    expect(text(durationText('2 months'))).toBe('شهران');
    expect(durationText('Lifetime')).toBe('Lifetime');
  });

  it('keeps the quote lines as text keys, so they follow a language change', async () => {
    const quote = quoteSetup({ service: 'vibeztv', plan: plan('vibeztv'), connections: null, duration: '12 months', device: null, model: null });
    const plex = quote.lines.find((l) => l.name === 'PLEX')!;
    expect(text(plex.detail!)).toBe('Included free');
    await i18n.changeLanguage('fr');
    expect(text(plex.detail!)).toBe('Inclus gratuitement');
  });

  it('gives every phone kind the server can send a text, and an unknown one the plain "phone"', async () => {
    for (const kind of ['An iPhone', 'An iPad', 'An Android phone', 'An Android tablet', 'A phone or computer', 'A phone']) {
      expect(i18n.exists(phoneKindKey(kind)), kind).toBe(true);
    }
    expect(i18n.t(phoneKindKey('An iPhone'))).toBe('An iPhone');
    await i18n.changeLanguage('de');
    expect(i18n.t(phoneKindKey('An Android phone'))).toBe('Ein Android-Handy');
  });
});
