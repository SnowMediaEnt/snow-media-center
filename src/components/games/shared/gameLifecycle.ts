import { useEffect, useMemo, useRef } from 'react';

/**
 * Per-game lifecycle registry.
 *
 * Every animation frame, timeout, interval and listener a game starts is
 * tracked here so Back / unmount cancels all of it, and so a backgrounded
 * document can pause purely visual work without resubmitting anything or
 * touching the committed server result.
 */
export interface GameLifecycle {
  /** Request a tracked animation frame. */
  raf: (cb: FrameRequestCallback) => number;
  /** Cancel a tracked animation frame. */
  cancelRaf: (id: number | null | undefined) => void;
  /** Tracked setTimeout. */
  timeout: (cb: () => void, ms: number) => number;
  /** Tracked setInterval. */
  interval: (cb: () => void, ms: number) => number;
  /** Cancel a tracked timer (timeout or interval). */
  clearTimer: (id: number | null | undefined) => void;
  /** Cancel every tracked frame/timer. Called automatically on unmount. */
  cancelAll: () => void;
  /** False once the component has unmounted — guard state updates with it. */
  isMounted: () => boolean;
  /** True while the document is hidden: pause visual work, never game logic. */
  isHidden: () => boolean;
  /** Subscribe to visibility changes; returns an unsubscribe function. */
  onVisibilityChange: (cb: (hidden: boolean) => void) => () => void;
}

export const useGameLifecycle = (): GameLifecycle => {
  const frames = useRef<Set<number>>(new Set());
  const timers = useRef<Set<number>>(new Set());
  const mounted = useRef(true);
  const hidden = useRef(typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const listeners = useRef<Set<(hidden: boolean) => void>>(new Set());

  const api = useMemo<GameLifecycle>(() => ({
    raf: (cb) => {
      const id = requestAnimationFrame((t) => {
        frames.current.delete(id);
        if (mounted.current) cb(t);
      });
      frames.current.add(id);
      return id;
    },
    cancelRaf: (id) => {
      if (id === null || id === undefined) return;
      frames.current.delete(id);
      cancelAnimationFrame(id);
    },
    timeout: (cb, ms) => {
      const id = window.setTimeout(() => {
        timers.current.delete(id);
        if (mounted.current) cb();
      }, ms);
      timers.current.add(id);
      return id;
    },
    interval: (cb, ms) => {
      const id = window.setInterval(() => {
        if (mounted.current) cb();
      }, ms);
      timers.current.add(id);
      return id;
    },
    clearTimer: (id) => {
      if (id === null || id === undefined) return;
      timers.current.delete(id);
      window.clearTimeout(id);
      window.clearInterval(id);
    },
    cancelAll: () => {
      frames.current.forEach((id) => cancelAnimationFrame(id));
      frames.current.clear();
      timers.current.forEach((id) => { window.clearTimeout(id); window.clearInterval(id); });
      timers.current.clear();
    },
    isMounted: () => mounted.current,
    isHidden: () => hidden.current,
    onVisibilityChange: (cb) => {
      listeners.current.add(cb);
      return () => { listeners.current.delete(cb); };
    },
  }), []);

  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => {
      hidden.current = document.visibilityState === 'hidden';
      listeners.current.forEach((cb) => cb(hidden.current));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      listeners.current.clear();
      api.cancelAll();
    };
  }, [api]);

  return api;
};
