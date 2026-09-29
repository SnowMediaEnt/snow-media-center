import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import i18n from '@/i18n';

// Home, popups and the updater in another language: the parts that are not plain
// t('key') calls (rich text, plurals, a clock, markers that become text).
vi.mock('@/hooks/useUpdateCheck', () => ({ useUpdateCheck: () => ({ updateAvailable: true, latestVersion: '9.9.9' }) }));
vi.mock('@/utils/pausableInterval', () => ({ setPausableInterval: () => () => {} }));
vi.mock('@/utils/network', () => ({ robustFetch: () => new Promise(() => {}) }));
vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: '1.8.0', versionCode: 180, isLoading: false }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

import HomeClock from './HomeClock';
import NewsTicker from './NewsTicker';
import AppAlertDialog from './AppAlertDialog';
import PreEventStepsDialog from './PreEventStepsDialog';
import WelcomePopup from './WelcomePopup';
import { DEFAULT_PRE_EVENT_HEADLINE } from '@/hooks/usePreEventAlert';

const inLang = async (lng: string) => { await act(async () => { await i18n.changeLanguage(lng); }); };

afterEach(async () => {
  vi.useRealTimers();
  await inLang('en');
});

describe('HomeClock', () => {
  it('shows the weekday, date and 12-hour time with seconds, in the language shown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 21, 5, 3));
    const { container, unmount } = render(<HomeClock version="1.8.0" />);
    expect(container.textContent).toContain('Tue, Sep 29');
    expect(container.textContent).toContain('09:05:03 PM');
    expect(screen.getByRole('button').getAttribute('title')).toBe('Update available: v9.9.9');
    unmount();

    vi.useRealTimers();
    await inLang('ar');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 21, 5, 3));
    const ar = render(<HomeClock version="1.8.0" />);
    // Arabic words, but the digits stay 0-9 (they match the remote's number keys).
    expect(ar.container.textContent).toMatch(/09:05:03/);
    expect(ar.container.textContent).not.toMatch(/[٠-٩]/);
    expect(screen.getByRole('button').getAttribute('title')).toBe('تحديث متاح: v9.9.9');
  });
});

describe('NewsTicker frame', () => {
  it('says it is loading, in the language shown, until the feed answers', async () => {
    localStorage.clear();
    const { container, unmount } = render(<NewsTicker />);
    expect(container.textContent).toContain('Loading news feed...');
    expect(container.textContent).toContain('LIVE');
    unmount();
    await inLang('es');
    const es = render(<NewsTicker />);
    expect(es.container.textContent).toContain('Cargando noticias...');
    expect(es.container.textContent).toContain('EN VIVO');
  });
});

describe('AppAlertDialog', () => {
  it('bolds the app name inside a translated sentence', async () => {
    await inLang('es');
    render(<AppAlertDialog alert={{ id: '1', app_match: 'x', title: 'T', message: 'M', severity: 'info', active: true, source: 's', created_at: '', updated_at: '' }} appName="Plex" open onDismiss={() => {}} onContinue={() => {}} />);
    const strong = document.querySelector('strong');
    expect(strong?.textContent).toBe('Plex');
    expect(strong?.parentElement?.textContent).toBe('Aviso sobre Plex:');
    expect(screen.getByText('Continuar de todos modos')).toBeTruthy();
  });
});

describe('PreEventStepsDialog', () => {
  it('shows the five steps in the language shown, and the stock headline translated', async () => {
    await inLang('fr');
    render(<PreEventStepsDialog open headline={DEFAULT_PRE_EVENT_HEADLINE} onDismiss={() => {}} />);
    expect(screen.getByText(/PPV ce soir/)).toBeTruthy();
    expect(screen.getByText('Redémarrez le routeur et l\'appareil')).toBeTruthy();
    expect(document.querySelectorAll('ol li').length).toBe(5);
  });

  it('keeps a headline the admin wrote', () => {
    render(<PreEventStepsDialog open headline="UFC 300 tonight" onDismiss={() => {}} />);
    expect(screen.getByText('UFC 300 tonight')).toBeTruthy();
  });
});

describe('WelcomePopup', () => {
  it('turns the account note into one translated sentence with the site in bold', async () => {
    localStorage.clear();
    await inLang('de');
    render(<WelcomePopup />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Willkommen bei Snow Media Center')).toBeTruthy();
    const strong = document.querySelector('strong');
    expect(strong?.textContent).toBe('snowmediaent.com');
    expect(strong?.parentElement?.textContent).toMatch(/^Melde dich mit deinem Konto von snowmediaent\.com an/);
  });
});

describe('service alert wording', () => {
  it('counts days with the right plural in each language', async () => {
    const t = (lng: string, count: number) => i18n.t('popups.serviceAlert.soonMsg', { name: 'Vibez', count, lng });
    expect(t('en', 5)).toBe('Vibez expires in 5 days. Renew it from Dashboard before it lapses.');
    expect(i18n.t('popups.serviceAlert.expiredMsg', { name: 'Vibez', count: 1, lng: 'en' })).toBe('Vibez expired 1 day ago. Renew before continuing.');
    await inLang('ar');
    expect(t('ar', 2)).toContain('يومين');
    expect(t('ar', 5)).toContain('5 أيام');
    expect(t('ar', 15)).toContain('15 يومًا');
    await inLang('es');
    expect(t('es', 1)).toContain('1 día');
    expect(t('es', 5)).toContain('5 días');
  });
});
