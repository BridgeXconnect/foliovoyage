/**
 * Canvas bucket layout (spec 0004, AC-L1 to AC-L6).
 *
 * `layoutBucket` places every tile of one bucket inside its 2400 x 1624 slot, the
 * same way every time. It reads no DOM, font, clock or random source, never
 * throws, and never grows the slot: a tile that cannot be placed is left out and
 * its id is listed in `dropped`, in rank order.
 *
 * The only import allowed here is the constants file. Every pixel value comes
 * from `geometry.ts`; the numbers in this file are structure (0, 1, 2, -1) or the
 * published constants of FNV-1a and mulberry32, written in hex.
 */

import {
  CLEARANCE,
  DEGREES_PER_HALF_TURN,
  EXIT_TILE_CORNER,
  EXIT_TILE_HEIGHT,
  EXIT_TILE_WIDTH,
  GRID_SIZE,
  GUTTER,
  JITTER,
  LANDSCAPE_RATIO,
  MARGIN,
  PERCENT_BASE,
  RANK_ONE_OFFSET,
  SCORE_X_WEIGHT,
  SLOT_HEIGHT,
  SLOT_WIDTH,
  SQUARE_SHAPE_PERCENT,
  TIER_CAPTION_GAP,
  TIER_CAPTION_HEIGHT,
  TIER_PHOTO_WIDTH,
  TILT_DEGREES,
  TILT_STEPS_PER_DEGREE,
  TITLE_BLOCK,
  tierForRank,
  type TileTier,
} from "./geometry";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TileShape = "1:1" | "3:2";

/**
 * One placed tile. `x` and `y` are the pre rotation top left corner of the
 * outline (jitter included), relative to the slot origin. `w` and `h` cover the
 * photo, the gap and the caption. `rot` is in degrees.
 */
export interface Placement extends Rect {
  id: string;
  kind: "tour" | "exit";
  tier: TileTier;
  shape: TileShape;
  rot: number;
}

export interface LayoutInput {
  bucketKey: string;
  tiles: readonly { id: string; rank: number }[];
}

export interface LayoutResult {
  title: Rect;
  tiles: Placement[];
  exit: Placement;
  /** Ids of tiles that did not fit the slot, in rank order. Empty for every real bucket. */
  dropped: string[];
}

/** FNV-1a, 32 bit. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a seeded generator returning numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 0xf), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 0x7), 0x3d | t)) ^ t;
    return ((t ^ (t >>> 0xe)) >>> 0) / 0x100000000;
  };
}

/** A tile with its seeded look, before it has a position. */
interface Seeded {
  id: string;
  rank: number;
  tier: TileTier;
  shape: TileShape;
  jx: number;
  jy: number;
  rot: number;
  w: number;
  h: number;
}

/** A positioned item. Reserved areas (title, exit) have rank 0 or less and never move. */
interface Item extends Seeded {
  x: number;
  y: number;
}

type Point = readonly [number, number];

function seedTile(tile: { id: string; rank: number }): Seeded {
  const hash = fnv1a(tile.id);
  const square = hash % PERCENT_BASE < SQUARE_SHAPE_PERCENT;
  const rand = mulberry32(hash);
  // `+ 0` turns a rounded -0 into 0, so the output is the same in every serializer.
  const jx = Math.round((rand() * 2 - 1) * JITTER) + 0;
  const jy = Math.round((rand() * 2 - 1) * JITTER) + 0;
  const rot =
    Math.round((rand() * 2 - 1) * TILT_DEGREES * TILT_STEPS_PER_DEGREE) / TILT_STEPS_PER_DEGREE + 0;
  const tier = tierForRank(tile.rank);
  const w = TIER_PHOTO_WIDTH[tier];
  const photoHeight = square ? w : (w * LANDSCAPE_RATIO.height) / LANDSCAPE_RATIO.width;
  return {
    id: tile.id,
    rank: tile.rank,
    tier,
    shape: square ? "1:1" : "3:2",
    jx,
    jy,
    rot,
    w,
    h: photoHeight + TIER_CAPTION_GAP[tier] + TIER_CAPTION_HEIGHT[tier],
  };
}

const overlaps = (a: Rect, b: Rect, pad: number): boolean =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/**
 * The first free spot for a tile on the grid, scored `y + SCORE_X_WEIGHT * x`, or
 * null when no row has room. Row by row it finds the leftmost x clear of every
 * blocker, which is the same spot a full grid scan would pick.
 */
function findSpot(tile: Seeded, blockers: readonly Rect[]): Point | null {
  let best: { x: number; y: number; score: number } | null = null;
  for (let y = MARGIN; y + tile.h <= SLOT_HEIGHT - MARGIN; y += GRID_SIZE) {
    // A later row can only score higher than the best so far once y alone passes it.
    if (best && y + SCORE_X_WEIGHT * MARGIN >= best.score) break;
    const blocked: [number, number][] = [];
    for (const b of blockers) {
      if (y < b.y + b.h + GUTTER && b.y < y + tile.h + GUTTER) {
        blocked.push([b.x - tile.w - GUTTER, b.x + b.w + GUTTER]);
      }
    }
    blocked.sort((p, q) => p[0] - q[0]);
    let x = MARGIN;
    for (let moved = true; moved; ) {
      moved = false;
      for (const [low, high] of blocked) {
        if (x > low && x < high) {
          x = MARGIN + GRID_SIZE * Math.ceil((high - MARGIN) / GRID_SIZE);
          moved = true;
        }
      }
    }
    if (x + tile.w > SLOT_WIDTH - MARGIN) continue;
    const score = y + SCORE_X_WEIGHT * x;
    if (!best || score < best.score) best = { x, y, score };
  }
  return best ? [best.x, best.y] : null;
}

/** The four corners of an item's outline after jitter and tilt, clockwise from the top left. */
function outline(item: Item): Point[] {
  const angle = (item.rot * Math.PI) / DEGREES_PER_HALF_TURN;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const ox = item.x + item.jx;
  const oy = item.y + item.jy;
  return [
    [0, 0],
    [item.w, 0],
    [item.w, item.h],
    [0, item.h],
  ].map(([u, v]): Point => [ox + u * cos - v * sin, oy + u * sin + v * cos]);
}

/** Separating axis test on two convex quadrilaterals: true when some edge normal separates them. */
function separated(p: readonly Point[], q: readonly Point[]): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1;
      const ny = x1 - x2;
      let pMin = Infinity;
      let pMax = -Infinity;
      let qMin = Infinity;
      let qMax = -Infinity;
      for (const [x, y] of p) {
        const v = x * nx + y * ny;
        if (v < pMin) pMin = v;
        if (v > pMax) pMax = v;
      }
      for (const [x, y] of q) {
        const v = x * nx + y * ny;
        if (v < qMin) qMin = v;
        if (v > qMax) qMax = v;
      }
      if (pMax < qMin || qMax < pMin) return true;
    }
  }
  return false;
}

function pointToSegment([px, py]: Point, [x1, y1]: Point, [x2, y2]: Point): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const along = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + along * dx), py - (y1 + along * dy));
}

/** Smallest distance between two convex outlines, 0 when they touch or overlap. */
function distance(p: readonly Point[], q: readonly Point[]): number {
  if (!separated(p, q)) return 0;
  let nearest = Infinity;
  for (const [from, to] of [
    [p, q],
    [q, p],
  ]) {
    for (const point of from) {
      for (let i = 0; i < to.length; i++) {
        nearest = Math.min(nearest, pointToSegment(point, to[i], to[(i + 1) % to.length]));
      }
    }
  }
  return nearest;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function boundingBox(poly: readonly Point[]): Box {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [x, y] of poly) {
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return { left, top, right, bottom };
}

/** False when the boxes are further apart than the clearance, so the outlines cannot violate it. */
const near = (a: Box, b: Box): boolean =>
  a.left - CLEARANCE <= b.right &&
  b.left - CLEARANCE <= a.right &&
  a.top - CLEARANCE <= b.bottom &&
  b.top - CLEARANCE <= a.bottom;

const isTilted = (item: Item): boolean => item.rot !== 0 || item.jx !== 0 || item.jy !== 0;

/**
 * Straighten and un-jitter tiles until no two outlines are closer than the
 * clearance. Of a violating pair the later rank goes first. A straightened tile
 * sits on the grid at least a gutter from every other tile, so the loop ends.
 * Outlines are cached and rebuilt only for the tiles that were straightened.
 */
function straighten(items: Item[]): void {
  const polys = items.map(outline);
  const boxes = polys.map(boundingBox);
  for (;;) {
    const found: [number, number][] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (near(boxes[i], boxes[j]) && distance(polys[i], polys[j]) < CLEARANCE) found.push([i, j]);
      }
    }
    let changed = false;
    for (const [i, j] of found) {
      const target = [i, j]
        .filter((k) => items[k].rank > 0 && isTilted(items[k]))
        .sort((p, q) => items[q].rank - items[p].rank)[0];
      if (target !== undefined) {
        const item = items[target];
        item.rot = 0;
        item.jx = 0;
        item.jy = 0;
        polys[target] = outline(item);
        boxes[target] = boundingBox(polys[target]);
        changed = true;
      }
    }
    if (!changed) return;
  }
}

function toPlacement(item: Item): Placement {
  return {
    id: item.id,
    kind: "tour",
    tier: item.tier,
    shape: item.shape,
    x: item.x + item.jx,
    y: item.y + item.jy,
    w: item.w,
    h: item.h,
    rot: item.rot,
  };
}

/**
 * Lay out one bucket. Tiles are placed in rank order, rank 1 beside the title
 * block and the rest at the first free grid spot. Same input, same output.
 */
export function layoutBucket(input: LayoutInput): LayoutResult {
  const title: Rect = {
    x: TITLE_BLOCK.x,
    y: TITLE_BLOCK.y,
    w: TITLE_BLOCK.width,
    h: TITLE_BLOCK.height,
  };
  const exit: Placement = {
    id: "exit",
    kind: "exit",
    tier: "md",
    shape: "3:2",
    x: EXIT_TILE_CORNER.x,
    y: EXIT_TILE_CORNER.y,
    w: EXIT_TILE_WIDTH,
    h: EXIT_TILE_HEIGHT,
    rot: 0,
  };

  const ordered = [...input.tiles].sort(
    (a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const blockers: Rect[] = [title, exit];
  const placed: Item[] = [];
  const dropped: string[] = [];

  for (const tile of ordered.map(seedTile)) {
    let spot: Point | null = null;
    if (tile.rank === 1) {
      const pinned: Rect = {
        x: title.x + title.w + RANK_ONE_OFFSET,
        y: title.y,
        w: tile.w,
        h: tile.h,
      };
      const fits =
        pinned.x + pinned.w <= SLOT_WIDTH - MARGIN &&
        pinned.y + pinned.h <= SLOT_HEIGHT - MARGIN &&
        !blockers.some((b) => overlaps(pinned, b, GUTTER));
      if (fits) spot = [pinned.x, pinned.y];
    }
    spot ??= findSpot(tile, blockers);
    if (!spot) {
      dropped.push(tile.id);
      continue;
    }
    placed.push({ ...tile, x: spot[0], y: spot[1] });
    blockers.push({ x: spot[0], y: spot[1], w: tile.w, h: tile.h });
  }

  const reserved: Item[] = [title, exit].map((r, index) => ({
    id: index === 0 ? "title" : "exit",
    rank: -index,
    tier: "md",
    shape: "3:2",
    jx: 0,
    jy: 0,
    rot: 0,
    ...r,
  }));
  straighten([...placed, ...reserved]);

  return { title, tiles: placed.map(toPlacement), exit, dropped };
}
