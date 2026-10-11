// A title's trailer, played inside SMC (owner, 2026-10-11: "with the fix to
// play in SMC instead of going out and the pause fix as well"; from Tronix
// 1039497).
//
// A full-screen layer over the page that opened it, with the video service's
// own embeddable player (lib/trailer trailerEmbedUrl: its documented iframe
// embed, privacy-enhanced host). Nothing is extracted or downloaded, and the
// film player (VodPlayer) is never involved.
//  - The remote: OK (and the remote's Play/Pause) pauses and plays it through
//    the embed's player API: the messages its own API script sends, posted
//    straight to the frame (no outside script is loaded into the app). Back
//    closes it, one step: the page under it is as it was, its highlight
//    still on Trailer. The arrows do nothing here.
//  - The frame never takes the remote: the layer keeps the page's focus, so
//    every key comes here (a touch screen may tap the embed's own controls,
//    and has a Close button).
//  - It won't play here (the embed says so, or nothing plays within 8 s, a
//    little longer while it is still loading): "This trailer can't play
//    here" and "Open outside the app".
//  - The video's end closes it.
// Closing unmounts the layer, and with it the frame: its page, its player and
// what it had buffered go at once (a Fire TV has little memory to spare).
//
// Generic on purpose (any page may show a trailer): a video id or a link to it
// in, onClose out. The page drawing it stands its own key handler aside while
// it is up (this layer's listener is added after the page's). A phone's
// system Back needs nothing extra here: inside Live TV the Player turns it
// into the Escape this layer already answers (LiveTV's backButton listener).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Clapperboard, ExternalLink, Loader2, Pause, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTouchUI } from '@/lib/phoneMode';
import { onMediaKey } from '@/lib/mediaKeys';
import { kidsLevel } from '@/lib/kidsFilter';
import { TRAILER_EMBED_ORIGINS, openTrailerOutside, trailerEmbedUrl, trailerIdOf, type TrailerKind } from '@/lib/trailer';

/** No playback by then: it can't play here. */
export const TRAILER_START_MS = 8000;
/** Still loading at 8 s (the embed said it is buffering): this much longer. */
export const TRAILER_BUFFERING_EXTRA_MS = 7000;
/** The remote's hint shows this long. */
const HINT_MS = 5000;
/** The embed's player API: ask for its events, again until it answers. */
const LISTEN_EVERY_MS = 250;
const LISTEN_TRIES = 40;

type Status = 'loading' | 'playing' | 'paused' | 'failed';

export interface TrailerOverlayProps {
  /** The trailer: a video id, or a watch / short / embed link to one (lib/trailer trailerIdOf). */
  video: string;
  /** Back, the Close button, the video's end, or "Open outside the app": the page drops the layer. */
  onClose: () => void;
  /** "Open outside the app" when it can't play here. Default: lib/trailer
   *  openTrailerOutside (the video app or the browser). The layer closes first. */
  onOpenOutside?: () => void;
  /** What it is a trailer of, for the default "Open outside the app"'s count. */
  kind?: TrailerKind;
}

/** The page's own origin for the embed's `origin` (its messages come back to it). */
const pageOrigin = (): string | null => {
  try { return window.location.origin && window.location.origin !== 'null' ? window.location.origin : null; } catch { return null; }
};

const isBackKey = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.keyCode === 4;
const isOkKey = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;

const TrailerLayer = memo(({ video, onClose, onOpenOutside, kind = 'movie' }: TrailerOverlayProps) => {
  const { t, i18n } = useTranslation();
  const touch = useTouchUI();
  const id = useMemo(() => trailerIdOf(video), [video]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Nothing to embed (not a video this player knows): straight to the fallback.
  const [status, setStatus] = useState<Status>(() => (id ? 'loading' : 'failed'));
  const statusRef = useRef<Status>(status);
  const set = useCallback((s: Status) => { statusRef.current = s; setStatus(s); }, []);
  const [hint, setHint] = useState(true);
  const startedRef = useRef(false);
  const bufferingRef = useRef(false);
  const heardRef = useRef(false);
  const src = useMemo(
    () => (id ? trailerEmbedUrl(id, pageOrigin(), (i18n.language || '').slice(0, 2)) : ''),
    // One address per trailer: a language change while it plays doesn't reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => { onCloseRef.current(); }, []);
  const failed = status === 'failed';
  const paused = status === 'paused';
  const fail = useCallback(() => {
    if (statusRef.current === 'failed') return;
    set('failed');
  }, [set]);
  const canOpenOutside = !!onOpenOutside || !!id;
  const openOutside = useCallback(() => {
    close();
    if (onOpenOutside) onOpenOutside();
    else if (id) void openTrailerOutside({ kind: 'video', id }, kind);
  }, [close, onOpenOutside, id, kind]);

  /** One command to the embed's player (playVideo, pauseVideo). */
  const command = useCallback((func: 'playVideo' | 'pauseVideo') => {
    try {
      frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), TRAILER_EMBED_ORIGINS[0]);
    } catch { /* gone */ }
  }, []);
  const toggle = useCallback(() => {
    if (statusRef.current === 'failed') return;
    if (statusRef.current === 'playing') { command('pauseVideo'); set('paused'); } else { command('playVideo'); }
  }, [command, set]);

  // The page's focus: here, and back where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    try { rootRef.current?.focus({ preventScroll: true }); } catch { /* ignore */ }
    return () => {
      try { if (before && before.isConnected && before !== document.body) before.focus({ preventScroll: true }); } catch { /* ignore */ }
    };
  }, []);

  // A TV: the frame never keeps the focus (the remote's keys would go to it).
  useEffect(() => {
    if (touch) return undefined;
    const onBlur = () => {
      window.setTimeout(() => {
        if (document.activeElement && document.activeElement === frameRef.current) {
          try { rootRef.current?.focus({ preventScroll: true }); } catch { /* ignore */ }
        }
      }, 0);
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [touch]);

  // The embed's messages: its state, its errors. Only from the frame itself,
  // on the embed's own origins.
  useEffect(() => {
    const onState = (s: number) => {
      if (statusRef.current === 'failed') return;
      if (s === 1) { startedRef.current = true; set('playing'); }
      else if (s === 2) set('paused');
      else if (s === 3) bufferingRef.current = true;
      else if (s === 0 && startedRef.current) close();
    };
    const onMessage = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      if (!TRAILER_EMBED_ORIGINS.includes(e.origin)) return;
      let d: unknown = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      if (!d || typeof d !== 'object') return;
      const m = d as { event?: unknown; info?: unknown };
      heardRef.current = true;
      if (m.event === 'onError') { fail(); return; }
      if (m.event === 'onStateChange' && typeof m.info === 'number') { onState(m.info); return; }
      if ((m.event === 'infoDelivery' || m.event === 'initialDelivery') && m.info && typeof m.info === 'object') {
        const ps = (m.info as { playerState?: unknown }).playerState;
        if (typeof ps === 'number') onState(ps);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [close, fail, set]);

  // Nothing playing within 8 s (a little longer while it loads): it can't.
  useEffect(() => {
    let extended = false;
    let timer = 0;
    const check = () => {
      if (startedRef.current || statusRef.current === 'failed') return;
      if (bufferingRef.current && !extended) { extended = true; timer = window.setTimeout(check, TRAILER_BUFFERING_EXTRA_MS); return; }
      fail();
    };
    timer = window.setTimeout(check, TRAILER_START_MS);
    return () => window.clearTimeout(timer);
  }, [fail]);

  // The hint fades after a few seconds.
  useEffect(() => {
    const h = window.setTimeout(() => setHint(false), HINT_MS);
    return () => window.clearTimeout(h);
  }, []);

  // Ask the embed for its events once it has loaded, until it answers.
  const listenTimer = useRef(0);
  const onFrameLoad = useCallback(() => {
    let n = 0;
    window.clearInterval(listenTimer.current);
    const ask = () => {
      if (heardRef.current || n++ >= LISTEN_TRIES) { window.clearInterval(listenTimer.current); return; }
      try {
        frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'smc-trailer', channel: 'widget' }), TRAILER_EMBED_ORIGINS[0]);
      } catch { /* gone */ }
    };
    ask();
    listenTimer.current = window.setInterval(ask, LISTEN_EVERY_MS);
  }, []);
  useEffect(() => () => window.clearInterval(listenTimer.current), []);

  // The remote. Added after the page's own listener (which stands aside while
  // this is up); every key stops here, so nothing under the layer moves.
  const keyState = useRef({ failed, canOpenOutside, toggle, close, openOutside, command });
  keyState.current = { failed, canOpenOutside, toggle, close, openOutside, command };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // A held key (the OK that opened it): not a press here.
      if (e.repeat) return;
      const s = keyState.current;
      if (isBackKey(e)) {
        // The app's other Back listeners (useNavigation) stand aside for this press.
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        s.close();
        return;
      }
      if (s.failed) { if (isOkKey(e) && s.canOpenOutside) s.openOutside(); return; }
      if (isOkKey(e) || k === 'MediaPlayPause') s.toggle();
      else if (k === 'MediaPlay') s.command('playVideo');
      else if (k === 'MediaPause') s.command('pauseVideo');
    };
    window.addEventListener('keydown', onKey, true);
    // The remote's Play/Pause as the app's native side raises it (MainActivity).
    const offMedia = onMediaKey((m) => {
      const s = keyState.current;
      if (s.failed) return;
      if (m === 'playpause') s.toggle();
      else if (m === 'play') s.command('playVideo');
      else if (m === 'pause') s.command('pauseVideo');
    });
    return () => { window.removeEventListener('keydown', onKey, true); offMedia(); };
  }, []);

  const label = t('live.trailer.watch');
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      data-trailer-overlay={status}
      className="fixed inset-0 z-[130] flex items-center justify-center outline-none bg-black"
    >
      {!failed && (
        <>
          <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
          </div>
          <iframe
            ref={frameRef}
            data-trailer-frame=""
            src={src}
            title={label}
            tabIndex={-1}
            onLoad={onFrameLoad}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            // Its scripts and its own origin (the player needs both); no
            // pop-ups and no taking the page away from the app.
            sandbox="allow-scripts allow-same-origin allow-presentation"
            className="relative w-full h-full border-0"
          />
          {paused && !touch && (
            <div data-trailer-paused="" className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
              <span className="flex items-center justify-center w-20 h-20 rounded-full bg-black/70 text-white">
                <Pause className="w-10 h-10" />
              </span>
            </div>
          )}
          {hint && !touch && (
            <p data-trailer-hint="" className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/75 text-white/90 font-nunito text-sm whitespace-nowrap pointer-events-none">
              {t('live.trailer.hint')}
            </p>
          )}
          {touch && (
            <button
              type="button"
              data-trailer-close=""
              onClick={close}
              aria-label={t('common.close')}
              className="absolute top-3 right-3 flex items-center justify-center w-11 h-11 rounded-full bg-black/75 text-white"
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </>
      )}
      {failed && (
        <div data-trailer-failed="" className="max-w-md w-full mx-6 rounded-3xl border border-brand-gold/40 bg-[#0b1622] p-8 text-center shadow-2xl">
          <Clapperboard className="w-10 h-10 mx-auto mb-4 text-brand-gold" aria-hidden="true" />
          <p className="font-nunito text-white/90 text-lg leading-relaxed">{t('live.trailer.cantPlay')}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center -ml-3">
            {canOpenOutside && (
              <Button
                type="button"
                variant="gold"
                data-trailer-outside=""
                data-focused={touch ? undefined : 'true'}
                onClick={openOutside}
                className="tv-ring tv-ring-contrast mt-3 ml-3 h-12 rounded-xl text-base px-6 scale-105"
              >
                <ExternalLink className="w-5 h-5 mr-2" aria-hidden="true" />
                {t('live.trailer.openOutsideBtn')}
              </Button>
            )}
            {touch && (
              <Button type="button" variant="outline" onClick={close} className="mt-3 ml-3 h-12 rounded-xl text-base px-6 bg-black/40 border-white/20 text-white">
                {t('common.close')}
              </Button>
            )}
          </div>
          {!touch && <p className="mt-4 font-nunito text-sm text-brand-ice/80">{t('live.trailer.backHint')}</p>}
        </div>
      )}
    </div>
  );
});
TrailerLayer.displayName = 'TrailerLayer';

/**
 * A trailer full screen over the page that draws it, while it is drawn:
 *   {trailerId && <TrailerOverlay video={trailerId} onClose={() => setTrailerId(null)} />}
 * Never on a Kids profile: it closes at once there.
 */
export default function TrailerOverlay(props: TrailerOverlayProps) {
  const kids = !!kidsLevel();
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useEffect(() => { if (kids) onCloseRef.current(); }, [kids]);
  if (kids || typeof document === 'undefined') return null;
  // A new video is a new layer (its own frame, timers and status).
  return createPortal(<TrailerLayer key={props.video} {...props} />, document.body);
}
