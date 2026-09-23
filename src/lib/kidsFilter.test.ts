import { afterEach, describe, expect, it } from 'vitest';
import { kidsAllowsCategory, kidsAllowsChannel, kidsAllowsPlex, kidsRatingQuery, ratingAllowed, setKidsLevel } from './kidsFilter';

afterEach(() => setKidsLevel(null));

describe('kidsFilter', () => {
  it('lets everything through for a grown-up profile', () => {
    expect(kidsAllowsPlex({ type: 'movie', contentRating: 'R', title: 'Heat' })).toBe(true);
    expect(kidsAllowsCategory('US | NEWS')).toBe(true);
    expect(kidsRatingQuery()).toBe('');
  });

  it('allows certificates by level, with country prefixes', () => {
    expect(ratingAllowed('G', 'little')).toBe(true);
    expect(ratingAllowed('PG', 'little')).toBe(false);
    expect(ratingAllowed('us/PG', 'kids')).toBe(true);
    expect(ratingAllowed('gb/12A', 'teen')).toBe(true);
    expect(ratingAllowed('PG-13', 'kids')).toBe(false);
    expect(ratingAllowed(undefined, 'teen')).toBe(false);
  });

  it('filters Plex titles: unrated movies are out, seasons pass', () => {
    setKidsLevel('kids');
    expect(kidsAllowsPlex({ type: 'movie', contentRating: 'PG', title: 'Up' })).toBe(true);
    expect(kidsAllowsPlex({ type: 'movie', contentRating: 'R', title: 'Heat' })).toBe(false);
    expect(kidsAllowsPlex({ type: 'show', title: 'Unrated show' })).toBe(false);
    expect(kidsAllowsPlex({ type: 'season', title: 'Season 1' })).toBe(true);
    expect(kidsAllowsPlex({ type: 'episode', contentRating: 'TV-MA', title: 'x' })).toBe(false);
    expect(kidsRatingQuery()).toMatch(/^contentRating=G,/);
  });

  it('keeps Live TV to kids categories, teens to anything not adult', () => {
    setKidsLevel('kids');
    expect(kidsAllowsCategory('US| KIDS')).toBe(true);
    expect(kidsAllowsCategory('Disney+ Channels')).toBe(true);
    expect(kidsAllowsCategory('US | NEWS')).toBe(false);
    expect(kidsAllowsCategory('XXX Adults')).toBe(false);
    setKidsLevel('teen');
    expect(kidsAllowsCategory('US | NEWS')).toBe(true);
    expect(kidsAllowsCategory('US | ADULT 18+')).toBe(false);
    expect(kidsAllowsChannel({ name: 'Brazzers TV', category_id: '1' }, new Set(['1']))).toBe(false);
    expect(kidsAllowsChannel({ name: 'Nick Jr', category_id: '2' }, new Set(['1']))).toBe(false);
  });
});
