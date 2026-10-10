// The Recently watched panel's rows: channels only, newest first, once each,
// on lines signed in here (every service's); never an adult channel, a hidden
// category's, or (Kids) one outside the profile's line-up. Invented names only.
import { describe, expect, it } from 'vitest';
import type { WatchEntry } from './watchHistory';
import type { XtreamCreds } from './xtream';
import { RECENT_CHANNELS_MAX, recentChannelId, recentChannelsFrom } from './recentChannels';

const A: XtreamCreds = { host: 'http://a.test', username: 'u', password: 'p', output: 'ts', serverLabel: 'Alpha' };
const B: XtreamCreds = { host: 'http://b.test', username: 'v', password: 'q', output: 'ts', serverLabel: 'Beta' };
const chan = (line: XtreamCreds, id: number, title: string, at: number, cat = '1', subtitle = 'News'): WatchEntry => ({
  kind: 'channel', key: `${line.host.replace(/^https?:\/\//, '')}|${line.username}|${id}`, title, subtitle, watchedAt: at, count: 1,
  channel: { host: line.host, username: line.username, streamId: id, categoryId: cat, num: id, serverLabel: line.serverLabel },
});

describe('Recently watched channels', () => {
  it('newest first, channels only, lines signed in here only (every service)', () => {
    const rows = recentChannelsFrom([
      chan(A, 1, 'Harbor News', 100),
      { kind: 'plex', key: 'm', title: 'A Film', watchedAt: 500, count: 1 },
      chan(A, 2, 'Pinecrest Weather', 300, '2', 'Regional'),
      chan({ ...B, host: 'http://gone.test' }, 3, 'Gone Line', 400),
      chan(B, 4, 'Summit Sports', 200, '5', 'Beta'),
    ], [A, B]);
    expect(rows.map((r) => r.name)).toEqual(['Pinecrest Weather', 'Summit Sports', 'Harbor News']);
    expect(rows[0]).toMatchObject({ id: recentChannelId(A, 2), category: 'Regional', line: A, stream: { stream_id: 2, category_id: '2' } });
    // Each row keeps its own service.
    expect(rows[1]).toMatchObject({ id: recentChannelId(B, 4), line: B });
    // A subtitle that is only the service's name is no category.
    expect(rows[1].category).toBeUndefined();
  });

  it('the same stream id on two services is two channels', () => {
    const rows = recentChannelsFrom([chan(A, 7, 'Alpha Seven', 200), chan(B, 7, 'Beta Seven', 100)], [A, B]);
    expect(rows.map((r) => r.id)).toEqual([recentChannelId(A, 7), recentChannelId(B, 7)]);
  });

  it('no adult channel (by its category or its name), whatever was watched', () => {
    const rows = recentChannelsFrom([
      chan(A, 1, 'Harbor News', 100),
      chan(A, 2, 'Hot Encounters', 300, '9', 'XXX | For Adults'),
      chan(A, 3, 'Moonlit XXX', 200, '2', 'Regional'),
    ], [A]);
    expect(rows.map((r) => r.name)).toEqual(['Harbor News']);
  });

  it('the last 10 channels, newest first, a channel watched twice once', () => {
    expect(RECENT_CHANNELS_MAX).toBe(10);
    // Twelve channels, the first watched again last: 12 different channels in all.
    const history = Array.from({ length: 12 }, (_, i) => chan(A, i + 1, `Channel ${i + 1}`, 100 + i * 10));
    history.push(chan(A, 1, 'Channel 1', 1000));
    const rows = recentChannelsFrom(history, [A]);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.name)).toEqual(['Channel 1', 'Channel 12', 'Channel 11', 'Channel 10', 'Channel 9', 'Channel 8', 'Channel 7', 'Channel 6', 'Channel 5', 'Channel 4']);
  });

  it('a hidden category, and on a Kids profile any category it may not open, stay out', () => {
    const history = [chan(A, 1, 'Harbor News', 100), chan(A, 2, 'Doodle Den', 200, '4', 'Kids')];
    expect(recentChannelsFrom(history, [A], { hidden: new Map([['a.test|u', new Set(['1'])]]) }).map((r) => r.name)).toEqual(['Doodle Den']);
    const kids = new Map([['a.test|u', new Set(['4'])]]);
    expect(recentChannelsFrom(history, [A], { kidsCats: kids }).map((r) => r.name)).toEqual(['Doodle Den']);
  });
});
