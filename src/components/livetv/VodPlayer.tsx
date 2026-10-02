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
// The section keeps its keys (Back closes, ◀ ▶ volume); the remote's media
// keys (play/pause, +30 s / -10 s) are useNativePlayer's, as they were
// VideoPlayer's. Several sound tracks: the viewer's language when the file
// has it, else the file's own default (see vodAudio).
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
import type { VideoController } from './VideoPlayer';

const VideoPlayer = lazy(() => import('./VideoPlayer'));

/** An error for analytics: at most 200 characters and never an address
 *  (a line's stream URL carries its username and password). */
const cleanVodMessage = (msg: string): string =>
  String(msg || '').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]').slice(0, 200);

interface Props {
  /** The film's or episode's stream URL. Never logged. */
  src: string;
  /** 0..1.5; the browser's <video> stops at 1. */
  volume: number;
  /** For analytics: an address-free message. */
  onError?: (msg: string) => void;
  onEnded?: () => void;
  /** Drawn over the picture (the title in the corner). */
  children?: ReactNode;
}

export default function VodPlayer({ src, volume, onError, onEnded, children }: Props) {
  const { t } = useTranslation();
  // Fixed for the life of the player: a box never changes engine mid-film.
  const [native] = useState(() => hasNativePlayer());

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const reportError = useCallback((msg: string) => { onErrorRef.current?.(cleanVodMessage(msg)); }, []);
  const ended = useCallback(() => { onEndedRef.current?.(); }, []);

  // ◀ ▶ change the volume with nothing else on screen: show where it is.
  const [volShown, setVolShown] = useState(false);
  const volSeenRef = useRef(false);
  useEffect(() => {
    if (!volSeenRef.current) { volSeenRef.current = true; return; }
    setVolShown(true);
    const id = window.setTimeout(() => setVolShown(false), 2000);
    return () => window.clearTimeout(id);
  }, [volume]);
  const volPct = Math.round((native ? volume : Math.min(1, volume)) * 100);

  return (
    <div
      data-vod-player
      data-engine={native ? 'native' : 'html5'}
      className={`fixed left-0 top-0 w-full h-full z-[60] ${native ? 'bg-transparent' : 'bg-black'}`}
    >
      {native ? (
        <NativeVod src={src} volume={volume} onError={reportError} onEnded={ended} />
      ) : (
        <Suspense fallback={<div className="absolute left-0 top-0 w-full h-full flex items-center justify-center"><div className="w-full max-w-md"><SnowLoader size="lg" label={t('common.loading')} /></div></div>}>
          <VideoPlayer src={src} volume={volume} className="w-full h-full" onError={reportError} onEnded={ended} />
        </Suspense>
      )}
      {volShown && (
        <div data-vod-volume className="absolute top-4 right-4 px-4 py-2 rounded-xl bg-black/70 text-white font-nunito text-base tabular-nums pointer-events-none">
          {t('live.bar.volLevelLabel', { pct: volPct })}
        </div>
      )}
      {children}
    </div>
  );
}

function NativeVod({ src, volume, onError, onEnded }: { src: string; volume: number; onError: (msg: string) => void; onEnded: () => void }) {
  const { t } = useTranslation();

  // Sound track: once per stream (and again after a reload, which starts on
  // the file's default), as soon as the player knows the tracks.
  const ctlRef = useRef<VideoController | null>(null);
  const srcRef = useRef(src);
  srcRef.current = src;
  const pickedForRef = useRef<string | null>(null);
  const onTracks = useCallback(() => {
    const c = ctlRef.current;
    if (!c || pickedForRef.current === srcRef.current) return;
    const tracks = c.getAudioTracks();
    if (!tracks.length) return; // not prepared yet: the next tracksChanged has them
    pickedForRef.current = srcRef.current;
    const id = pickAudioTrack(tracks, i18n.language);
    if (id !== null) c.setAudioTrack(id);
  }, []);
  const onReload = useCallback(() => { pickedForRef.current = null; }, []);

  const player = useNativePlayer({ active: true, url: src, live: false, volume, onEnded, onTracksChanged: onTracks, onReload });
  ctlRef.current = player.controller;

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
        </div>
      )}
    </>
  );
}
