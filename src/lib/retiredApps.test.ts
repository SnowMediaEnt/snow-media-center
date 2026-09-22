import { describe, expect, it } from 'vitest';
import { retiredAppFor, retiredAppMessage } from './retiredApps';

describe('retiredAppFor', () => {
  it('sends the three retired apps to their Player section', () => {
    expect(retiredAppFor('Dreamstreams')).toEqual({ where: 'Live TV', screen: 'live_tv' });
    expect(retiredAppFor('Dreamstreams 3.0')).toEqual({ where: 'Live TV', screen: 'live_tv' });
    expect(retiredAppFor('Dream Streams')).toEqual({ where: 'Live TV', screen: 'live_tv' });
    expect(retiredAppFor('VibezTV')).toEqual({ where: 'Live TV', screen: 'live_tv' });
    expect(retiredAppFor('Vibez')).toEqual({ where: 'Live TV', screen: 'live_tv' });
    expect(retiredAppFor('Plex')).toEqual({ where: 'Plex', screen: 'plex' });
    expect(retiredAppFor('Plex for Android TV')).toEqual({ where: 'Plex', screen: 'plex' });
  });
  it('leaves every other app alone', () => {
    for (const n of ['Snow Media Center', 'Downloader', 'Kodi', 'Plexus', 'Complex', 'Tivimate', '', undefined, null]) {
      expect(retiredAppFor(n), String(n)).toBeNull();
    }
  });
  it('names the app and where it went', () => {
    const msg = retiredAppMessage('VibezTV', { where: 'Live TV', screen: 'live_tv' });
    expect(msg).toContain('VibezTV');
    expect(msg).toContain('Live TV');
    expect(msg).toContain('Plex is in Plex');
  });
});
