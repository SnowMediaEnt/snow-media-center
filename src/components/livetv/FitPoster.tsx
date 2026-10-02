// A film's or series' cover on Live TV › VOD's detail pages.
//
// Sized by the height it is given, not by a fixed width: a 2:3 poster set to
// a fixed width ran past the bottom of the screen at 960×540. The box fills
// its column's height, measures it, and takes the width of a 2:3 poster that
// tall (never wider than maxWidth). Chrome 66 has no aspect-ratio, so the
// frame's shape comes from padding-bottom: 150%. A wide picture (a backdrop
// some panels send as the cover) is shown whole, not cropped to a sliver.
import { useLayoutEffect, useRef, useState } from 'react';

const RATIO = 1.5; // height / width of a poster

/** The 2:3 frame and its picture, as wide as its parent. */
export function PosterFrame({ src, className = '' }: { src?: string; className?: string }) {
  // Per picture: the next title's cover starts fresh.
  const [wideSrc, setWideSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const wide = !!src && wideSrc === src;
  const failed = !!src && failedSrc === src;
  return (
    <div
      className={`relative overflow-hidden bg-black/40 border border-white/10 ${className}`}
      style={{ height: 0, paddingBottom: `${RATIO * 100}%` }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(e) => { const i = e.currentTarget; setWideSrc(i.naturalWidth > i.naturalHeight ? src : null); }}
          onError={() => setFailedSrc(src)}
          className={`absolute left-0 top-0 w-full h-full ${wide ? 'object-contain' : 'object-cover'}`}
        />
      ) : null}
    </div>
  );
}

interface Props {
  src?: string;
  /** The widest it may get, in CSS px (a tall screen). */
  maxWidth: number;
  className?: string;
}

export default function FitPoster({ src, maxWidth, className = '' }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(maxWidth);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const calc = () => {
      const h = el.clientHeight;
      if (!h) return; // not laid out (a hidden pane, tests)
      const w = Math.max(48, Math.min(maxWidth, Math.floor(h / RATIO)));
      setWidth((prev) => (prev !== w ? w : prev));
    };
    calc();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  return (
    <div ref={boxRef} data-fit-poster="" className={`h-full flex-shrink-0 ${className}`} style={{ width }}>
      <PosterFrame src={src} className="rounded-2xl" />
    </div>
  );
}
