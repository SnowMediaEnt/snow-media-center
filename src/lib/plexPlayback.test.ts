import { describe, expect, it } from 'vitest';
import { isPrivatePlexBase } from './plex';
import { PLAYBACK_CONNECTIONS, playbackConnections, rangeFetchAllowed } from './plexPlayback';

const FILE = '/library/parts/7/1700000000/file.mkv?X-Plex-Token=tok';

describe('the parallel reader: only to a server that is not on a private network', () => {
  it('reads a file from a public address over several connections', () => {
    expect(rangeFetchAllowed(`https://203-0-113-5.abc123.plex.direct:32400${FILE}`, 'direct', true)).toBe(true);
    expect(rangeFetchAllowed(`http://203.0.113.5:32400${FILE}`, 'direct', true)).toBe(true);
    expect(rangeFetchAllowed(`https://[2001:db8::5]:32400${FILE}`, 'direct', true)).toBe(true);
    expect(rangeFetchAllowed(`https://2001-db8--5.abc123.plex.direct:32400${FILE}`, 'direct', true)).toBe(true);
    // A name that stands for no address is not known to be private.
    expect(rangeFetchAllowed(`https://plex.example.com${FILE}`, 'direct', true)).toBe(true);
  });

  it('never on a private network, whatever plex.tv called the route', () => {
    for (const host of ['192.168.1.5:32400', '10.0.0.2:32400', '172.16.4.9:32400', '172.31.255.1:32400', '127.0.0.1:32400', '[fd12:3456::1]:32400', '[::1]:32400', 'localhost:32400', '192-168-1-5.abc123.plex.direct:32400']) {
      expect(rangeFetchAllowed(`http://${host}${FILE}`, 'direct', true)).toBe(false);
    }
    // A public address plex.tv listed as local is still public.
    expect(rangeFetchAllowed(`http://203.0.113.5:32400${FILE}`, 'lan', true)).toBe(true);
    // 172.32 is not private.
    expect(isPrivatePlexBase('http://172.32.0.1:32400')).toBe(false);
    expect(isPrivatePlexBase('nonsense')).toBe(false);
  });

  it('never over the relay, never for a conversion, and the flag is the kill switch', () => {
    expect(rangeFetchAllowed(`https://203-0-113-5.abc123.plex.direct:8443${FILE}`, 'relay', true)).toBe(false);
    expect(rangeFetchAllowed('https://203-0-113-5.abc123.plex.direct:32400/video/:/transcode/universal/start.m3u8?path=x', 'direct', true)).toBe(false);
    expect(rangeFetchAllowed(`https://203-0-113-5.abc123.plex.direct:32400${FILE}`, 'direct', false)).toBe(false);
    expect(rangeFetchAllowed(null, 'direct', true)).toBe(false);
  });

  it('how many connections a speed check reads with: the same as playback', () => {
    expect(playbackConnections('https://203-0-113-5.abc123.plex.direct:32400', 'direct', true)).toBe(PLAYBACK_CONNECTIONS);
    expect(playbackConnections('http://192.168.1.5:32400/', 'lan', true)).toBe(1);
    expect(playbackConnections('https://203-0-113-5.abc123.plex.direct:8443', 'relay', true)).toBe(1);
    expect(playbackConnections('https://203-0-113-5.abc123.plex.direct:32400', 'direct', false)).toBe(1);
  });
});
