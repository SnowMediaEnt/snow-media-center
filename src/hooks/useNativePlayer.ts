// Lifecycle owner for the native ExoPlayer/Media3 SnowPlayer plugin, wrapped
// as a React hook. Registers NO back/keydown listeners (existing handlers
// keep full ownership of Back). Handles: load nonce (zap → quick Back),
// volume sync, buffering + fatal-error state with exponential-backoff
// auto-retry (matches VideoPlayer's shape), background stop + resume, and
// the 'streaming-active' documentElement flag for parity.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import { createNativeVideoController, type NativeControllerHandle } from '@/lib/nativeVideoController';
import type { VideoController } from '@/components/livetv/VideoPlayer';

interface UseNativePlayerArgs {
  active: boolean;
  url: string | null;
  volume: number;
  maxRetries?: number;
  onTracksChanged?: () => void;
  onPlayStateChange?: (paused: boolean) => void;
}

export interface NativePlayerState {
  controller: VideoController | null;
  buffering: boolean;
  error: { code?: string; message: string } | null;
  retry: () => void;
}

const MAX_RETRIES_DEFAULT = 5;

export function useNativePlayer({ active, url, volume, maxRetries = MAX_RETRIES_DEFAULT, onTracksChanged, onPlayStateChange }: UseNativePlayerArgs): NativePlayerState {
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
  useEffect(() => { cbTracksRef.current = onTracksChanged; }, [onTracksChanged]);
  useEffect(() => { cbPlayStateRef.current = onPlayStateChange; }, [onPlayStateChange]);

  const markStreaming = (on: boolean) => {
    try {
      if (on) document.documentElement.classList.add('streaming-active');
      else document.documentElement.classList.remove('streaming-active');
    } catch { /* ignore */ }
  };

  const clearRetryTimer = () => {
    if (retryTimerRef.current) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  };

  const retry = useCallback(() => {
    retriesRef.current = 0;
    setError(null);
    setRetryNonce((n) => n + 1);
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
          if (data.state === 'buffering') setBuffering(true);
          else if (data.state === 'ready') setBuffering(false);
          if (typeof data.playing === 'boolean') markStreaming(data.playing);
        });
        errH = await SnowPlayer.addListener('playerError', (data) => {
          markStreaming(false);
          const msg = data.message || 'Playback error';
          const code = data.code;
          if (retriesRef.current >= maxRetries) {
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
        await SnowPlayer.load({ url, isLive: true });
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

  return useMemo(() => ({ controller, buffering, error, retry }), [controller, buffering, error, retry]);
}
