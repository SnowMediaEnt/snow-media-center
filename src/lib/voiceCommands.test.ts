import { describe, expect, it } from 'vitest';
import { bestApp, bestChannel, cleanChannelName, parseVoiceCommand, titleMatches } from './voiceCommands';

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

  it('finds installed apps and close titles', () => {
    const apps = [{ appName: 'YouTube', packageName: 'yt' }, { appName: 'YouTube Kids', packageName: 'ytk' }, { appName: 'Downloader', packageName: 'dl' }];
    expect(bestApp('youtube', apps)?.packageName).toBe('yt');
    expect(bestApp('you tube kids', apps)?.packageName).toBe('ytk');
    expect(titleMatches('the office', 'The Office (US)')).toBe(true);
    expect(titleMatches('office', 'The Office')).toBe(true);
    expect(titleMatches('star', 'Star Wars: The Empire Strikes Back')).toBe(false);
  });
});
