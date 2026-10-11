// The remote while a title's trailer plays in SMC's own Plex player, in place
// of a film's control bar (owner, 2026-10-11: the trailer plays in SMC rather
// than outside it, and pauses). PlexSection plays the trailer like a film,
// minus everything a film saves; this is all the player shows on top of it.
//  - OK pauses and plays it; the remote's Play/Pause does the same
//    (useNativePlayer). Paused, a card says so, with the title, the time and
//    what the keys do.
//  - Back closes it in one step, paused or not: the title page is as it was,
//    the highlight still on Trailer.
//  - The arrows do nothing: a trailer is a couple of minutes, and the bar's
//    menus (quality, subtitles, help) are a film's.
// A touch screen gets a Close and a Pause / Play button instead of the keys.
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, X } from 'lucide-react';
import { useTouchUI } from '@/lib/phoneMode';
import type { VideoController } from './VideoPlayer';

interface Props {
  /** The player is up with the trailer loaded (as PlexPlayerOverlay's). */
  active: boolean;
  /** The title the trailer is for. */
  title: string;
  /** The player's own play state (a stall is not a pause). */
  paused: boolean;
  controller: VideoController | null;
  getPosition: () => Promise<{ position: number; duration: number; playing: boolean }>;
  onClose: () => void;
}

/** The keys' hint shows this long after the trailer starts. */
export const TRAILER_HINT_MS = 5000;

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
};

const PlexTrailerControls = memo(({ active, title, paused, controller, getPosition, onClose }: Props) => {
  const { t } = useTranslation();
  const touch = useTouchUI();
  const [hint, setHint] = useState(true);
  // Where it was paused, read once per pause for the card.
  const [at, setAt] = useState<{ position: number; duration: number } | null>(null);

  const controllerRef = useRef(controller); controllerRef.current = controller;
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const getPositionRef = useRef(getPosition); getPositionRef.current = getPosition;

  useEffect(() => {
    if (!active) return undefined;
    const id = window.setTimeout(() => setHint(false), TRAILER_HINT_MS);
    return () => window.clearTimeout(id);
  }, [active]);

  useEffect(() => {
    if (!paused) { setAt(null); return undefined; }
    let alive = true;
    void getPositionRef.current().then((p) => {
      if (alive && p.duration > 0) setAt({ position: p.position, duration: p.duration });
    }).catch(() => { /* the card shows without the time */ });
    return () => { alive = false; };
  }, [paused]);

  // Capture phase, as the film's overlay: while the player is up nothing
  // under it (the title page) sees these keys. The media keys are left for
  // useNativePlayer, which already pauses and plays on them.
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
      // keyCode 23 is DPAD_CENTER and 66 ENTER (remotes that send no e.key).
      const isOk = e.key === 'Enter' || e.key === ' ' || e.keyCode === 23 || e.keyCode === 66;
      const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      if (!isBack && !isOk && !isArrow) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (isBack) { onCloseRef.current(); return; }
      // A held OK (the press on Trailer that started it) is not a press here.
      if (isOk && !e.repeat) { controllerRef.current?.togglePlay(); setHint(false); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [active]);

  if (!active) return null;
  return (
    <div className="absolute inset-0 pointer-events-none" data-plex-trailer-controls={paused ? 'paused' : 'playing'}>
      {hint && !paused && !touch && (
        <p data-plex-trailer-hint="" className="absolute bottom-8 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/80 text-white/90 font-nunito text-sm whitespace-nowrap">
          {t('plex.trailer.hint')}
        </p>
      )}
      {paused && (
        <div data-plex-trailer-paused="" className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="max-w-md w-full mx-6 rounded-2xl border border-white/15 bg-black/85 p-6 text-center shadow-2xl">
            <Pause className="w-10 h-10 mx-auto mb-3 text-brand-gold" aria-hidden="true" />
            <p className="font-quicksand font-bold text-lg text-white">{t('plex.trailer.paused')}</p>
            <p className="font-nunito text-white/90 truncate">{t('plex.trailer.playingTitle', { title })}</p>
            {at && (
              <p className="font-nunito text-sm text-brand-ice/80 mt-1">
                {t('plex.trailer.time', { time: fmtTime(at.position), duration: fmtTime(at.duration) })}
              </p>
            )}
            {!touch && <p className="font-nunito text-sm text-brand-ice/80 mt-3">{t('plex.trailer.pausedHint')}</p>}
          </div>
        </div>
      )}
      {touch && (
        <>
          <button
            type="button"
            data-plex-trailer-close=""
            onClick={() => onCloseRef.current()}
            aria-label={t('common.close')}
            className="pointer-events-auto absolute top-3 right-3 flex items-center justify-center w-11 h-11 rounded-full bg-black/70 text-white"
          >
            <X className="w-6 h-6" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-plex-trailer-toggle=""
            onClick={() => controllerRef.current?.togglePlay()}
            aria-label={t('plex.player.playPause')}
            className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center justify-center w-14 h-14 rounded-full bg-black/70 text-white"
          >
            {paused ? <Play className="w-7 h-7 fill-current" aria-hidden="true" /> : <Pause className="w-7 h-7" aria-hidden="true" />}
          </button>
        </>
      )}
    </div>
  );
});
PlexTrailerControls.displayName = 'PlexTrailerControls';
export default PlexTrailerControls;
