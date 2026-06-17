import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle, RotateCw } from 'lucide-react';

interface VideoPlayerProps {
  src: string | null;
  volume?: number;
  className?: string;
  /** Auto-retry attempts on fatal errors (IPTV streams drop often). */
  maxRetries?: number;
  onError?: (msg: string) => void;
  /** Fired when the underlying <video> finishes playback (finite media). */
  onEnded?: () => void;
}

type Engine = 'hls' | 'mpegts' | 'native';

function pickEngine(src: string): Engine {
  const lower = src.split('?')[0].toLowerCase();
  if (lower.endsWith('.m3u8')) return 'hls';
  if (lower.endsWith('.ts'))   return 'mpegts';
  return 'native';
}

const VideoPlayer = memo(({ src, volume = 0.8, className, maxRetries = 5, onError, onEnded }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  const retriesRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

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
      setLoading(true);

      const engine = pickEngine(src);

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
            hls.loadSource(src);
            hls.attachMedia(video);
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

    const onPlaying = () => { setLoading(false); setFatal(null); };
    const onWaiting = () => setLoading(true);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);

    attach();

    return () => {
      cancelled = true;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      teardownRef.current?.();
      teardownRef.current = null;
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* ignore */ }
    };
  }, [src, maxRetries, onError, retryNonce]);

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
