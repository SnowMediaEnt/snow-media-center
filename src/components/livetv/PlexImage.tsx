// Plex poster loader — hybrid strategy to keep bytes off the JS heap:
//   1. Absolute http(s) URL (e.g. actor headshots at metadata-static.plex.tv)
//      → render directly as <img src>. Chromium caches it off-heap.
//   2. Server-relative path (native platform) → first try a plain <img> against
//      the PMS photo transcode URL. `allowMixedContent: true` (capacitor.config)
//      + cleartext permitted in network_security_config lets Chromium load
//      the http://plex-server:.../photo bytes without crossing the JS bridge.
//      If that fails once, fall back to the CapacitorHttp → data-URI path so
//      older installs still show art.
//   3. Web / non-native → same photo transcode URL as plain <img>.
//
// The data-URI fallback shares a small concurrency gate inside plex.ts so at
// most 4 CapacitorHttp image requests run at once — otherwise base64 payloads
// would spike the JS heap and cause the OOM crashes we're solving here.
import { memo, useEffect, useState } from 'react';
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

const PlexImage = memo(({ base, path, token, w, h, className, alt = '' }: Props) => {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  // Once the direct <img> path errors we try ONE data-URI fallback.
  const [fellBack, setFellBack] = useState(false);

  useEffect(() => {
    if (!path) { setSrc(null); setErr(true); return; }
    setErr(false);
    setFellBack(false);
    // Absolute http(s) URL → serve directly (signs with token if it's a Plex
    // metadata URL, otherwise leaves it alone).
    if (/^https?:\/\//i.test(path)) {
      const isPlex = /(^|\.)plex\.tv/i.test(path);
      setSrc(isPlex ? plexTokenizedUrl(path, token) : path);
      return;
    }
    // Server-relative: build the transcode URL. Native + web both try plain
    // <img> first; the CapacitorHttp fallback only kicks in on error.
    setSrc(plexPhotoTranscodeUrl(base, path, token, w, h));
  }, [base, path, token, w, h]);

  const onImgError = () => {
    // On web there's no bridge fallback — just show the placeholder.
    if (!isNativePlatform() || fellBack || !path || /^https?:\/\//i.test(path)) {
      setErr(true);
      return;
    }
    setFellBack(true);
    let cancelled = false;
    const url = plexPhotoTranscodeUrl(base, path, token, w, h);
    plexFetchImageDataUri(url)
      .then((data) => { if (!cancelled) setSrc(data); })
      .catch(() => { if (!cancelled) setErr(true); });
    // No cleanup — one-shot fallback; component re-mounts if props change.
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
