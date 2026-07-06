// Synchronous adapter around the native SnowPlayer plugin that satisfies the
// existing VideoController interface consumed by PlayerControlBar. The bar
// reads track lists synchronously each render, so we cache them here and
// refresh via prime() + the plugin's 'tracksChanged' event.
import { SnowPlayer, type SnowTrack } from '@/capacitor/SnowPlayer';
import type { VideoController, VideoTrackInfo } from '@/components/livetv/VideoPlayer';

interface Callbacks {
  onTracksChanged?: () => void;
  onPlayStateChange?: (paused: boolean) => void;
}

export interface NativeControllerHandle {
  controller: VideoController;
  prime: () => Promise<void>;
  dispose: () => void;
}

export function createNativeVideoController(cb: Callbacks = {}): NativeControllerHandle {
  const state = {
    paused: false,
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
    }).catch(() => null),
  ]);

  const controller: VideoController = {
    play: () => { void SnowPlayer.play().catch(() => { /* ignore */ }); state.paused = false; },
    pause: () => { void SnowPlayer.pause().catch(() => { /* ignore */ }); state.paused = true; },
    togglePlay: () => {
      if (state.paused) { void SnowPlayer.play().catch(() => { /* ignore */ }); state.paused = false; }
      else { void SnowPlayer.pause().catch(() => { /* ignore */ }); state.paused = true; }
    },
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

  return { controller, prime, dispose };
}
