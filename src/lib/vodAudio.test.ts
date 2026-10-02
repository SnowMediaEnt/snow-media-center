import { describe, expect, it } from 'vitest';
import { baseLanguage, pickAudioTrack } from './vodAudio';

const tr = (id: number, language: string | undefined, active = false) => ({ id, label: `T${id}`, language, active });

describe('baseLanguage', () => {
  it('reduces tags and ISO 639-2 codes to the two-letter language', () => {
    expect(baseLanguage('en')).toBe('en');
    expect(baseLanguage('en-US')).toBe('en');
    expect(baseLanguage('ENG')).toBe('en');
    expect(baseLanguage('ger')).toBe('de');
    expect(baseLanguage('fre')).toBe('fr');
    expect(baseLanguage('spa')).toBe('es');
    expect(baseLanguage('ara')).toBe('ar');
  });
  it('treats no language and "und" as none', () => {
    expect(baseLanguage(undefined)).toBe('');
    expect(baseLanguage('')).toBe('');
    expect(baseLanguage('und')).toBe('');
  });
});

describe('pickAudioTrack', () => {
  it('switches to the viewer\'s language when the file has it and it is not playing', () => {
    expect(pickAudioTrack([tr(0, 'en', true), tr(1, 'es')], 'es')).toBe(1);
    expect(pickAudioTrack([tr(0, 'eng', true), tr(1, 'spa')], 'es')).toBe(1);
  });
  it('keeps the playing track when it already is the viewer\'s language', () => {
    expect(pickAudioTrack([tr(0, 'en', true), tr(1, 'en')], 'en')).toBeNull();
  });
  it('keeps the file\'s own default when the viewer\'s language is not there', () => {
    expect(pickAudioTrack([tr(0, 'en', true), tr(1, 'it')], 'ar')).toBeNull();
  });
  it('does nothing with one track or none', () => {
    expect(pickAudioTrack([], 'en')).toBeNull();
    expect(pickAudioTrack([tr(0, 'es', true)], 'en')).toBeNull();
  });
});
