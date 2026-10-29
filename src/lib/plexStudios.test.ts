import { describe, expect, it } from 'vitest';
import { groupStudios, studioGroupId, studioMatches } from './plexStudios';
import { buildLibraryQuery, describeFilters, EMPTY_FILTERS, fallbackFilterKey, hasAnyFilter } from './plexLibraryFilters';
import { libraryRowSpecs } from './plexLibraryRows';

const v = (title: string, key = title) => ({ key, title });

describe('plexStudios — matching', () => {
  it('matches whole names and names that carry on past a word boundary, case-insensitively', () => {
    expect(studioMatches('ANGEL STUDIOS', 'angel studios')).toBe(true);
    expect(studioMatches('Marvel Studios LLC', 'marvel')).toBe(true);
    expect(studioMatches('Disney+', 'disney')).toBe(true);
    expect(studioMatches('Warner Bros. Pictures', 'warner bros')).toBe(true);
    expect(studioMatches('Foxtail Films', 'fox')).toBe(false);
    expect(studioMatches('Applecart', 'apple tv')).toBe(false);
  });

  it('puts each starter name in its group', () => {
    const cases: Record<string, string> = {
      'Angel Studios': 'angel', 'Angel Films': 'angel', VidAngel: 'angel',
      'Walt Disney Pictures': 'disney', 'Walt Disney Animation Studios': 'disney', 'Disney Channel': 'disney', 'Disney Television Animation': 'disney',
      'Pixar Animation Studios': 'pixar', 'Marvel Entertainment': 'marvel', 'Lucasfilm Ltd.': 'lucasfilm', A24: 'a24',
      '20th Century Fox': 'fox', '20th Century Studios': 'fox', Fox: 'fox', 'Fox 2000 Pictures': 'fox', 'Fox Searchlight Pictures': 'fox', 'Searchlight Pictures': 'fox',
      'Warner Bros.': 'warner', 'Warner Bros. Television': 'warner', 'New Line Cinema': 'warner', HBO: 'hbo', 'HBO Films': 'hbo',
      'Universal Pictures': 'universal', 'Focus Features': 'universal', 'Illumination Entertainment': 'universal',
      'Paramount Pictures': 'paramount', 'Columbia Pictures': 'sony', 'Sony Pictures Animation': 'sony', 'TriStar Pictures': 'sony', 'Screen Gems': 'sony',
      Lionsgate: 'lionsgate', 'DreamWorks Animation': 'dreamworks', 'Blumhouse Productions': 'blumhouse',
      Netflix: 'netflix', 'Amazon MGM Studios': 'amazon', 'Metro-Goldwyn-Mayer': 'amazon', 'Apple TV+': 'apple',
    };
    for (const [raw, id] of Object.entries(cases)) expect([raw, studioGroupId(raw)]).toEqual([raw, id]);
    expect(studioGroupId('Some Indie Outfit')).toBeUndefined();
  });
});

describe('plexStudios — groupStudios', () => {
  it('folds raw values into groups, joins their keys, drops unmatched ones, Angel Studios first', () => {
    const groups = groupStudios([
      v('Universal Pictures', 'u1'), v('Walt Disney Pictures', 'd1'), v('Tiny Indie'), v('Disney+', 'd2'),
      v('A24', 'a'), v('Angel Studios', 'ang'), v('VidAngel', 'va'),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['angel', 'disney', 'a24', 'universal']);
    expect(groups[0]).toMatchObject({ name: 'Angel Studios', value: 'ang,va' });
    expect(groups[1].value).toBe('d1,d2');
  });

  it('no matches, no groups; a repeated key is used once', () => {
    expect(groupStudios([v('Tiny Indie')])).toEqual([]);
    expect(groupStudios([v('A24'), v('A24')])[0].value).toBe('A24');
  });
});

describe('plexLibraryFilters — studio', () => {
  const studio = { key: 'Walt Disney Pictures,Disney+', title: 'Disney' };
  it('is a filter, says its name, and becomes studio= with each value encoded and commas (OR) between', () => {
    const f = { ...EMPTY_FILTERS, studio };
    expect(hasAnyFilter(f)).toBe(true);
    expect(describeFilters(f)).toBe('Disney');
    expect(buildLibraryQuery('movie', f)).toBe('type=1&studio=Walt%20Disney%20Pictures,Disney%2B');
    expect(buildLibraryQuery('show', f)).toBe('type=2&studio=Walt%20Disney%20Pictures,Disney%2B');
  });
  it("a TV section's studio list is its shows'", () => {
    expect(fallbackFilterKey('4', 'studio', 'show')).toBe('/library/sections/4/studio?type=2');
    expect(fallbackFilterKey('3', 'studio', 'movie')).toBe('/library/sections/3/studio');
  });
  it('the Studios row comes right after Recently Added, in wave 2, for both section types', () => {
    for (const type of ['movie', 'show'] as const) {
      const ids = libraryRowSpecs(type).map((s) => s.id);
      expect(ids[ids.indexOf('added') + 1]).toBe('studios');
      expect(libraryRowSpecs(type).find((s) => s.id === 'studios')).toMatchObject({ kind: 'studios', wave: 2 });
    }
  });
});
