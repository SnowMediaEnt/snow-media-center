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

// ── the channel list over the picture (FullscreenChannelOverlay) ──────────

/** Rows drawn at once in each column (the Search row is one of the channels'). */
export const OVERLAY_CAT_ROWS = 9;
export const OVERLAY_CHANNEL_ROWS = 7;
/** Results drawn under the field while the keyboard is up. The field and
 *  these stay in the top half of a 960x540 screen: 12 + 44 + 4 x 44 = 232 px
 *  (Amazon's keyboard covers the rest from about 270 px down). */
export const OVERLAY_TYPING_RESULTS = 4;

/** The list's places the overlay draws: a window around the highlight, the
 *  Search row (when there is one) its first place; while typing the field
 *  and the first few results. `from` / `to`: the channels among them (what
 *  LiveSection fetches "what's on" for). */
export function overlayChannelWindow(
  count: number,
  channelIdx: number,
  search: { onSearch: boolean; typing: boolean } | null,
): { start: number; end: number; searchShown: boolean; from: number; to: number } {
  const lead = search ? 1 : 0;
  const typing = !!search?.typing;
  const w = listWindow(count + lead, search && (search.onSearch || typing) ? 0 : channelIdx + lead, typing ? 1 + OVERLAY_TYPING_RESULTS : OVERLAY_CHANNEL_ROWS);
  return { start: w.start, end: w.end, searchShown: !!search && w.start === 0, from: Math.max(0, w.start - lead), to: w.end - lead };
}
