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
import { memo, useEffect, useRef, useState } from 'react';
import { Tv } from 'lucide-react';
import { plexFetchImageDataUri, plexPhotoTranscodeUrl, plexTokenizedUrl } from '@/lib/plex';
import { isNativePlatform } from '@/utils/platform';

interface Props {
  base: string;
  path?: string;
  token: string;
  w: number;
  h: number;
  className?: string;
  alt?: string;
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

const PlexImage = memo(({ base, path, token, w, h, className, alt = '' }: Props) => {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  // Fallback ladder: 0 = raw thumb, 1 = photo-transcode, 2 = data-URI (native).
  const stepRef = useRef(0);

  useEffect(() => {
    stepRef.current = 0;
    setErr(false);
    if (!path) { setSrc(null); setErr(true); return; }
    const key = `${base}|${path}`;
    const cached = _srcCache.get(key);
    if (cached) { setSrc(cached); return; }
    if (/^https?:\/\//i.test(path)) {
      const isPlex = /(^|\.)plex\.tv/i.test(path);
      const resolved = isPlex ? plexTokenizedUrl(path, token) : path;
      _srcCache.set(key, resolved);
      setSrc(resolved);
      return;
    }
    // Mixed-content shortcut: https page + http PMS → skip plain <img> and
    // photo-transcode (both would be blocked) and go straight to CapacitorHttp.
    const baseIsHttp = /^http:\/\//i.test(base);
    if (PAGE_HTTPS && baseIsHttp && isNativePlatform()) {
      stepRef.current = 2;
      const url = plexPhotoTranscodeUrl(base, path, token, w, h);
      let cancelled = false;
      plexFetchImageDataUri(url)
        .then((data) => { if (cancelled) return; _srcCache.set(key, data); setSrc(data); })
        .catch(() => { if (!cancelled) setErr(true); });
      return () => { cancelled = true; };
    }
    // Server-relative: raw tokenized thumb URL is the primary source.
    const raw = `${base}${path}?X-Plex-Token=${encodeURIComponent(token)}`;
    setSrc(raw);
  }, [base, path, token, w, h]);

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
      const url = plexPhotoTranscodeUrl(base, path, token, w, h);
      let cancelled = false;
      plexFetchImageDataUri(url)
        .then((data) => { if (cancelled) return; _srcCache.set(`${base}|${path}`, data); setSrc(data); })
        .catch(() => { if (!cancelled) setErr(true); });
      return;
    }
    setErr(true);
  };

  if (!path || err || !src) {
    return (
      <div className={`bg-black/40 flex items-center justify-center ${className || ''}`}>
        <Tv className="w-8 h-8 text-brand-ice/40" />
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} onError={onImgError} loading="lazy" decoding="async" />;
});

PlexImage.displayName = 'PlexImage';
export default PlexImage;
