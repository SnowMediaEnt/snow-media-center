import { describe, expect, it } from 'vitest';
import { isAdultChannel, isAdultLabel, isAdultPlexItem, isAdultRating, isAdultTitle } from './adultContent';

describe('isAdultLabel — categories, libraries, genres', () => {
  it('catches the usual provider names', () => {
    for (const s of ['XXX', 'Adult', 'ADULTS', 'For Adults', 'Adults Only', '18+', '+18', 'US | XXX', 'VOD - Adult Movies',
      'Sex', 'Erotic', 'Hentai', 'Playboy TV', 'Brazzers', 'NSFW', 'Mature', 'x-rated', 'FR: ADULTES (18+)']) {
      expect(isAdultLabel(s), s).toBe(true);
    }
  });
  it('leaves ordinary categories alone', () => {
    for (const s of ['Sports', 'Movies', 'Kids', 'News', 'Adult Swim', 'Documentaries', '24/7', 'UK | Entertainment', 'Music', 'Anime']) {
      expect(isAdultLabel(s), s).toBe(false);
    }
  });
  it('is blank-safe', () => {
    expect(isAdultLabel('')).toBe(false);
    expect(isAdultLabel(undefined)).toBe(false);
    expect(isAdultLabel(null)).toBe(false);
  });
});

describe('isAdultTitle — channel and title names', () => {
  it('catches names that leave no doubt', () => {
    for (const s of ['XXX Movies HD', 'ADULT 1', 'Adult Movies HD', 'Playboy TV', 'Hustler HD', 'Brazzers TV', 'Vivid TV 18+', 'Penthouse',
      'PORN HUB TV', 'Hentai Heaven', 'Only Fans Live']) {
      expect(isAdultTitle(s), s).toBe(true);
    }
  });
  it('does not flag prime-time television or cartoons', () => {
    for (const s of ['Sex and the City', 'Sex Education', 'Adult Swim', 'Adult Life Skills', 'Mature Content Warning', 'ESPN', 'CNN',
      'The Sexy Beast', 'Sexy Beasts', 'Little Women', 'Adult Education']) {
      expect(isAdultTitle(s), s).toBe(false);
    }
  });
});

describe('isAdultRating', () => {
  it('knows the pornography certificates and keeps the grown-up ones', () => {
    expect(isAdultRating('XXX')).toBe(true);
    expect(isAdultRating('X')).toBe(true);
    expect(isAdultRating('us/XXX')).toBe(true);
    expect(isAdultRating('R18')).toBe(true);
    expect(isAdultRating('R')).toBe(false);
    expect(isAdultRating('TV-MA')).toBe(false);
    expect(isAdultRating('NC-17')).toBe(false);
    expect(isAdultRating(undefined)).toBe(false);
  });
});

describe('isAdultChannel', () => {
  it('uses the category, the panel flag and the name', () => {
    expect(isAdultChannel({ name: 'Channel 12', categoryName: 'XXX' })).toBe(true);
    expect(isAdultChannel({ name: 'Channel 12', categoryName: 'Sports', row: { is_adult: '1' } })).toBe(true);
    expect(isAdultChannel({ name: 'Hustler HD', categoryName: 'Movies' })).toBe(true);
    expect(isAdultChannel({ name: 'ESPN', categoryName: 'Sports', row: { is_adult: '0' } })).toBe(false);
    expect(isAdultChannel({ name: 'Sex and the City 24/7', categoryName: 'Series 24/7' })).toBe(false);
  });
});

describe('isAdultPlexItem', () => {
  it('uses the library, the certificate, the genres and the name', () => {
    expect(isAdultPlexItem({ title: 'Some Film', libraryTitle: 'Adult' })).toBe(true);
    expect(isAdultPlexItem({ title: 'Some Film', libraryTitle: 'Movies', contentRating: 'XXX' })).toBe(true);
    expect(isAdultPlexItem({ title: 'Some Film', libraryTitle: 'Movies', genres: ['Drama', 'Adult'] })).toBe(true);
    expect(isAdultPlexItem({ title: 'Brazzers Collection', libraryTitle: 'Movies' })).toBe(true);
    expect(isAdultPlexItem({ title: 'Pilot', grandparentTitle: 'Playboy TV', libraryTitle: 'TV Shows' })).toBe(true);
    expect(isAdultPlexItem({ title: 'Sex Education', libraryTitle: 'TV Shows', contentRating: 'TV-MA', genres: ['Comedy'] })).toBe(false);
    expect(isAdultPlexItem({ title: 'Blue Velvet', libraryTitle: 'Movies', contentRating: 'R', genres: ['Thriller'] })).toBe(false);
  });
});
