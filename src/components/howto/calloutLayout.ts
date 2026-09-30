// Where the ring, the number and the label of each highlight go, in percent of
// the picture. Pure maths, no DOM: the picture view feeds it the measured
// rects (and, once drawn, the real label sizes) and draws what comes back.
//
// Rules (plan-howto.md, section 5):
//  - the ring is the rect grown by 0.8%, kept inside the frame;
//  - the label sits below the ring if the ring ends above 70% of the height,
//    else above if it starts below 30%, else to the right, else to the left;
//    when that spot would cover a ring (its own or another's) or a label
//    already placed, the first other side that covers none is taken, else
//    one that covers only its own ring (stacked rows: a label below the
//    first row would hide the second);
//  - a label is never wider than 38% of the frame and always stays inside 1..99%;
//  - two labels never sit on each other: the later one moves down (up if it sits
//    above its ring, or at the bottom edge). A pointer then stretches so it still
//    reaches its ring.
import type { ShotRect } from '@/data/howtoContract';

export interface Box { left: number; top: number; width: number; height: number }
export type Side = 'below' | 'above' | 'right' | 'left';
/** The label edge the pointer sticks out of. */
export type PointerEdge = 'top' | 'bottom' | 'left' | 'right';

export interface CalloutInput {
  /** [left, top, width, height] in percent of the frame. */
  rect: ShotRect;
  /** Length of the label text: sizes the label until it has been measured. */
  chars?: number;
  /** Force a side (the drawn remote uses this; screenshots follow the rules). */
  side?: Side;
  /** Put the label next to this box instead of the ring: the pointer then
   *  stretches from the label to the ring (a leader line across the drawing). */
  anchor?: Box;
}

/** The frame on screen, in px. Only its aspect and scale matter. */
export interface FrameSize { width: number; height: number }
/** A label's real size, in percent of the frame. */
export interface LabelSize { width: number; height: number }

export interface Callout {
  ring: Box;
  /** 1, 2, 3, only when the slide has more than one highlight. */
  badge: number | null;
  label: Box & { maxWidth: number; side: Side };
  /** null when the label sits on the ring itself (no room anywhere). */
  pointer: { edge: PointerEdge; offset: number; length: number } | null;
}

export interface LayoutOptions {
  frame?: FrameSize;
  /** Measured label sizes, by highlight index; missing ones are estimated. */
  sizes?: (LabelSize | undefined)[];
  /** Areas labels must stay off (for example the remote-hint chip). */
  avoid?: Box[];
}

/** 16:9 picture at the size the guide draws it (62% of 960 wide). */
export const DEFAULT_FRAME: FrameSize = { width: 565, height: 318 };

export const RING_GROW = 0.8;
export const LABEL_MAX_WIDTH = 38;
export const EDGE_MIN = 1;
export const EDGE_MAX = 99;
/** A label pushed against the right edge keeps this much spare width, in
 *  percent: its max width is rounded to 2 decimals, and a hair less than
 *  the text needs wraps it onto a second line. */
const FIT_SLACK = 0.05;
/** Room between labels, in percent. */
const LABEL_MARGIN = 1;
/** Pointer arrow length in px: the least gap between a label and its ring. */
export const ARROW_PX = 9;

// Label look (px). The view uses the same numbers, so estimate and drawing agree.
export const LABEL_FONT_PX = 15;
export const LABEL_LINE_PX = 19;
export const LABEL_PAD_X_PX = 20;
export const LABEL_PAD_Y_PX = 10;
export const BADGE_PX = 28;
// Bold text, a little wider than the average letter, so the guess errs on the big side.
const CHAR_PX = LABEL_FONT_PX * 0.62;

const round2 = (n: number) => Math.round(n * 100) / 100;
const keepIn = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

export function growRing(rect: ShotRect): Box {
  const [l, t, w, h] = rect;
  const left = Math.max(0, l - RING_GROW);
  const top = Math.max(0, t - RING_GROW);
  const right = Math.min(100, l + w + RING_GROW);
  const bottom = Math.min(100, t + h + RING_GROW);
  return { left: round2(left), top: round2(top), width: round2(right - left), height: round2(bottom - top) };
}

/** Best guess of a label's size until it has been measured. */
export function estimateLabelSize(chars: number, frame: FrameSize, hasBadge: boolean): LabelSize {
  const maxPx = (LABEL_MAX_WIDTH / 100) * frame.width;
  const extra = LABEL_PAD_X_PX + (hasBadge ? BADGE_PX : 0);
  const textPx = Math.max(1, chars) * CHAR_PX;
  const lines = Math.min(2, Math.max(1, Math.ceil(textPx / Math.max(20, maxPx - extra))));
  const widthPx = Math.min(maxPx, extra + (lines > 1 ? maxPx - extra : textPx));
  const heightPx = Math.max(lines * LABEL_LINE_PX + LABEL_PAD_Y_PX, hasBadge ? BADGE_PX + LABEL_PAD_Y_PX - 4 : 0);
  return { width: (widthPx / frame.width) * 100, height: (heightPx / frame.height) * 100 };
}

const overlaps = (a: Box, b: Box, m: number) =>
  a.left < b.left + b.width + m && b.left < a.left + a.width + m && a.top < b.top + b.height + m && b.top < a.top + a.height + m;

/** Rings that touch or contain each other become one hole in the dim layer
 *  (evenodd would paint a ring inside another ring dark again). */
export function spotlightHoles(rings: Box[]): Box[] {
  const holes = rings.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < holes.length && !merged; i++) {
      for (let j = i + 1; j < holes.length && !merged; j++) {
        if (!overlaps(holes[i], holes[j], 0)) continue;
        const a = holes[i];
        const b = holes[j];
        const left = Math.min(a.left, b.left);
        const top = Math.min(a.top, b.top);
        const right = Math.max(a.left + a.width, b.left + b.width);
        const bottom = Math.max(a.top + a.height, b.top + b.height);
        holes[i] = { left, top, width: right - left, height: bottom - top };
        holes.splice(j, 1);
        merged = true;
      }
    }
  }
  return holes;
}

const SIDES: Side[] = ['below', 'above', 'right', 'left'];

function pickSide(ring: Box, size: LabelSize, gapX: number): Side {
  if (ring.top + ring.height < 70) return 'below';
  if (ring.top > 30) return 'above';
  if (ring.left + ring.width + gapX + size.width <= EDGE_MAX) return 'right';
  return 'left';
}

/** Pointer for a finished label position: which edge, where along it, how long. */
function pointerFor(ring: Box, label: Box, frame: FrameSize): Callout['pointer'] {
  const pxX = frame.width / 100;
  const pxY = frame.height / 100;
  const ringCx = ring.left + ring.width / 2;
  const ringCy = ring.top + ring.height / 2;
  const ringBottom = ring.top + ring.height;
  const ringRight = ring.left + ring.width;
  const labelBottom = label.top + label.height;
  const labelRight = label.left + label.width;

  // Where along the label's edge the arrow leaves, in % of that edge; kept off the rounded corners.
  const along = (from: number, size: number, target: number) =>
    keepIn(((target - from) / Math.max(size, 0.1)) * 100, 10, 90);

  if (label.top >= ringBottom - 0.01) {
    return { edge: 'top', offset: along(label.left, label.width, ringCx), length: Math.max(ARROW_PX, (label.top - ringBottom) * pxY) };
  }
  if (labelBottom <= ring.top + 0.01) {
    return { edge: 'bottom', offset: along(label.left, label.width, ringCx), length: Math.max(ARROW_PX, (ring.top - labelBottom) * pxY) };
  }
  if (label.left >= ringRight - 0.01) {
    return { edge: 'left', offset: along(label.top, label.height, ringCy), length: Math.max(ARROW_PX, (label.left - ringRight) * pxX) };
  }
  if (labelRight <= ring.left + 0.01) {
    return { edge: 'right', offset: along(label.top, label.height, ringCy), length: Math.max(ARROW_PX, (ring.left - labelRight) * pxX) };
  }
  return null;
}

export function layoutCallouts(items: CalloutInput[], options: LayoutOptions = {}): Callout[] {
  const frame = options.frame && options.frame.width > 0 && options.frame.height > 0 ? options.frame : DEFAULT_FRAME;
  const avoid = options.avoid ?? [];
  const list = items.slice(0, 3);
  const numbered = list.length > 1;
  const gapX = ARROW_PX / (frame.width / 100);
  const gapY = ARROW_PX / (frame.height / 100);

  const rings = list.map((item) => growRing(item.rect));
  const boxes: Box[] = [];
  const placed = list.map((item, i) => {
    const ring = rings[i];
    const size = options.sizes?.[i] ?? estimateLabelSize(item.chars ?? 14, frame, numbered);
    const width = Math.min(size.width, LABEL_MAX_WIDTH);
    const height = size.height;
    const base = item.anchor ?? ring;
    const cx = ring.left + ring.width / 2;
    const cy = ring.top + ring.height / 2;
    const boxAt = (s: Side): Box => {
      let left: number;
      let top: number;
      if (s === 'below' || s === 'above') {
        left = cx - width / 2;
        top = s === 'below' ? base.top + base.height + gapY : base.top - gapY - height;
      } else {
        left = s === 'right' ? base.left + base.width + gapX : base.left - gapX - width;
        top = cy - height / 2;
      }
      return {
        left: keepIn(left, EDGE_MIN, EDGE_MAX - width - FIT_SLACK),
        top: keepIn(top, EDGE_MIN, EDGE_MAX - height),
        width,
        height,
      };
    };
    const preferred = item.side ?? pickSide(base, { width, height }, gapX);
    let side = preferred;
    let box = boxAt(preferred);
    // A forced side stays; otherwise a spot that hides nothing beats the
    // rule's, and a spot on its own ring beats one on another's ring.
    const free = (b: Box, ownOk: boolean) => !rings.some((r, j) => (ownOk && j === i ? false : overlaps(b, r, 0)))
      && !boxes.some((o) => overlaps(b, o, LABEL_MARGIN))
      && !avoid.some((a) => overlaps(b, a, LABEL_MARGIN));
    if (!item.side && !free(box, false)) {
      const found = [false, true].reduce<Side | null>((got, ownOk) => got
        ?? [preferred, ...SIDES.filter((x) => x !== preferred)].find((x) => free(boxAt(x), ownOk)) ?? null, null);
      if (found) { side = found; box = boxAt(found); }
    }
    boxes.push(box);
    return { ring, box, side };
  });

  // Keep off the obstacles (they sit at the bottom, so labels move up), then
  // off each other (the later label moves down, or up at the bottom edge).
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    placed.forEach((p, i) => {
      for (const a of avoid) {
        if (overlaps(p.box, a, LABEL_MARGIN)) {
          p.box.top = keepIn(a.top - LABEL_MARGIN - p.box.height, EDGE_MIN, EDGE_MAX - p.box.height);
          moved = true;
        }
      }
      for (let j = 0; j < i; j++) {
        const o = placed[j].box;
        if (!overlaps(p.box, o, LABEL_MARGIN)) continue;
        // Away from its ring: down, except a label that sits above its ring (down would cover the ring).
        const down = o.top + o.height + LABEL_MARGIN;
        const up = o.top - LABEL_MARGIN - p.box.height;
        const goUp = p.side === 'above' ? up >= EDGE_MIN : down + p.box.height > EDGE_MAX;
        p.box.top = keepIn(goUp ? up : down, EDGE_MIN, EDGE_MAX - p.box.height);
        moved = true;
      }
    });
    if (!moved) break;
  }

  return placed.map((p, i) => ({
    ring: p.ring,
    badge: numbered ? i + 1 : null,
    label: {
      left: round2(p.box.left),
      top: round2(p.box.top),
      width: round2(p.box.width),
      height: round2(p.box.height),
      maxWidth: Math.min(LABEL_MAX_WIDTH, round2(EDGE_MAX - p.box.left)),
      side: p.side,
    },
    pointer: pointerFor(p.ring, p.box, frame),
  }));
}
