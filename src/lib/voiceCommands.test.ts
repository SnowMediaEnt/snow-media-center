import { describe, expect, it } from 'vitest';
import { bestApp, bestChannel, channelForName, cleanChannelName, parseVoiceCommand, titleMatches } from './voiceCommands';

describe('parseVoiceCommand', () => {
  it.each([
    ['Open Plex', { kind: 'screen', screen: 'plex' }],
    ['take me to the TV guide', { kind: 'screen', screen: 'guide' }],
    ['go home', { kind: 'screen', screen: 'home' }],
    ['Hey Snow, open settings please', { kind: 'screen', screen: 'settings' }],
    ['device cleaner', { kind: 'screen', screen: 'device_cleaner' }],
    ['switch profile', { kind: 'profiles' }],
    ['put on ESPN', { kind: 'channel', name: 'espn' }],
    ['turn on channel Fox Sports 1', { kind: 'channel', name: 'fox sports 1' }],
    ['watch CNN', { kind: 'channel', name: 'cnn' }],
    ['watch the movie Inception', { kind: 'plex', query: 'inception', open: true }],
    ['watch The Office', { kind: 'watch', query: 'the office' }],
    ['search for Batman', { kind: 'plex', query: 'batman', open: false }],
    ['open YouTube', { kind: 'app', name: 'youtube' }],
    ['launch the Downloader app', { kind: 'app', name: 'downloader' }],
    ['install IPVanish', { kind: 'install', name: 'ipvanish' }],
  ])('%s', (said, want) => {
    expect(parseVoiceCommand(said)).toEqual(want);
  });

  it('hands anything else to the assistant', () => {
    expect(parseVoiceCommand('why is my box so slow').kind).toBe('ai');
    expect(parseVoiceCommand('watch the Lakers game').kind).toBe('ai');
  });

  it.each([
    ['switch to Plex', { kind: 'screen', screen: 'plex' }],
    ['switch to the guide', { kind: 'screen', screen: 'guide' }],
    ['change to live TV', { kind: 'screen', screen: 'live_tv' }],
    ['switch to Game Day', { kind: 'screen', screen: 'game_day' }],
    ['switch to the kids profile', { kind: 'profiles' }],
    ['open the store', { kind: 'screen', screen: 'store' }],
    ['open the Play Store', { kind: 'app', name: 'play store' }],
  ])('"%s" names a screen, not a channel', (said, want) => {
    expect(parseVoiceCommand(said)).toEqual(want);
  });

  it('sends settings and games said after "turn on" / "put on" to the assistant', () => {
    expect(parseVoiceCommand('turn on subtitles').kind).toBe('ai');
    expect(parseVoiceCommand('turn on closed captions').kind).toBe('ai');
    expect(parseVoiceCommand('put on the Lakers game').kind).toBe('ai');
  });

  it.each(['Fantastic Mr Fox', 'News of the World', 'A Discovery of Witches', 'Game of Thrones', 'Squid Game', 'The Hunger Games'])(
    '"watch %s" is a title, not a channel or an event',
    (title) => {
      expect(parseVoiceCommand(`watch ${title}`)).toEqual({ kind: 'watch', query: title.toLowerCase() });
    },
  );

  it('still knows channels and events when they are the whole phrase', () => {
    expect(parseVoiceCommand('watch Fox Sports 1')).toEqual({ kind: 'channel', name: 'fox sports 1' });
    expect(parseVoiceCommand('watch the news')).toEqual({ kind: 'channel', name: 'the news' });
    expect(parseVoiceCommand('watch ESPN 2')).toEqual({ kind: 'channel', name: 'espn 2' });
    expect(parseVoiceCommand('watch the UFC fight').kind).toBe('ai');
    expect(parseVoiceCommand('watch the game tonight').kind).toBe('ai');
    expect(parseVoiceCommand('watch live TV')).toEqual({ kind: 'screen', screen: 'live_tv' });
  });
});

describe('matching', () => {
  it('cleans provider decoration off channel names', () => {
    expect(cleanChannelName('US| ESPN 2 FHD')).toBe('espn 2');
    expect(cleanChannelName('UK: Sky Sports Main Event [VIP]')).toBe('sky sports main event');
  });

  it('finds the channel that was said, favourites first', () => {
    const chans = [
      { name: 'US| ESPN 2 HD', stream_id: 2 },
      { name: 'US| ESPN FHD', stream_id: 1 },
      { name: 'US| ESPNEWS', stream_id: 3 },
      { name: 'US| ESPN HD', stream_id: 4 },
    ];
    expect(bestChannel('espn', chans)?.stream_id).toBe(1);
    expect(bestChannel('espn', chans, new Set([4]))?.stream_id).toBe(4);
    expect(bestChannel('espn two', chans)?.stream_id).toBe(2);
    expect(bestChannel('bravo', chans)).toBeNull();
  });

  it('plays nothing on a guess', () => {
    const usa = [
      { name: 'USA A&E', stream_id: 1 },
      { name: 'USA ABC', stream_id: 2 },
      { name: 'USA NETWORK HD', stream_id: 3 },
      { name: 'USA ESPN', stream_id: 4 },
      { name: 'USA ESPN 2', stream_id: 5 },
    ];
    // Only part of a name, and several channels have it.
    expect(bestChannel('usa', usa)).toBeNull();
    expect(bestChannel('fox', [{ name: 'FOX NEWS', stream_id: 6 }, { name: 'FOX SPORTS 1', stream_id: 7 }])).toBeNull();
    // Only somewhere inside a longer name.
    expect(bestChannel('espn', [{ name: 'WatchESPN Events', stream_id: 8 }])).toBeNull();
    // A name no channel has.
    expect(bestChannel('hallmark', usa)).toBeNull();
    // What was said, with the provider's country in front.
    expect(bestChannel('espn', usa)?.stream_id).toBe(4);
    expect(bestChannel('a&e', usa)?.stream_id).toBe(1);
    expect(bestChannel('usa network', usa)?.stream_id).toBe(3);
  });

  it('lets a favourite, or the only channel that fits, settle a partial name', () => {
    const fox = [{ name: 'FOX NEWS', stream_id: 6 }, { name: 'FOX SPORTS 1', stream_id: 7 }];
    expect(bestChannel('fox', fox, new Set([7]))?.stream_id).toBe(7);
    expect(bestChannel('cnn', [{ name: 'CNN INTERNATIONAL', stream_id: 9 }])?.stream_id).toBe(9);
    // The same channel twice (two qualities) is still one channel.
    expect(bestChannel('cnn', [{ name: 'CNN INTERNATIONAL 1080p', stream_id: 9 }, { name: 'CNN INTERNATIONAL HD', stream_id: 10 }])?.stream_id).toBe(9);
  });

  it('looks a spoken name up across every line', () => {
    const lineA = [{ name: 'USA A&E', stream_id: 1 }, { name: 'USA ABC', stream_id: 2 }];
    const lineB = [{ name: 'US| ESPN2 HD', stream_id: 3 }, { name: 'The Weather Channel', stream_id: 4 }];
    expect(channelForName('espn two', [lineA, lineB])?.stream_id).toBe(3);
    expect(channelForName('ESPN2', [lineA, lineB])?.stream_id).toBe(3);
    expect(channelForName('the weather channel', [lineA, lineB])?.stream_id).toBe(4);
    // Not there: nothing, never the first channel of a list.
    expect(channelForName('usa network', [lineA, lineB])).toBeNull();
    expect(channelForName('usa', [lineA, lineB])).toBeNull();
  });

  it('finds installed apps and close titles', () => {
    const apps = [{ appName: 'YouTube', packageName: 'yt' }, { appName: 'YouTube Kids', packageName: 'ytk' }, { appName: 'Downloader', packageName: 'dl' }];
    expect(bestApp('youtube', apps)?.packageName).toBe('yt');
    expect(bestApp('you tube kids', apps)?.packageName).toBe('ytk');
    expect(titleMatches('the office', 'The Office (US)')).toBe(true);
    expect(titleMatches('office', 'The Office')).toBe(true);
    expect(titleMatches('star', 'Star Wars: The Empire Strikes Back')).toBe(false);
  });
});
