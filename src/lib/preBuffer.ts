// The native player's start-up hold for films and episodes: it spends up to
// 10 s filling its buffer (aiming for 25 s of video; a 4K film until it has
// 20 s, 30 s at most, see PreBufferRule.kt) before it starts, and
// reports how far along it is as 'preBuffer' events (SnowPlayerPlugin.kt,
// schedulePreBuffer). This keeps that progress for the "Getting ready…"
// indicator, and tells the slow-load watchdog that the player is busy on
// purpose rather than stuck.
import { useSyncExternalStore } from 'react';
import { SnowPlayer } from '@/capacitor/SnowPlayer';

export interface PreBufferState {
  active: boolean;
  /** 0..1: how far to starting — whichever of the buffer target and the
   *  time limit is nearer. */
  progress: number;
}

const IDLE: PreBufferState = { active: false, progress: 0 };
let state: PreBufferState = IDLE;
let lastEventAt = 0;
let staleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let bound = false;

// Events come every 500 ms; a gap this long means the hold ended without
// its last event (the stream was replaced or stopped).
const STALE_MS = 2_500;

function emit(next: PreBufferState): void {
  if (next.active === state.active && Math.abs(next.progress - state.progress) < 0.01) return;
  state = next;
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

/** Progress from one event (exported for tests). */
export function preBufferProgress(d: { bufferedMs?: number; targetMs?: number; elapsedMs?: number; maxWaitMs?: number }): number {
  const b = d.targetMs ? (d.bufferedMs ?? 0) / d.targetMs : 0;
  const t = d.maxWaitMs ? (d.elapsedMs ?? 0) / d.maxWaitMs : 0;
  return Math.max(0, Math.min(1, Math.max(b, t)));
}

/** Feeds one 'preBuffer' event in (the plugin listener; tests). */
export function notePreBuffer(d: { screenId?: string; bufferedMs?: number; targetMs?: number; elapsedMs?: number; maxWaitMs?: number; done?: boolean }): void {
  if (d.screenId && d.screenId !== 'main') return;
  if (staleTimer) { clearTimeout(staleTimer); staleTimer = null; }
  if (d.done) { lastEventAt = 0; emit(IDLE); return; }
  lastEventAt = Date.now();
  emit({ active: true, progress: preBufferProgress(d) });
  staleTimer = setTimeout(() => { staleTimer = null; lastEventAt = 0; emit(IDLE); }, STALE_MS);
}

/** A new stream, or playback started: whatever hold there was is over. */
export function clearPreBuffer(): void {
  if (staleTimer) { clearTimeout(staleTimer); staleTimer = null; }
  lastEventAt = 0;
  emit(IDLE);
}

/** True while the player is holding the start to fill its buffer. */
export function isPreBuffering(now: number = Date.now()): boolean {
  return state.active && lastEventAt > 0 && now - lastEventAt < STALE_MS;
}

function ensureListener(): void {
  if (bound) return;
  bound = true;
  try {
    void Promise.resolve(SnowPlayer.addListener('preBuffer', (d) => notePreBuffer(d))).catch(() => { /* older build: no events */ });
  } catch { /* no plugin */ }
}

function subscribe(cb: () => void): () => void {
  ensureListener();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The hold's state; re-renders only when it changes by a percent or more. */
export function usePreBuffer(): PreBufferState {
  return useSyncExternalStore(subscribe, () => state, () => IDLE);
}

/** Only whether a hold is on (re-renders twice per start, not per tick). */
export function usePreBufferActive(): boolean {
  return useSyncExternalStore(subscribe, () => state.active, () => false);
}
