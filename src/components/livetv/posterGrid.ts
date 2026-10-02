// Live TV › VOD's poster grids (Movies, Series).
import { keepInView } from '@/utils/keepInView';

/**
 * After the poster grid's virtualizer has scrolled to a row, finish the job
 * against the real layout: the virtualizer does not know about the grid's
 * padding, so a row brought up from below stopped with the bottom of its
 * posters under the edge of the pane. Measured on the next frame (the row is
 * drawn by then); returns the cancel for an effect.
 */
export function followGridRow(container: HTMLElement | null, row: number): () => void {
  if (!container) return () => {};
  const id = requestAnimationFrame(() => {
    const el = container.querySelector<HTMLElement>(`[data-grid-row="${row}"]`);
    // The focused poster grows 8%: room for that above and below.
    if (el) keepInView(container, el, 16);
  });
  return () => cancelAnimationFrame(id);
}
