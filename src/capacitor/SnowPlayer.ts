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
  /** 'exo' (default) or 'mpv' — owner test builds only, and only ever
   *  actually used for the main slot on a live channel (EngineChoice).
   *  Anything else (a tile, Plex, VOD) silently plays on ExoPlayer even if
   *  'mpv' is asked for, with no engineFallback — it was never offered
   *  there. Ignored on web. */
  engine?: 'exo' | 'mpv';
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
  /** The HTTP status behind a lastError of ERROR_CODE_IO_BAD_HTTP_STATUS
   *  (e.g. 503), when the server sent one; null otherwise. Older builds
   *  leave it out. */
  httpStatus?: number | null;
  /** How far ahead the player reads, e.g. "steady · 50 s / 128 MB, 20 s floor",
   *  or for mpv "mpv · cache 32 MB · 10 s ahead". */
  loadProfile: string | null;
  javaHeapMb: number | null;
  nativeHeapMb: number | null;
  /** Which engine actually played this stream. */
  engine: 'exo' | 'mpv';
  /** Time to first picture since load(), ms. Null before it has one. */
  firstFrameMs: number | null;
  /** Rebuffers since the first picture (not the start-up wait itself), and
   *  the seconds spent in them. */
  stalls: number;
  stallSec: number;
  /** CPU used by this whole process since load(), against wall time since
   *  load() — not just this stream's own decoding. Null before a load(). */
  cpuPct: number | null;
  /** This process's PSS, cached for a few seconds. */
  pssMb: number | null;
}

/** Stats with nothing playing: what the web build answers, and a stand-in
 *  for an older app whose plugin has no getStats yet. */
export function emptyPlayerStats(): PlayerStats {
  return {
    state: 'idle', playing: false, positionSec: 0, durationSec: 0, bufferedAheadSec: 0,
    nowKbps: null, avgKbps: null, minKbps: null, maxKbps: null,
    videoDecoder: null, videoFormat: null, renderedFrames: null, droppedFrames: null,
    audioDecoder: null, audioFormat: null,
    restarts: 0, lastRestartReason: null, lastError: null, httpStatus: null, loadProfile: null,
    javaHeapMb: null, nativeHeapMb: null,
    engine: 'exo', firstFrameMs: null, stalls: 0, stallSec: 0, cpuPct: null, pssMb: null,
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

/**
 * `label` and `hint` are the English words (tests and older callers read them). The screen shows
 * t(labelKey) and t(hintKey) instead: the words in the app's language, plexApi.screenFormat.*.
 */
export const SCREEN_FORMATS: Array<{ id: ScreenFormat; label: string; hint: string; labelKey: string; hintKey: string }> = [
  { id: 'fit',  label: 'Fit',       hint: 'Whole picture, correct shape',    labelKey: 'plexApi.screenFormat.fit.label',  hintKey: 'plexApi.screenFormat.fit.hint' },
  { id: 'zoom', label: 'Zoom',      hint: 'Fills the screen, edges cropped', labelKey: 'plexApi.screenFormat.zoom.label', hintKey: 'plexApi.screenFormat.zoom.hint' },
  { id: 'wide', label: 'Wide 16:9', hint: 'Force widescreen',                labelKey: 'plexApi.screenFormat.wide.label', hintKey: 'plexApi.screenFormat.wide.hint' },
  { id: 'fill', label: 'Stretch',   hint: 'Fills the screen, shape ignored', labelKey: 'plexApi.screenFormat.fill.label', hintKey: 'plexApi.screenFormat.fill.hint' },
];

/** Where the choice is remembered, so it survives leaving the player. */
export const SCREEN_FORMAT_KEY = 'smc-screen-format-v1';

/**
 * Rewind live TV's on-box buffer (TimeshiftManager in the plugin). "behind"
 * is seconds behind live; 0 while the channel itself plays. ExoPlayer only:
 * a channel on mpv never has a buffer (the state stays 'off').
 */
export interface TimeshiftStatus {
  /** off: no buffer · starting: nothing captured yet · capturing · unavailable: see reason. */
  state: 'off' | 'starting' | 'capturing' | 'unavailable';
  /** live: the channel itself · buffer: the rewound copy. */
  mode: 'live' | 'buffer';
  /** How far back the buffer reaches from live, seconds. */
  availableSec: number;
  behindSec: number;
  usedBytes: number;
  /** Why rewind is unavailable, in the viewer's words. */
  reason?: string;
}

export const timeshiftOff = (): TimeshiftStatus => ({ state: 'off', mode: 'live', availableSec: 0, behindSec: 0, usedBytes: 0 });

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
  /** Whether mpv is offered on this box right now (owner test builds only),
   *  and why not when it isn't. An app built before this existed rejects
   *  the call — callers treat that the same as { available: false }. */
  getEngines(): Promise<{ mpv: { available: boolean; reason?: string } }>;
  /** Rewind live TV: capture the full-screen channel `key` from `url` (same
   *  address the player uses; never logged). The same key again is a no-op;
   *  a new one closes the last channel's buffer at once (no third stream). maxMinutes 0 =
   *  Auto (disk budget only). Does nothing while the channel plays on mpv.
   *  Older builds reject. */
  timeshiftStart(opts: { url: string; key: string; maxMinutes: number; hardCapMb: number }): Promise<void>;
  /** Stop capturing and delete the buffer now. Back to live first. */
  timeshiftStop(): Promise<void>;
  /** Delete every rewind buffer now (leaving the player, sign-out). */
  timeshiftWipe(): Promise<void>;
  timeshiftStatus(): Promise<TimeshiftStatus>;
  /** Back (negative) or forward by deltaSec. Forward past the end = live. */
  timeshiftSeek(opts: { deltaSec: number }): Promise<TimeshiftStatus>;
  timeshiftGoLive(): Promise<TimeshiftStatus>;
  /** The buffer's disk use and the cache volume's free / total bytes. */
  timeshiftUsage(): Promise<{ usedBytes: number; freeBytes: number; totalBytes: number }>;
  addListener(
    event: 'playerState' | 'playerError' | 'tracksChanged' | 'audioUnsupported' | 'bandwidth' | 'preBuffer' | 'engineFallback',
    cb: (data: {
      screenId?: string; state?: string; playing?: boolean;
      /** playerError: the player's own ERROR_CODE_* name, AUDIO_DECODE, or
       *  RECONNECT_EXHAUSTED once the plugin has given up (a channel after
       *  20 restarts in a row, a film or episode after 3). A film's message
       *  then says how its server failed: "The server stopped responding.
       *  Try again." or "The Plex server refused this file (HTTP 404)."
       *  Never a URL.
       *  PLEX_TRANSCODE_HTTP: a Plex conversion the server answered with an
       *  HTTP error status twice in a row (the same session is not tried a
       *  third time). */
      code?: string; message?: string;
      /** playerError: the HTTP status behind it, when the server answered
       *  with one (a number only). Older builds never send it. */
      httpStatus?: number | null;
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
      /** engineFallback: mpv was asked for and could not be used —
       *  'not-in-build' | 'android-too-old' | 'init-failed'. */
      reason?: string;
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
  // Web never has mpv; the reason matches EngineChoice.NOT_IN_BUILD.
  async getEngines() { return { mpv: { available: false, reason: 'not-in-build' } }; },
  async timeshiftStart() {},
  async timeshiftStop() {},
  async timeshiftWipe() {},
  async timeshiftStatus() { return timeshiftOff(); },
  async timeshiftSeek() { return timeshiftOff(); },
  async timeshiftGoLive() { return timeshiftOff(); },
  async timeshiftUsage() { return { usedBytes: 0, freeBytes: 0, totalBytes: 0 }; },
  async addListener() { return { remove: async () => {} } as PluginListenerHandle; },
};

export const SnowPlayer = registerPlugin<SnowPlayerPlugin>('SnowPlayer', { web: webFallback });

/** True when the native ExoPlayer plugin is actually available (native build, plugin registered). */
export function hasNativePlayer(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SnowPlayer');
}
