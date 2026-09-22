import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

import { supabase } from '@/integrations/supabase/client';
import { trackEvent } from '@/lib/analytics';
import { commitSearch, fallbackSuggestions, fetchPopularSearches, forgetRecentSearches, loadRecentSearches, rememberSearch } from './plexSearches';

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  rpc.mockReset();
  (trackEvent as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('recent searches on this box', () => {
  it('remembers the newest first, once each, eight at most', () => {
    for (const q of ['batman', 'Batman', 'the office', 'a', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7']) rememberSearch(q);
    const list = loadRecentSearches();
    expect(list.length).toBe(8);
    expect(list[0]).toBe('x7');
    expect(list).not.toContain('a');           // too short
    expect(list.filter((x) => x.toLowerCase() === 'batman').length).toBeLessThanOrEqual(1);
    forgetRecentSearches();
    expect(loadRecentSearches()).toEqual([]);
  });
  it('commitSearch remembers and reports the search', () => {
    commitSearch('  Star   Wars ');
    expect(loadRecentSearches()).toEqual(['Star Wars']);
    expect(trackEvent).toHaveBeenCalledWith('plex_search_commit', 'player', { scope: 'plex', query: 'Star Wars' });
  });
});

describe('fetchPopularSearches', () => {
  it('returns the fleet list without adult terms, cached for the session', async () => {
    rpc.mockResolvedValueOnce({ data: [{ query: 'batman' }, { query: 'xxx' }, { query: 'Batman' }, { query: 'the office' }], error: null });
    expect(await fetchPopularSearches(5)).toEqual(['batman', 'the office']);
    expect(await fetchPopularSearches(5)).toEqual(['batman', 'the office']);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('is empty, not an error, when the RPC is missing', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'function does not exist' } });
    expect(await fetchPopularSearches()).toEqual([]);
  });
});

describe('fallbackSuggestions', () => {
  it('dedupes titles and drops adult ones', () => {
    expect(fallbackSuggestions(['Inception', 'inception', undefined, 'Playboy TV', 'Dune'], 3)).toEqual(['Inception', 'Dune']);
  });
});
