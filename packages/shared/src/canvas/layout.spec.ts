import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CLEARANCE,
  EXIT_TILE_CORNER,
  EXIT_TILE_HEIGHT,
  EXIT_TILE_WIDTH,
  JITTER,
  MAX_TILES_PER_BUCKET,
  PERCENT_BASE,
  RANK_ONE_OFFSET,
  SLOT_HEIGHT,
  SLOT_WIDTH,
  SQUARE_SHAPE_PERCENT,
  TILT_DEGREES,
  TITLE_BLOCK,
  tierForRank,
} from "./geometry";
import { fnv1a, layoutBucket, mulberry32, type LayoutResult } from "./layout";

// Geometry helpers, written separately from layout.ts so the checks do not share its bugs ----

type Pt = [number, number];

/** Corners of a placement's outline: rotated about its top left corner, clockwise. */
function corners(p: { x: number; y: number; w: number; h: number; rot: number }): Pt[] {
  const a = (p.rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ([[0, 0], [p.w, 0], [p.w, p.h], [0, p.h]] as Pt[]).map(([u, v]) => [
    p.x + u * c - v * s,
    p.y + u * s + v * c,
  ]);
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

function pointSegment(p: Pt, a: Pt, b: Pt): number {
  const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len2));
  return Math.hypot(p[0] - (a[0] + k * (b[0] - a[0])), p[1] - (a[1] + k * (b[1] - a[1])));
}

function inside(p: Pt, poly: Pt[]): boolean {
  return poly.every((q, i) => cross(q, poly[(i + 1) % poly.length], p) >= 0);
}

/** Smallest gap between two convex quadrilaterals, 0 when they cross or one holds the other. */
function gap(p: Pt[], q: Pt[]): number {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (segmentsCross(p[i], p[(i + 1) % 4], q[j], q[(j + 1) % 4])) return 0;
    }
  }
  if (inside(p[0], q) || inside(q[0], p)) return 0;
  let best = Infinity;
  for (const [from, to] of [[p, q], [q, p]]) {
    for (const pt of from) {
      for (let i = 0; i < 4; i++) best = Math.min(best, pointSegment(pt, to[i], to[(i + 1) % 4]));
    }
  }
  return best;
}

const TITLE_RECT = { x: TITLE_BLOCK.x, y: TITLE_BLOCK.y, w: TITLE_BLOCK.width, h: TITLE_BLOCK.height, rot: 0 };
const EXIT_RECT = {
  x: EXIT_TILE_CORNER.x,
  y: EXIT_TILE_CORNER.y,
  w: EXIT_TILE_WIDTH,
  h: EXIT_TILE_HEIGHT,
  rot: 0,
};

/** Float noise allowance on the 6 px clearance: the layout and this check compute it differently. */
const EPSILON = 1e-6;

/** The smallest gap between any two tilted outlines, the title block and the exit tile included (Infinity when none are within the clearance's reach). */
function minClearance(result: LayoutResult): number {
  const shapes = [...result.tiles, TITLE_RECT, EXIT_RECT].map(corners);
  const boxes = shapes.map((poly) => ({
    x0: Math.min(...poly.map((p) => p[0])),
    x1: Math.max(...poly.map((p) => p[0])),
    y0: Math.min(...poly.map((p) => p[1])),
    y1: Math.max(...poly.map((p) => p[1])),
  }));
  let best = Infinity;
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      // Boxes further apart than the clearance cannot hold outlines that close.
      if (a.x0 > b.x1 + CLEARANCE || b.x0 > a.x1 + CLEARANCE) continue;
      if (a.y0 > b.y1 + CLEARANCE || b.y0 > a.y1 + CLEARANCE) continue;
      best = Math.min(best, gap(shapes[i], shapes[j]));
    }
  }
  return best;
}

/** Every corner of every outline must lie inside the slot. */
function allInsideSlot(result: LayoutResult): boolean {
  return [...result.tiles, result.exit].every((p) =>
    corners(p).every(([x, y]) => x >= 0 && y >= 0 && x <= SLOT_WIDTH && y <= SLOT_HEIGHT),
  );
}

/** Gap from every tile to a reserved rectangle: the title block or the exit tile. */
function minGapTo(result: LayoutResult, rect: { x: number; y: number; w: number; h: number; rot: number }): number {
  const r = corners(rect);
  return Math.min(...result.tiles.map((t) => gap(corners(t), r)));
}

// Bucket builders ------------------------------------------------------------

const isSquareId = (id: string) => fnv1a(id) % PERCENT_BASE < SQUARE_SHAPE_PERCENT;

/** An id of the wanted shape, found by trying suffixes: the shape is a pure function of the id. */
function idWithShape(prefix: string, square: boolean): string {
  for (let attempt = 0; ; attempt++) {
    const id = `${prefix}-${attempt}`;
    if (isSquareId(id) === square) return id;
  }
}

/** A bucket of `count` tiles of which exactly `squares` are 1:1, spread over the ranks by `seed`. */
function makeBucket(seed: number, count: number, squares: number) {
  const rand = mulberry32(seed);
  const flags = Array.from({ length: count }, (_, i) => i < squares);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [flags[i], flags[j]] = [flags[j], flags[i]];
  }
  return {
    bucketKey: `bucket-${seed}`,
    tiles: flags.map((square, i) => ({ id: idWithShape(`t${seed}-${i}`, square), rank: i + 1 })),
  };
}

/** The checks every layout must pass, fitting or not. */
function expectSound(result: LayoutResult, count: number) {
  expect(result.tiles.length + result.dropped.length).toBe(count);
  expect(minClearance(result)).toBeGreaterThanOrEqual(CLEARANCE - EPSILON);
  expect(allInsideSlot(result)).toBe(true);
  expect(minGapTo(result, TITLE_RECT)).toBeGreaterThanOrEqual(CLEARANCE - EPSILON);
  expect(minGapTo(result, EXIT_RECT)).toBeGreaterThanOrEqual(CLEARANCE - EPSILON);
}

// Tests ----------------------------------------------------------------------

describe("hash and generator", () => {
  it("matches the FNV-1a 32 bit test vectors", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("foobar")).toBe(0xbf9cf968);
  });

  it("gives the same sequence for the same seed, in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const run = Array.from({ length: 20 }, () => a());
    expect(run).toEqual(Array.from({ length: 20 }, () => b()));
    expect(run.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(new Set(run).size).toBe(20);
  });
});

describe("layoutBucket", () => {
  const tiles = Array.from({ length: 12 }, (_, i) => ({ id: `tile-${i}`, rank: i + 1 }));

  it("returns the title block, the exit tile and one placement per tile", () => {
    const result = layoutBucket({ bucketKey: "bangkok/food-drink", tiles });
    expect(result.title).toEqual({ x: 48, y: 48, w: 201, h: 59 });
    expect(result.exit).toEqual({
      id: "exit",
      kind: "exit",
      tier: "md",
      shape: "3:2",
      x: 2112,
      y: 1416,
      w: 240,
      h: 160,
      rot: 0,
    });
    expect(result.tiles.map((t) => t.id)).toEqual(tiles.map((t) => t.id));
    expect(result.dropped).toEqual([]);
    expect(result.tiles.every((t) => t.kind === "tour")).toBe(true);
  });

  it("returns an empty layout for an empty bucket", () => {
    const result = layoutBucket({ bucketKey: "empty", tiles: [] });
    expect(result.tiles).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it("seeds shape, jitter and tilt from the tile id (AC-L2)", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `seed-${i}`, rank: i + 1 }));
    const result = layoutBucket({ bucketKey: "seeds", tiles: many });
    for (const [i, t] of result.tiles.entries()) {
      expect(t.shape).toBe(isSquareId(many[i].id) ? "1:1" : "3:2");
      expect(Math.abs(t.rot)).toBeLessThanOrEqual(TILT_DEGREES);
      expect(t.tier).toBe(tierForRank(i + 1));
    }
    // Jitter is a draw of the same generator, so the same id gives the same look in any bucket.
    const alone = layoutBucket({ bucketKey: "other", tiles: [{ id: "seed-7", rank: 8 }] });
    expect(alone.tiles[0].shape).toBe(result.tiles[7].shape);
    expect(alone.tiles[0].w).toBe(result.tiles[7].w);
    expect(alone.tiles[0].h).toBe(result.tiles[7].h);
  });

  it("sizes a tile from its tier and shape, caption included", () => {
    const sq = idWithShape("size", true);
    const ls = idWithShape("size", false);
    const result = layoutBucket({
      bucketKey: "sizes",
      tiles: [
        { id: sq, rank: 1 }, // lg 1:1: 360 + 12 + 68
        { id: ls, rank: 5 }, // md 3:2: 160 + 10 + 57
        { id: `${sq}x`, rank: 21 }, // sm: 168 wide
      ],
    });
    expect([result.tiles[0].w, result.tiles[0].h]).toEqual([360, 440]);
    expect([result.tiles[1].w, result.tiles[1].h]).toEqual([240, 227]);
    expect(result.tiles[2].w).toBe(168);
  });

  it("puts rank 1 beside the title block, 24 px away, within its jitter (AC-L6)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const bucket = makeBucket(seed, 30, 9);
      const first = layoutBucket(bucket).tiles[0];
      expect(Math.abs(first.x - (TITLE_BLOCK.x + TITLE_BLOCK.width + RANK_ONE_OFFSET))).toBeLessThanOrEqual(
        JITTER,
      );
      expect(Math.abs(first.y - TITLE_BLOCK.y)).toBeLessThanOrEqual(JITTER);
    }
  });

  it("does not depend on the order the tiles arrive in", () => {
    const bucket = makeBucket(7, 40, 12);
    const shuffled = { ...bucket, tiles: [...bucket.tiles].reverse() };
    expect(layoutBucket(shuffled)).toEqual(layoutBucket(bucket));
  });

  it("does not change its input", () => {
    const bucket = makeBucket(3, 25, 7);
    const copy = JSON.parse(JSON.stringify(bucket));
    layoutBucket(bucket);
    expect(bucket).toEqual(copy);
  });

  it("serializes identically on every run (AC-L1)", () => {
    const bucket = makeBucket(11, 50, 10);
    expect(JSON.stringify(layoutBucket(bucket))).toBe(JSON.stringify(layoutBucket(bucket)));
  });
});

// AC-L5. The cells and seed lists are fixed, so a failure names a bucket that can be rebuilt.
describe("layoutBucket property test (AC-L5)", () => {
  const COUNTS = [1, 2, 5, 10, 20, 30, 40, MAX_TILES_PER_BUCKET];
  const SHARES = [0, 10, 20, 30, 40]; // percent of 1:1 tiles

  it("fits and spaces 200 mixed buckets, 1 to 50 tiles, 1:1 shares 0 to 40%", () => {
    const rand = mulberry32(0xa71a5);
    let buckets = 0;
    for (let seed = 1; buckets < 200; seed++) {
      const count = 1 + Math.floor(rand() * MAX_TILES_PER_BUCKET);
      const share = Math.floor(rand() * 41);
      const bucket = makeBucket(seed, count, Math.round((count * share) / 100));
      const result = layoutBucket(bucket);
      expect({ seed, count, share, dropped: result.dropped }).toEqual({ seed, count, share, dropped: [] });
      expectSound(result, count);
      expect(layoutBucket(bucket)).toEqual(result);
      buckets++;
    }
    expect(buckets).toBe(200);
  });

  // The worst case for fit is the fullest bucket, so each share gets 500 seeds at 50 tiles,
  // and the smaller counts get fewer, as they have far more room.
  it.each(SHARES)("drops nothing at 50 tiles with %i%% 1:1, over 500 seeds", (share) => {
    const squares = Math.round((MAX_TILES_PER_BUCKET * share) / 100);
    for (let seed = 0; seed < 500; seed++) {
      const result = layoutBucket(makeBucket(seed, MAX_TILES_PER_BUCKET, squares));
      if (result.dropped.length) throw new Error(`seed ${seed} at ${share}% dropped ${result.dropped}`);
      expectSound(result, MAX_TILES_PER_BUCKET);
    }
  });

  // Smaller buckets have far more room, so a short list of seeds per cell is enough.
  it.each(COUNTS.filter((c) => c < MAX_TILES_PER_BUCKET))(
    "drops nothing at %i tiles for every share up to 40%%, over 20 seeds each",
    (count) => {
      for (const share of SHARES) {
        for (let seed = 0; seed < 20; seed++) {
          const result = layoutBucket(makeBucket(seed, count, Math.round((count * share) / 100)));
          if (result.dropped.length) throw new Error(`${count} tiles, ${share}%, seed ${seed} dropped`);
          expectSound(result, count);
        }
      }
    },
  );

  it("is the same on two runs for every cell", () => {
    for (const count of COUNTS) {
      for (const share of SHARES) {
        const bucket = makeBucket(count * 100 + share, count, Math.round((count * share) / 100));
        expect(layoutBucket(bucket)).toEqual(layoutBucket(bucket));
      }
    }
  });
});

// Known limit. Pinning rank 1 beside the title block takes room the scan would otherwise
// use, so a bucket of 50 tiles with 50% of them 1:1 sometimes loses its last tile: measured
// 7 of 500 seeds (1.4%) in the design study, 2 of 500 with this file's seeds, always rank 49
// or 50. Real buckets top out at 42% 1:1, so none reaches it (see the real data test). `dropped` exists for this case, so the stress run
// does not demand zero drops. It demands the backstop behaves.
describe("layoutBucket at 50% 1:1 (known limit)", () => {
  it("drops at most one tile per run, always one of the last two ranks, and stays sound", () => {
    let withDrops = 0;
    for (let seed = 0; seed < 500; seed++) {
      const bucket = makeBucket(seed, MAX_TILES_PER_BUCKET, MAX_TILES_PER_BUCKET / 2);
      const result = layoutBucket(bucket);
      expect(result.dropped.length).toBeLessThanOrEqual(1);
      const lastTwo = bucket.tiles.slice(-2).map((t) => t.id);
      for (const id of result.dropped) expect(lastTwo).toContain(id);
      expectSound(result, MAX_TILES_PER_BUCKET);
      if (seed % 25 === 0) expect(layoutBucket(bucket)).toEqual(result);
      withDrops += result.dropped.length;
    }
    // A loose ceiling (5%) so a change in the rule set that makes this much worse shows here.
    expect(withDrops).toBeLessThanOrEqual(25);
  });
});

describe("layoutBucket over-full (the dropped backstop)", () => {
  const bucket = {
    bucketKey: "over-full",
    tiles: Array.from({ length: MAX_TILES_PER_BUCKET }, (_, i) => ({
      id: idWithShape(`full-${i}`, true),
      rank: i + 1,
    })),
  };

  it("returns without throwing, and drops only tail ranks, in rank order", () => {
    const result = layoutBucket(bucket);
    expect(result.dropped.length).toBeGreaterThan(0);
    const rankOf = new Map(bucket.tiles.map((t) => [t.id, t.rank]));
    const droppedRanks = result.dropped.map((id) => rankOf.get(id) as number);
    const first = droppedRanks[0];
    // A contiguous tail: ranks first..50 are all dropped, in order, and everything above is placed.
    expect(droppedRanks).toEqual(
      Array.from({ length: MAX_TILES_PER_BUCKET - first + 1 }, (_, i) => first + i),
    );
    expect(result.tiles.map((t) => rankOf.get(t.id))).toEqual(
      Array.from({ length: first - 1 }, (_, i) => i + 1),
    );
    expectSound(result, MAX_TILES_PER_BUCKET);
  });

  it("is the same on two runs", () => {
    expect(layoutBucket(bucket)).toEqual(layoutBucket(bucket));
  });

  it("leaves no overlap between tiles, the title block and the exit tile", () => {
    const result = layoutBucket(bucket);
    const shapes = [...result.tiles, TITLE_RECT, EXIT_RECT].map(corners);
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) expect(gap(shapes[i], shapes[j])).toBeGreaterThan(0);
    }
  });

  it("does not grow the slot, however many tiles arrive", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: idWithShape(`many-${i}`, i % 2 === 0), rank: i + 1 }));
    const result = layoutBucket({ bucketKey: "many", tiles: many });
    expect(result.dropped.length).toBeGreaterThan(0);
    expectSound(result, many.length);
  });
});

// The 42 live buckets, ids in rank order, capped at 50 (production snapshot of the feed,
// taken for the cap decision). Real shares of 1:1 tiles run from 12% to 42%.
describe("layoutBucket on real data", () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "real-buckets.json"), "utf8")) as Record<
    string,
    string[]
  >;

  it("holds the 42 buckets", () => {
    expect(Object.keys(fixture)).toHaveLength(42);
    for (const ids of Object.values(fixture)) expect(ids.length).toBeLessThanOrEqual(MAX_TILES_PER_BUCKET);
  });

  it("places every tile of every bucket with 6 px clearance", () => {
    for (const [bucketKey, ids] of Object.entries(fixture)) {
      const result = layoutBucket({ bucketKey, tiles: ids.map((id, i) => ({ id, rank: i + 1 })) });
      expect({ bucketKey, dropped: result.dropped }).toEqual({ bucketKey, dropped: [] });
      expectSound(result, ids.length);
    }
  });
});
