// Plex poster loader — Fire-TV low-memory strategy:
//   1. Absolute http(s) URL → render as-is (with token if it's a Plex URL).
//   2. Server-relative path (native + web) → PRIMARY <img> src = the RAW
//      tokenized thumb URL (`${base}${path}?X-Plex-Token=…`). Plex serves the
//      already-sized cached thumbnail — no per-image /photo/:/transcode job
//      spun up on the PMS, no heap pressure client-side.
//   3. onError #1 → fall back to plexPhotoTranscodeUrl (small box, no upscale).
//   4. onError #2 (native only) → last-ditch CapacitorHttp → data-URI path
//      (this is the 200MB-heap culprit on 1GB Fire TV Sticks; only reached
//      when the raw + transcoded HTTP paths both failed).
//
// A module-level Map caches the resolved src per `${base}|${path}` so
// scroll-back / remounts never refetch.
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
}

// Cache the FINAL resolved src per (base|path). Keyed without token/size so
// we still hit on remount even if the caller passes slightly different sizes.
const _srcCache = new Map<string, string>();

// When the WebView origin is https://localhost, every http:// image URL is
// blocked by Chrome's mixed-content policy — the plain <img> + photo-transcode
// fallbacks both fail before we finally hit the CapacitorHttp bridge, wasting
// two failed round-trips per poster. Detect once and jump straight to the
// data-URI path when the PMS connection is plain http.
const PAGE_HTTPS = typeof window !== 'undefined' && window.location.protocol === 'https:';

const PlexImage = memo(({ base, path, token, w, h, className, alt = '', priority = false }: Props) => {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  // Fallback ladder: 0 = raw thumb, 1 = photo-transcode, 2 = data-URI (native).
  const stepRef = useRef(0);
  // Deferred src while imageFocusMode is on and this image is not priority.
  const pendingSrcRef = useRef<string | null>(null);
  // Viewport gate for the heavy CapacitorHttp bridge fetch — non-priority
  // images only fire once at/near the viewport.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState<boolean>(priority);

  // Commit a src, honoring focus-mode parking for non-priority images.
  const commitSrc = (s: string) => {
    if (!priority && isPlexImageFocusOn()) {
      pendingSrcRef.current = s;
    } else {
      pendingSrcRef.current = null;
      setSrc(s);
    }
  };

  // Release parked src the moment focus mode flips off (or priority is true).
  useEffect(() => {
    const flush = () => {
      if ((priority || !isPlexImageFocusOn()) && pendingSrcRef.current) {
        const s = pendingSrcRef.current;
        pendingSrcRef.current = null;
        setSrc(s);
      }
    };
    if (priority) flush();
    const off = onPlexImageFocusChange(() => flush());
    return () => { off(); };
  }, [priority]);

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
    return () => { io.disconnect(); };
  }, [priority]);

  useEffect(() => {
    stepRef.current = 0;
    setErr(false);
    pendingSrcRef.current = null;
    if (!path) { setSrc(null); setErr(true); return; }
    const key = `${base}|${path}`;
    const cached = _srcCache.get(key);
    if (cached) { commitSrc(cached); return; }
    if (/^https?:\/\//i.test(path)) {
      const isPlex = /(^|\.)plex\.tv/i.test(path);
      const resolved = isPlex ? plexTokenizedUrl(path, token) : path;
      _srcCache.set(key, resolved);
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
      plexFetchImageDataUri(url, priority)
        .then((data) => { if (cancelled) return; _srcCache.set(key, data); commitSrc(data); })
        .catch(() => { if (!cancelled) setErr(true); });
      return () => { cancelled = true; };
    }
    // Server-relative: raw tokenized thumb URL is the primary source.
    const raw = `${base}${path}?X-Plex-Token=${encodeURIComponent(token)}`;
    commitSrc(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, path, token, w, h, priority, inView]);

  const onImgError = () => {
    if (!path || /^https?:\/\//i.test(path)) { setErr(true); return; }
    const step = stepRef.current;
    if (step === 0) {
      // Try the server photo transcode with a SMALL box + no upscale.
      stepRef.current = 1;
      setSrc(plexPhotoTranscodeUrl(base, path, token, w, h));
      return;
    }
    if (step === 1 && isNativePlatform()) {
      // Last-ditch: CapacitorHttp → base64 data URI. Concurrency-gated in plex.ts.
      stepRef.current = 2;
      if (!priority && !inView) { setErr(true); return; }
      const url = plexPhotoTranscodeUrl(base, path, token, w, h);
      let cancelled = false;
      plexFetchImageDataUri(url, priority)
        .then((data) => { if (cancelled) return; _srcCache.set(`${base}|${path}`, data); setSrc(data); })
        .catch(() => { if (!cancelled) setErr(true); });
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
  return <img ref={wrapRef as unknown as React.MutableRefObject<HTMLImageElement | null>} src={src} alt={alt} className={className} onError={onImgError} loading="lazy" decoding="async" />;
});

PlexImage.displayName = 'PlexImage';
export default PlexImage;
