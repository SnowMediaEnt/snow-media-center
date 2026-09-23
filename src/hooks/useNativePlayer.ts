// Lifecycle owner for the native ExoPlayer/Media3 SnowPlayer plugin, wrapped
// as a React hook. Registers NO back/keydown listeners (existing handlers
// keep full ownership of Back). Handles: load nonce (zap → quick Back),
// volume sync, buffering + fatal-error state with exponential-backoff
// auto-retry (matches VideoPlayer's shape), background stop + resume, and
// the 'streaming-active' documentElement flag for parity.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SnowPlayer, type SnowSubtitle } from '@/capacitor/SnowPlayer';
import { createNativeVideoController, type NativeControllerHandle } from '@/lib/nativeVideoController';
import type { VideoController } from '@/components/livetv/VideoPlayer';
import { enterQuiet, exitQuiet } from '@/utils/quietMode';
import { beginStream as diagBegin, endStream as diagEnd, setBuffering as diagBuffering } from '@/lib/bufferDiagnostics';

interface UseNativePlayerArgs {
  active: boolean;
  url: string | null;
  volume: number;
  /** false = VOD (Plex movies/episodes). Defaults true for backward compat (Live TV). */
  live?: boolean;
  /** Sidecar subtitles passed at load. */
  subtitles?: SnowSubtitle[];
  /** Seconds to resume at after load. */
  startPosition?: number;
  maxRetries?: number;
  onTracksChanged?: () => void;
  onPlayStateChange?: (paused: boolean) => void;
  /** Fired when the native player emits state='ended' (VOD only). */
  onEnded?: () => void;
  /** Fired when the hook triggers a reload (app resume / visibility return). */
  onReload?: () => void;
  /**
   * Where the picture goes, in CSS px of the viewport. `undefined` (the
   * default) is fullscreen. `null` means "not measured yet": the stream
   * loads but no rect is sent until one arrives. A change while active is
   * applied in place — the same stream moves between a preview box and
   * fullscreen without reloading.
   */
  rect?: NativeRect | null;
  /**
   * Whether this playback should quieten the rest of the app (quiet mode,
   * the `streaming-active` flag that pauses updaters and the content bar).
   * True for fullscreen viewing; false for a preview box the viewer is
   * browsing beside, where the screen behind must keep working.
   */
  background?: boolean;
}

export interface NativeRect { x: number; y: number; width: number; height: number }

export interface NativePlayerState {
  controller: VideoController | null;
  buffering: boolean;
  error: { code?: string; message: string } | null;
  /** Set when the stream carries audio this device can't decode. NOT an error —
   *  video keeps playing, there is simply no sound. */
  audioWarning: { codecs: string; ffmpegAvailable: boolean } | null;
  retry: () => void;
  seekTo: (seconds: number) => Promise<void>;
  getPosition: () => Promise<{ position: number; duration: number; playing: boolean }>;
}

const MAX_RETRIES_DEFAULT = 5;

/** A CSS-px viewport rect for the plugin, which scales it to device px
 *  against the WebView's own size. Degenerate rects are dropped. */
async function applyRect(r: NativeRect): Promise<void> {
  const l = Math.round(r.x), t = Math.round(r.y);
  const w = Math.round(r.x + r.width) - l, h = Math.round(r.y + r.height) - t;
  if (w <= 0 || h <= 0) return;
  await SnowPlayer.setRect({
    x: l, y: t, width: w, height: h,
    cssW: Math.round(window.innerWidth), cssH: Math.round(window.innerHeight),
  });
}

export function useNativePlayer({ active, url, volume, live = true, subtitles, startPosition, maxRetries = MAX_RETRIES_DEFAULT, onTracksChanged, onPlayStateChange, onEnded, onReload, rect, background = true }: UseNativePlayerArgs): NativePlayerState {
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [audioWarning, setAudioWarning] = useState<{ codecs: string; ffmpegAvailable: boolean } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const handleRef = useRef<NativeControllerHandle | null>(null);
  const [controller, setController] = useState<VideoController | null>(null);
  const nonceRef = useRef(0);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);

  const cbTracksRef = useRef(onTracksChanged);
  const cbPlayStateRef = useRef(onPlayStateChange);
  const cbEndedRef = useRef(onEnded);
  const cbReloadRef = useRef(onReload);
  useEffect(() => { cbTracksRef.current = onTracksChanged; }, [onTracksChanged]);
  useEffect(() => { cbPlayStateRef.current = onPlayStateChange; }, [onPlayStateChange]);
  useEffect(() => { cbEndedRef.current = onEnded; }, [onEnded]);
  useEffect(() => { cbReloadRef.current = onReload; }, [onReload]);
  const rectRef = useRef(rect);
  const backgroundRef = useRef(background);
  backgroundRef.current = background;

  const markStreaming = (on: boolean) => {
    // A preview never claims the screen: the flag would stop the updater,
    // alerts and the content bar while the viewer is only browsing.
    if (on && !backgroundRef.current) return;
    try {
      if (on) document.documentElement.classList.add('streaming-active');
      else document.documentElement.classList.remove('streaming-active');
    } catch { /* ignore */ }
  };

  // Quiet mode (pause non-essential background jobs) is deliberately NOT
  // tied to markStreaming: ExoPlayer's `playing` flag flips false on every
  // buffering stall, and toggling the html class + re-arming every interval
  // mid-stall is exactly the churn a starved Fire TV can't afford. Quiet is
  // entered once the stream is primed / playing and released only on the
  // terminal paths (ended, fatal error, hidden, active=false, unmount).
  const quietOn = () => { if (!backgroundRef.current) return; try { enterQuiet('native-player'); } catch { /* ignore */ } };
  const quietOff = () => { try { exitQuiet('native-player'); } catch { /* ignore */ } };

  const clearRetryTimer = () => {
    if (retryTimerRef.current) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  };

  const retryBusyRef = useRef(false);
  const retry = useCallback(() => {
    if (retryBusyRef.current) return;
    retryBusyRef.current = true;
    retriesRef.current = 0;
    setError(null);
    setRetryNonce((n) => n + 1);
    window.setTimeout(() => { retryBusyRef.current = false; }, 800);
  }, []);

  // Ensure controller handle exists exactly once while active.
  useEffect(() => {
    if (!active) return;
    if (!handleRef.current) {
      handleRef.current = createNativeVideoController({
        onTracksChanged: () => cbTracksRef.current?.(),
        onPlayStateChange: (p) => cbPlayStateRef.current?.(p),
      });
      setController(handleRef.current.controller);
    }
    return () => {
      // Full teardown handled by the load effect below on active=false.
    };
  }, [active]);

  // Global player-error / state listeners tied to buffering + retry logic.
  useEffect(() => {
    if (!active) return;
    let stateH: { remove?: () => void } | null = null;
    let errH: { remove?: () => void } | null = null;
    let audioH: { remove?: () => void } | null = null;
    // Added after awaits: if the player went inactive in between, the cleanup
    // below has already run, so each handle removes itself as it arrives.
    let gone = false;
    const keep = <T extends { remove?: () => void }>(h: T): T | null => {
      if (gone) { try { h?.remove?.(); } catch { /* ignore */ } return null; }
      return h;
    };
    (async () => {
      try {
        audioH = keep(await SnowPlayer.addListener('audioUnsupported', (data) => {
          if (data.screenId && data.screenId !== 'main') return;
          setAudioWarning({
            codecs: data.codecs || 'unknown',
            ffmpegAvailable: data.ffmpegAvailable === true,
          });
        }));
        if (gone) return;
        stateH = keep(await SnowPlayer.addListener('playerState', (data) => {
          if ((data as { screenId?: string }).screenId && (data as { screenId?: string }).screenId !== 'main') return;
          // Mirror stall state into the buffering diagnostics (never throws).
          if (data.state === 'buffering') { setBuffering(true); try { diagBuffering(true); } catch { /* ignore */ } }
          else if (data.state === 'ready') { setBuffering(false); try { diagBuffering(false); } catch { /* ignore */ } }
          else if (data.state === 'ended') { markStreaming(false); quietOff(); try { diagEnd(); } catch { /* ignore */ } cbEndedRef.current?.(); }
          // Playing is authoritative — clear the spinner immediately.
          if (data.playing === true) { setBuffering(false); quietOn(); try { diagBuffering(false); } catch { /* ignore */ } }
          if (typeof data.playing === 'boolean') markStreaming(data.playing);
        }));
        if (gone) return;
        errH = keep(await SnowPlayer.addListener('playerError', (data) => {
          if ((data as { screenId?: string }).screenId && (data as { screenId?: string }).screenId !== 'main') return;
          markStreaming(false);
          quietOff();
          try { diagEnd(); } catch { /* ignore */ }
          const msg = data.message || 'Playback error';
          const code = data.code;
          // AUDIO_DECODE is a codec-init failure — auto-retrying the same URL
          // won't fix it. Surface immediately so the caller (PlexSection) can
          // fall back to a server-side transcode.
          // RECONNECT_EXHAUSTED means the native side already tried 20 times,
          // and every load() here restarts that count — so one fresh start,
          // not maxRetries × 20 more connections to a dead stream.
          if (code === 'AUDIO_DECODE' || retriesRef.current >= maxRetries
            || (code === 'RECONNECT_EXHAUSTED' && retriesRef.current >= 1)) {
            setError({ code, message: msg });
            return;
          }
          retriesRef.current += 1;
          const delay = Math.min(8000, 500 * 2 ** retriesRef.current);
          clearRetryTimer();
          retryTimerRef.current = window.setTimeout(() => { setRetryNonce((n) => n + 1); }, delay) as unknown as number;
        }));
      } catch { /* ignore */ }
    })();
    return () => {
      gone = true;
      try { stateH?.remove?.(); } catch { /* ignore */ }
      try { errH?.remove?.(); } catch { /* ignore */ }
      try { audioH?.remove?.(); } catch { /* ignore */ }
    };
  }, [active, maxRetries]);

  // Reset retry counter only when the source URL changes (not on retryNonce),
  // so RECONNECT_EXHAUSTED auto-retries accumulate against maxRetries and the
  // error panel eventually surfaces on permanently hung streams.
  useEffect(() => {
    retriesRef.current = 0;
    // Codec support is per-stream — don't carry a warning to the next channel.
    setAudioWarning(null);
  }, [active, url]);

  // Main load pipeline — runs on (active, url, retryNonce) changes.
  useEffect(() => {
    if (!active || !url) return;
    const myNonce = ++nonceRef.current;
    let cancelled = false;
    setBuffering(true);
    setError(null);
    clearRetryTimer();
    // Buffering diagnostics: ExoPlayer has no engine throughput stats, so the
    // module samples the stream host itself (VOD / opt-in) and probes general
    // internet during stalls. Retries re-enter here and count as a new stream.
    try { diagBegin(url, live ? 'live' : 'vod'); diagBuffering(true); } catch { /* ignore */ }

    (async () => {
      try {
        const r = rectRef.current;
        if (r === undefined) await SnowPlayer.setRect({ x: 0, y: 0, width: 0, height: 0, fullscreen: true });
        else if (r) await applyRect(r);
        if (cancelled || myNonce !== nonceRef.current) return;
        await SnowPlayer.load({ url, live, isLive: live, subtitles });
        if (cancelled || myNonce !== nonceRef.current) return;
        if (startPosition && startPosition > 0) {
          try { await SnowPlayer.seekTo({ position: startPosition }); } catch { /* ignore */ }
        }
        if (cancelled || myNonce !== nonceRef.current) return;
        await SnowPlayer.setVolume({ volume: Math.min(1, Math.max(0, volume)) });
        if (cancelled || myNonce !== nonceRef.current) return;
        await handleRef.current?.prime();
        // Every other await above is followed by this check; this one was
        // not. A teardown during prime() then re-flagged streaming-active
        // and quiet mode AFTER the player had gone — and nothing ever cleared
        // them, so alerts, updater checks and the content-bar refresh stayed
        // paused for the rest of the session.
        if (cancelled || myNonce !== nonceRef.current) return;
        markStreaming(true);
        quietOn();
      } catch (e) {
        if (cancelled || myNonce !== nonceRef.current) return;
        setError({ message: (e as Error)?.message || 'Failed to load stream' });
      }
    })();

    return () => {
      cancelled = true;
    };
    // volume intentionally omitted — separate effect handles live volume changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, url, retryNonce]);

  // The picture's place on screen, applied in place while playing. Going
  // from a preview box to fullscreen and back is this alone: same stream,
  // no reload.
  useEffect(() => {
    rectRef.current = rect;
    if (!active) return;
    if (rect === undefined) void SnowPlayer.setRect({ x: 0, y: 0, width: 0, height: 0, fullscreen: true }).catch(() => { /* ignore */ });
    else if (rect) void applyRect(rect).catch(() => { /* ignore */ });
  }, [active, rect]);

  // Preview -> fullscreen with no reload skips the load pipeline, so the
  // screen-owning flags are settled here when `background` flips.
  useEffect(() => {
    if (!active) return;
    if (background) { markStreaming(true); quietOn(); }
    else { markStreaming(false); quietOff(); }
    // markStreaming/quietOn read backgroundRef, which is set above in render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, background]);

  // Live volume sync.
  useEffect(() => {
    if (!active) return;
    void SnowPlayer.setVolume({ volume: Math.min(1, Math.max(0, volume)) }).catch(() => { /* ignore */ });
  }, [active, volume]);

  // Absolute stop on active flip / unmount.
  useEffect(() => {
    if (active) return;
    // active turned false — hard stop + teardown controller handle.
    clearRetryTimer();
    markStreaming(false);
    quietOff();
    try { diagEnd(); } catch { /* ignore */ }
    void SnowPlayer.stop().catch(() => { /* ignore */ });
    if (handleRef.current) {
      try { handleRef.current.dispose(); } catch { /* ignore */ }
      handleRef.current = null;
      setController(null);
    }
    setBuffering(false);
    setError(null);
    retriesRef.current = 0;
  }, [active]);

  useEffect(() => {
    return () => {
      clearRetryTimer();
      markStreaming(false);
      quietOff();
      try { diagEnd(); } catch { /* ignore */ }
      void SnowPlayer.stop().catch(() => { /* ignore */ });
      if (handleRef.current) {
        try { handleRef.current.dispose(); } catch { /* ignore */ }
        handleRef.current = null;
      }
    };
  }, []);

  // Background/resume parity with VideoPlayer.
  useEffect(() => {
    if (!active) return;
    let capH: { remove?: () => void } | undefined;
    let cancelled = false;
    // visibilitychange and appStateChange both fire on every background and
    // resume; without this flag the stream was opened twice on each resume.
    let hidden = false;
    const onHidden = () => {
      if (hidden) return;
      hidden = true;
      void SnowPlayer.stop().catch(() => { /* ignore */ }); markStreaming(false); quietOff(); try { diagEnd(); } catch { /* ignore */ }
    };
    const onVisible = () => {
      if (!hidden) return;
      hidden = false;
      try { cbReloadRef.current?.(); } catch { /* ignore */ } setRetryNonce((n) => n + 1);
    };
    const onVis = () => { if (document.hidden) onHidden(); else onVisible(); };
    document.addEventListener('visibilitychange', onVis);
    (async () => {
      try {
        const mod = await import('@capacitor/app');
        const h = await mod.App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) onHidden();
          else onVisible();
        });
        if (cancelled) h?.remove?.();
        else capH = h;
      } catch { /* web */ }
    })();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      capH?.remove?.();
    };
  }, [active]);

  const seekTo = useCallback(async (seconds: number) => {
    try { await SnowPlayer.seekTo({ position: Math.max(0, seconds) }); } catch { /* ignore */ }
  }, []);
  const getPosition = useCallback(async () => {
    try { return await SnowPlayer.getPosition(); } catch { return { position: 0, duration: 0, playing: false }; }
  }, []);

  return useMemo(
    () => ({ controller, buffering, error, audioWarning, retry, seekTo, getPosition }),
    [controller, buffering, error, audioWarning, retry, seekTo, getPosition],
  );
}
