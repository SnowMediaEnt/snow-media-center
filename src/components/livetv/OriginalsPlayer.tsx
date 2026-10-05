// Live TV › Snow Originals: one video full screen, then the next.
//
// On a TV box it plays on the native ExoPlayer (useNativePlayer, live:false),
// like Recordings and Backups do: hardware decoding on old boxes, MP4s with
// their index at the end, retries, and the place kept when the app comes back.
// The WebView <video> (VideoPlayer) is only the fallback for the browser.
//
// Upright (phone) videos: the native picture goes in a centred box the
// video's own shape (its `rect`), and the sides show the video's 32-px still
// (`backdropUrl`) stretched over the whole screen, which the browser's scaling
// turns into a blur. That costs no CSS filter, no second decoder and almost no
// memory, so it works on Chrome 66 and 2 GB boxes. The centre stays
// transparent so the native picture shows through. Sideways videos fill the
// screen.
//
// Remote: OK pause/play, ◀ ▶ 10 s, ▼ next video, ▲ previous, Back to the list
// (one Back = one step). The remote's media keys are useNativePlayer's.
// Touch screens (phones, tablets) only: a tap is OK, a swipe up the next
// video (▼) and a swipe down the previous one (▲); Back is the edge swipe.
// At the end: "Up next" with a 5-second countdown, then the next video; after
// the last one, back to the list. Nothing is preloaded.
//
// Chrome 66: no inset, no aspect-ratio, no gap beyond gap-1..4.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, Snowflake } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hasNativePlayer, SnowPlayer } from '@/capacitor/SnowPlayer';
import { useNativePlayer, type NativeRect } from '@/hooks/useNativePlayer';
import { usePictureTouch } from '@/hooks/usePlayerTouch';
import { useTransientVisible } from '@/hooks/useTransientVisible';
import { trackEvent, startTimer, stopTimer } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { kidsLevel } from '@/lib/kidsFilter';
import { clearProgress, resumeAt, saveProgress } from '@/lib/originalsProgress';
import { formatDuration } from '@/lib/recording';
import { loadPlayerVolume } from '@/utils/volume';
import SnowLoader from '@/components/SnowLoader';
import type { VideoController } from './VideoPlayer';

import type { OriginalsPlayerProps, SnowOriginal } from '@/lib/snowOriginals';

const VideoPlayer = lazy(() => import('./VideoPlayer'));


const SEEK_SEC = 10;
const UP_NEXT_SEC = 5;
const SAVE_EVERY_TICKS = 5;

const markBack = () => { (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now(); };
const isBackKey = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
const isOkKey = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23;
const swallow = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

/** An error for analytics: at most 200 characters and never an address. */
const cleanMessage = (msg: string) => msg.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]').slice(0, 200);

/** The upright box: full height, the video's own width, centred. */
function uprightRect(it: SnowOriginal): NativeRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const width = Math.min(vw, Math.round(vh * it.width / it.height));
  return { x: (vw - width) / 2, y: 0, width, height: vh };
}

/** One band of the blurred sides: a window onto the still stretched over the whole screen. */
function bandStyle(img: string | null, left: number, width: number): CSSProperties {
  const vw = window.innerWidth, vh = window.innerHeight;
  return {
    left, top: 0, width, height: '100%',
    backgroundColor: '#000',
    ...(img ? {
      backgroundImage: `url(${JSON.stringify(img)})`,
      backgroundSize: `${vw}px ${vh}px`,
      backgroundPosition: `${-left}px 0`,
      backgroundRepeat: 'no-repeat',
    } : {}),
  };
}

export default function OriginalsPlayer({ items, startId, onClose }: OriginalsPlayerProps) {
  const { t } = useTranslation();
  const [native] = useState(() => hasNativePlayer());
  const [volume] = useState(() => loadPlayerVolume());
  const [idx, setIdx] = useState(() => Math.max(0, items.findIndex((it) => it.id === startId)));
  const cur: SnowOriginal | undefined = items[idx];
  const next: SnowOriginal | undefined = items[idx + 1];
  const curId = cur?.id ?? startId;

  // Where this video starts: its saved place (videos of 2 minutes or more), read once per video.
  // Keyed on the id: a new copy of the same video (the list redrawn) is not a new start.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const startAt = useMemo(() => (cur ? resumeAt(cur.id, cur.durationSec) : 0), [curId]);
  const portrait = !!cur?.portrait && cur.width > 0 && cur.height > 0;
  const rect = useMemo<NativeRect | undefined>(
    () => (portrait && cur ? uprightRect(cur) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [portrait, cur?.width, cur?.height],
  );

  // Up next: the seconds left, or null when it isn't showing.
  const [upNext, setUpNext] = useState<number | null>(null);
  const [htmlError, setHtmlError] = useState<string | null>(null);
  const [htmlPaused, setHtmlPaused] = useState(false);
  const [htmlNonce, setHtmlNonce] = useState(0);
  const [pos, setPos] = useState({ position: 0, duration: 0 });

  const closedRef = useRef(false);
  const autoplayRef = useRef(false);
  const endedRef = useRef<string | null>(null);
  const posRef = useRef({ position: 0, duration: 0 });
  const htmlCtlRef = useRef<VideoController | null>(null);
  const htmlBoxRef = useRef<HTMLDivElement | null>(null);
  // The next HTML5 mount is a retry of this video (carry on from its place), not its start.
  const htmlRetryRef = useRef(false);

  const onEndedRef = useRef<() => void>(() => {});
  const nativeEnded = useCallback(() => onEndedRef.current(), []);
  const player = useNativePlayer({
    active: native,
    url: native && cur?.videoUrl ? cur.videoUrl : null,
    live: false,
    volume,
    startPosition: startAt,
    onEnded: nativeEnded,
    rect,
  });

  const paused = native ? player.paused : htmlPaused;
  const errorMsg = native ? (player.error ? player.error.message || 'Playback error' : null) : htmlError;

  // The bar: 4 s after the video starts and after any key. Shown for as long as it is paused.
  const [barShown, pokeBar] = useTransientVisible(4000, { watchKeys: false, deps: [curId] });
  const [resumedShown] = useTransientVisible(3000, { watchKeys: false, deps: [curId], enabled: startAt > 0 });
  const barVisible = barShown || paused;

  // Refs for the key handler and timers, which are set up once.
  const s = { cur, next, idx, items, upNext, errorMsg, player, native, onClose, barVisible, startAt };
  const sRef = useRef(s);
  sRef.current = s;

  // The native picture shows through: no background on the page behind it.
  useEffect(() => {
    if (!native) return;
    document.documentElement.classList.add('snowplayer-fullscreen');
    return () => { document.documentElement.classList.remove('snowplayer-fullscreen'); };
  }, [native]);

  // "Wide" (force 16:9) would squash an upright video into a 16:9 strip
  // inside its box; fit is the right shape there. The viewer's choice comes
  // back for sideways videos and when the player closes.
  useEffect(() => {
    if (!native || !portrait) return;
    let gone = false;
    let restore = false;
    void (async () => {
      try {
        const { mode } = await SnowPlayer.getResizeMode();
        if (gone || mode !== 'wide') return;
        restore = true;
        await SnowPlayer.setResizeMode({ mode: 'fit' });
      } catch { /* web: no screen format */ }
    })();
    return () => {
      gone = true;
      if (restore) void SnowPlayer.setResizeMode({ mode: 'wide' }).catch(() => { /* ignore */ });
    };
  }, [native, portrait]);

  // ── Analytics: a play per video, and how long it is watched ──
  useEffect(() => {
    if (!cur) return;
    const auto = autoplayRef.current;
    autoplayRef.current = false;
    if (isDemo()) return;
    try {
      trackEvent('originals_play', 'player', {
        id: cur.id, title: cur.title, orientation: cur.portrait ? 'portrait' : 'landscape',
        kid_profile: kidsLevel() !== null, resumed: startAt > 0, autoplay: auto,
      });
      startTimer('watch', 'originals_watch', 'player', { id: cur.id, title: cur.title });
    } catch { /* ignore */ }
    return () => { try { stopTimer('watch'); } catch { /* ignore */ } };
    // Once per video: startAt and cur go with curId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId]);

  // A play error, once per error.
  useEffect(() => {
    if (!errorMsg || !cur || isDemo()) return;
    try { trackEvent('player_error', 'player', { kind: 'originals', channel_or_title: cur.title, message: cleanMessage(errorMsg) }); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorMsg]);

  // ── Position: read every second, the bar redrawn only while it shows, the place saved every 5 s ──
  const readPosition = useCallback(async (): Promise<{ position: number; duration: number }> => {
    if (sRef.current.native) {
      const p = await sRef.current.player.getPosition();
      return { position: p.position, duration: p.duration };
    }
    const v = htmlBoxRef.current?.querySelector('video');
    if (!v) return { position: 0, duration: 0 };
    return { position: v.currentTime || 0, duration: Number.isFinite(v.duration) ? v.duration : 0 };
  }, []);

  useEffect(() => {
    posRef.current = { position: startAt, duration: 0 };
    setPos({ position: startAt, duration: 0 });
    if (!cur) return;
    endedRef.current = null;
    let alive = true;
    let ticks = 0;
    const id = cur.id;
    const timer = window.setInterval(() => {
      void readPosition().then((p) => {
        if (!alive || sRef.current.cur?.id !== id || endedRef.current === id) return;
        posRef.current = p;
        if (sRef.current.barVisible) setPos(p);
        ticks += 1;
        if (ticks % SAVE_EVERY_TICKS === 0 && p.position > 0) saveProgress(id, p.position, p.duration > 0 ? p.duration : cur.durationSec);
      }).catch(() => { /* next tick */ });
    }, 1000);
    return () => { alive = false; window.clearInterval(timer); };
    // Once per video: startAt and cur go with curId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId, readPosition]);
  // The bar coming back shows the place now, not where it was when it hid.
  useEffect(() => { if (barVisible) setPos(posRef.current); }, [barVisible]);

  /** Keep this video's place before leaving it (not after its end). */
  const keepPlace = useCallback(() => {
    const c = sRef.current.cur;
    if (!c || endedRef.current === c.id) return;
    const p = posRef.current;
    if (p.position > 0) saveProgress(c.id, p.position, p.duration > 0 ? p.duration : c.durationSec);
  }, []);

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    keepPlace();
    sRef.current.onClose(sRef.current.cur?.id ?? startId);
  }, [keepPlace, startId]);

  const playIndex = useCallback((i: number, autoplay: boolean) => {
    const st = sRef.current;
    if (i < 0 || i >= st.items.length || closedRef.current) return;
    keepPlace();
    autoplayRef.current = autoplay;
    endedRef.current = null;
    setUpNext(null);
    setHtmlError(null);
    setHtmlPaused(false);
    setIdx(i);
  }, [keepPlace]);

  // ── The end: Up next, or back to the list after the last one ──
  onEndedRef.current = () => {
    const c = sRef.current.cur;
    if (!c || closedRef.current || endedRef.current === c.id) return;
    endedRef.current = c.id;
    clearProgress(c.id);
    if (!isDemo()) { try { trackEvent('originals_finish', 'player', { id: c.id, title: c.title }); } catch { /* ignore */ } }
    if (sRef.current.next) setUpNext(UP_NEXT_SEC);
    else close();
  };
  const htmlEnded = useCallback(() => onEndedRef.current(), []);

  const counting = upNext !== null;
  useEffect(() => {
    if (!counting) return;
    const timer = window.setInterval(() => { setUpNext((n) => (n === null ? n : Math.max(0, n - 1))); }, 1000);
    return () => window.clearInterval(timer);
  }, [counting]);
  useEffect(() => { if (upNext === 0) playIndex(sRef.current.idx + 1, true); }, [upNext, playIndex]);

  // Nothing to play (an empty list): straight back.
  useEffect(() => { if (!cur) close(); }, [cur, close]);

  // ── HTML5 fallback callbacks (stable: VideoPlayer re-runs onReady when it changes) ──
  const htmlReady = useCallback((ctl: VideoController) => {
    htmlCtlRef.current = ctl;
    const v = htmlBoxRef.current?.querySelector('video');
    // A retry carries on from where it was; a new video starts at its saved place.
    // (This runs before this component's own effects for a new video, so posRef may still be the last one's.)
    const retrying = htmlRetryRef.current;
    htmlRetryRef.current = false;
    const at = retrying ? posRef.current.position : sRef.current.startAt;
    if (!v || at <= 0) return;
    const go = () => { try { v.currentTime = at; } catch { /* ignore */ } };
    if (v.readyState >= 1) go();
    else v.addEventListener('loadedmetadata', go, { once: true });
  }, []);
  const htmlErrorCb = useCallback((msg: string) => { setHtmlError(msg || 'Playback error'); }, []);
  const htmlPlayState = useCallback((p: boolean) => { setHtmlPaused(p); }, []);

  const retry = useCallback(() => {
    const st = sRef.current;
    if (st.native) st.player.retry();
    else { htmlRetryRef.current = true; setHtmlError(null); setHtmlNonce((n) => n + 1); }
  }, []);

  // ── Remote ──
  // What a key does once the bar is poked (and a finger on a touch screen):
  // OK pause/play (Up next: play it now; an error: retry), ▼ ▲ the next /
  // previous video, ◀ ▶ 10 s.
  const act = useCallback((key: string, ok: boolean) => {
    const st = sRef.current;
    if (st.upNext !== null) {
      if (ok) playIndex(st.idx + 1, false);
      return;
    }
    if (st.errorMsg) {
      if (ok) retry();
      else if (key === 'ArrowDown') playIndex(st.idx + 1, false);
      else if (key === 'ArrowUp') playIndex(st.idx - 1, false);
      return;
    }
    if (ok) {
      if (st.native) st.player.controller?.togglePlay();
      else htmlCtlRef.current?.togglePlay();
      return;
    }
    if (key === 'ArrowDown') { playIndex(st.idx + 1, false); return; }
    if (key === 'ArrowUp') { playIndex(st.idx - 1, false); return; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const delta = key === 'ArrowRight' ? SEEK_SEC : -SEEK_SEC;
      if (st.native) {
        const n = st.player;
        void n.getPosition().then((p) => {
          const to = p.position + delta;
          const max = p.duration > 0 ? Math.max(0, p.duration - 1) : to;
          return n.seekTo(Math.max(0, Math.min(max, to)));
        }).catch(() => { /* ignore */ });
      } else {
        const v = htmlBoxRef.current?.querySelector('video');
        if (!v) return;
        const max = Number.isFinite(v.duration) && v.duration > 0 ? Math.max(0, v.duration - 1) : v.currentTime + delta;
        try { v.currentTime = Math.max(0, Math.min(max, v.currentTime + delta)); } catch { /* ignore */ }
      }
    }
  }, [playIndex, retry]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The remote's own media keys belong to the player (useNativePlayer / VideoPlayer).
      if (e.key.startsWith('Media') || e.key.startsWith('Channel')) return;
      swallow(e);
      if (isBackKey(e)) { markBack(); close(); return; }
      if (closedRef.current) return;
      pokeBar();
      const ok = isOkKey(e);
      if (ok && e.repeat) return;
      act(e.key, ok);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, pokeBar, act]);
  usePictureTouch({
    within: '[data-originals-player]',
    onTap: () => { if (closedRef.current) return; pokeBar(); act('Enter', true); },
    onSwipe: (dir) => { if (closedRef.current) return; pokeBar(); act(dir === 'up' ? 'ArrowDown' : 'ArrowUp', false); },
  });

  if (!cur) return null;

  const vw = window.innerWidth;
  const sideImg = cur.backdropUrl || cur.posterUrl;
  const dur = pos.duration > 0 ? pos.duration : cur.durationSec;
  const pct = dur > 0 ? Math.min(100, Math.max(0, (pos.position / dur) * 100)) : 0;

  return (
    <div
      data-originals-player
      data-orientation={cur.portrait ? 'portrait' : 'landscape'}
      data-engine={native ? 'native' : 'html5'}
      className={`fixed left-0 top-0 w-full h-full z-[60] text-white overflow-hidden ${native ? 'bg-transparent' : 'bg-black'}`}
    >
      {/* Blurred sides of an upright video. Native: two bands either side of the transparent centre. */}
      {native && rect && (
        <>
          <div data-originals-band="left" className="absolute" style={bandStyle(sideImg, 0, rect.x)}>
            <div className="w-full h-full bg-black/40" />
          </div>
          <div data-originals-band="right" className="absolute" style={bandStyle(sideImg, rect.x + rect.width, vw - rect.x - rect.width)}>
            <div className="w-full h-full bg-black/40" />
          </div>
        </>
      )}

      {/* Browser fallback: the still behind, the video in the centred box (or full screen). */}
      {!native && (
        <>
          {rect && (
            <div data-originals-band="full" className="absolute" style={bandStyle(sideImg, 0, vw)}>
              <div className="w-full h-full bg-black/40" />
            </div>
          )}
          <div
            ref={htmlBoxRef}
            className="absolute"
            style={rect ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height } : { left: 0, top: 0, width: '100%', height: '100%' }}
          >
            <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><SnowLoader size="lg" /></div>}>
              <VideoPlayer
                key={`${cur.id}:${htmlNonce}`}
                src={cur.videoUrl || null}
                volume={volume}
                className="w-full h-full"
                maxRetries={2}
                onReady={htmlReady}
                onEnded={htmlEnded}
                onError={htmlErrorCb}
                onPlayStateChange={htmlPlayState}
              />
            </Suspense>
          </div>
        </>
      )}

      {native && player.buffering && !errorMsg && upNext === null && (
        <div className="absolute left-0 top-0 w-full h-full flex items-center justify-center pointer-events-none">
          <div className="w-full max-w-md"><SnowLoader size="lg" label={t('live.player.buffering')} /></div>
        </div>
      )}

      {resumedShown && startAt > 0 && !errorMsg && upNext === null && (
        <div data-originals-resumed className="absolute top-4 right-4 px-4 py-2 rounded-xl bg-black/70 text-sm font-nunito pointer-events-none">
          {t('originals.player.resumed')}
        </div>
      )}

      {errorMsg && upNext === null && (
        <div data-originals-error className="absolute left-0 top-0 w-full h-full flex flex-col items-center justify-center bg-black/85 p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-brand-gold mb-3" />
          <p className="text-xl font-quicksand font-semibold mb-1">{t('originals.player.cantPlay')}</p>
          <p className="text-sm text-brand-ice/80 font-nunito">{t('originals.player.retryHint')}</p>
        </div>
      )}

      {upNext !== null && next && (
        <div data-originals-upnext className="absolute left-0 top-0 w-full h-full flex items-center justify-center bg-black/70">
          <div className="flex items-center rounded-2xl bg-brand-navy/95 border border-brand-gold/40 p-5" style={{ width: 600, maxWidth: '94%' }}>
            <div className="relative flex-shrink-0 rounded-xl overflow-hidden bg-black mr-5" style={{ width: 192, height: 108 }}>
              {next.portrait && next.backdropUrl && (
                <div className="absolute left-0 top-0 w-full h-full" style={{ backgroundImage: `url(${JSON.stringify(next.backdropUrl)})`, backgroundSize: '100% 100%' }}>
                  <div className="w-full h-full bg-black/40" />
                </div>
              )}
              {next.posterUrl
                ? <img src={next.posterUrl} alt="" decoding="async" className="relative w-full h-full object-contain" />
                : <div className="w-full h-full flex items-center justify-center"><Snowflake className="w-10 h-10 text-brand-ice/50" /></div>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-nunito uppercase tracking-wide text-brand-gold">{t('originals.player.upNext')}</p>
              <p className="mt-1 text-2xl font-quicksand font-bold truncate">{next.title}</p>
              <p className="mt-2 text-sm font-nunito text-brand-ice/70">{t('originals.player.upNextHint')}</p>
            </div>
            <div data-originals-countdown className="flex-shrink-0 ml-5 w-14 h-14 rounded-full border-2 border-brand-gold flex items-center justify-center text-2xl font-quicksand font-bold tabular-nums">
              {upNext}
            </div>
          </div>
        </div>
      )}

      {barVisible && !errorMsg && upNext === null && (
        <div data-originals-bar className="absolute left-0 right-0 bottom-0 px-8 pt-8 pb-8 bg-gradient-to-t from-black/90 to-transparent pointer-events-none">
          <p className="text-2xl font-quicksand font-bold truncate">
            <Snowflake className="inline w-6 h-6 mr-2 -mt-1 text-brand-gold" />{cur.title}
          </p>
          <div className="mt-2 flex items-center">
            <div className="flex-1 h-2.5 bg-white/15 rounded-full overflow-hidden">
              <div className="h-full bg-brand-gold" style={{ width: `${pct}%` }} />
            </div>
            <span data-originals-time className="text-base font-nunito tabular-nums ml-3">
              {formatDuration(pos.position)} / {dur > 0 ? formatDuration(dur) : '--:--'}
            </span>
          </div>
          <p className="mt-2 text-sm font-nunito text-brand-ice/70">
            {paused ? t('originals.player.hintPaused') : t('originals.player.hintPlaying')}
          </p>
        </div>
      )}
    </div>
  );
}
