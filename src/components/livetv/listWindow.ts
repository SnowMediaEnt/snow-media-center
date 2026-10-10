// The rows a remote-driven list over the picture draws (the channel list on
// ◀, Recently watched on ▶): only a window around the highlight. "All
// channels" can be thousands long, and a 2 GB box must not lay them all out.

/** The slice of a list to draw so the focused row stays in view. */
export function listWindow(length: number, focus: number, size: number): { start: number; end: number } {
  if (length <= size) return { start: 0, end: length };
  const half = Math.floor(size / 2);
  const start = Math.max(0, Math.min(length - size, focus - half));
  return { start, end: start + size };
}
