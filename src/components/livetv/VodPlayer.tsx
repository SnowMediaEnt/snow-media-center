// Live TV › VOD: the line's own films and series episodes, full screen.
//
// On a TV box they play on the native ExoPlayer (useNativePlayer, live:false),
// like Plex, the channels, Recordings and Snow Originals. The WebView <video>
// (VideoPlayer) is only for the browser build.
//
// Why: the WebView's Chromium has no decoder for Dolby Digital (AC-3),
// Dolby Digital Plus (E-AC-3), DTS or TrueHD, the sound of most 5.1 films on
// a panel. It drops that track without an error and plays the picture with
// no sound. The native player decodes all of them in software (the FFmpeg
// extension, see android/app/build.gradle) and boosts past 100% (up to 150%).
//
// Every key is the player's while it plays: VodControlBar (OK / ▲ ▼ bring up
// play/pause, seek, subtitles, audio, volume to 150%, next episode; ◀ ▶
// with the bar hidden jump -10 / +30 s; Back closes the bar, then the
// player through onClose). The remote's media keys (play/pause, +30 s /
// -10 s) are useNativePlayer's, as they were VideoPlayer's. Several sound
// tracks: the viewer's language when the file has it, else the file's own
// default (see vodAudio), until the viewer picks one in the bar.
//
// onProgress: where the title is, every VOD_PROGRESS_MS while it is on screen
// and once more as it closes or the next episode replaces it, from the same
// getPosition the bar reads (the <video>, or the native player). The bar only
// reads it while it is up, so this is its own slow timer, kept running while
// a stream plays (quiet mode stops the others) and stopped with the app in
// the background. Movies and Series mark what was watched from it
// (lib/watchedMarks).
//
// Chrome 66: no inset, no aspect-ratio, no gap beyond gap-1..4.
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { useNativePlayer } from '@/hooks/useNativePlayer';
import { pickAudioTrack } from '@/lib/vodAudio';
import SnowLoader from '@/components/SnowLoader';
import { loadPlayerVolume, MAX_VOLUME, savePlayerVolume } from '@/utils/volume';
import { setPausableInterval } from '@/utils/pausableInterval';
import type { VideoController } from './VideoPlayer';
import VodControlBar, { type VodPosition } from './VodControlBar';
import { useTouchUI } from '@/lib/phoneMode';

const VideoPlayer = lazy(() => import('./VideoPlayer'));

/** How often the position goes to onProgress while a title plays. */
export const VOD_PROGRESS_MS = 10_000;

/** An error for analytics: at most 200 characters and never an address
 *  (a line's stream URL carries its username and password). */
const cleanVodMessage = (msg: string): string =>
  String(msg || '').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]').slice(0, 200);

interface Props {
  /** The film's or episode's stream URL. Never logged. */
  src: string;
  /** 0..1.5 (the shared player volume); the browser's <video> stops at 1.
   *  Left out: the saved one (loadPlayerVolume). */
  volume?: number;
  /** The viewer changed the volume in the bar (already saved). */
  onVolumeChange?: (v: number) => void;
  /** Shown at the top of the bar. */
  title?: string;
  /** Back with the bar down: leave the player. */
  onClose?: () => void;
  /** A series: the bar's Next episode button (greyed out when !hasNext). */
  onNext?: () => void;
  hasNext?: boolean;
  /** For analytics: an address-free message. */
  onError?: (msg: string) => void;
  onEnded?: () => void;
  /** Where the title is (seconds; duration 0 while not known), every
   *  VOD_PROGRESS_MS and once more when it closes or `src` changes. */
  onProgress?: (position: number, duration: number) => void;
  /** Drawn over the picture (the title in the corner). */
  children?: ReactNode;
}

/** What both engines hand the bar. */
interface BarProps {
  title?: string;
  volume: number;
  onVolume: (v: number) => void;
  onClose?: () => void;
  onNext?: () => void;
  hasNext?: boolean;
}

export default function VodPlayer({ src, volume: volumeProp, onVolumeChange, title, onClose, onNext, hasNext, onError, onEnded, onProgress, children }: Props) {
  const { t } = useTranslation();
  // Fixed for the life of the player: a box never changes engine mid-film.
  const [native] = useState(() => hasNativePlayer());

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const reportError = useCallback((msg: string) => { onErrorRef.current?.(cleanVodMessage(msg)); }, []);
  const ended = useCallback(() => { onEndedRef.current?.(); }, []);
  // Set after render, not during it: when the next episode replaces this one,
  // the last report of the one leaving (useProgressFeed's cleanup, which runs
  // first) still goes to its own callback, not to the new episode's.
  const onProgressRef = useRef(onProgress);
  useEffect(() => { onProgressRef.current = onProgress; });
  const progress = useCallback((pos: number, dur: number) => { onProgressRef.current?.(pos, dur); }, []);

  // The shared player volume (Live TV, Plex). The bar changes it, saves it
  // and tells the section; a change from the section is followed.
  const [volume, setVolume] = useState(() => volumeProp ?? loadPlayerVolume());
  useEffect(() => { if (volumeProp != null) setVolume(volumeProp); }, [volumeProp]);
  const onVolumeChangeRef = useRef(onVolumeChange);
  onVolumeChangeRef.current = onVolumeChange;
  const changeVolume = useCallback((v: number) => {
    setVolume(v);
    savePlayerVolume(v);
    onVolumeChangeRef.current?.(v);
  }, []);

  const bar: BarProps = { title, volume, onVolume: changeVolume, onClose, onNext, hasNext };

  return (
    <div
      data-vod-player
      data-engine={native ? 'native' : 'html5'}
      className={`fixed left-0 top-0 w-full h-full z-[60] ${native ? 'bg-transparent' : 'bg-black'}`}
    >
      {native ? (
        <NativeVod src={src} onError={reportError} onEnded={ended} onProgress={progress} bar={bar} />
      ) : (
        <Suspense fallback={<div className="absolute left-0 top-0 w-full h-full flex items-center justify-center"><div className="w-full max-w-md"><SnowLoader size="lg" label={t('common.loading')} /></div></div>}>
          <WebVod src={src} onError={reportError} onEnded={ended} onProgress={progress} bar={bar} />
        </Suspense>
      )}
      {children}
    </div>
  );
}

type Report = (position: number, duration: number) => void;

/** Reads `getPosition` every VOD_PROGRESS_MS for `src` and hands it to
 *  `report`, then once more (the last place read) when `src` changes or the
 *  player closes. Nothing before the title has started. */
function useProgressFeed(src: string, getPosition: () => Promise<VodPosition>, report: Report) {
  const getRef = useRef(getPosition);
  getRef.current = getPosition;
  useEffect(() => {
    let alive = true;
    let pos = 0;
    let dur = 0;
    const read = async () => {
      try {
        const p = await getRef.current();
        if (!alive) return;
        // A stopped player (the app was in the background) answers 0: the
        // place it had stands.
        if (p.duration > 0) dur = p.duration;
        if (p.position > 0) { pos = p.position; report(pos, dur); }
      } catch { /* not ready yet */ }
    };
    const stop = setPausableInterval(() => { void read(); }, VOD_PROGRESS_MS, { essential: true });
    return () => {
      alive = false;
      stop();
      if (pos > 0) { try { report(pos, dur); } catch { /* ignore */ } }
    };
  }, [src, report]);
}

/** The browser build: the HTML5 <video>, with the same bar (to 100%). */
function WebVod({ src, onError, onEnded, onProgress, bar }: { src: string; onError: (msg: string) => void; onEnded: () => void; onProgress: Report; bar: BarProps }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [controller, setController] = useState<VideoController | null>(null);
  const [paused, setPaused] = useState(false);
  const [tracksTick, setTracksTick] = useState(0);
  const onTracks = useCallback(() => setTracksTick((n) => n + 1), []);
  const video = () => boxRef.current?.querySelector('video') ?? null;
  const getPosition = useCallback(async (): Promise<VodPosition> => {
    const v = video();
    if (!v) return { position: 0, duration: 0, playing: false };
    return { position: v.currentTime || 0, duration: Number.isFinite(v.duration) ? v.duration : 0, playing: !v.paused };
  }, []);
  const seekTo = useCallback((sec: number) => { const v = video(); if (v) v.currentTime = Math.max(0, sec); }, []);
  useProgressFeed(src, getPosition, onProgress);
  return (
    <>
      <div ref={boxRef} className="absolute left-0 top-0 w-full h-full">
        <VideoPlayer
          src={src}
          volume={Math.min(1, bar.volume)}
          className="w-full h-full"
          onError={onError}
          onEnded={onEnded}
          onReady={setController}
          onPlayStateChange={setPaused}
          onTracksChanged={onTracks}
        />
      </div>
      <VodControlBar
        {...bar}
        volume={Math.min(1, bar.volume)}
        maxVolume={1}
        controller={controller}
        tracksTick={tracksTick}
        paused={paused}
        getPosition={getPosition}
        seekTo={seekTo}
      />
    </>
  );
}

function NativeVod({ src, onError, onEnded, onProgress, bar }: { src: string; onError: (msg: string) => void; onEnded: () => void; onProgress: Report; bar: BarProps }) {
  const { t } = useTranslation();
  const touch = useTouchUI();

  // Sound track: once per stream (and again after a reload, which starts on
  // the file's default), as soon as the player knows the tracks.
  const ctlRef = useRef<VideoController | null>(null);
  const srcRef = useRef(src);
  srcRef.current = src;
  const pickedForRef = useRef<string | null>(null);
  // The track the viewer chose in the bar: a reload (which starts on the
  // file's default) goes back to it, not to the automatic pick.
  const chosenRef = useRef<{ src: string; id: number } | null>(null);
  const [tracksTick, setTracksTick] = useState(0);
  const onTracks = useCallback(() => {
    setTracksTick((n) => n + 1); // the bar's menus re-read the lists
    const c = ctlRef.current;
    if (!c || pickedForRef.current === srcRef.current) return;
    const tracks = c.getAudioTracks();
    if (!tracks.length) return; // not prepared yet: the next tracksChanged has them
    pickedForRef.current = srcRef.current;
    const chosen = chosenRef.current?.src === srcRef.current ? chosenRef.current.id : null;
    const id = chosen ?? pickAudioTrack(tracks, i18n.language);
    if (id === null || tracks.find((tr) => tr.id === id)?.active) return;
    // The viewer's own choice is theirs; the language rule's is automatic.
    if (chosen !== null) c.setAudioTrack(id);
    else c.setAudioTrack(id, { auto: true });
  }, []);
  const onReload = useCallback(() => { pickedForRef.current = null; }, []);
  const onAudioPicked = useCallback((id: number) => { chosenRef.current = { src: srcRef.current, id }; }, []);

  const player = useNativePlayer({ active: true, url: src, live: false, volume: bar.volume, onEnded, onTracksChanged: onTracks, onReload });
  ctlRef.current = player.controller;
  useProgressFeed(src, player.getPosition, onProgress);

  // The native picture shows through: no background on the page behind it.
  useEffect(() => {
    document.documentElement.classList.add('snowplayer-fullscreen');
    return () => { document.documentElement.classList.remove('snowplayer-fullscreen'); };
  }, []);

  // A play error, once per error, for analytics.
  const err = player.error;
  useEffect(() => {
    if (!err) return;
    onError(err.code ? `${err.code}: ${err.message}` : err.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [err]);

  const retry = useCallback(() => { pickedForRef.current = null; player.retry(); }, [player]);

  return (
    <>
      {player.buffering && !err && (
        <div className="absolute left-0 top-0 w-full h-full flex items-center justify-center pointer-events-none">
          <div className="w-full max-w-md"><SnowLoader size="lg" label={t('live.player.buffering')} /></div>
        </div>
      )}
      {/* Sound this box can't decode even with the software decoders: say so
          instead of leaving the viewer guessing, and name the codec for support. */}
      {player.audioWarning && !err && (
        <div data-vod-nosound className="absolute bottom-24 left-0 w-full flex justify-center pointer-events-none">
          <div className="max-w-lg rounded-2xl bg-black/85 px-5 py-3 text-center">
            <p className="font-quicksand font-semibold text-brand-gold text-sm">{t('live.vod.noSoundTitle')}</p>
            <p className="mt-1 font-nunito text-xs text-brand-ice/80">{t('live.vod.noSoundBody', { codecs: player.audioWarning.codecs })}</p>
          </div>
        </div>
      )}
      {err && (
        <div data-vod-error className="absolute left-0 top-0 w-full h-full flex flex-col items-center justify-center bg-black/85 text-white p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-brand-gold mb-3" />
          <p className="font-quicksand font-semibold mb-1">{t('live.player.playbackError')}</p>
          <p className="text-sm text-brand-ice/80 font-nunito max-w-md mb-4">{cleanVodMessage(err.message) || t('live.player.loadFailed')}</p>
          <button
            type="button"
            onClick={retry}
            autoFocus
            className="tv-focusable home-focus-surface flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-gold text-brand-navy font-quicksand font-bold focus:outline-none focus:ring-4 focus:ring-brand-gold/60"
          >
            <RotateCw className="w-4 h-4" /> {t('common.retry')}
          </button>
          {/* A touch screen has no remote Back to reach for (Tronix 77d9422). */}
          {touch && bar.onClose && (
            <button type="button" onClick={bar.onClose} data-vod-error-back="" className="mt-3 px-5 py-2.5 rounded-xl border border-white/20 text-white font-quicksand font-semibold">
              {t('common.back')}
            </button>
          )}
        </div>
      )}
      <VodControlBar
        {...bar}
        maxVolume={MAX_VOLUME}
        controller={player.controller}
        tracksTick={tracksTick}
        paused={player.paused}
        getPosition={player.getPosition}
        seekTo={player.seekTo}
        stats
        blocked={!!err}
        onAudioPicked={onAudioPicked}
      />
    </>
  );
}
