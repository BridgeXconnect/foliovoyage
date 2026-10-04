/**
 * Clearance with the rendered tile geometry (spec 0004, AC-L4 and the tile
 * design's "no transform on text" rule). `layoutBucket` checks its 6 px
 * clearance with each tile, caption included, as one rotated rectangle. The page
 * rotates the photo only and keeps the caption upright (`CanvasItem.tsx`), so
 * this test measures what is actually drawn: each photo as a rotated rectangle,
 * each caption as an axis aligned one, plus the title block and the exit tile,
 * over the 42 real buckets in the shared fixture. No two shapes of different
 * items may come closer than `CLEARANCE`.
 */

import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLEARANCE,
  DEGREES_PER_HALF_TURN,
  LANDSCAPE_RATIO,
  TIER_CAPTION_GAP,
  TIER_CAPTION_HEIGHT,
  layoutBucket,
  type Placement,
  type Rect,
} from "@folio/shared";

type Point = readonly [number, number];
interface Shape {
  owner: string;
  poly: Point[];
  /** Bounding box as [left, top, right, bottom], to skip pairs that are obviously far apart. */
  box: [number, number, number, number];
}

const corners = (x: number, y: number, w: number, h: number): Point[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** A rectangle rotated `deg` degrees about its top left corner, as `CanvasItem` draws the photo. */
function rotated(x: number, y: number, w: number, h: number, deg: number): Point[] {
  const angle = (deg * Math.PI) / DEGREES_PER_HALF_TURN;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return corners(0, 0, w, h).map(([u, v]): Point => [x + u * cos - v * sin, y + u * sin + v * cos]);
}

/** Separating axis test on two convex polygons. */
function separated(p: readonly Point[], q: readonly Point[]): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1;
      const ny = x1 - x2;
      const along = (pts: readonly Point[]) => pts.map(([x, y]) => x * nx + y * ny);
      const a = along(p);
      const b = along(q);
      if (Math.max(...a) < Math.min(...b) || Math.max(...b) < Math.min(...a)) return true;
    }
  }
  return false;
}

function pointToSegment([px, py]: Point, [x1, y1]: Point, [x2, y2]: Point): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Smallest distance between two convex polygons, 0 when they touch or overlap. */
function distance(p: readonly Point[], q: readonly Point[]): number {
  if (!separated(p, q)) return 0;
  let nearest = Infinity;
  for (const [from, to] of [
    [p, q],
    [q, p],
  ]) {
    for (const point of from) {
      for (let i = 0; i < to.length; i++) nearest = Math.min(nearest, pointToSegment(point, to[i], to[(i + 1) % to.length]));
    }
  }
  return nearest;
}

const photoHeight = (p: Placement) => (p.shape === "1:1" ? p.w : (p.w * LANDSCAPE_RATIO.height) / LANDSCAPE_RATIO.width);

function shape(owner: string, poly: Point[]): Shape {
  const xs = poly.map(([x]) => x);
  const ys = poly.map(([, y]) => y);
  return { owner, poly, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/** False when the boxes are further apart than the clearance, so the shapes cannot violate it. */
const near = ({ box: a }: Shape, { box: b }: Shape): boolean =>
  a[0] - CLEARANCE <= b[2] && b[0] - CLEARANCE <= a[2] && a[1] - CLEARANCE <= b[3] && b[1] - CLEARANCE <= a[3];

/** What the page draws for one bucket, in slot coordinates. */
function renderedShapes(title: Rect, exit: Placement, tiles: readonly Placement[]): Shape[] {
  const shapes: Shape[] = [
    shape("title", corners(title.x, title.y, title.w, title.h)),
    shape("exit", corners(exit.x, exit.y, exit.w, exit.h)),
  ];
  for (const t of tiles) {
    const ph = photoHeight(t);
    shapes.push(shape(t.id, rotated(t.x, t.y, t.w, ph, t.rot)));
    shapes.push(shape(t.id, corners(t.x, t.y + ph + TIER_CAPTION_GAP[t.tier], t.w, TIER_CAPTION_HEIGHT[t.tier])));
  }
  return shapes;
}

describe("clearance with the rendered geometry", () => {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, "../../../../packages/shared/src/canvas/fixtures/real-buckets.json"), "utf8"),
  ) as Record<string, string[]>;

  it("keeps every pair of drawn shapes at least 6 px apart in all 42 real buckets", () => {
    expect(Object.keys(fixture)).toHaveLength(42);
    const tooClose: string[] = [];
    let minimum = Infinity; // over the pairs within reach of the clearance
    for (const [bucketKey, ids] of Object.entries(fixture)) {
      const { title, exit, tiles } = layoutBucket({ bucketKey, tiles: ids.map((id, i) => ({ id, rank: i + 1 })) });
      const shapes = renderedShapes(title, exit, tiles);
      for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) {
          if (shapes[i].owner === shapes[j].owner || !near(shapes[i], shapes[j])) continue;
          const d = distance(shapes[i].poly, shapes[j].poly);
          minimum = Math.min(minimum, d);
          if (d < CLEARANCE) tooClose.push(`${bucketKey}: ${shapes[i].owner} / ${shapes[j].owner} ${d.toFixed(2)} px`);
        }
      }
    }
    expect(tooClose).toEqual([]);
    // 8.09 px when this test was written; a drop below the clearance fails above.
    expect(minimum).toBeGreaterThanOrEqual(CLEARANCE);
  });

  it("rotates only the photo: the one rotate() in the tile is on the photo wrapper", () => {
    const source = readFileSync(join(__dirname, "CanvasItem.tsx"), "utf8");
    const rotations = source.match(/rotate\(/g) ?? [];
    expect(rotations).toHaveLength(1);
    const photo = source.slice(source.indexOf("function Photo("), source.indexOf("export type ActivateHandler"));
    expect(photo).toContain("rotate(");
  });
});
