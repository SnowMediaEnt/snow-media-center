// Long channel names (2026-10-09: an event channel with no listings carries
// the event and its start time in its name, "the name is too long and won't
// scroll"). Owner: a size or two smaller on two lines beats a scroll,
// nothing waits for focus. So a name longer than a place shows on one
// line at its usual size is drawn a step smaller, on up to two lines, on
// every row at once; the "…" only past the second line. A short name looks as
// it always has. No measuring: the length decides, once per render.

/** Up to two lines, broken anywhere if a word is longer than the line. */
export const TWO_LINES = 'line-clamp-2 break-words leading-tight';

/** A name past `chars` characters is drawn the smaller size, on two lines. */
export const isLongName = (name: string | null | undefined, chars: number): boolean =>
  (name ?? '').length > chars;

/** The text classes for a name: its usual size (`big`) while it fits one
 *  line there, else `small`; either way on up to two lines. */
export const nameClasses = (name: string | null | undefined, chars: number, big: string, small: string): string =>
  `${isLongName(name, chars) ? small : big} ${TWO_LINES}`;
