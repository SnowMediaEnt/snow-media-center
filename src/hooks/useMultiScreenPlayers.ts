// Multi-screen (up to 4 slots) native player manager. Bypasses useNativePlayer
// entirely and calls SnowPlayer directly with screenIds 'ms1'..'ms4'.
//
// Slot ids match tile indexes in the grid: tile 0 → 'ms1', tile 1 → 'ms2', etc.
// The caller must call applyRect(screenId, cssRect) BEFORE loadSlot(...) so the
// native surface is sized before the first frame renders.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import { loadPlayerVolume } from '@/utils/volume';

export type MultiScreenId = 'ms1' | 'ms2' | 'ms3' | 'ms4';
export const MS_SLOT_IDS: MultiScreenId[] = ['ms1', 'ms2', 'ms3', 'ms4'];

export interface SlotState {
  url: string | null;
  buffering: boolean;
  error: string | null;
  retries: number;
  bufferingSince: number | null;
}

export interface CssRect { x: number; y: number; width: number; height: number }

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 8000;

const emptySlot = (): SlotState => ({
  url: null,
  buffering: false,
  error: null,
  retries: 0,
  bufferingSince: null,
});

interface Api {
  slots: Record<MultiScreenId, SlotState>;
  loadSlot: (screenId: MultiScreenId, url: string) => Promise<void>;
  closeSlot: (screenId: MultiScreenId) => Promise<void>;
  applyRect: (screenId: MultiScreenId, rect: CssRect) => Promise<void>;
  focusAudio: (screenId: MultiScreenId | null) => Promise<void>;
  stopAll: () => Promise<void>;
}

export function useMultiScreenPlayers(): Api {
  const [slots, setSlots] = useState<Record<MultiScreenId, SlotState>>(() => ({
    ms1: emptySlot(), ms2: emptySlot(), ms3: emptySlot(), ms4: emptySlot(),
  }));
  const slotsRef = useRef(slots);
  useEffect(() => { slotsRef.current = slots; }, [slots]);

  const retryTimersRef = useRef<Record<string, number | undefined>>({});
  const focusedAudioRef = useRef<MultiScreenId | null>(null);

  const isMs = (id: string | undefined): id is MultiScreenId =>
    !!id && (id === 'ms1' || id === 'ms2' || id === 'ms3' || id === 'ms4');

  const updateSlot = useCallback((id: MultiScreenId, patch: Partial<SlotState>) => {
    setSlots(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  // Own documentElement classes globally: on while any slot has a url.
  useEffect(() => {
    const anyOccupied = MS_SLOT_IDS.some(id => slots[id].url);
    const root = document.documentElement;
    if (anyOccupied) {
      root.classList.add('snowplayer-fullscreen');
      root.classList.add('snowplayer-multiview');
      root.classList.add('streaming-active');
    } else {
      root.classList.remove('snowplayer-fullscreen');
      root.classList.remove('snowplayer-multiview');
      root.classList.remove('streaming-active');
    }
  }, [slots]);

  // Event demux
  useEffect(() => {
    let stateHandle: PluginListenerHandle | undefined;
    let errHandle: PluginListenerHandle | undefined;
    let cancelled = false;
    (async () => {
      try {
        const h1 = await SnowPlayer.addListener('playerState', (data: { screenId?: string; state?: string }) => {
          const sid = data?.screenId;
          if (!isMs(sid)) return;
          const cur = slotsRef.current[sid];
          if (!cur.url) return;
          const s = String(data?.state || '').toLowerCase();
          const buffering = s === 'buffering';
          if (cur.buffering !== buffering) {
            updateSlot(sid, {
              buffering,
              bufferingSince: buffering ? Date.now() : null,
            });
          }
          if (s === 'ready' || s === 'playing') {
            if (cur.retries !== 0 || cur.error) updateSlot(sid, { retries: 0, error: null });
          }
        });
        const h2 = await SnowPlayer.addListener('playerError', (data: { screenId?: string; code?: string; message?: string }) => {
          const sid = data?.screenId;
          if (!isMs(sid)) return;
          const cur = slotsRef.current[sid];
          if (!cur.url) return;
          if (cur.retries >= MAX_RETRIES) {
            updateSlot(sid, { error: 'Stream unavailable', buffering: false });
            return;
          }
          const attempt = cur.retries + 1;
          const delay = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * Math.pow(2, cur.retries));
          updateSlot(sid, { retries: attempt, buffering: true });
          const key = `retry-${sid}`;
          const prev = retryTimersRef.current[key];
          if (prev) window.clearTimeout(prev);
          retryTimersRef.current[key] = window.setTimeout(() => {
            const now = slotsRef.current[sid];
            if (!now.url) return;
            SnowPlayer.load({ url: now.url, live: true, screenId: sid }).catch(() => { /* next error will retry */ });
          }, delay) as unknown as number;
        });
        if (cancelled) { h1.remove(); h2.remove(); }
        else { stateHandle = h1; errHandle = h2; }
      } catch { /* ignore */ }
    })();
    return () => {
      cancelled = true;
      try { stateHandle?.remove(); } catch { /* ignore */ }
      try { errHandle?.remove(); } catch { /* ignore */ }
      Object.values(retryTimersRef.current).forEach(t => { if (t) window.clearTimeout(t); });
      retryTimersRef.current = {};
    };
  }, [updateSlot]);

  const applyRect = useCallback(async (screenId: MultiScreenId, rect: CssRect): Promise<void> => {
    const dpr = window.devicePixelRatio || 1;
    try {
      await SnowPlayer.setRect({
        x: Math.round(rect.x * dpr),
        y: Math.round(rect.y * dpr),
        width: Math.round(rect.width * dpr),
        height: Math.round(rect.height * dpr),
        screenId,
      });
    } catch { /* ignore */ }
  }, []);

  const focusAudio = useCallback(async (screenId: MultiScreenId | null): Promise<void> => {
    focusedAudioRef.current = screenId;
    const vol = loadPlayerVolume();
    for (const id of MS_SLOT_IDS) {
      const s = slotsRef.current[id];
      if (!s.url) continue;
      if (id === screenId) {
        try { await SnowPlayer.setAudioEnabled({ enabled: true, screenId: id }); } catch { /* ignore */ }
        try { await SnowPlayer.setVolume({ volume: vol, screenId: id }); } catch { /* ignore */ }
      } else {
        try { await SnowPlayer.setAudioEnabled({ enabled: false, screenId: id }); } catch { /* ignore */ }
        try { await SnowPlayer.setVolume({ volume: 0, screenId: id }); } catch { /* ignore */ }
      }
    }
  }, []);

  const loadSlot = useCallback(async (screenId: MultiScreenId, url: string): Promise<void> => {
    updateSlot(screenId, { url, error: null, retries: 0, buffering: true, bufferingSince: Date.now() });
    try {
      await SnowPlayer.load({ url, live: true, screenId });
      await SnowPlayer.play({ screenId });
      // Default audio state — muted unless focused. Caller will refocus if desired.
      const focused = focusedAudioRef.current;
      if (focused === screenId) {
        try { await SnowPlayer.setAudioEnabled({ enabled: true, screenId }); } catch { /* ignore */ }
        try { await SnowPlayer.setVolume({ volume: loadPlayerVolume(), screenId }); } catch { /* ignore */ }
      } else {
        try { await SnowPlayer.setAudioEnabled({ enabled: false, screenId }); } catch { /* ignore */ }
        try { await SnowPlayer.setVolume({ volume: 0, screenId }); } catch { /* ignore */ }
      }
    } catch (e) {
      updateSlot(screenId, { error: 'Stream unavailable', buffering: false });
    }
  }, [updateSlot]);

  const closeSlot = useCallback(async (screenId: MultiScreenId): Promise<void> => {
    const key = `retry-${screenId}`;
    const t = retryTimersRef.current[key];
    if (t) { window.clearTimeout(t); retryTimersRef.current[key] = undefined; }
    try { await SnowPlayer.stop({ screenId }); } catch { /* ignore */ }
    setSlots(prev => ({ ...prev, [screenId]: emptySlot() }));
    if (focusedAudioRef.current === screenId) focusedAudioRef.current = null;
  }, []);

  const stopAll = useCallback(async (): Promise<void> => {
    Object.values(retryTimersRef.current).forEach(t => { if (t) window.clearTimeout(t); });
    retryTimersRef.current = {};
    try { await SnowPlayer.stopAll(); } catch { /* ignore */ }
    setSlots({ ms1: emptySlot(), ms2: emptySlot(), ms3: emptySlot(), ms4: emptySlot() });
    focusedAudioRef.current = null;
  }, []);

  // Background/foreground: stop everything but remember URLs, restore on resume.
  useEffect(() => {
    const rememberedRef: { current: Record<string, string | null> } = { current: {} };

    const goBg = () => {
      const snap: Record<string, string | null> = {};
      for (const id of MS_SLOT_IDS) snap[id] = slotsRef.current[id].url;
      rememberedRef.current = snap;
      void (async () => {
        try { await SnowPlayer.stopAll(); } catch { /* ignore */ }
      })();
    };
    const goFg = () => {
      const snap = rememberedRef.current;
      for (const id of MS_SLOT_IDS) {
        const url = snap[id];
        if (url) {
          // Rects will be re-applied by the component on next layout tick.
          SnowPlayer.load({ url, live: true, screenId: id }).catch(() => { /* ignore */ });
          SnowPlayer.play({ screenId: id }).catch(() => { /* ignore */ });
        }
      }
    };

    const onVis = () => {
      if (document.visibilityState === 'hidden') goBg();
      else if (document.visibilityState === 'visible') goFg();
    };
    document.addEventListener('visibilitychange', onVis);

    let appHandle: PluginListenerHandle | undefined;
    let cancelled = false;
    (async () => {
      try {
        const h = await CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) goFg(); else goBg();
        });
        if (cancelled) h.remove(); else appHandle = h;
      } catch { /* ignore */ }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      try { appHandle?.remove(); } catch { /* ignore */ }
    };
  }, []);

  // Unmount → hard stop.
  useEffect(() => {
    return () => {
      try { SnowPlayer.stopAll(); } catch { /* ignore */ }
      document.documentElement.classList.remove('snowplayer-fullscreen');
      document.documentElement.classList.remove('streaming-active');
    };
  }, []);

  return useMemo(() => ({
    slots, loadSlot, closeSlot, applyRect, focusAudio, stopAll,
  }), [slots, loadSlot, closeSlot, applyRect, focusAudio, stopAll]);
}
