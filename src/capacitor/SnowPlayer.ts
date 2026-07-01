// JS bridge for the native Media3/ExoPlayer plugin (com.snowmedia.player.SnowPlayerPlugin).
import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

export interface SnowTrack {
  id: string;          // "groupIndex:trackIndex", or "-1" = OFF
  label: string;
  language?: string;
  codec?: string;
  selected: boolean;
}

export interface SnowPlayerPlugin {
  load(opts: { url: string; isLive?: boolean }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  /** Position/size the native video surface in DEVICE px (CSS rect * devicePixelRatio). w/h<=0 = fullscreen. */
  setRect(opts: { x: number; y: number; width: number; height: number }): Promise<void>;
  setVolume(opts: { volume: number }): Promise<void>;
  getAudioTracks(): Promise<{ tracks: SnowTrack[] }>;
  setAudioTrack(opts: { id: string }): Promise<void>;
  getSubtitleTracks(): Promise<{ tracks: SnowTrack[] }>;
  setSubtitleTrack(opts: { id: string }): Promise<void>;
  addListener(
    event: 'playerState' | 'playerError' | 'tracksChanged',
    cb: (data: { state?: string; playing?: boolean; code?: string; message?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const webFallback: SnowPlayerPlugin = {
  async load() {},
  async play() {},
  async pause() {},
  async stop() {},
  async setRect() {},
  async setVolume() {},
  async getAudioTracks() { return { tracks: [] }; },
  async setAudioTrack() {},
  async getSubtitleTracks() { return { tracks: [] }; },
  async setSubtitleTrack() {},
  async addListener() { return { remove: async () => {} } as PluginListenerHandle; },
};

export const SnowPlayer = registerPlugin<SnowPlayerPlugin>('SnowPlayer', { web: webFallback });

/** True when the native ExoPlayer plugin is actually available (native build, plugin registered). */
export function hasNativePlayer(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SnowPlayer');
}
