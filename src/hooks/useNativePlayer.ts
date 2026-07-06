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
}

export interface NativePlayerState {
  controller: VideoController | null;
  buffering: boolean;
  error: { code?: string; message: string } | null;
  retry: () => void;
  seekTo: (seconds: number) => Promise<void>;
  getPosition: () => Promise<{ position: number; duration: number; playing: boolean }>;
}

const MAX_RETRIES_DEFAULT = 5;

export function useNativePlayer({ active, url, volume, live = true, subtitles, startPosition, maxRetries = MAX_RETRIES_DEFAULT, onTracksChanged, onPlayStateChange, onEnded }: UseNativePlayerArgs): NativePlayerState {
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const handleRef = useRef<NativeControllerHandle | null>(null);
  const [controller, setController] = useState<VideoController | null>(null);
  const nonceRef = useRef(0);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);

  const cbTracksRef = useRef(onTracksChanged);
  const cbPlayStateRef = useRef(onPlayStateChange);
  const cbEndedRef = useRef(onEnded);
  useEffect(() => { cbTracksRef.current = onTracksChanged; }, [onTracksChanged]);
  useEffect(() => { cbPlayStateRef.current = onPlayStateChange; }, [onPlayStateChange]);
  useEffect(() => { cbEndedRef.current = onEnded; }, [onEnded]);

  const markStreaming = (on: boolean) => {
    try {
      if (on) document.documentElement.classList.add('streaming-active');
      else document.documentElement.classList.remove('streaming-active');
    } catch { /* ignore */ }
  };

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
    (async () => {
      try {
        stateH = await SnowPlayer.addListener('playerState', (data) => {
          if ((data as { screenId?: string }).screenId && (data as { screenId?: string }).screenId !== 'main') return;
          if (data.state === 'buffering') setBuffering(true);
          else if (data.state === 'ready') setBuffering(false);
          else if (data.state === 'ended') { markStreaming(false); cbEndedRef.current?.(); }
          if (typeof data.playing === 'boolean') markStreaming(data.playing);
        });
        errH = await SnowPlayer.addListener('playerError', (data) => {
          if ((data as { screenId?: string }).screenId && (data as { screenId?: string }).screenId !== 'main') return;
          markStreaming(false);
          const msg = data.message || 'Playback error';
          const code = data.code;
          // AUDIO_DECODE is a codec-init failure — auto-retrying the same URL
          // won't fix it. Surface immediately so the caller (PlexSection) can
          // fall back to a server-side transcode.
          if (code === 'AUDIO_DECODE' || retriesRef.current >= maxRetries) {
            setError({ code, message: msg });
            return;
          }
          retriesRef.current += 1;
          const delay = Math.min(8000, 500 * 2 ** retriesRef.current);
          clearRetryTimer();
          retryTimerRef.current = window.setTimeout(() => { setRetryNonce((n) => n + 1); }, delay) as unknown as number;
        });
      } catch { /* ignore */ }
    })();
    return () => {
      try { stateH?.remove?.(); } catch { /* ignore */ }
      try { errH?.remove?.(); } catch { /* ignore */ }
    };
  }, [active, maxRetries]);

  // Main load pipeline — runs on (active, url, retryNonce) changes.
  useEffect(() => {
    if (!active || !url) return;
    const myNonce = ++nonceRef.current;
    let cancelled = false;
    setBuffering(true);
    setError(null);
    retriesRef.current = 0;
    clearRetryTimer();

    (async () => {
      try {
        await SnowPlayer.setRect({ x: 0, y: 0, width: 0, height: 0 });
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
        markStreaming(true);
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
    const onHidden = () => { void SnowPlayer.stop().catch(() => { /* ignore */ }); markStreaming(false); };
    const onVisible = () => { setRetryNonce((n) => n + 1); };
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

  return useMemo(() => ({ controller, buffering, error, retry, seekTo, getPosition }), [controller, buffering, error, retry, seekTo, getPosition]);
}
