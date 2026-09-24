// Synchronous adapter around the native SnowPlayer plugin that satisfies the
// existing VideoController interface consumed by PlayerControlBar. The bar
// reads track lists synchronously each render, so we cache them here and
// refresh via prime() + the plugin's 'tracksChanged' event.
import { SnowPlayer, type SnowTrack } from '@/capacitor/SnowPlayer';
import type { VideoController, VideoTrackInfo } from '@/components/livetv/VideoPlayer';

interface Callbacks {
  onTracksChanged?: () => void;
  onPlayStateChange?: (paused: boolean) => void;
  /** Paused on purpose (not a stall): set the moment play/pause is asked
   *  for here, then confirmed by the plugin's `paused` (which also covers a
   *  pause from outside the app). */
  onPausedChange?: (paused: boolean) => void;
}

export interface NativeControllerHandle {
  controller: VideoController;
  prime: () => Promise<void>;
  /** A new stream starts playing: forget the last one's pause, quietly. */
  resetPaused: () => void;
  dispose: () => void;
}

export function createNativeVideoController(cb: Callbacks = {}): NativeControllerHandle {
  const state = {
    paused: false,
    // What the viewer asked for. `paused` above follows `playing`, which
    // is also false during every stall — Play/Pause pressed mid-stall used
    // to resume instead of pausing.
    wantPaused: false,
    audioIdMap: [] as string[],   // index → "group:track"
    subIdMap: [] as string[],
    audioTracks: [] as VideoTrackInfo[],
    subtitleTracks: [] as VideoTrackInfo[],
  };

  const toInfos = (tracks: SnowTrack[], idMap: string[]): VideoTrackInfo[] => {
    idMap.length = 0;
    return tracks.map((t, i) => {
      idMap.push(t.id);
      return { id: i, label: t.label, language: t.language, active: !!t.selected };
    });
  };

  const prime = async () => {
    try {
      const [a, s] = await Promise.all([
        SnowPlayer.getAudioTracks().catch(() => ({ tracks: [] as SnowTrack[] })),
        SnowPlayer.getSubtitleTracks().catch(() => ({ tracks: [] as SnowTrack[] })),
      ]);
      state.audioTracks = toInfos(a.tracks || [], state.audioIdMap);
      state.subtitleTracks = toInfos(s.tracks || [], state.subIdMap);
      cb.onTracksChanged?.();
    } catch { /* ignore */ }
  };

  const listenersP = Promise.all([
    SnowPlayer.addListener('tracksChanged', (data) => {
      if ((data as { screenId?: string })?.screenId && (data as { screenId?: string }).screenId !== 'main') return;
      void prime();
    }).catch(() => null),
    SnowPlayer.addListener('playerState', (data) => {
      if ((data as { screenId?: string }).screenId && (data as { screenId?: string }).screenId !== 'main') return;
      if (typeof data.playing === 'boolean') {
        state.paused = !data.playing;
        cb.onPlayStateChange?.(state.paused);
      }
      if (typeof data.paused === 'boolean') setWantPaused(data.paused);
    }).catch(() => null),
  ]);

  function setWantPaused(p: boolean) {
    if (state.wantPaused === p) return;
    state.wantPaused = p;
    cb.onPausedChange?.(p);
  }
  const doPlay = () => { void SnowPlayer.play().catch(() => { /* ignore */ }); state.paused = false; setWantPaused(false); };
  const doPause = () => { void SnowPlayer.pause().catch(() => { /* ignore */ }); state.paused = true; setWantPaused(true); };

  const controller: VideoController = {
    play: doPlay,
    pause: doPause,
    togglePlay: () => { if (state.wantPaused) doPlay(); else doPause(); },
    seek: () => { /* live — no-op */ },
    isPaused: () => state.paused,
    isSeekable: () => false,
    getSubtitleTracks: () => state.subtitleTracks,
    setSubtitleTrack: (id: number) => {
      const trackId = id === -1 ? '-1' : (state.subIdMap[id] ?? '-1');
      void SnowPlayer.setSubtitleTrack({ id: trackId }).then(() => prime()).catch(() => { /* ignore */ });
    },
    getAudioTracks: () => state.audioTracks,
    setAudioTrack: (id: number) => {
      const trackId = state.audioIdMap[id];
      if (!trackId) return;
      void SnowPlayer.setAudioTrack({ id: trackId }).then(() => prime()).catch(() => { /* ignore */ });
    },
  };

  const dispose = () => {
    void listenersP.then((hs) => hs.forEach((h) => { try { h?.remove?.(); } catch { /* ignore */ } }));
  };

  const resetPaused = () => { state.wantPaused = false; };

  return { controller, prime, resetPaused, dispose };
}
