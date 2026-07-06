// JS bridge for the native Media3/ExoPlayer plugin (com.snowmedia.player.SnowPlayerPlugin).
// Slot-based: every method accepts an optional `screenId` (defaults to "main"
// server-side). Existing callers pass no screenId and stay on the "main" slot.
import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

export interface SnowTrack {
  id: string;          // "groupIndex:trackIndex", or "-1" = OFF
  label: string;
  language?: string;
  codec?: string;
  selected: boolean;
}

/** Sidecar subtitle track passed at load time (Plex external subs, etc.). */
export interface SnowSubtitle {
  url: string;
  lang?: string;
  label?: string;
  /** MIME type; defaults to application/x-subrip on native. */
  mime?: string;
}

export interface SnowPlayerLoadOpts {
  url: string;
  /** true (default) = live IPTV: STATE_ENDED → reconnect. false = VOD: STATE_ENDED emits 'ended' state, reconnects resume-at-position. */
  live?: boolean;
  isLive?: boolean; // legacy alias
  subtitles?: SnowSubtitle[];
  /** Optional multi-screen slot id. Omit → "main". */
  screenId?: string;
}

export interface SnowScreenOpts { screenId?: string }

export interface SnowPlayerPlugin {
  load(opts: SnowPlayerLoadOpts): Promise<void>;
  play(opts?: SnowScreenOpts): Promise<void>;
  pause(opts?: SnowScreenOpts): Promise<void>;
  stop(opts?: SnowScreenOpts): Promise<void>;
  /** Stop every slot and clear the keep-screen-on flag. */
  stopAll(): Promise<void>;
  /** Seek to an absolute position (seconds). */
  seekTo(opts: { position: number; screenId?: string }): Promise<void>;
  /** Poll current playhead + duration (seconds). duration = 0 when unknown/live. */
  getPosition(opts?: SnowScreenOpts): Promise<{ position: number; duration: number; playing: boolean }>;
  /** Position/size the native video surface in DEVICE px (CSS rect * devicePixelRatio). w/h<=0 = fullscreen. */
  setRect(opts: { x: number; y: number; width: number; height: number; screenId?: string }): Promise<void>;
  setVolume(opts: { volume: number; screenId?: string }): Promise<void>;
  /** Disable audio decoding entirely on a slot (cheaper than volume 0 on Fire TV). */
  setAudioEnabled(opts: { enabled: boolean; screenId?: string }): Promise<void>;
  getAudioTracks(opts?: SnowScreenOpts): Promise<{ tracks: SnowTrack[] }>;
  setAudioTrack(opts: { id: string; screenId?: string }): Promise<void>;
  getSubtitleTracks(opts?: SnowScreenOpts): Promise<{ tracks: SnowTrack[] }>;
  setSubtitleTrack(opts: { id: string; screenId?: string }): Promise<void>;
  addListener(
    event: 'playerState' | 'playerError' | 'tracksChanged',
    cb: (data: { screenId?: string; state?: string; playing?: boolean; code?: string; message?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const webFallback: SnowPlayerPlugin = {
  async load() {},
  async play() {},
  async pause() {},
  async stop() {},
  async stopAll() {},
  async seekTo() {},
  async getPosition() { return { position: 0, duration: 0, playing: false }; },
  async setRect() {},
  async setVolume() {},
  async setAudioEnabled() {},
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
