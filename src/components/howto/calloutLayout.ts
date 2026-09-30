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
//  - screenshots: every combination of spots is weighed, and the cheapest
//    wins. A pointer through another label almost never happens (neighbours
//    on a bar stand side by side instead), and labels and pointers stay off
//    other rings where they can;
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
  const labelSizes = list.map((item, i) => {
    const size = options.sizes?.[i] ?? estimateLabelSize(item.chars ?? 14, frame, numbered);
    return { width: Math.min(size.width, LABEL_MAX_WIDTH), height: size.height };
  });
  // Screenshots: search for spots where no label, ring or pointer gets in
  // another's way. The drawn remote forces its sides, and keeps the simple rules.
  const searched = list.some((it) => it.side || it.anchor)
    ? null
    : searchLayout(rings, labelSizes, avoid, frame, gapX, gapY);
  if (searched) return searched.map((p, i) => finish(p, i, numbered, frame));

  const boxes: Box[] = [];
  const placed = list.map((item, i) => {
    const ring = rings[i];
    const { width, height } = labelSizes[i];
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

  return placed.map((p, i) => finish(p, i, numbered, frame));
}

interface Placed { ring: Box; box: Box; side: Side }

function finish(p: Placed, i: number, numbered: boolean, frame: FrameSize): Callout {
  return {
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
  };
}

/** The area a label's pointer covers (stem and arrow head), in percent; null
 *  when the label sits on its ring and has none. */
export function pointerArea(label: Box, pointer: Callout['pointer'], frame: FrameSize): Box | null {
  if (!pointer) return null;
  const pxX = frame.width / 100;
  const pxY = frame.height / 100;
  const len = pointer.length;
  if (pointer.edge === 'top' || pointer.edge === 'bottom') {
    const x = label.left + (pointer.offset / 100) * label.width;
    const h = len / pxY;
    const top = pointer.edge === 'top' ? label.top - h : label.top + label.height;
    return { left: x - ARROW_PX / pxX, top, width: (2 * ARROW_PX) / pxX, height: h };
  }
  const y = label.top + (pointer.offset / 100) * label.height;
  const w = len / pxX;
  const left = pointer.edge === 'left' ? label.left - w : label.left + label.width;
  return { left, top: y - ARROW_PX / pxY, width: w, height: (2 * ARROW_PX) / pxY };
}

// Where along the label its ring may sit (0.5: centred), tried in this order.
// Moving a label along lets two neighbours stand side by side (one above-left,
// one above-right) instead of stacking, where one pointer would cross the other label.
const ALONG_H = [0.5, 0.75, 0.25, 0.88, 0.12];
const ALONG_V = [0.5, 0.2, 0.8];

// What a spot costs. Labels never overlap each other or leave the frame, and
// a pointer always ends on its ring; everything else is weighed, so the least
// bad layout wins when no perfect one exists.
const COST = {
  /** A pointer through another label: only when nothing else fits. */
  pointerOnLabel: 1000,
  /** A label over another highlight (one that doesn't hold this one). */
  onOtherRing: 50,
  /** A pointer across another highlight's ring. */
  pointerOnRing: 40,
  /** A label over its own highlight. */
  onOwnRing: 30,
  /** A label over the highlight that holds this one (a button in a bar). */
  onParentRing: 20,
  /** One label height further out than the nearest spot. */
  further: 2,
  /** Per step down the list of spots (the rule's side first). */
  order: 0.5,
} as const;

type Spot = Placed & { pointer: Box | null; cost: number };

/**
 * The cheapest layout of every label: sides in the rule's order, each moved
 * along its ring or one label height further out. A pointer that runs through
 * another label or across another ring counts against a spot, as does a label
 * over a ring. Every combination is weighed (at most 3 labels, ~26 spots each).
 */
function searchLayout(
  rings: Box[], sizes: LabelSize[], avoid: Box[], frame: FrameSize, gapX: number, gapY: number,
): Placed[] | null {
  const spots: Spot[][] = rings.map((ring, i) => {
    const { width, height } = sizes[i];
    const cx = ring.left + ring.width / 2;
    const cy = ring.top + ring.height / 2;
    const clampBox = (left: number, top: number): Box => ({
      left: keepIn(left, EDGE_MIN, EDGE_MAX - width - FIT_SLACK),
      top: keepIn(top, EDGE_MIN, EDGE_MAX - height),
      width,
      height,
    });
    const preferred = pickSide(ring, { width, height }, gapX);
    const raw: Array<{ side: Side; box: Box; extra: number }> = [];
    for (const side of [preferred, ...SIDES.filter((x) => x !== preferred)]) {
      if (side === 'below' || side === 'above') {
        for (const further of [0, 1]) {
          const lift = further * (height + LABEL_MARGIN);
          const top = side === 'below' ? ring.top + ring.height + gapY + lift : ring.top - gapY - height - lift;
          for (const f of ALONG_H) raw.push({ side, box: clampBox(cx - f * width, top), extra: further * COST.further });
        }
      } else {
        const left = side === 'right' ? ring.left + ring.width + gapX : ring.left - gapX - width;
        for (const f of ALONG_V) raw.push({ side, box: clampBox(left, cy - f * height), extra: 0 });
      }
    }
    const out: Spot[] = [];
    raw.forEach(({ side, box, extra }, n) => {
      if (avoid.some((a) => overlaps(box, a, LABEL_MARGIN))) return;
      const pointer = pointerArea(box, pointerFor(ring, box, frame), frame);
      if (pointer && !meetsRing(ring, side, pointer)) return;
      let cost = n * COST.order + extra;
      rings.forEach((r, j) => {
        const nested = j !== i && holds(r, ring);
        if (overlaps(box, r, 0)) cost += j === i ? COST.onOwnRing : nested ? COST.onParentRing : COST.onOtherRing;
        if (pointer && j !== i && !nested && overlaps(pointer, r, 0)) cost += COST.pointerOnRing;
      });
      out.push({ ring, side, box, pointer, cost });
    });
    return out.sort((x, y) => x.cost - y.cost);
  });
  if (spots.some((list) => list.length === 0)) return null;

  let best: Spot[] | null = null;
  let bestCost = Infinity;
  const chosen: Spot[] = [];
  const place = (i: number, sum: number) => {
    if (sum >= bestCost) return;
    if (i === rings.length) { best = chosen.slice(); bestCost = sum; return; }
    for (const c of spots[i]) {
      if (sum + c.cost >= bestCost) break; // sorted: the rest cost more
      let extra = 0;
      let ok = true;
      for (const o of chosen) {
        if (overlaps(c.box, o.box, LABEL_MARGIN)) { ok = false; break; }
        if (c.pointer && overlaps(c.pointer, o.box, 0)) extra += COST.pointerOnLabel;
        if (o.pointer && overlaps(o.pointer, c.box, 0)) extra += COST.pointerOnLabel;
      }
      if (!ok) continue;
      chosen.push(c);
      place(i + 1, sum + c.cost + extra);
      chosen.pop();
    }
  };
  place(0, 0);
  const found: Spot[] | null = best;
  return found ? found.map(({ ring, box, side }) => ({ ring, box: { ...box }, side })) : null;
}

/** `outer` holds `inner` (a bar and one of its buttons): it is the bigger one
 *  and has the other's centre inside. Rings that only touch (two rows one
 *  above the other) don't. */
function holds(outer: Box, inner: Box): boolean {
  const cx = inner.left + inner.width / 2;
  const cy = inner.top + inner.height / 2;
  return outer.width * outer.height > inner.width * inner.height
    && cx > outer.left && cx < outer.left + outer.width && cy > outer.top && cy < outer.top + outer.height;
}

/** The pointer ends on its ring, not beside it (a label moved far along). */
function meetsRing(ring: Box, side: Side, pointer: Box): boolean {
  if (side === 'below' || side === 'above') {
    const x = pointer.left + pointer.width / 2;
    return x >= ring.left && x <= ring.left + ring.width;
  }
  const y = pointer.top + pointer.height / 2;
  return y >= ring.top && y <= ring.top + ring.height;
}
