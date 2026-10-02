import { useLayoutEffect, useRef, useState } from 'react';

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

/** Description scroll speed, in CSS px a second: slow enough to read. */
export const SCROLL_LINES_PX_PER_SEC = 15;
/** How long the description holds still at the top, and again at the end. */
export const SCROLL_LINES_HOLD_MS = 3000;

/**
 * A short block of text (a description) shown in a box `maxLines` tall. When
 * it is taller than the box, it holds at the top, scrolls slowly up to the
 * end, holds there, then jumps back to the top and repeats; it never bounces.
 * Chrome 66: the Web Animations API with plain px values (no CSS variables in
 * keyframes); text that fits never moves.
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

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (dist <= 0 || !inner || typeof inner.animate !== 'function') return;
    const travelMs = (dist / SCROLL_LINES_PX_PER_SEC) * 1000;
    const total = SCROLL_LINES_HOLD_MS * 2 + travelMs;
    const end = `translate3d(0, -${dist}px, 0)`;
    const anim = inner.animate(
      [
        { transform: 'translate3d(0, 0, 0)', offset: 0 },
        { transform: 'translate3d(0, 0, 0)', offset: SCROLL_LINES_HOLD_MS / total },
        { transform: end, offset: (SCROLL_LINES_HOLD_MS + travelMs) / total },
        { transform: end, offset: 1 },
      ],
      { duration: total, iterations: Infinity, easing: 'linear' },
    );
    return () => anim.cancel();
  }, [dist, text]);

  return (
    <div ref={boxRef} className={`overflow-hidden ${className}`} style={{ maxHeight: `${maxLines * 1.375}em` }}>
      <div ref={innerRef} style={dist > 0 ? { willChange: 'transform' } : undefined}>{text}</div>
    </div>
  );
}
