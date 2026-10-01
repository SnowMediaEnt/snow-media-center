import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

interface ScrollTextProps {
  text: string;
  /** Only scrolls while true (the row or tile has the remote's highlight). */
  active: boolean;
  className?: string;
}

/**
 * One line of text that is cut off with "…" when it doesn't fit, and slides
 * slowly sideways to show the rest while it is highlighted (pausing at each
 * end). Text that fits never moves. Chrome 66: transform + a CSS variable in
 * the keyframes; no layout work while it runs.
 */
export default function ScrollText({ text, active, className = '' }: ScrollTextProps) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [dist, setDist] = useState(0);

  useLayoutEffect(() => {
    if (!active) { setDist(0); return; }
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const over = inner.scrollWidth - box.clientWidth;
    setDist(over > 2 ? over : 0);
  }, [active, text]);

  const moving = active && dist > 0;
  // About 40 px a second, plus the pauses at each end.
  const style: CSSProperties | undefined = moving
    ? ({ '--scroll-text-dist': `-${dist}px`, animationDuration: `${Math.max(3, dist / 40 + 2)}s` } as CSSProperties)
    : undefined;

  return (
    <span ref={boxRef} className={`block min-w-0 overflow-hidden whitespace-nowrap ${className}`} title={text}>
      <span
        ref={innerRef}
        className={moving ? 'scroll-text-move inline-block' : 'block truncate'}
        style={style}
      >
        {text}
      </span>
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
