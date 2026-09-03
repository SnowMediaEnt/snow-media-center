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
  /** False when this device has no decoder for the track. An unsupported audio
   *  track is silently deselected by ExoPlayer — video plays with no sound. */
  supported?: boolean;
  mimeType?: string;
  channels?: number;
}

/** Device audio-decode capability, for support diagnostics. */
export interface SnowDecoderInfo {
  /** FFmpeg software decoding (AC-3/E-AC-3/DTS/TrueHD) actually loaded here. */
  ffmpegAvailable: boolean;
  ffmpegVersion: string;
  abis: string[];
  device: string;
  sdk: number;
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


/**
 * Screen format. The picture is drawn into a full-screen surface, so "fit" is
 * a correction, not a preference — without it every video is stretched to the
 * panel and anything that is not 16:9 comes out the wrong shape.
 *
 * `wide` deliberately ignores what the stream says its shape is. That is the
 * escape hatch for a badly flagged or anamorphic file, which is the case that
 * looks "full when it should be wide".
 */
export type ScreenFormat = 'fit' | 'fill' | 'zoom' | 'wide';

export const SCREEN_FORMATS: Array<{ id: ScreenFormat; label: string; hint: string }> = [
  { id: 'fit',  label: 'Fit',       hint: 'Whole picture, correct shape' },
  { id: 'zoom', label: 'Zoom',      hint: 'Fills the screen, edges cropped' },
  { id: 'wide', label: 'Wide 16:9', hint: 'Force widescreen' },
  { id: 'fill', label: 'Stretch',   hint: 'Fills the screen, shape ignored' },
];

/** Where the choice is remembered, so it survives leaving the player. */
export const SCREEN_FORMAT_KEY = 'smc-screen-format-v1';


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
  setRect(opts: { x: number; y: number; width: number; height: number; cssW?: number; cssH?: number; fullscreen?: boolean; screenId?: string }): Promise<void>;
  setVolume(opts: { volume: number; screenId?: string }): Promise<void>;
  /** Screen format — see SCREEN_FORMATS. Native only; a no-op on web. */
  setResizeMode(opts: { mode: ScreenFormat; screenId?: string }): Promise<{ mode: string }>;
  getResizeMode(opts?: { screenId?: string }): Promise<{ mode: string }>;
  /** Disable audio decoding entirely on a slot (cheaper than volume 0 on Fire TV). */
  setAudioEnabled(opts: { enabled: boolean; screenId?: string }): Promise<void>;
  getAudioTracks(opts?: SnowScreenOpts): Promise<{ tracks: SnowTrack[] }>;
  setAudioTrack(opts: { id: string; screenId?: string }): Promise<void>;
  getSubtitleTracks(opts?: SnowScreenOpts): Promise<{ tracks: SnowTrack[] }>;
  setSubtitleTrack(opts: { id: string; screenId?: string }): Promise<void>;
  /** Whether this device can software-decode Dolby/DTS. Use for diagnostics. */
  getDecoderInfo(): Promise<SnowDecoderInfo>;
  addListener(
    event: 'playerState' | 'playerError' | 'tracksChanged' | 'audioUnsupported',
    cb: (data: {
      screenId?: string; state?: string; playing?: boolean; code?: string; message?: string;
      /** audioUnsupported: the codecs present that this device cannot decode. */
      codecs?: string; ffmpegAvailable?: boolean;
    }) => void,
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
  async setResizeMode() { return { mode: 'fit' }; },
  async getResizeMode() { return { mode: 'fit' }; },
  async setAudioEnabled() {},
  async getAudioTracks() { return { tracks: [] }; },
  async setAudioTrack() {},
  async getSubtitleTracks() { return { tracks: [] }; },
  async setSubtitleTrack() {},
  async getDecoderInfo() {
    return { ffmpegAvailable: false, ffmpegVersion: '', abis: [], device: 'web', sdk: 0 };
  },
  async addListener() { return { remove: async () => {} } as PluginListenerHandle; },
};

export const SnowPlayer = registerPlugin<SnowPlayerPlugin>('SnowPlayer', { web: webFallback });

/** True when the native ExoPlayer plugin is actually available (native build, plugin registered). */
export function hasNativePlayer(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SnowPlayer');
}
