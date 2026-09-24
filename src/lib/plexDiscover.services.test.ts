import { describe, expect, it, vi } from 'vitest';

// Studio / network lists as a Plex server sends them: a series library on a
// current server has `network` (numeric keys), an older one only `studio`;
// films carry `studio` (the name is the key).
const VALUES: Record<string, Array<{ key: string; title: string }>> = {
  '/library/sections/1/studio': [
    { key: 'Netflix', title: 'Netflix' }, { key: 'Amazon Studios', title: 'Amazon Studios' },
    { key: 'Amazon MGM Studios', title: 'Amazon MGM Studios' }, { key: 'Apple Original Films', title: 'Apple Original Films' },
    { key: 'Warner Bros. Pictures', title: 'Warner Bros. Pictures' }, { key: 'Paramount Pictures', title: 'Paramount Pictures' },
    { key: 'HBO Films', title: 'HBO Films' }, { key: 'Walt Disney Pictures', title: 'Walt Disney Pictures' },
  ],
  '/library/sections/2/network': [
    { key: '101', title: 'Netflix' }, { key: '102', title: 'HBO' }, { key: '103', title: 'HBO Max' }, { key: '104', title: 'Max' },
    { key: '105', title: 'Hulu' }, { key: '106', title: 'NBC' }, { key: '107', title: 'Peacock' }, { key: '108', title: 'Disney+' },
    { key: '109', title: 'Apple TV+' }, { key: '110', title: 'Paramount+' }, { key: '111', title: 'Prime Video' }, { key: '112', title: 'AMC' },
  ],
  '/library/sections/3/network': [],
  '/library/sections/3/studio': [{ key: 'Netflix', title: 'Netflix' }, { key: 'Disney Plus', title: 'Disney Plus' }],
};
const rowQueries: Array<{ section: string; query: string }> = [];

vi.mock('@/lib/plex', () => ({
  getPlexFilterValues: vi.fn(async (_b: string, _t: string, path: string) => VALUES[path] ?? []),
  getPlexSectionRow: vi.fn(async (_b: string, _t: string, section: string, query: string) => {
    rowQueries.push({ section, query });
    return [{ ratingKey: `${section}-a`, title: 'A', type: section === '1' ? 'movie' : 'show' }];
  }),
  getPlexRelated: vi.fn(async () => []),
}));
vi.mock('@/lib/watchHistory', () => ({ currentViewer: async () => 'device', loadWatchHistory: () => [] }));

const LIBS = [
  { key: '1', title: 'Movies', type: 'movie' },
  { key: '2', title: 'TV Shows', type: 'show' },
  { key: '3', title: 'Old TV', type: 'show' },
];

describe('streaming service rows', () => {
  it('names and aliases map to their service; others to none', async () => {
    const { serviceOf } = await import('./plexDiscover');
    const id = (n: string) => serviceOf(n)?.id ?? null;
    expect(id('Netflix')).toBe('netflix');
    expect(id('HBO')).toBe('max');
    expect(id('HBO Max')).toBe('max');
    expect(id('Max')).toBe('max');
    expect(id('Maximum Pictures')).toBeNull();
    expect(id('Amazon Studios')).toBe('prime');
    expect(id('Prime Video')).toBe('prime');
    expect(id('Apple TV+')).toBe('apple');
    expect(id('Apple Original Films')).toBe('apple');
    expect(id('Disney+')).toBe('disney');
    expect(id('Disney Plus')).toBe('disney');
    expect(id('Walt Disney Pictures')).toBeNull();
    expect(id('Paramount+')).toBe('paramount');
    expect(id('Paramount Pictures')).toBeNull();
    expect(id('NBC')).toBe('peacock');
    expect(id('Peacock')).toBe('peacock');
    expect(id('NBCSN')).toBeNull();
    expect(id('Hulu')).toBe('hulu');
  });

  it('finds every service the server has, per library, network first and studio on an older server', async () => {
    const { pickServices } = await import('./plexDiscover');
    const map = await pickServices('http://pms', 't', LIBS);
    expect([...map.keys()].sort()).toEqual(['apple', 'disney', 'hulu', 'max', 'netflix', 'paramount', 'peacock', 'prime']);
    expect(map.get('max')!.get('2')).toEqual({ field: 'network', keys: ['102', '103', '104'] });
    expect(map.get('max')!.get('1')).toEqual({ field: 'studio', keys: ['HBO Films'] });
    expect(map.get('prime')!.get('1')!.keys).toEqual(['Amazon Studios', 'Amazon MGM Studios']);
    expect(map.get('netflix')!.get('3')).toEqual({ field: 'studio', keys: ['Netflix'] });
    expect(map.get('disney')!.get('3')).toEqual({ field: 'studio', keys: ['Disney Plus'] });
  });

  it('one row mixes the films and series of a service, asking each library for all its names at once', async () => {
    const { pickServices, serviceRow } = await import('./plexDiscover');
    const map = await pickServices('http://pms', 't', LIBS);
    rowQueries.length = 0;
    const items = await serviceRow('http://pms', 't', LIBS, map.get('prime')!);
    expect(rowQueries).toEqual([
      { section: '1', query: 'type=1&studio=Amazon%20Studios,Amazon%20MGM%20Studios&sort=random' },
      { section: '2', query: 'type=2&network=111&sort=random' },
    ]);
    expect(items.map((i) => i.type)).toEqual(['movie', 'show']);
  });
});
