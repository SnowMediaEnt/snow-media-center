import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { storage: { from: () => ({
    list: mocks.list,
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.test/${encodeURIComponent(path)}` } }),
  }) } },
}));

import {
  GAME_MUSIC_STORAGE_KEY,
  nextGameMusicTrack,
  refreshGameMusicTracks,
  setGameMusicEnabled,
  setGameMusicMode,
  setGameMusicVolume,
} from './gameMusic';

class MockAudio {
  static instances: MockAudio[] = [];
  src = '';
  preload = '';
  volume = 1;
  paused = true;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  addEventListener = vi.fn();
  removeAttribute = vi.fn(() => { this.src = ''; });
  constructor() { MockAudio.instances.push(this); }
}

afterEach(() => {
  setGameMusicMode(null);
  setGameMusicEnabled(false);
  window.localStorage.removeItem(GAME_MUSIC_STORAGE_KEY);
  vi.unstubAllGlobals();
  mocks.list.mockReset();
  MockAudio.instances = [];
});

describe('streamed game music', () => {
  it('finds new MP3s without a hardcoded playlist and loads only the current song', async () => {
    vi.stubGlobal('Audio', MockAudio);
    let names = ['A.mp3', 'B.mp3', 'cover.png'];
    mocks.list.mockImplementation(async () => ({
      data: names.map(name => ({ id: 'file-id', name })), error: null,
    }));

    setGameMusicMode('adult');
    await refreshGameMusicTracks('adult');
    setGameMusicVolume(25);
    setGameMusicEnabled(true);

    expect(MockAudio.instances).toHaveLength(1);
    const audio = MockAudio.instances[0];
    expect(audio.src).toContain('A.mp3');
    expect(audio.volume).toBe(0.25);
    expect(audio.preload).toBe('none');

    names = ['A.mp3', 'B.mp3', 'C.mp3'];
    await refreshGameMusicTracks('adult');
    expect(audio.src).toContain('A.mp3'); // refresh must not interrupt a song
    nextGameMusicTrack();
    expect(audio.src).toContain('B.mp3');
    nextGameMusicTrack();
    expect(audio.src).toContain('C.mp3');
    expect(mocks.list).toHaveBeenCalledWith('game-audio/adult', expect.any(Object));

    setGameMusicMode(null);
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.src).toBe('');
  });
});
