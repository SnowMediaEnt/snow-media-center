import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type GameMusicMode = 'adult' | 'kids';

export const GAME_MUSIC_STORAGE_KEY = 'snow-game-music-v1';

// Only filenames are listed. MP3 bytes are fetched one at a time by Audio.
const tracks: Record<GameMusicMode, string[]> = { adult: [], kids: [] };
const listing: Partial<Record<GameMusicMode, Promise<void>>> = {};

type MusicPreference = { enabled: boolean; volume: number };
type Subscriber = (next: MusicPreference) => void;

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 30;
}

function readPreference(): MusicPreference {
  if (typeof window === 'undefined') return { enabled: true, volume: 30 };
  try {
    const saved = JSON.parse(window.localStorage.getItem(GAME_MUSIC_STORAGE_KEY) ?? 'null');
    return {
      enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : true,
      volume: clampVolume(typeof saved?.volume === 'number' ? saved.volume : 30),
    };
  } catch {
    return { enabled: true, volume: 30 };
  }
}

let preference = readPreference();
let mode: GameMusicMode | null = null;
let player: HTMLAudioElement | null = null;
let loadedPath = '';
let visible = true;
const indices: Record<GameMusicMode, number> = { adult: 0, kids: 0 };
const subscribers = new Set<Subscriber>();

function publicUrl(path: string): string {
  return supabase.storage.from('media-assets').getPublicUrl(path).data.publicUrl;
}

export async function refreshGameMusicTracks(target: GameMusicMode): Promise<void> {
  if (listing[target]) return listing[target];
  const request = (async () => {
    const found: string[] = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const { data, error } = await supabase.storage.from('media-assets').list(`game-audio/${target}`, {
        limit: 100, offset, sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      for (const file of data ?? []) {
        if (file.id && /\.mp3$/i.test(file.name)) found.push(file.name);
      }
      if (!data || data.length < 100) break;
    }
    const currentName = mode === target && loadedPath.startsWith(`game-audio/${target}/`)
      ? loadedPath.slice(`game-audio/${target}/`.length) : tracks[target][indices[target]];
    tracks[target] = Array.from(new Set(found)).sort((a, b) => a.localeCompare(b));
    const retainedIndex = tracks[target].indexOf(currentName);
    indices[target] = retainedIndex >= 0 ? retainedIndex : Math.min(indices[target], Math.max(0, tracks[target].length - 1));
    if (mode === target) playCurrent();
  })();
  listing[target] = request;
  try { await request; } finally { delete listing[target]; }
}

function pauseAndUnload(): void {
  if (!player) return;
  player.pause();
  player.removeAttribute('src');
  loadedPath = '';
  // load() cancels an in-flight MP3 request on older Android WebViews.
  try { player.load(); } catch { /* WebView may be closing */ }
}

function playCurrent(): void {
  if (!mode || !preference.enabled || !visible || typeof Audio === 'undefined') return;
  const track = tracks[mode][indices[mode]];
  if (!track) return;
  const path = `game-audio/${mode}/${track}`;
  if (!player) {
    player = new Audio();
    player.preload = 'none';
    player.addEventListener('ended', () => { nextGameMusicTrack(); });
  }
  if (loadedPath !== path) {
    player.src = publicUrl(path);
    loadedPath = path;
  }
  player.volume = preference.volume / 100;
  if (preference.volume === 0) {
    player.pause();
    return;
  }
  if (player.paused) {
    try { void player.play().catch(() => undefined); } catch { /* gesture not yet accepted */ }
  }
}

function publish(): void {
  try { window.localStorage.setItem(GAME_MUSIC_STORAGE_KEY, JSON.stringify(preference)); } catch { /* private mode */ }
  subscribers.forEach(subscriber => subscriber({ ...preference }));
}

function onVisibility(): void {
  visible = typeof document !== 'undefined' && !document.hidden;
  if (!visible) player?.pause();
  // Do not resume until a real input event after returning to the app.
}

function onGesture(event: Event): void {
  if (event.isTrusted) playCurrent();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== GAME_MUSIC_STORAGE_KEY) return;
  preference = readPreference();
  subscribers.forEach(subscriber => subscriber({ ...preference }));
  if (!preference.enabled) pauseAndUnload();
  else playCurrent();
}

export function setGameMusicMode(next: GameMusicMode | null): void {
  if (mode === next) return;
  pauseAndUnload();
  mode = next;
  if (mode && typeof document !== 'undefined') {
    visible = !document.hidden;
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('keydown', onGesture, true);
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('touchstart', onGesture, true);
    window.addEventListener('storage', onStorage);
    void refreshGameMusicTracks(mode).catch(() => undefined);
    playCurrent();
  } else if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onGesture, true);
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('touchstart', onGesture, true);
    window.removeEventListener('storage', onStorage);
  }
}

export function getGameMusicPreference(): MusicPreference { return { ...preference }; }

export function setGameMusicEnabled(enabled: boolean): void {
  preference = { ...preference, enabled };
  publish();
  if (enabled) playCurrent();
  else pauseAndUnload();
}

export function setGameMusicVolume(volume: number): void {
  preference = { ...preference, volume: clampVolume(volume) };
  publish();
  if (player) player.volume = preference.volume / 100;
  if (preference.volume === 0) player?.pause();
  else playCurrent();
}

export function nextGameMusicTrack(): void {
  if (!mode) return;
  if (!tracks[mode].length) return;
  indices[mode] = (indices[mode] + 1) % tracks[mode].length;
  pauseAndUnload();
  playCurrent();
  void refreshGameMusicTracks(mode).catch(() => undefined);
}

export function useGameMusic() {
  const [music, setMusic] = useState(getGameMusicPreference);
  useEffect(() => {
    subscribers.add(setMusic);
    return () => { subscribers.delete(setMusic); };
  }, []);
  const setEnabled = useCallback(setGameMusicEnabled, []);
  const setVolume = useCallback(setGameMusicVolume, []);
  const nextTrack = useCallback(nextGameMusicTrack, []);
  return { ...music, setEnabled, setVolume, nextTrack };
}
