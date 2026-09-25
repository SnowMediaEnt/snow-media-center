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
  /** Where to start, in seconds (a film resumed part-way). The player opens
   *  the file right there instead of at 0 followed by a seekTo. Omit or 0 →
   *  the player's own start (the beginning, or a channel's live edge). */
  startPosition?: number;
  /** Optional multi-screen slot id. Omit → "main". */
  screenId?: string;
}

export interface SnowScreenOpts { screenId?: string }

/**
 * What the player is doing right now, for the stats panel (getStats). Read on
 * demand; the plugin answers from what it already holds. Codec names, numbers
 * and error code names only — never a URL or a token. The speeds and frames
 * are this load's; the restarts and last error are this title's, so a retry
 * of the same one keeps them. A stop clears everything, decoders and formats
 * included, and a stream that has been replaced never reports into the next.
 */
export interface PlayerStats {
  state: 'idle' | 'buffering' | 'ready' | 'ended';
  playing: boolean;
  positionSec: number;
  durationSec: number;
  bufferedAheadSec: number;
  /** The player's own download speed, kbps, from its 3-second samples (main
   *  slot only). `now` is the last sample, 0 included; min / max / average
   *  count only the samples in which data arrived, since a pause or a full
   *  buffer is not the server being slow. Null before the first sample. */
  nowKbps: number | null;
  avgKbps: number | null;
  minKbps: number | null;
  maxKbps: number | null;
  /** The decoder's own name, or "FFmpeg (software)". */
  videoDecoder: string | null;
  /** e.g. "HEVC 1920x804 23.98fps 21.6 Mb/s"; parts the stream doesn't state
   *  are left out (a file played as it is rarely states its bit rate). */
  videoFormat: string | null;
  renderedFrames: number | null;
  droppedFrames: number | null;
  /** The decoder's own name, "FFmpeg (software)", or "Passthrough" (Dolby or
   *  DTS sent on to the TV or receiver as it is). */
  audioDecoder: string | null;
  /** e.g. "EAC3 8ch 48.0kHz" */
  audioFormat: string | null;
  /** Times the plugin restarted this stream by itself, and why the last time:
   *  "no picture in 8 s", "stream error <CODE>", "server stopped responding",
   *  "live stream ended". */
  restarts: number;
  lastRestartReason: string | null;
  /** The code name of the last error that made the player restart or stop
   *  (e.g. "ERROR_CODE_IO_BAD_HTTP_STATUS"). Set before that error's
   *  playerError is sent, so a playerError handler can read it here: behind
   *  a RECONNECT_EXHAUSTED, ERROR_CODE_IO_BAD_HTTP_STATUS is a server that
   *  refused the file, not one that stopped answering. */
  lastError: string | null;
  /** How far ahead the player reads, e.g. "steady · 50 s / 128 MB, 20 s floor". */
  loadProfile: string | null;
  javaHeapMb: number | null;
  nativeHeapMb: number | null;
}

/** Stats with nothing playing: what the web build answers, and a stand-in
 *  for an older app whose plugin has no getStats yet. */
export function emptyPlayerStats(): PlayerStats {
  return {
    state: 'idle', playing: false, positionSec: 0, durationSec: 0, bufferedAheadSec: 0,
    nowKbps: null, avgKbps: null, minKbps: null, maxKbps: null,
    videoDecoder: null, videoFormat: null, renderedFrames: null, droppedFrames: null,
    audioDecoder: null, audioFormat: null,
    restarts: 0, lastRestartReason: null, lastError: null, loadProfile: null,
    javaHeapMb: null, nativeHeapMb: null,
  };
}


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
  /** Position/size the native video surface in DEVICE px (CSS rect * devicePixelRatio). w/h<=0 = fullscreen.
   *  `blank`: a new stream is about to load here — black out the current picture now; it stays black until the next load's first frame. */
  setRect(opts: { x: number; y: number; width: number; height: number; cssW?: number; cssH?: number; fullscreen?: boolean; screenId?: string; blank?: boolean }): Promise<void>;
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
  /** The stats panel's figures for a slot (main by default); see PlayerStats.
   *  An app built before this existed rejects the call. */
  getStats(opts?: SnowScreenOpts): Promise<PlayerStats>;
  addListener(
    event: 'playerState' | 'playerError' | 'tracksChanged' | 'audioUnsupported' | 'bandwidth' | 'preBuffer',
    cb: (data: {
      screenId?: string; state?: string; playing?: boolean;
      /** playerError: the player's own ERROR_CODE_* name, AUDIO_DECODE, or
       *  RECONNECT_EXHAUSTED once the plugin has given up (a channel after
       *  20 restarts in a row, a film or episode after 3). A film's message
       *  then says how its server failed: "The server stopped responding.
       *  Try again." or "The Plex server refused this file (HTTP 404)."
       *  Never a URL. */
      code?: string; message?: string;
      /** playerState: paused on purpose (viewer or system). `playing` also
       *  drops on every stall; this does not. Older builds never send it. */
      paused?: boolean;
      /** audioUnsupported: the codecs present that this device cannot decode. */
      codecs?: string; ffmpegAvailable?: boolean;
      /** bandwidth (main slot, every 3 s while data flows): how fast the
       *  player's own downloads are arriving, kbps. */
      kbps?: number;
      /** preBuffer (main slot, every 500 ms while a film's start is held to
       *  fill the buffer): video buffered ahead / the target, time held / the
       *  limit, all ms; `done` on the last one. */
      bufferedMs?: number; targetMs?: number; elapsedMs?: number; maxWaitMs?: number; done?: boolean;
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
  async getStats() { return emptyPlayerStats(); },
  async addListener() { return { remove: async () => {} } as PluginListenerHandle; },
};

export const SnowPlayer = registerPlugin<SnowPlayerPlugin>('SnowPlayer', { web: webFallback });

/** True when the native ExoPlayer plugin is actually available (native build, plugin registered). */
export function hasNativePlayer(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SnowPlayer');
}
