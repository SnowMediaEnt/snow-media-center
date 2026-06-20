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

const VideoPlayer = memo(({ src, volume = 0.8, className, maxRetries = 5, onError, onEnded, onReady, onPlayStateChange, onTracksChanged }: VideoPlayerProps) => {
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    retriesRef.current = 0;
    setFatal(null);

    let cancelled = false;

    const attach = async () => {
      // Tear down previous engine
      teardownRef.current?.();
      teardownRef.current = null;
      hlsRef.current = null;
      setLoading(true);

      const engine = pickEngine(src);
      engineRef.current = engine;

      try {
        if (engine === 'hls') {
          // Safari has native HLS — prefer it when available
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = src;
            await video.play().catch(() => { /* autoplay may need a user gesture */ });
            return;
          }
          const Hls = (await import('hls.js')).default;
          if (Hls.isSupported()) {
            const hls = new Hls({ liveDurationInfinity: true, lowLatencyMode: true });
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
              if (data.fatal) {
                onError?.(`HLS ${data.type}: ${data.details}`);
                scheduleRetry();
              }
            });
            teardownRef.current = () => { try { hls.destroy(); } catch { /* ignore */ } };
            await video.play().catch(() => { /* autoplay */ });
            return;
          }
          // Last resort
          video.src = src;
          await video.play().catch(() => { /* autoplay */ });
          return;
        }

        if (engine === 'mpegts') {
          const mpegts = (await import('mpegts.js')).default;
          if (mpegts.getFeatureList().mseLivePlayback) {
            const player = mpegts.createPlayer(
              { type: 'mpegts', url: src, isLive: true, hasAudio: true, hasVideo: true },
              { enableStashBuffer: false, liveBufferLatencyChasing: true },
            );
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
            await player.play();
            return;
          }
          // Fallback to native
          video.src = src;
          await video.play().catch(() => { /* autoplay */ });
          return;
        }

        // Native <video>
        video.src = src;
        await video.play().catch(() => { /* autoplay */ });
      } catch (e) {
        onError?.((e as Error).message || 'Playback error');
        scheduleRetry();
      }
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

    const onPlaying = () => { setLoading(false); setFatal(null); onPlayStateRef.current?.(false); };
    const onPause   = () => { onPlayStateRef.current?.(true); };
    const onPlay    = () => { onPlayStateRef.current?.(false); };
    const onWaiting = () => setLoading(true);
    const onEndedInner = () => { onEnded?.(); };
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
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('ended', onEndedInner);
      video.removeEventListener('loadedmetadata', onLoadedMeta);
      teardownRef.current?.();
      teardownRef.current = null;
      hlsRef.current = null;
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* ignore */ }
    };
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
