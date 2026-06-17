import { memo, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface VideoPlayerProps {
  src: string | null;
  volume?: number;
  className?: string;
  /** Auto-retry attempts on fatal errors (IPTV streams drop often). */
  maxRetries?: number;
  onError?: (msg: string) => void;
}

type Engine = 'hls' | 'mpegts' | 'native';

function pickEngine(src: string): Engine {
  const lower = src.split('?')[0].toLowerCase();
  if (lower.endsWith('.m3u8')) return 'hls';
  if (lower.endsWith('.ts'))   return 'mpegts';
  return 'native';
}

const VideoPlayer = memo(({ src, volume = 0.8, className, maxRetries = 5, onError }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  const retriesRef = useRef(0);
  const [loading, setLoading] = useState(false);

  // Keep volume in sync
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = Math.min(1, Math.max(0, volume));
  }, [volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    retriesRef.current = 0;

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
      if (retriesRef.current >= maxRetries) return;
      retriesRef.current += 1;
      const delay = Math.min(8000, 500 * 2 ** retriesRef.current);
      setTimeout(() => { if (!cancelled) attach(); }, delay);
    };

    const onPlaying = () => setLoading(false);
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
  }, [src, maxRetries, onError]);

  return (
    <div className={`relative bg-black overflow-hidden ${className || ''}`}>
      <video
        ref={videoRef}
        className="w-full h-full object-contain bg-black"
        playsInline
        autoPlay
        muted={false}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-12 h-12 text-brand-gold animate-spin drop-shadow-lg" />
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
