// The app's language reaches Plex as X-Plex-Language on API calls only (the server then names its
// own rows in it). Stream URLs stay exactly as they were, and the few words plex.ts writes itself
// follow the language too.
import { afterEach, describe, expect, it, vi } from 'vitest';

// Not native: plexReq goes through fetch, which the header test captures.
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false }, CapacitorHttp: {}, registerPlugin: () => ({}) }));

import i18n from '@/i18n';
import { SCREEN_FORMATS } from '@/capacitor/SnowPlayer';
import {
  getPlexServers, plexDirectUrl, plexRouteLabel, plexTranscodeUrl, PLEX_QUALITY_PRESETS,
} from './plex';

const BASE = 'https://203-0-113-5.abc123.plex.direct:32400';
const PART = '/library/parts/7/1700000000/file.mkv';

afterEach(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

/** The headers of the next API call. */
async function sentHeaders(tag: string): Promise<Record<string, string>> {
  let sent: Record<string, string> = {};
  vi.stubGlobal('fetch', async (_url: string, init?: { headers?: Record<string, string> }) => {
    sent = init?.headers ?? {};
    return { ok: true, status: 200, text: async () => '[]' };
  });
  await getPlexServers(tag, { fresh: true });
  return sent;
}

describe('X-Plex-Language', () => {
  it.each(['en', 'es', 'fr', 'de', 'ar'])('%s: an API call sends the app language', async (lang) => {
    await i18n.changeLanguage(lang);
    const headers = await sentHeaders(`lang-${lang}`);
    expect(headers['X-Plex-Language']).toBe(lang);
    // The rest of who is asking is untouched.
    expect(headers['X-Plex-Product']).toBe('Snow Media Center');
    expect(headers['X-Plex-Platform']).toBe('Android');
  });

  it('follows a language change made after the first call', async () => {
    expect((await sentHeaders('first'))['X-Plex-Language']).toBe('en');
    await i18n.changeLanguage('de');
    expect((await sentHeaders('second'))['X-Plex-Language']).toBe('de');
  });

  it('is never in a stream URL', async () => {
    await i18n.changeLanguage('es');
    expect(plexDirectUrl(BASE, PART, 'tok')).not.toMatch(/Language/i);
    expect(plexTranscodeUrl(BASE, '101', 'tok', { maxVideoBitrateKbps: 4000 })).not.toMatch(/Language/i);
  });
});

describe('the words plex.ts writes itself', () => {
  it('are unchanged in English', () => {
    expect(plexRouteLabel('direct', BASE)).toBe('Direct to server · plex.direct · https');
    expect(plexRouteLabel('relay', BASE)).toBe('Plex Relay (speed-capped by Plex)');
    expect(PLEX_QUALITY_PRESETS[0].label).toBe('Original (direct)');
  });

  it('follow the language, including the quality list that is built once', async () => {
    await i18n.changeLanguage('es');
    expect(plexRouteLabel('lan', BASE)).toBe('Red local · plex.direct · https');
    expect(plexRouteLabel('direct', 'http://192.168.1.5:32400')).toContain('Directo al servidor · IP · http (sin cifrar)');
    expect(PLEX_QUALITY_PRESETS[0].label).toBe('Original (directo)');
    // A preset key is a code, not a label.
    expect(PLEX_QUALITY_PRESETS[0].key).toBe('original');
  });
});

describe('the screen format names', () => {
  it('keep their English label and hint, and have a key for each in every language', async () => {
    for (const f of SCREEN_FORMATS) {
      expect(i18n.t(f.labelKey)).toBe(f.label);
      expect(i18n.t(f.hintKey)).toBe(f.hint);
    }
    await i18n.changeLanguage('es');
    expect(i18n.t(SCREEN_FORMATS[0].labelKey)).toBe('Ajustar');
  });
});
