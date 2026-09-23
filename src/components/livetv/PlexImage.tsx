// Plex poster loader — Fire-TV low-memory strategy:
//   1. Absolute http(s) URL → render as-is (with token if it's a Plex URL).
//   2. Server-relative path (native + web) → PRIMARY <img> src = the server's
//      photo transcode at the size the tile is drawn (`/photo/:/transcode?
//      width=140&height=210&…`). The PMS scales it once and caches the result
//      for every viewer after that, so a rail poster is ~10 KB.
//
//      It used to be the RAW thumb (`${base}${path}?X-Plex-Token=…`) on the
//      theory that it was "the already-sized cached thumbnail". It is not:
//      that path is the poster as the agent downloaded it, typically
//      1000×1500 and 200–500 KB. Every tile on screen pulled a full poster
//      over the customer's connection and the WebView decoded a 1.5-megapixel
//      JPEG to paint a 104-pixel box. Fifty of those on the first screen is
//      15–25 MB and a few seconds of decode on a stick, which was most of
//      "Plex is laggy" — on every device, not only the weak ones.
//   3. onError #1 → fall back to the raw thumb (a server with the photo
//      transcoder disabled or failing still shows art).
//   4. onError #2 (native only) → last-ditch CapacitorHttp → data-URI path
//      (this is the 200MB-heap culprit on 1GB Fire TV Sticks; only reached
//      when both HTTP paths failed).
//
// A module-level Map caches the resolved src per `${base}|${path}|${w}x${h}`
// so scroll-back / remounts never refetch. The size is part of the key: a
// rail tile and the detail poster share a path and must not share a src.
//
// PRIORITY / FOCUS MODE: when a detail page is open, PlexSection flips the
// module-level `imageFocusMode` in plex.ts. Non-priority images defer their
// <img src> write until focus is released (a small subscription via the
// `plex-image-focus` window event). Priority images (detail poster, backdrop,
// cast, filmography) are unaffected.
import { memo, useEffect, useRef, useState } from 'react';
import { Tv } from 'lucide-react';
import {
  plexFetchImageDataUri, plexPhotoTranscodeUrl, plexTokenizedUrl,
  isPlexImageFocusOn, onPlexImageFocusChange,
} from '@/lib/plex';
import { isNativePlatform } from '@/utils/platform';

interface Props {
  base: string;
  path?: string;
  token: string;
  w: number;
  h: number;
  className?: string;
  alt?: string;
  /** When true, this image bypasses focus-mode parking and is treated as high
   *  priority in the CapacitorHttp data-URI queue. Set on detail-page assets. */
  priority?: boolean;
  /** Exempt from focus-mode parking (state gate) AND from the network-level
   *  focus block in acquireImgSlot — admitted in a second tier behind priority
   *  images, ahead of parked browse images. Still viewport-gated. Use for
   *  detail-page secondary assets (cast, seasons, episodes, filmography) that
   *  mount while focus mode is on. */
  focusExempt?: boolean;
  /** Load now, without waiting to be seen: the next few tiles along a rail
   *  (see the eager effect). Only the viewport gate is skipped; focus-mode
   *  parking and the network queue still apply. */
  eager?: boolean;
}

// The src that actually painted, per (base|token|path|size). The token is in
// the key because it is in the URL: a cached URL outliving its token (a
// provider token repair, another account on the same server) would 401. Written when an image LOADS (not when
// it is tried), so a failing URL is never remembered; read on mount, so a
// poster that scrolls out of a rail's window and back in, or comes back after
// the player closes, paints at once instead of flashing the placeholder and
// waiting for its visibility check again.
//
// Two maps, least-recently-used first out. URL strings are small, so the
// four hundred-deep rails plus the library rails all fit; data URIs (the
// http-server fallback below) are whole images in memory and stay capped low.
const URL_CACHE_MAX = 2000;
const DATA_CACHE_MAX = 200;
const _urlCache = new Map<string, string>();
const _dataCache = new Map<string, string>();
const cacheGet = (key: string): string | undefined => {
  for (const m of [_urlCache, _dataCache]) {
    const v = m.get(key);
    if (v !== undefined) { m.delete(key); m.set(key, v); return v; }
  }
  return undefined;
};
const cachePut = (key: string, value: string) => {
  const m = value.startsWith('data:') ? _dataCache : _urlCache;
  const max = m === _dataCache ? DATA_CACHE_MAX : URL_CACHE_MAX;
  m.delete(key);
  while (m.size >= max) {
    const first = m.keys().next().value;
    if (first === undefined) break;
    m.delete(first);
  }
  m.set(key, value);
};

/** Everything this loader remembers. Called with clearPlexCaches on sign-out
 *  and on a token repair. */
export function clearPlexImageCache(): void {
  _urlCache.clear();
  _dataCache.clear();
  _transcodeFails.clear();
  _httpImgBlocked.clear();
}

/** Same server, new address (the idle upgrade, the relay escape): posters that
 *  already painted keep their URL on the old address, which still answers,
 *  instead of every mounted tile re-requesting its poster at once. Called only
 *  on those paths, never on a switch to a different server. */
export function rekeyPlexImageCache(oldBase: string, newBase: string): void {
  if (!oldBase || !newBase || oldBase === newBase) return;
  const prefix = `${oldBase}|`;
  for (const m of [_urlCache, _dataCache]) {
    for (const [k, v] of Array.from(m.entries())) {
      if (k.startsWith(prefix)) m.set(`${newBase}|${k.slice(prefix.length)}`, v);
    }
  }
}

// Servers whose photo transcoder keeps failing. After a few failures on one
// server its posters go straight to the raw thumb instead of paying a failed
// transcode request first, every time. A failure only counts when the raw
// thumb then LOADS — proof the server and the token are fine and it was the
// transcoder that said no (a Wi-Fi drop or a dead token fails both, and must
// not push a box onto full-size posters). And it wears off: the transcoder
// is tried again after ten minutes.
const TRANSCODE_FAILS_MAX = 3;
const TRANSCODE_RETRY_MS = 10 * 60 * 1000;
const _transcodeFails = new Map<string, { count: number; at: number }>();
const noTranscode = (base: string) => {
  const f = _transcodeFails.get(base);
  if (!f || f.count < TRANSCODE_FAILS_MAX) return false;
  if (Date.now() - f.at > TRANSCODE_RETRY_MS) { _transcodeFails.delete(base); return false; }
  return true;
};
const noteTranscodeFail = (base: string) => {
  const f = _transcodeFails.get(base);
  _transcodeFails.set(base, { count: (f?.count ?? 0) + 1, at: Date.now() });
};

// An https page (Capacitor's https://localhost) with a plain-http Plex server.
// capacitor.config.ts sets allowMixedContent, so a plain <img> normally loads
// it — and a plain <img> is far cheaper than the CapacitorHttp → base64 path,
// which the header calls the heap culprit. So an http server starts on the
// plain <img>; only if that is actually blocked on this box (both the
// transcode and the raw thumb fail) is the server marked, and its later
// posters go straight to the data-URI path.
const PAGE_HTTPS = typeof window !== 'undefined' && window.location.protocol === 'https:';
const _httpImgBlocked = new Set<string>();

const PlexImage = memo(({ base, path, token, w, h, className, alt = '', priority = false, focusExempt = false, eager = false }: Props) => {
  const key = path ? `${base}|${token}|${path}|${w}x${h}` : '';
  // Paint straight from the cache when this poster already loaded once —
  // unless focus mode would have parked it (see commitSrc).
  const [src, setSrc] = useState<string | null>(() => {
    if (!key) return null;
    if (!priority && !focusExempt && isPlexImageFocusOn()) return null;
    return cacheGet(key) ?? null;
  });
  const [err, setErr] = useState(false);
  // Bumped to re-run the load ladder after a failure (see the re-arm below).
  const [armNonce, setArmNonce] = useState(0);
  // Fallback ladder: 0 = photo-transcode, 1 = raw thumb, 2 = data-URI (native).
  const stepRef = useRef(0);
  // True when this image is on the raw thumb because its transcode failed
  // (as opposed to going there directly on a no-transcode server).
  const fellBackRef = useRef(false);
  // Deferred src while imageFocusMode is on and this image is not priority.
  const pendingSrcRef = useRef<string | null>(null);
  // Viewport gate for non-priority images. A poster that painted from the
  // cache is already past it.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState<boolean>(() => priority || src !== null);
  const inViewRef = useRef(inView); inViewRef.current = inView;

  // Commit a src, honoring focus-mode parking for non-priority images.
  const commitSrc = (s: string) => {
    if (!priority && !focusExempt && isPlexImageFocusOn()) {
      pendingSrcRef.current = s;
    } else {
      pendingSrcRef.current = null;
      setSrc(s);
    }
  };

  // Release parked src the moment focus mode flips off (or priority is true).
  useEffect(() => {
    const flush = () => {
      if ((priority || focusExempt || !isPlexImageFocusOn()) && pendingSrcRef.current) {
        const s = pendingSrcRef.current;
        pendingSrcRef.current = null;
        setSrc(s);
      }
    };
    if (priority || focusExempt) flush();
    const off = onPlexImageFocusChange(() => flush());
    return () => { off(); };
  }, [priority, focusExempt]);

  // The next few tiles along a rail: admitted by position, not geometry. The
  // rail is an overflow-x scroller, and the visibility check clips to it, so a
  // tile one slot past the edge never counted as near the screen until the
  // cursor had already scrolled it in — every Right arrow revealed an empty
  // tile that only then started loading.
  useEffect(() => { if (eager) setInView(true); }, [eager]);

  // IntersectionObserver gate — only applies to non-priority images.
  useEffect(() => {
    if (priority || inViewRef.current) return;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const el = wrapRef.current;
    if (!el) return;
    let late = 0;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setInView(true); io.disconnect(); window.clearTimeout(late); return; }
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    // Safety net for a box with no laid-out size (it never intersects). Every
    // Plex poster frame is sized now, so this measures once and admits
    // nothing; it is kept for any image dropped into an unsized box, and
    // cleared as soon as the image is admitted.
    late = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) setInView(true);
    }, 400);
    return () => { io.disconnect(); window.clearTimeout(late); };
  }, [priority]);

  useEffect(() => {
    stepRef.current = 0;
    fellBackRef.current = false;
    setErr(false);
    pendingSrcRef.current = null;
    if (!path) { setSrc(null); setErr(true); return; }
    const cached = cacheGet(key);
    if (cached) { commitSrc(cached); return; }
    if (/^https?:\/\//i.test(path)) {
      const isPlex = /(^|\.)plex\.tv/i.test(path);
      const resolved = isPlex ? plexTokenizedUrl(path, token) : path;
      commitSrc(resolved);
      return;
    }
    // A plain-http server this box has already shown cannot load in an <img>:
    // straight to CapacitorHttp.
    const baseIsHttp = /^http:\/\//i.test(base);
    if (PAGE_HTTPS && baseIsHttp && isNativePlatform() && _httpImgBlocked.has(base)) {
      stepRef.current = 2;
      if (!inView) return; // wait until in-viewport for non-priority
      const url = plexPhotoTranscodeUrl(base, path, token, w, h);
      let cancelled = false;
      plexFetchImageDataUri(url, priority, focusExempt)
        .then((data) => { if (cancelled) return; cachePut(key, data); commitSrc(data); })
        .catch(() => { if (!cancelled) setErr(true); });
      return () => { cancelled = true; };
    }
    // Server-relative: the small photo transcode is the primary source (see
    // the header — the raw thumb is the full poster), unless this server's
    // transcoder has failed repeatedly, in which case the raw thumb is.
    //
    // VIEWPORT-GATED. The library rows screen mounts whole horizontal rails,
    // most of each one off-screen; committing immediately fired dozens of
    // poster GETs at a server that was still answering the row queries.
    // `loading="lazy"` does NOT cover this: it landed in Chrome 76 and the
    // oldest boxes here run Chromium 66, where the attribute is inert.
    if (!inView) return;
    if (noTranscode(base)) {
      stepRef.current = 1;
      commitSrc(`${base}${path}?X-Plex-Token=${encodeURIComponent(token)}`);
      return;
    }
    commitSrc(plexPhotoTranscodeUrl(base, path, token, w, h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, path, token, w, h, priority, focusExempt, inView, armNonce]);

  // One delayed re-arm after a failure, twice at most. Without it every poster
  // on screen during a Wi-Fi blip stays a grey placeholder for the life of the
  // component: nothing in the effect above re-runs when the network returns.
  const rearmRef = useRef(0);
  useEffect(() => { rearmRef.current = 0; }, [base, path]);
  useEffect(() => {
    if (!err || !path || rearmRef.current >= 2) return;
    const t = window.setTimeout(() => { rearmRef.current += 1; setArmNonce((n) => n + 1); }, 6000);
    return () => window.clearTimeout(t);
  }, [err, path]);

  const onImgLoad = () => {
    if (!src || !key) return;
    if (stepRef.current === 0) {
      // Remember what painted (never a failure — this only runs on load). Only
      // the small transcode (or an absolute URL) is remembered: a raw
      // full-size fallback must not become this poster's cached answer.
      if (!src.startsWith('data:')) cachePut(key, src);
      if (_transcodeFails.has(base)) _transcodeFails.delete(base);
    } else if (stepRef.current === 1 && fellBackRef.current) {
      // The transcode failed but the raw poster loaded: that is the
      // transcoder's failure, and it counts.
      fellBackRef.current = false;
      noteTranscodeFail(base);
    }
  };

  const onImgError = () => {
    if (!path || /^https?:\/\//i.test(path)) { setErr(true); return; }
    const step = stepRef.current;
    if (step === 0) {
      // The transcoder said no (disabled, or choking) — or the network did:
      // the raw poster still shows the art, at the old cost, for this one
      // image. Whether it counts against the transcoder is decided on load.
      fellBackRef.current = true;
      stepRef.current = 1;
      commitSrc(`${base}${path}?X-Plex-Token=${encodeURIComponent(token)}`);
      return;
    }
    if (step === 1 && isNativePlatform()) {
      // Both plain loads failed. On an https page with an http server that is
      // the mixed-content block: remember it for this server.
      if (PAGE_HTTPS && /^http:\/\//i.test(base)) _httpImgBlocked.add(base);
      // Last-ditch: CapacitorHttp → base64 data URI. Concurrency-gated in plex.ts.
      stepRef.current = 2;
      if (!priority && !inView) { setErr(true); return; }
      const url = plexPhotoTranscodeUrl(base, path, token, w, h);
      plexFetchImageDataUri(url, priority, focusExempt)
        .then((data) => { cachePut(key, data); commitSrc(data); })
        .catch(() => setErr(true));
      return;
    }
    setErr(true);
  };

  if (!path || err || !src) {
    return (
      <div ref={wrapRef} className={`bg-black/40 flex items-center justify-center ${className || ''}`}>
        <Tv className="w-8 h-8 text-brand-ice/40" />
      </div>
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <img ref={wrapRef as any} src={src} alt={alt} className={className} onLoad={onImgLoad} onError={onImgError} loading="lazy" decoding="async" />;
});

PlexImage.displayName = 'PlexImage';
export default PlexImage;
