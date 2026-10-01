import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

interface ScrollTextProps {
  text: string;
  /** Only scrolls while true (the row or tile has the remote's highlight). */
  active: boolean;
  className?: string;
}

/** Ticker speed, in CSS px a second: slow enough to read from the couch. */
export const SCROLL_TEXT_PX_PER_SEC = 30;
/** How long the start of the text holds still before each pass. */
export const SCROLL_TEXT_PAUSE_MS = 1500;
/** Space between the end of the text and its repeat, in em. */
const GAP_EM = 3;

/**
 * One line of text that is cut off with "…" when it doesn't fit. While it is
 * highlighted it scrolls one way like a news ticker: the start holds still,
 * then the text moves slowly left and repeats after a gap, so it reads in
 * order and never bounces. Text that fits never moves. Chrome 66: the Web
 * Animations API with plain px values (no CSS variables in keyframes); no
 * layout work while it runs.
 */
export default function ScrollText({ text, active, className = '' }: ScrollTextProps) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const firstRef = useRef<HTMLSpanElement>(null);
  const gapRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    if (!active) { setOverflows(false); return; }
    const box = boxRef.current;
    if (!box) return;
    // Truncated: the full width is its scrollWidth. Already moving (the text
    // changed while highlighted): the first copy's own width.
    const width = measureRef.current?.scrollWidth ?? firstRef.current?.offsetWidth;
    if (width == null) return;
    setOverflows(width - box.clientWidth > 2);
  }, [active, text]);

  const moving = active && overflows;

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!moving || !track || typeof track.animate !== 'function') return;
    // One pass = the text plus the gap; then the repeat sits exactly where the
    // text started, so the loop is seamless.
    const dist = (firstRef.current?.offsetWidth ?? 0) + (gapRef.current?.offsetWidth ?? 0);
    if (dist <= 0) return;
    const travelMs = (dist / SCROLL_TEXT_PX_PER_SEC) * 1000;
    const total = SCROLL_TEXT_PAUSE_MS + travelMs;
    const anim = track.animate(
      [
        { transform: 'translate3d(0, 0, 0)', offset: 0 },
        { transform: 'translate3d(0, 0, 0)', offset: SCROLL_TEXT_PAUSE_MS / total },
        { transform: `translate3d(-${dist}px, 0, 0)`, offset: 1 },
      ],
      { duration: total, iterations: Infinity, easing: 'linear' },
    );
    return () => anim.cancel();
  }, [moving, text]);

  return (
    <span ref={boxRef} className={`block min-w-0 overflow-hidden whitespace-nowrap ${className}`} title={text}>
      {moving ? (
        <span ref={trackRef} className="inline-block whitespace-nowrap" style={{ willChange: 'transform' }}>
          <span ref={firstRef}>{text}</span>
          <span ref={gapRef} className="inline-block" style={{ width: `${GAP_EM}em` }} aria-hidden="true" />
          <span aria-hidden="true">{text}</span>
        </span>
      ) : (
        <span ref={measureRef} className="block truncate">{text}</span>
      )}
    </span>
  );
}

/**
 * A short block of text (a description) shown in a box `maxLines` tall. When
 * it is longer, it scrolls slowly up to the end and back, pausing at each end,
 * so the whole thing can be read from the couch.
 */
export function ScrollLines({ text, maxLines = 2, className = '' }: { text: string; maxLines?: number; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [dist, setDist] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const over = inner.scrollHeight - box.clientHeight;
    setDist(over > 2 ? over : 0);
  }, [text, maxLines]);

  // About 12 px (half a line) a second, plus the pauses at each end.
  const style: CSSProperties | undefined = dist > 0
    ? ({ '--scroll-text-dist': `-${dist}px`, animationDuration: `${Math.max(4, dist / 12 + 3)}s` } as CSSProperties)
    : undefined;

  return (
    <div ref={boxRef} className={`overflow-hidden ${className}`} style={{ maxHeight: `${maxLines * 1.375}em` }}>
      <div ref={innerRef} className={dist > 0 ? 'scroll-lines-move' : undefined} style={style}>{text}</div>
    </div>
  );
}
