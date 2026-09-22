import { describe, expect, it } from 'vitest';
import type { PlexItem } from '@/lib/plex';
import { editDistance, normalizeTitle, rankSuggestions, searchLooksThin, searchVariants, similarity } from './plexFuzzy';

const item = (ratingKey: string, title: string, year?: number): PlexItem =>
  ({ ratingKey, title, type: 'movie', year } as PlexItem);

describe('normalizeTitle', () => {
  it('collapses the spellings people use on a TV keyboard', () => {
    expect(normalizeTitle("Don't Look Up")).toBe('dont look up');
    expect(normalizeTitle('Spider-Man: No Way Home')).toBe('spider man no way home');
    expect(normalizeTitle('Mission: Impossible – Dead Reckoning')).toBe('mission impossible dead reckoning');
    expect(normalizeTitle('Fast & Furious')).toBe('fast and furious');
    expect(normalizeTitle('Amélie')).toBe('amelie');
  });
});

describe('editDistance', () => {
  it('counts a swap once', () => {
    expect(editDistance('batman', 'batmna')).toBe(1);
    expect(editDistance('batman', 'batmn')).toBe(1);
    expect(editDistance('abc', 'abc')).toBe(0);
  });
});

describe('similarity', () => {
  it('is high for the usual typos and missing punctuation', () => {
    expect(similarity('dont look up', "Don't Look Up")).toBe(1);
    expect(similarity('spiderman', 'Spider-Man')).toBeGreaterThan(0.85);
    expect(similarity('batmn begins', 'Batman Begins')).toBeGreaterThan(0.85);
    expect(similarity('dark knight', 'The Dark Knight')).toBeGreaterThan(0.8);
    expect(similarity('avengers', 'Avengers: Endgame')).toBeGreaterThan(0.8);
  });
  it('is low for unrelated titles', () => {
    expect(similarity('batman', 'The Notebook')).toBeLessThan(0.5);
    expect(similarity('dune', 'Frozen')).toBeLessThan(0.5);
  });
});

describe('searchVariants', () => {
  it('offers the cleaned query, the long words, and a prefix', () => {
    const v = searchVariants('Batmn: Begins');
    expect(v[0]).toBe('batmn begins');
    expect(v).toContain('begins');
    expect(v).toContain('batmn');
    expect(v.length).toBeLessThanOrEqual(4);
    expect(searchVariants('spidermann')).toContain('spide');
  });
  it('never repeats what was typed', () => {
    expect(searchVariants('batman')).not.toContain('batman');
  });
});

describe('rankSuggestions + searchLooksThin', () => {
  it('ranks the closest titles first and leaves out what is already shown', () => {
    const cands = [item('1', 'Batman Begins', 2005), item('2', 'Batman Returns', 1992), item('3', 'The Notebook'), item('4', 'Batman Begins', 2005)];
    const out = rankSuggestions('batmn begins', cands, new Set(['4']));
    expect(out.map((i) => i.ratingKey)).toEqual(['1', '2']);
  });
  it('knows when a search came back thin', () => {
    expect(searchLooksThin('batmn begins', [])).toBe(true);
    expect(searchLooksThin('batman', [item('9', 'Batman')])).toBe(false);
    expect(searchLooksThin('batman', [item('9', 'The Notebook')])).toBe(true);
  });
});
