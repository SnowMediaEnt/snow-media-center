// A title's trailer, played inside SMC (owner, 2026-10-11: "with the fix to
// play in SMC instead of going out and the pause fix as well"; from Tronix
// 1039497 and 06f67c0).
//
// A full-screen layer over the page that opened it, with the video service's
// own embeddable player (lib/trailer trailerEmbedUrl: its documented iframe
// embed, privacy-enhanced host). Nothing is extracted or downloaded, and the
// film player (VodPlayer) is never involved.
//  - The remote: OK (and the remote's Play/Pause) pauses and plays it through
//    the embed's player API: the messages its own API script sends, posted
//    straight to the frame (no outside script is loaded into the app). Once
//    the embed first answers, the layer subscribes to its state and its
//    errors. Back closes it, one step, whatever it is doing: the page under it
//    is as it was, its highlight still on Trailer. The arrows do nothing here.
//  - Paused (Tronix 06f67c0; the owner's Fire TV Stick): the Amazon WebView
//    plays the embed on a hardware overlay and tears it down on pause, so a
//    paused embed draws no frame at all (the screen went white, and OK never
//    brought the picture back). A TV never relies on it: our own opaque dark
//    "Paused" card covers the frame (the title, where it stopped, from the
//    time the embed reports, "OK to resume · Back to close"). OK sends play;
//    no "playing" back within TRAILER_RESUME_MS, the frame is rebuilt at that
//    second (the embed's own start + autoplay), once per resume; the rebuilt
//    one not playing within 8 s: it can't play here.
//  - The frame never takes the remote: the layer keeps the page's focus, so
//    every key comes here (a touch screen may tap the embed's own controls,
//    and has a Close button).
//  - It won't play here (the embed says so, or nothing plays within 8 s, a
//    little longer while it is still loading): "This trailer can't play
//    here" and "Open outside the app".
//  - The video's end closes it, and so does the app going to the background
//    (Home on the remote): nothing plays behind the launcher.
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
import { App as CapApp } from '@capacitor/app';
import { Clapperboard, ExternalLink, Loader2, Pause, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTouchUI } from '@/lib/phoneMode';
import { onMediaKey } from '@/lib/mediaKeys';
import { kidsLevel } from '@/lib/kidsFilter';
import { formatDuration } from '@/lib/recording';
import { TRAILER_EMBED_ORIGINS, openTrailerOutside, trailerEmbedUrl, trailerIdOf, type TrailerKind } from '@/lib/trailer';

/** No playback by then: it can't play here. */
export const TRAILER_START_MS = 8000;
/** Still loading at 8 s (the embed said it is buffering): this much longer. */
export const TRAILER_BUFFERING_EXTRA_MS = 7000;
/** After the play command, the embed has this long to say it plays again; then the frame is rebuilt there. */
export const TRAILER_RESUME_MS = 1500;
/** At most this long guessed past the embed's last reported time (it reports a few times a second). */
const TIME_GUESS_MAX_S = 2;
/** The remote's hint shows this long. */
const HINT_MS = 5000;
/** The embed's player API: ask for its events, again until it answers. */
const LISTEN_EVERY_MS = 250;
const LISTEN_TRIES = 40;
/** The embed's events the layer subscribes to once it answers. */
const EMBED_EVENTS = ['onStateChange', 'onError'] as const;

type Status = 'loading' | 'playing' | 'paused' | 'resuming' | 'failed';
type EmbedCommand = 'playVideo' | 'pauseVideo' | 'addEventListener';

export interface TrailerOverlayProps {
  /** The trailer: a video id, or a watch / short / embed link to one (lib/trailer trailerIdOf). */
  video: string;
  /** Back, the Close button, the video's end, the app going to the background,
   *  or "Open outside the app": the page drops the layer. */
  onClose: () => void;
  /** The title's name as the page shows it (the Paused card says it). */
  title?: string;
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

const TrailerLayer = memo(({ video, onClose, title, onOpenOutside, kind = 'movie' }: TrailerOverlayProps) => {
  const { t, i18n } = useTranslation();
  const touch = useTouchUI();
  const touchRef = useRef(touch);
  touchRef.current = touch;
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
  // The frame on screen has answered (and been asked for its events).
  const heardRef = useRef(false);
  // The frame: the first one, or one rebuilt at the paused second (n counts them).
  const [frame, setFrame] = useState<{ n: number; start: number | null }>({ n: 0, start: null });
  // One language per open: a change while it plays doesn't reload it.
  const lang = useRef((i18n.language || '').slice(0, 2)).current;
  const src = useMemo(
    () => (id ? trailerEmbedUrl(id, pageOrigin(), lang, frame.start) : ''),
    [id, lang, frame.start],
  );
  // Where it is: the embed's last reported time (and when it came), its length.
  const timeRef = useRef<{ t: number; at: number }>({ t: 0, at: 0 });
  const [duration, setDuration] = useState(0);
  const [pausedAt, setPausedAt] = useState(0);
  const pausedAtRef = useRef(0);
  const resumeTimer = useRef(0);
  const rebuildTimer = useRef(0);

  // Closed once, whichever way (Back, the end, the background, both of the
  // background's signals together).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closedRef = useRef(false);
  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCloseRef.current();
  }, []);
  const failed = status === 'failed';
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

  /** One command to the embed's player (playVideo, pauseVideo, addEventListener). */
  const command = useCallback((func: EmbedCommand, args: unknown[] = []) => {
    try {
      frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), TRAILER_EMBED_ORIGINS[0]);
    } catch { /* gone */ }
  }, []);
  const clearResume = useCallback(() => {
    window.clearTimeout(resumeTimer.current); resumeTimer.current = 0;
    window.clearTimeout(rebuildTimer.current); rebuildTimer.current = 0;
  }, []);
  /** Where it is now: the last reported time, plus the moments since while it played. */
  const nowAt = useCallback((): number => {
    const { t: at0, at } = timeRef.current;
    if (!at || statusRef.current !== 'playing') return at0;
    return at0 + Math.min(TIME_GUESS_MAX_S, Math.max(0, (Date.now() - at) / 1000));
  }, []);
  /** Paused (by the remote, or the embed says so): the card, at this second. */
  const markPaused = useCallback((at: number) => {
    clearResume();
    pausedAtRef.current = at;
    setPausedAt(at);
    set('paused');
  }, [clearResume, set]);
  const pause = useCallback(() => {
    if (statusRef.current !== 'playing') return;
    const at = nowAt();
    command('pauseVideo');
    markPaused(at);
  }, [command, markPaused, nowAt]);
  /** The same video again from the paused second (the embed's start + autoplay). */
  const rebuild = useCallback(() => {
    if (statusRef.current !== 'resuming') return;
    const start = Math.floor(pausedAtRef.current);
    heardRef.current = false;
    timeRef.current = { t: start, at: 0 };
    setFrame((f) => ({ n: f.n + 1, start: start >= 1 ? start : null }));
    // The new frame doesn't play either: it can't play here.
    window.clearTimeout(rebuildTimer.current);
    rebuildTimer.current = window.setTimeout(() => {
      if (statusRef.current === 'resuming') set('failed');
    }, TRAILER_START_MS);
  }, [set]);
  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    command('playVideo');
    set('resuming');
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(rebuild, TRAILER_RESUME_MS);
  }, [command, rebuild, set]);
  const toggle = useCallback(() => {
    const st = statusRef.current;
    if (st === 'failed' || st === 'resuming') return;
    if (st === 'playing') pause();
    else if (st === 'paused') resume();
    else command('playVideo');
  }, [command, pause, resume]);
  useEffect(() => clearResume, [clearResume]);

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

  // The app goes to the background (the remote's Home, another app): the
  // trailer closes, as the film player stops (VideoPlayer). Fire TV's Home
  // doesn't always reach the page as visibilitychange; Capacitor's
  // appStateChange covers it.
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) close(); };
    document.addEventListener('visibilitychange', onVisibility);
    let handle: { remove: () => void } | null = null;
    let cancelled = false;
    try {
      void CapApp.addListener('appStateChange', ({ isActive }) => { if (!isActive) close(); })
        .then((h) => { if (cancelled) void h.remove(); else handle = h; })
        .catch(() => { /* web: visibilitychange covers it */ });
    } catch { /* no Capacitor */ }
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      try { void handle?.remove(); } catch { /* ignore */ }
    };
  }, [close]);

  // The embed's messages: its state, its time, its errors. Only from the
  // frame on screen, on the embed's own origins.
  useEffect(() => {
    const onState = (s: number) => {
      const st = statusRef.current;
      if (st === 'failed') return;
      if (s === 1) {
        startedRef.current = true;
        if (st === 'resuming') clearResume();
        // Paused on a TV: a late "playing" (sent before our pause got there)
        // must not play under the card; pause it again. A touch screen's own
        // play button on the embed: it plays.
        if (st === 'paused' && !touchRef.current) command('pauseVideo');
        else set('playing');
      }
      // The embed paused itself (or confirms ours): the card. Resuming, the
      // rebuild decides (a paused embed is just what it is for).
      else if (s === 2) { if (st === 'playing' || st === 'loading') markPaused(nowAt()); }
      else if (s === 3) bufferingRef.current = true;
      else if (s === 0 && startedRef.current) close();
    };
    const onInfo = (info: { currentTime?: unknown; duration?: unknown }) => {
      const ct = info.currentTime;
      if (typeof ct === 'number' && Number.isFinite(ct) && ct >= 0) {
        timeRef.current = { t: ct, at: Date.now() };
        // Paused: the embed's own last word on where it stopped.
        if (statusRef.current === 'paused') { pausedAtRef.current = ct; setPausedAt(ct); }
      }
      const d = info.duration;
      if (typeof d === 'number' && Number.isFinite(d) && d > 0) setDuration(d);
    };
    const onMessage = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      if (!TRAILER_EMBED_ORIGINS.includes(e.origin)) return;
      let d: unknown = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      if (!d || typeof d !== 'object') return;
      const m = d as { event?: unknown; info?: unknown };
      // Its first answer: subscribe to its state and its errors (an embed
      // that won't play here says so at once instead of after 8 s).
      if (!heardRef.current) {
        heardRef.current = true;
        for (const ev of EMBED_EVENTS) command('addEventListener', [ev]);
      }
      if (m.event === 'onError') { fail(); return; }
      if (m.event === 'onStateChange' && typeof m.info === 'number') { onState(m.info); return; }
      if ((m.event === 'infoDelivery' || m.event === 'initialDelivery') && m.info && typeof m.info === 'object') {
        // The time first: a "paused" in the same message pauses at it.
        onInfo(m.info as { currentTime?: unknown; duration?: unknown });
        const ps = (m.info as { playerState?: unknown }).playerState;
        if (typeof ps === 'number') onState(ps);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [close, fail, set, clearResume, markPaused, nowAt, command]);

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

  // Ask the embed for its events once it has loaded, until it answers (a
  // rebuilt frame too).
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
  const keyState = useRef({ failed, canOpenOutside, toggle, close, openOutside, pause, resume });
  keyState.current = { failed, canOpenOutside, toggle, close, openOutside, pause, resume };
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
      else if (k === 'MediaPlay') s.resume();
      else if (k === 'MediaPause') s.pause();
    };
    window.addEventListener('keydown', onKey, true);
    // The remote's Play/Pause as the app's native side raises it (MainActivity).
    const offMedia = onMediaKey((m) => {
      const s = keyState.current;
      if (s.failed) return;
      if (m === 'playpause') s.toggle();
      else if (m === 'play') s.resume();
      else if (m === 'pause') s.pause();
    });
    return () => { window.removeEventListener('keydown', onKey, true); offMedia(); };
  }, []);

  const label = t('live.trailer.watch');
  // Paused or starting again, on a TV: our card over the frame.
  const held = !touch && (status === 'paused' || status === 'resuming');
  const resuming = status === 'resuming';
  const name = (title ?? '').trim();
  const timeText = duration > 0
    ? t('live.trailer.time', { time: formatDuration(Math.min(pausedAt, duration)), duration: formatDuration(duration) })
    : formatDuration(pausedAt);
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
          {/* Black under its picture: a WebView that draws nothing for a
              paused or starting embed shows black, never the page or white. */}
          <iframe
            key={frame.n}
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
            className="relative w-full h-full border-0 bg-black"
          />
          {held && (
            // Opaque: the paused frame may draw nothing (or white) under it.
            <div
              data-trailer-paused={status}
              role="status"
              className="absolute inset-0 flex items-center justify-center bg-black pointer-events-none"
            >
              <div className="max-w-xl w-full mx-6 rounded-3xl border border-brand-gold/40 bg-[#0b1622] px-8 py-7 text-center shadow-2xl">
                <span className="flex items-center justify-center w-16 h-16 mx-auto mb-3 rounded-full bg-black/40 text-white" aria-hidden="true">
                  {resuming ? <Loader2 className="w-8 h-8 animate-spin text-brand-gold" /> : <Pause className="w-8 h-8" />}
                </span>
                <p className="font-nunito text-sm uppercase tracking-wider text-brand-ice/80">{t('live.trailer.paused')}</p>
                {name && (
                  <p data-trailer-title="" className="mt-1 font-quicksand font-bold text-2xl text-white leading-tight line-clamp-2 break-words">{name}</p>
                )}
                <p data-trailer-time="" dir="ltr" className="mt-2 font-nunito text-xl text-white/90 tabular-nums">{timeText}</p>
                <p className="mt-4 font-nunito text-base text-brand-ice/80">{t('live.trailer.pausedHint')}</p>
              </div>
            </div>
          )}
          {hint && !held && !touch && (
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
 *   {trailerId && <TrailerOverlay video={trailerId} title={name} onClose={() => setTrailerId(null)} />}
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
