import { beforeEach, describe, expect, it } from 'vitest';
import { clearPlexDeeplink, handPlexDeeplink, peekPlexDeeplink, renewPlexDeeplink, PLEX_DEEPLINK_KEY, PLEX_DEEPLINK_TTL_MS } from './plexDeeplink';

beforeEach(() => { sessionStorage.clear(); });

describe('the content bar\'s link into Plex', () => {
  it('is stamped when handed over, and looking does not clear it', () => {
    handPlexDeeplink({ ratingKey: '42', title: 'Dune', kind: 'movie' }, 1000);
    const got = peekPlexDeeplink(1500);
    expect(got?.link).toEqual({ ratingKey: '42', title: 'Dune', kind: 'movie', at: 1000 });
    expect(peekPlexDeeplink(1500)?.raw).toBe(sessionStorage.getItem(PLEX_DEEPLINK_KEY));
  });

  it('is not used once it has gone stale, or when it names no title', () => {
    handPlexDeeplink({ ratingKey: '42' }, 1000);
    expect(peekPlexDeeplink(1000 + PLEX_DEEPLINK_TTL_MS + 1)).toBeNull();
    sessionStorage.setItem(PLEX_DEEPLINK_KEY, JSON.stringify({ title: 'Dune', at: 1000 }));
    expect(peekPlexDeeplink(1000)).toBeNull();
    sessionStorage.setItem(PLEX_DEEPLINK_KEY, '{nope');
    expect(peekPlexDeeplink()).toBeNull();
  });

  it('clears only the copy that was read', () => {
    handPlexDeeplink({ ratingKey: '1' }, 1000);
    const first = peekPlexDeeplink(1000)!;
    handPlexDeeplink({ ratingKey: '2' }, 1001);
    clearPlexDeeplink(first.raw);
    expect(peekPlexDeeplink(1001)?.link.ratingKey).toBe('2');
    clearPlexDeeplink();
    expect(sessionStorage.getItem(PLEX_DEEPLINK_KEY)).toBeNull();
  });

  it('Support hands the film back fresh, however long the guide was open', () => {
    handPlexDeeplink({ ratingKey: '7', title: 'Heat' }, 1000);
    const later = 1000 + 10 * 60 * 1000;
    expect(peekPlexDeeplink(later)).toBeNull();
    renewPlexDeeplink(later);
    expect(peekPlexDeeplink(later + 1)?.link).toMatchObject({ ratingKey: '7', title: 'Heat' });
    // Nothing stashed: nothing made up.
    sessionStorage.clear();
    renewPlexDeeplink(later);
    expect(sessionStorage.getItem(PLEX_DEEPLINK_KEY)).toBeNull();
  });
});
