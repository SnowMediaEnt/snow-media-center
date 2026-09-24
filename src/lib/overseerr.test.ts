import { describe, expect, it } from 'vitest';
import { isSameTitle, missingFromPlex, onPlexUnseen, type OverseerrItem } from './overseerr';

const ov = (id: number, title: string, status: number, extra: Partial<OverseerrItem> = {}): OverseerrItem =>
  ({ id, mediaType: 'tv', title, year: '2025', posterUrl: null, status, ...extra });

describe('Overseerr results next to a Plex search', () => {
  const found = [
    ov(1, 'The Prisoner of Beauty', 5, { ratingKey: 'pb' }),
    ov(2, 'Beauty Gone', 5),
    ov(3, 'Beauty Anew', 1),
    ov(4, 'Beauty Shop', 5, { ratingKey: 'bs' }),
    ov(5, 'Beauty Half', 4),
  ];
  const plex = [{ ratingKey: 'bs', title: 'Beauty Shop (US)', year: 2025 }];

  it('offers what is not on Plex to request, as before', () => {
    expect(missingFromPlex(found, plex, 6).map((it) => it.id)).toEqual([3, 5]);
  });

  it('keeps what Overseerr says is on Plex but the search missed, unless the search found it by key', () => {
    expect(onPlexUnseen(found, plex, 6).map((it) => it.id)).toEqual([1, 2]);
    expect(onPlexUnseen(found, [...plex, { title: 'The Prisoner of Beauty', year: '2025' }], 6).map((it) => it.id)).toEqual([2]);
  });

  it('trusts a key only for the same title', () => {
    const it0 = ov(1, 'The Prisoner of Beauty', 5, { ratingKey: 'pb' });
    expect(isSameTitle(it0, { title: 'Prisoner of Beauty', guids: ['imdb://tt1', 'tmdb://1'] })).toBe(true);
    // Another server's item under the same key.
    expect(isSameTitle(it0, { title: 'The Prisoner of Beauty', guids: ['tmdb://99'] })).toBe(false);
    // No ids to go by: the name.
    expect(isSameTitle(it0, { title: 'The Prisoner of Beauty', guids: [] })).toBe(true);
    expect(isSameTitle(it0, { title: 'Cars', guids: [] })).toBe(false);
  });
});
