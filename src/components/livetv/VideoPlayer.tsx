import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle, RotateCw } from 'lucide-react';
import { isFireTV } from '@/utils/platform';

export interface VideoTrackInfo {
  id: number;
  label: string;
  language?: string;
  active: boolean;
}

export interface VideoController {
  play(): void;
  pause(): void;
  togglePlay(): void;
  /** Positive = forward, negative = rewind. Clamped to seekable range. No-op if not seekable. */
  seek(deltaSec: number): void;
  isPaused(): boolean;
  isSeekable(): boolean;
  getSubtitleTracks(): VideoTrackInfo[];
  /** -1 = OFF */
  setSubtitleTrack(id: number): void;
  getAudioTracks(): VideoTrackInfo[];
  setAudioTrack(id: number): void;
}

interface VideoPlayerProps {
  src: string | null;
  volume?: number;
  /**
   * Explicit muted state. When provided, drives both the <video> initial
   * muted attribute AND the fullscreen-vs-preview branching (backward
   * compatible: when undefined, we fall back to `volume > 0` heuristic).
   */
  muted?: boolean;
  className?: string;
  /** Auto-retry attempts on fatal errors (IPTV streams drop often). */
  maxRetries?: number;
  onError?: (msg: string) => void;
  /** Fired when the underlying <video> finishes playback (finite media). */
  onEnded?: () => void;
  /** Emitted once with a stable controller handle (methods delegate to current engine via refs). */
  onReady?: (controller: VideoController) => void;
  /** Emitted when paused state changes (true = paused). */
  onPlayStateChange?: (paused: boolean) => void;
  /** Signal — caller should re-query controller.getSubtitleTracks() / getAudioTracks(). */
  onTracksChanged?: () => void;
}

type Engine = 'hls' | 'mpegts' | 'native';

// True when the URL looks like an Xtream LIVE stream (vs movie/series VOD).
function isLiveSrc(src: string): boolean {
  return /\/live\//i.test(src);
}

// Fire TV's WebView is unreliable with HLS-in-MSE on many Xtream channels —
// decoder silently rejects samples (black screen, timer advances). Swap the
// .m3u8 extension to .ts so we can route through mpegts.js instead.
function swapM3u8ToTs(src: string): string {
  return src.replace(/\.m3u8(\?|$)/i, '.ts$1');
}

function pickEngine(src: string): Engine {
  // Fire TV + live HLS → force mpegts.js path (handled by caller via URL swap).
  if (isFireTV() && isLiveSrc(src) && /\.m3u8(\?|$)/i.test(src)) return 'mpegts';
  const lower = src.split('?')[0].toLowerCase();
  if (lower.endsWith('.m3u8')) return 'hls';
  if (lower.endsWith('.ts'))   return 'mpegts';
  return 'native';
}

const VideoPlayer = memo(({ src, volume = 0.8, muted, className, maxRetries = 5, onError, onEnded, onReady, onPlayStateChange, onTracksChanged }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  const retriesRef = useRef(0);
  // Live engine refs — read by the stable VideoController.
  const engineRef = useRef<Engine>('native');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hlsRef = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // Stable controller handle — emitted once on mount.
  const onTracksChangedRef = useRef(onTracksChanged);
  const onPlayStateRef = useRef(onPlayStateChange);
  useEffect(() => { onTracksChangedRef.current = onTracksChanged; }, [onTracksChanged]);
  useEffect(() => { onPlayStateRef.current = onPlayStateChange; }, [onPlayStateChange]);

  const controllerRef = useRef<VideoController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = {
      play: () => { videoRef.current?.play().catch(() => { /* ignore */ }); },
      pause: () => { try { videoRef.current?.pause(); } catch { /* ignore */ } },
      togglePlay: () => {
        const v = videoRef.current; if (!v) return;
        if (v.paused) v.play().catch(() => { /* ignore */ });
        else { try { v.pause(); } catch { /* ignore */ } }
      },
      seek: (delta: number) => {
        const v = videoRef.current; if (!v) return;
        try {
          const sk = v.seekable;
          if (!sk || sk.length === 0) return;
          const start = sk.start(0);
          const end = sk.end(sk.length - 1);
          if (!Number.isFinite(end - start) || end - start < 1) return;
          const next = Math.min(end - 0.5, Math.max(start, (v.currentTime || end) + delta));
          v.currentTime = next;
        } catch { /* ignore */ }
      },
      isPaused: () => !!videoRef.current?.paused,
      isSeekable: () => {
        const v = videoRef.current; if (!v) return false;
        try {
          const sk = v.seekable;
          if (!sk || sk.length === 0) return false;
          return (sk.end(sk.length - 1) - sk.start(0)) > 1;
        } catch { return false; }
      },
      getSubtitleTracks: () => {
        const hls = hlsRef.current;
        if (hls && Array.isArray(hls.subtitleTracks)) {
          const cur = hls.subtitleTrack;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return hls.subtitleTracks.map((t: any, i: number) => ({
            id: i,
            label: t.name || t.lang || `Sub ${i + 1}`,
            language: t.lang,
            active: i === cur,
          }));
        }
        const v = videoRef.current;
        if (!v || !v.textTracks) return [];
        const out: VideoTrackInfo[] = [];
        for (let i = 0; i < v.textTracks.length; i++) {
          const t = v.textTracks[i];
          if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
          out.push({ id: i, label: t.label || t.language || `Sub ${i + 1}`, language: t.language, active: t.mode === 'showing' });
        }
        return out;
      },
      setSubtitleTrack: (id: number) => {
        const hls = hlsRef.current;
        if (hls && Array.isArray(hls.subtitleTracks)) {
          hls.subtitleTrack = id; // -1 = off
          onTracksChangedRef.current?.();
          return;
        }
        const v = videoRef.current; if (!v || !v.textTracks) return;
        for (let i = 0; i < v.textTracks.length; i++) {
          v.textTracks[i].mode = i === id ? 'showing' : 'disabled';
        }
        onTracksChangedRef.current?.();
      },
      getAudioTracks: () => {
        const hls = hlsRef.current;
        if (hls && Array.isArray(hls.audioTracks)) {
          const cur = hls.audioTrack;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return hls.audioTracks.map((t: any, i: number) => ({
            id: i,
            label: t.name || t.lang || `Audio ${i + 1}`,
            language: t.lang,
            active: i === cur,
          }));
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = videoRef.current as any;
        const at = v?.audioTracks;
        if (!at || !at.length) return [];
        const out: VideoTrackInfo[] = [];
        for (let i = 0; i < at.length; i++) {
          const t = at[i];
          out.push({ id: i, label: t.label || t.language || `Audio ${i + 1}`, language: t.language, active: !!t.enabled });
        }
        return out;
      },
      setAudioTrack: (id: number) => {
        const hls = hlsRef.current;
        if (hls && Array.isArray(hls.audioTracks)) {
          hls.audioTrack = id;
          onTracksChangedRef.current?.();
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = videoRef.current as any;
        const at = v?.audioTracks;
        if (!at) return;
        for (let i = 0; i < at.length; i++) at[i].enabled = i === id;
        onTracksChangedRef.current?.();
      },
    };
  }

  // Emit onReady once.
  const readyEmittedRef = useRef(false);
  useEffect(() => {
    if (readyEmittedRef.current || !controllerRef.current) return;
    readyEmittedRef.current = true;
    try { onReady?.(controllerRef.current); } catch { /* ignore */ }
  }, [onReady]);

  // Keep volume in sync
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = Math.min(1, Math.max(0, volume));
  }, [volume]);

  // ──────────────────────────────────────────────────────────────────────────
  // Stop ALL audio/video when the app is backgrounded (Fire TV HOME button)
  // or the tab/window is hidden. Without this, the engine keeps pushing
  // samples to the decoder and audio continues on the home screen.
  //
  // On background: tear down the hls/mpegts instance AND pause + clear the
  // <video> src + call load() so the media element releases its decoder.
  // On resume: bump retryNonce so the main src-effect re-attaches a fresh
  // engine and resumes playback automatically.
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!src) return;
    let backgrounded = false;

    const stopPlayback = () => {
      if (backgrounded) return;
      backgrounded = true;
      try { teardownRef.current?.(); } catch { /* ignore */ }
      teardownRef.current = null;
      hlsRef.current = null;
      const v = videoRef.current;
      if (v) {
        try { v.pause(); } catch { /* ignore */ }
        try { v.muted = true; } catch { /* ignore */ }
        try { v.removeAttribute('src'); v.load(); } catch { /* ignore */ }
      }
      try { document.documentElement.classList.remove('streaming-active'); } catch { /* ignore */ }
    };

    const resumePlayback = () => {
      if (!backgrounded) return;
      backgrounded = false;
      // Re-run the main attach effect → fresh engine, fresh decoder.
      setRetryNonce(n => n + 1);
    };

    const onVisibility = () => {
      if (document.hidden) stopPlayback();
      else resumePlayback();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Capacitor App.appStateChange — covers Fire TV / Android HOME, which
    // doesn't always fire visibilitychange on the WebView.
    let capHandle: { remove?: () => void } | undefined;
    let cancelledCap = false;
    (async () => {
      try {
        const mod = await import('@capacitor/app');
        const h = await mod.App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) stopPlayback();
          else resumePlayback();
        });
        if (cancelledCap) h?.remove?.();
        else capHandle = h;
      } catch { /* not on native — visibilitychange covers web */ }
    })();

    return () => {
      cancelledCap = true;
      document.removeEventListener('visibilitychange', onVisibility);
      capHandle?.remove?.();
    };
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    retriesRef.current = 0;
    setFatal(null);

    let cancelled = false;
    // Watchdog timers — cleared on src change / unmount / first real frame.
    let watchdogIv: ReturnType<typeof setInterval> | null = null;
    let nativeLoadTimer: ReturnType<typeof setTimeout> | null = null;
    // mpegts.js fallback already attempted? (prevents loops)
    let mpegtsFellBack = false;
    // hls.js MEDIA_ERROR recovery bookkeeping
    let mediaErrorCount = 0;
    let lastMediaErrorAt = 0;

    const clearWatchdogs = () => {
      if (watchdogIv) { clearInterval(watchdogIv); watchdogIv = null; }
      if (nativeLoadTimer) { clearTimeout(nativeLoadTimer); nativeLoadTimer = null; }
    };

    // The fullscreen player is opened by user action and passes muted={false}.
    // The preview tile passes muted={true} (and volume=0) and must stay muted.
    // Backward-compat: if `muted` isn't provided, fall back to legacy heuristic.
    const isFullscreenPlayer = muted === undefined ? (volume ?? 0) > 0 : !muted;

    // Autoplay safety: muted=true cannot be blocked by Chromium autoplay policy.
    const safePlay = async () => {
      try { video.muted = true; } catch { /* ignore */ }
      try {
        await video.play();
        if (isFullscreenPlayer) {
          // User-initiated → safe to unmute and restore intended volume.
          try { video.muted = false; } catch { /* ignore */ }
          try { video.volume = Math.min(1, Math.max(0, volume)); } catch { /* ignore */ }
        }
      } catch {
        /* play() can still reject in rare cases (e.g. detached element) */
      }
    };

    // Tear down whatever engine is currently attached. Idempotent.
    const teardownEngine = () => {
      try { teardownRef.current?.(); } catch { /* ignore */ }
      teardownRef.current = null;
      hlsRef.current = null;
    };

    // Start the no-frames watchdog. Targets the "black video but timer advances"
    // failure mode: MSE samples appended but the decoder emits nothing.
    const startWatchdog = (recover: () => Promise<boolean> | boolean, fallback: () => Promise<void> | void) => {
      clearWatchdogs();
      const startedAt = Date.now();
      let noFramesSince = startedAt;
      let lowReadySince = startedAt;
      let recoveryTriedAt = 0;
      let fallbackTried = false;
      watchdogIv = setInterval(async () => {
        if (cancelled || !video) return;
        if (video.paused) { noFramesSince = Date.now(); lowReadySince = Date.now(); return; }
        const hasFrames = video.videoWidth > 0;
        if (hasFrames) { noFramesSince = Date.now(); }
        if (video.readyState >= 3) { lowReadySince = Date.now(); }

        // Frames are rendering — happy path, stop watching.
        if (hasFrames && video.readyState >= 3) {
          clearWatchdogs();
          return;
        }

        const now = Date.now();
        const noFramesFor = now - noFramesSince;
        const lowReadyFor = now - lowReadySince;
        const stuck = noFramesFor >= 8000 || lowReadyFor >= 10000;
        if (!stuck) return;

        // First remediation: ask the engine to recover.
        if (!recoveryTriedAt) {
          recoveryTriedAt = now;
          try { await recover(); } catch { /* ignore */ }
          // Give recovery ~6s before escalating to fallback.
          noFramesSince = now;
          lowReadySince = now;
          return;
        }
        if (now - recoveryTriedAt < 6000) return;

        // Escalate to fallback engine, once.
        if (fallbackTried) return;
        fallbackTried = true;
        clearWatchdogs();
        try { await fallback(); } catch { /* ignore */ }
      }, 2000);
    };

    const attach = async () => {
      // Tear down previous engine + watchdogs before mounting a new one.
      clearWatchdogs();
      teardownEngine();
      setLoading(true);

      const engine = pickEngine(src);
      engineRef.current = engine;

      try {
        if (engine === 'hls') {
          // Safari has native HLS — prefer it when available
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = src;
            await safePlay();
            return;
          }
          const Hls = (await import('hls.js')).default;
          if (Hls.isSupported()) {
            const hls = new Hls({
              liveDurationInfinity: true,
              // lowLatencyMode:true triggers MSE end-of-stream bugs on older
              // (Fire OS) Chromium WebViews. The default off is safer everywhere.
              lowLatencyMode: false,
              enableWorker: true,
              backBufferLength: 30,
            });
            hlsRef.current = hls;
            hls.loadSource(src);
            hls.attachMedia(video);
            const fireTracks = () => { try { onTracksChangedRef.current?.(); } catch { /* ignore */ } };
            hls.on(Hls.Events.MANIFEST_PARSED, fireTracks);
            hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, fireTracks);
            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, fireTracks);
            hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, fireTracks);
            hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, fireTracks);
            hls.on(Hls.Events.ERROR, (_evt, data) => {
              // MEDIA_ERROR recovery ladder — handles decoder hiccups that
              // would otherwise leave the screen black with audio drifting.
              if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                const now = Date.now();
                const recent = now - lastMediaErrorAt < 3000;
                lastMediaErrorAt = now;
                mediaErrorCount = recent ? mediaErrorCount + 1 : 1;
                try {
                  if (mediaErrorCount === 1) {
                    hls.recoverMediaError();
                  } else if (mediaErrorCount === 2) {
                    hls.swapAudioCodec();
                    hls.recoverMediaError();
                  } else if (data.fatal) {
                    // Recovery exhausted — surface + retry/destroy path.
                    onError?.(`HLS ${data.type}: ${data.details}`);
                    scheduleRetry();
                  }
                } catch {
                  if (data.fatal) {
                    onError?.(`HLS ${data.type}: ${data.details}`);
                    scheduleRetry();
                  }
                }
                return;
              }
              if (data.fatal) {
                onError?.(`HLS ${data.type}: ${data.details}`);
                scheduleRetry();
              }
            });
            teardownRef.current = () => { try { hls.destroy(); } catch { /* ignore */ } };
            await safePlay();

            // Watchdog: if no frames render, try hls.recoverMediaError() once;
            // if still stuck, fall back to mpegts.js with the .ts URL.
            startWatchdog(
              () => { try { hls.recoverMediaError(); } catch { /* ignore */ } return true; },
              async () => {
                if (cancelled || mpegtsFellBack) return;
                if (!isLiveSrc(src)) return; // VOD has no .ts fallback
                mpegtsFellBack = true;
                teardownEngine();
                await attachMpegts(swapM3u8ToTs(src));
              },
            );
            return;
          }
          // Last resort
          video.src = src;
          await safePlay();
          return;
        }

        if (engine === 'mpegts') {
          // Live engine swap (Fire TV) — pick .ts URL when caller still has .m3u8.
          const tsUrl = /\.m3u8(\?|$)/i.test(src) ? swapM3u8ToTs(src) : src;
          await attachMpegts(tsUrl);
          return;
        }

        // Native <video> (VOD: mp4/mkv/avi/…)
        video.src = src;
        await safePlay();

        // VOD load-timeout watchdog — replaces the swallowed catch. If
        // nothing meaningful happens in 12s, the device can't decode this
        // container/codec: surface an error instead of freezing the UI.
        let loadProgressed = false;
        const markProgress = () => { loadProgressed = true; };
        video.addEventListener('loadeddata', markProgress, { once: true });
        video.addEventListener('canplay', markProgress, { once: true });
        video.addEventListener('timeupdate', markProgress, { once: true });
        const startCt = video.currentTime;
        nativeLoadTimer = setTimeout(() => {
          if (cancelled) return;
          const moved = video.currentTime > startCt + 0.1;
          if (!loadProgressed && !moved) {
            setLoading(false);
            setFatal("This title's format may not be supported on this device.");
            onError?.("This title's format may not be supported on this device.");
            try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* ignore */ }
          }
        }, 12000);
      } catch (e) {
        onError?.((e as Error).message || 'Playback error');
        scheduleRetry();
      }
    };

    // Mpegts engine attachment, extracted so the HLS watchdog can fall back to it.
    const attachMpegts = async (url: string) => {
      const mpegts = (await import('mpegts.js')).default;
      if (mpegts.getFeatureList().mseLivePlayback) {
        const player = mpegts.createPlayer(
          { type: 'mpegts', url, isLive: true, hasAudio: true, hasVideo: true },
          {
            enableStashBuffer: true,
            stashInitialSize: 1024 * 384,
            liveBufferLatencyChasing: false,
            liveBufferLatencyMaxLatency: 8,
            liveBufferLatencyMinRemain: 2,
            autoCleanupSourceBuffer: true,
          },
        );
        engineRef.current = 'mpegts';
        player.attachMediaElement(video);
        player.load();
        player.on(mpegts.Events.ERROR, (errType: string, errDetail: string) => {
          onError?.(`TS ${errType}: ${errDetail}`);
          scheduleRetry();
        });
        teardownRef.current = () => {
          try { player.unload(); } catch { /* ignore */ }
          try { player.detachMediaElement(); } catch { /* ignore */ }
          try { player.destroy(); } catch { /* ignore */ }
        };
        try { video.muted = true; } catch { /* ignore */ }
        try {
          await player.play();
          if (isFullscreenPlayer) {
            try { video.muted = false; } catch { /* ignore */ }
            try { video.volume = Math.min(1, Math.max(0, volume)); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }

        // Watchdog: if still no frames, give up gracefully (no further fallback).
        startWatchdog(
          () => false,
          async () => {
            if (cancelled) return;
            setLoading(false);
            setFatal('Stream unavailable on this device.');
            onError?.('Stream unavailable on this device.');
            teardownEngine();
          },
        );
        return;
      }
      // mpegts unsupported — fall back to native
      video.src = url;
      await safePlay();
    };

    const scheduleRetry = () => {
      if (cancelled) return;
      if (retriesRef.current >= maxRetries) {
        setLoading(false);
        setFatal('Stream unavailable. Check your connection and try again.');
        return;
      }
      retriesRef.current += 1;
      const delay = Math.min(8000, 500 * 2 ** retriesRef.current);
      setTimeout(() => { if (!cancelled) attach(); }, delay);
    };

    const markStreaming = (on: boolean) => {
      try {
        if (on) document.documentElement.classList.add('streaming-active');
        else document.documentElement.classList.remove('streaming-active');
      } catch { /* ignore */ }
    };

    const onPlaying = () => { setLoading(false); setFatal(null); onPlayStateRef.current?.(false); markStreaming(true); };
    const onPause   = () => { onPlayStateRef.current?.(true); markStreaming(false); };
    const onPlay    = () => { onPlayStateRef.current?.(false); markStreaming(true); };
    const onWaiting = () => setLoading(true);
    const onEndedInner = () => { markStreaming(false); onEnded?.(); };
    const onLoadedMeta = () => { try { onTracksChangedRef.current?.(); } catch { /* ignore */ } };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('ended', onEndedInner);
    video.addEventListener('loadedmetadata', onLoadedMeta);

    attach();

    return () => {
      cancelled = true;
      clearWatchdogs();
      markStreaming(false);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('ended', onEndedInner);
      video.removeEventListener('loadedmetadata', onLoadedMeta);
      teardownEngine();
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* ignore */ }
    };
    // `volume` is intentionally not a dep: it's consumed at attach time only
    // (autoplay-mute then restore). The separate effect above keeps live volume
    // changes in sync without forcing a full engine teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, maxRetries, onError, onEnded, retryNonce]);

  const handleRetry = useCallback(() => {
    retriesRef.current = 0;
    setFatal(null);
    setRetryNonce(n => n + 1);
  }, []);

  return (
    <div className={`relative bg-black overflow-hidden ${className || ''}`}>
      <video
        ref={videoRef}
        className="w-full h-full object-contain bg-black"
        playsInline
        autoPlay
        muted={false}
      />
      {loading && !fatal && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-12 h-12 text-brand-gold animate-spin drop-shadow-lg" />
        </div>
      )}
      {fatal && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-white p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-brand-gold mb-3" />
          <p className="font-quicksand font-semibold mb-1">Playback Error</p>
          <p className="text-sm text-brand-ice/80 font-nunito max-w-md mb-4">{fatal}</p>
          <button
            onClick={handleRetry}
            autoFocus
            className="tv-focusable home-focus-surface flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold focus:outline-none focus:ring-4 focus:ring-brand-gold/60"
          >
            <RotateCw className="w-4 h-4" /> Retry
          </button>
        </div>
      )}
      {!src && (
        <div className="absolute inset-0 flex items-center justify-center text-brand-ice/60 font-nunito">
          Select a channel to preview
        </div>
      )}
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';
export default VideoPlayer;
