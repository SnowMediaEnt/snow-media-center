import { afterEach, describe, expect, it } from 'vitest';
import type { PlexItem } from '@/lib/plex';
import { peekPlexVoice, pickPlexVoiceMatch, plexVoiceQuery, plexVoiceSearchText, plexVoiceSearchTexts, PLEX_VOICE_KEY, PLEX_VOICE_TTL_MS } from './plexVoice';
import { parseVoiceCommand } from './voiceCommands';

const item = (ratingKey: string, title: string, year?: number, type = 'movie'): PlexItem => ({ ratingKey, title, year, type });

describe('plexVoiceQuery', () => {
  it('drops the words that only say where to look', () => {
    expect(plexVoiceQuery('toy story 5 in plex')).toBe('toy story 5');
    expect(plexVoiceQuery('The Office on the Plex app')).toBe('The Office');
    expect(plexVoiceQuery('Dune from Plex.')).toBe('Dune');
    expect(plexVoiceQuery('plex')).toBe('plex');
    expect(plexVoiceQuery('Inside Out 2')).toBe('Inside Out 2');
  });

  it('"play toy story 5 in plex" is a Plex title, looked for as "toy story 5"', () => {
    const a = parseVoiceCommand('Play Toy Story 5 in Plex');
    expect(a).toEqual({ kind: 'watch', query: 'toy story 5 in plex' });
    expect(plexVoiceSearchTexts(a.kind === 'watch' ? a.query : '')).toEqual(['toy story 5']);
  });

  it('looks for a number said as a word as a digit too', () => {
    expect(plexVoiceSearchTexts('toy story five in plex')).toEqual(['toy story five', 'toy story 5']);
    expect(plexVoiceSearchTexts('Ocean\'s Eleven')).toEqual(['Ocean\'s Eleven', 'Ocean\'s 11']);
    expect(plexVoiceSearchTexts('someone great')).toEqual(['someone great']);
  });

  it('searches without a year said after the title', () => {
    expect(plexVoiceSearchText('dune 2021 in plex')).toBe('dune');
    expect(plexVoiceSearchText('1917')).toBe('1917');
    expect(plexVoiceSearchText('toy story 5')).toBe('toy story 5');
  });
});

describe('pickPlexVoiceMatch', () => {
  const toyStory = [item('1', 'Toy Story 2', 1999), item('2', 'Toy Story', 1995), item('3', 'Toy Story 4', 2019), item('5', 'Toy Story 5', 2026)];

  it('opens the title that is exactly what was said, not the first that starts with it', () => {
    expect(pickPlexVoiceMatch('toy story', toyStory)?.ratingKey).toBe('2');
    expect(pickPlexVoiceMatch('toy story 5 in plex', toyStory)?.ratingKey).toBe('5');
    expect(pickPlexVoiceMatch('Toy Story five', toyStory)?.ratingKey).toBe('5');
  });

  it('is no clear match when the title is not there', () => {
    expect(pickPlexVoiceMatch('toy story 6', toyStory)).toBeNull();
  });

  it('forgives punctuation, a leading "the" and "&"', () => {
    expect(pickPlexVoiceMatch('spiderman no way home', [item('9', 'Spider-Man: No Way Home', 2021)])?.ratingKey).toBe('9');
    expect(pickPlexVoiceMatch('office', [item('7', 'The Office', 2005, 'show')])?.ratingKey).toBe('7');
    expect(pickPlexVoiceMatch('fast and furious', [item('8', 'Fast & Furious', 2009)])?.ratingKey).toBe('8');
  });

  it('takes a title that starts with the words and is not much longer', () => {
    expect(pickPlexVoiceMatch('the office', [item('7', 'The Office (US)', 2005, 'show')])?.ratingKey).toBe('7');
    expect(pickPlexVoiceMatch('star', [item('4', 'Star Wars: The Empire Strikes Back', 1980)])).toBeNull();
  });

  it('asks (Search) when two different titles fit, and uses the year to choose', () => {
    const dune = [item('a', 'Dune', 1984), item('b', 'Dune', 2021)];
    expect(pickPlexVoiceMatch('dune', dune)).toBeNull();
    expect(pickPlexVoiceMatch('dune 2021', dune)?.ratingKey).toBe('b');
    expect(pickPlexVoiceMatch('fargo', [item('m', 'Fargo', 1996), item('s', 'Fargo', 2014, 'show')])).toBeNull();
  });

  it('treats the same film in two libraries as one answer', () => {
    expect(pickPlexVoiceMatch('toy story', [item('4k', 'Toy Story', 1995), item('hd', 'Toy Story', 1995)])?.ratingKey).toBe('4k');
  });
});

describe('peekPlexVoice', () => {
  afterEach(() => sessionStorage.clear());

  it('reads a fresh request without clearing it', () => {
    sessionStorage.setItem(PLEX_VOICE_KEY, JSON.stringify({ query: 'Toy Story', open: true, at: 1000 }));
    expect(peekPlexVoice(2000)?.intent).toEqual({ query: 'Toy Story', open: true, at: 1000 });
    expect(sessionStorage.getItem(PLEX_VOICE_KEY)).not.toBeNull();
  });

  it('ignores a request Plex never picked up in time', () => {
    sessionStorage.setItem(PLEX_VOICE_KEY, JSON.stringify({ query: 'Toy Story', open: true, at: 1000 }));
    expect(peekPlexVoice(1000 + PLEX_VOICE_TTL_MS + 1)).toBeNull();
  });

  it('takes an unstamped request (an older caller) and ignores junk', () => {
    sessionStorage.setItem(PLEX_VOICE_KEY, JSON.stringify({ query: 'Batman', open: false }));
    expect(peekPlexVoice()?.intent.query).toBe('Batman');
    sessionStorage.setItem(PLEX_VOICE_KEY, '{nope');
    expect(peekPlexVoice()).toBeNull();
  });
});
