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
}

// Cache the FINAL resolved src per (base|path|size). Keyed without the token
// so we still hit on remount after a token refresh.
const _srcCache = new Map<string, string>();
const SRC_CACHE_MAX = 200;
const capSrcCache = () => {
  while (_srcCache.size >= SRC_CACHE_MAX) {
    const first = _srcCache.keys().next().value;
    if (first === undefined) break;
    _srcCache.delete(first);
  }
};

// When the WebView origin is https://localhost, every http:// image URL is
// blocked by Chrome's mixed-content policy — the plain <img> + photo-transcode
// fallbacks both fail before we finally hit the CapacitorHttp bridge, wasting
// two failed round-trips per poster. Detect once and jump straight to the
// data-URI path when the PMS connection is plain http.
const PAGE_HTTPS = typeof window !== 'undefined' && window.location.protocol === 'https:';

const PlexImage = memo(({ base, path, token, w, h, className, alt = '', priority = false, focusExempt = false }: Props) => {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  // Bumped to re-run the load ladder after a failure (see the re-arm below).
  const [armNonce, setArmNonce] = useState(0);
  // Fallback ladder: 0 = photo-transcode, 1 = raw thumb, 2 = data-URI (native).
  const stepRef = useRef(0);
  // Deferred src while imageFocusMode is on and this image is not priority.
  const pendingSrcRef = useRef<string | null>(null);
  // Viewport gate for the heavy CapacitorHttp bridge fetch — non-priority
  // images only fire once at/near the viewport.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState<boolean>(priority);

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

  // IntersectionObserver gate — only applies to non-priority images.
  useEffect(() => {
    if (priority) { setInView(true); return; }
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setInView(true); io.disconnect(); return; }
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    // Safety net. A box with no laid-out size never intersects, and a poster
    // frame sized only by `aspect-ratio` is exactly that on a WebView older
    // than Chrome 88 — which the oldest boxes here are. Left alone those would
    // now stay blank forever.
    //
    // MEASURE, don't blanket-admit. The first version of this just set a timer
    // and admitted every pending image when it fired, which hands the whole
    // burst back a moment later — the exact thing the gate exists to prevent.
    // Checking the box instead admits only the images whose container genuinely
    // cannot report visibility, and leaves the ordinary off-screen ones waiting
    // for the user to reach them.
    const late = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) setInView(true);
    }, 400);
    return () => { io.disconnect(); window.clearTimeout(late); };
  }, [priority]);

  useEffect(() => {
    stepRef.current = 0;
    setErr(false);
    pendingSrcRef.current = null;
    if (!path) { setSrc(null); setErr(true); return; }
    const key = `${base}|${path}|${w}x${h}`;
    const cached = _srcCache.get(key);
    if (cached) { commitSrc(cached); return; }
    if (/^https?:\/\//i.test(path)) {
      const isPlex = /(^|\.)plex\.tv/i.test(path);
      const resolved = isPlex ? plexTokenizedUrl(path, token) : path;
      capSrcCache(); _srcCache.set(key, resolved);
      commitSrc(resolved);
      return;
    }
    // Mixed-content shortcut: https page + http PMS → skip plain <img> and
    // photo-transcode (both would be blocked) and go straight to CapacitorHttp.
    const baseIsHttp = /^http:\/\//i.test(base);
    if (PAGE_HTTPS && baseIsHttp && isNativePlatform()) {
      stepRef.current = 2;
      if (!inView) return; // wait until in-viewport for non-priority
      const url = plexPhotoTranscodeUrl(base, path, token, w, h);
      let cancelled = false;
      plexFetchImageDataUri(url, priority, focusExempt)
        .then((data) => { if (cancelled) return; capSrcCache(); _srcCache.set(key, data); commitSrc(data); })
        .catch(() => { if (!cancelled) setErr(true); });
      return () => { cancelled = true; };
    }
    // Server-relative: the small photo transcode is the primary source (see
    // the header — the raw thumb is the full poster).
    //
    // VIEWPORT-GATED, exactly like the data-URI branch above. This branch used
    // to commit immediately, so every mounted tile fetched its poster whether
    // or not it was on screen. That was invisible while the only caller was a
    // virtualized grid — it mounts just the visible rows — but the library
    // rows screen mounts whole horizontal rails, most of each one off-screen.
    // Opening Movies fired dozens of poster GETs at a PMS that was already
    // serving the row queries, and the rows arrived late as a result.
    //
    // `loading="lazy"` on the <img> does NOT cover this: it landed in Chrome 76
    // and the oldest boxes here run Chromium 66, where the attribute is inert.
    if (!inView) return;
    commitSrc(plexPhotoTranscodeUrl(base, path, token, w, h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, path, token, w, h, priority, focusExempt, inView, armNonce]);

  // One delayed re-arm after a failure, twice at most. Without it every poster
  // on screen during a Wi-Fi blip stays a grey placeholder for the life of the
  // component: nothing in the effect above re-runs when the network returns,
  // and HomePanel rails and search results are not virtualized, so they never
  // remount to recover either.
  const rearmRef = useRef(0);
  useEffect(() => { rearmRef.current = 0; }, [base, path]);
  useEffect(() => {
    if (!err || !path || rearmRef.current >= 2) return;
    const t = window.setTimeout(() => { rearmRef.current += 1; setArmNonce((n) => n + 1); }, 6000);
    return () => window.clearTimeout(t);
  }, [err, path]);

  const onImgError = () => {
    if (!path || /^https?:\/\//i.test(path)) { setErr(true); return; }
    const step = stepRef.current;
    if (step === 0) {
      // The transcoder said no (disabled, or choking): the raw poster still
      // shows the art, at the old cost, for this one image.
      stepRef.current = 1;
      commitSrc(`${base}${path}?X-Plex-Token=${encodeURIComponent(token)}`);
      return;
    }
    if (step === 1 && isNativePlatform()) {
      // Last-ditch: CapacitorHttp → base64 data URI. Concurrency-gated in plex.ts.
      stepRef.current = 2;
      if (!priority && !inView) { setErr(true); return; }
      const url = plexPhotoTranscodeUrl(base, path, token, w, h);
      plexFetchImageDataUri(url, priority, focusExempt)
        .then((data) => { capSrcCache(); _srcCache.set(`${base}|${path}|${w}x${h}`, data); commitSrc(data); })
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
  return <img ref={wrapRef as any} src={src} alt={alt} className={className} onError={onImgError} loading="lazy" decoding="async" />;
});

PlexImage.displayName = 'PlexImage';
export default PlexImage;
