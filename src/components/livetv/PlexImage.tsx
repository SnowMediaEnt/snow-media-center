// Plex poster loader — routes bytes through CapacitorHttp on native so the
// WebView never has to fetch http:// image URLs from an https origin (mixed
// content). Cached in a module-level Map so scrolling never re-fetches.
import { memo, useEffect, useState } from 'react';
import { Tv } from 'lucide-react';
import { plexFetchImageDataUri, plexPhotoTranscodeUrl } from '@/lib/plex';

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

  useEffect(() => {
    if (!path) { setSrc(null); setErr(true); return; }
    let cancelled = false;
    setErr(false);
    setSrc(null);
    const url = plexPhotoTranscodeUrl(base, path, token, w, h);
    plexFetchImageDataUri(url)
      .then((data) => { if (!cancelled) setSrc(data); })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [base, path, token, w, h]);

  if (!path || err || !src) {
    return (
      <div className={`bg-black/40 flex items-center justify-center ${className || ''}`}>
        <Tv className="w-8 h-8 text-brand-ice/40" />
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => setErr(true)} />;
});

PlexImage.displayName = 'PlexImage';
export default PlexImage;
