import { describe, expect, it } from "@jest/globals";
import {
  CANVAS_CATEGORIES,
  CANVAS_CITIES,
  EXIT_TILE_CORNER,
  GRID_SIZE,
  MARGIN,
  RANK_ONE_OFFSET,
  SLOT_HEIGHT,
  SLOT_WIDTH,
  TITLE_BLOCK,
  layoutBucket,
  type CanvasBucketResponse,
  type CanvasBucketSummary,
} from "@folio/shared";
import type { BucketState } from "./bucket-store";
import { PLACEHOLDER_RECT, REGION_SIZE, buildScene, citySlots, slotAt, slotsInRect } from "./scene";

const bangkok = CANVAS_CITIES[0];
const kyoto = CANVAS_CITIES[1];

const image = { url: "https://img.test/cover.jpg", width: 640, height: 427 };
const summaries: CanvasBucketSummary[] = CANVAS_CATEGORIES.map((c) => ({
  citySlug: "bangkok",
  countrySlug: "thailand",
  cityName: "Bangkok",
  categorySlug: c.slug,
  categoryLabel: c.label,
  total: 100,
  image,
}));

function bucket(categorySlug: string, count: number): CanvasBucketResponse {
  const summary = summaries.find((s) => s.categorySlug === categorySlug)!;
  return {
    ...summary,
    total: count,
    tiles: Array.from({ length: count }, (_, i) => ({
      id: `exp_${categorySlug}_${i + 1}`,
      tourId: `tour_${i + 1}`,
      rank: i + 1,
      title: `Tile ${i + 1}`,
      image,
      durationMin: 60,
      price: { amountMinor: 1000, currency: "USD" },
      ratingAvg: 4.5,
      ratingCount: 10,
    })),
  };
}

const idle = (): BucketState => ({ status: "idle" });

describe("citySlots", () => {
  it("lists seven slots in category order, four to a row, relative to the region", () => {
    const slots = citySlots(bangkok);
    expect(slots.map((s) => s.categorySlug)).toEqual(CANVAS_CATEGORIES.map((c) => c.slug));
    expect(slots[0].origin).toEqual({ x: 0, y: 0 });
    expect(slots[3].origin).toEqual({ x: 3 * SLOT_WIDTH, y: 0 });
    expect(slots[4].origin).toEqual({ x: 0, y: SLOT_HEIGHT });
  });

  it("gives every city the same region relative slots", () => {
    expect(citySlots(kyoto).map((s) => s.origin)).toEqual(citySlots(bangkok).map((s) => s.origin));
  });

  it("finds the slot under a point, and nothing over the spare cell", () => {
    const slots = citySlots(bangkok);
    expect(slotAt(slots, { x: 10, y: 10 })?.categorySlug).toBe("outdoor-activities");
    expect(slotAt(slots, { x: SLOT_WIDTH * 2 + 5, y: SLOT_HEIGHT + 5 })?.categorySlug).toBe("seasonal-events");
    expect(slotAt(slots, { x: SLOT_WIDTH * 3 + 5, y: SLOT_HEIGHT + 5 })).toBeNull();
    expect(slotAt(slots, { x: REGION_SIZE.width + 1, y: 0 })).toBeNull();
  });

  it("finds the slots a rect overlaps", () => {
    const slots = citySlots(bangkok);
    const hit = slotsInRect(slots, { x: SLOT_WIDTH - 10, y: SLOT_HEIGHT - 10, w: 20, h: 20 });
    expect(hit.map((s) => s.categoryIndex)).toEqual([0, 1, 4, 5]);
  });
});

describe("buildScene", () => {
  it("shows a title, a placeholder and the exit for each slot before its tiles load", () => {
    const scene = buildScene(bangkok, summaries, idle);
    expect(scene.items.map((i) => i.kind).slice(0, 3)).toEqual(["title", "placeholder", "exit"]);
    expect(scene.items).toHaveLength(7 * 3);
    const second = citySlots(bangkok)[1].origin;
    const placeholder = scene.items[4];
    expect(placeholder.kind).toBe("placeholder");
    expect(placeholder.rect).toEqual({ ...PLACEHOLDER_RECT, x: second.x + PLACEHOLDER_RECT.x, y: second.y + PLACEHOLDER_RECT.y });
    expect(scene.items[0].rect).toMatchObject({ x: TITLE_BLOCK.x, y: TITLE_BLOCK.y });
    expect(scene.items[2].rect).toMatchObject({ x: EXIT_TILE_CORNER.x, y: EXIT_TILE_CORNER.y });
  });

  it("keeps the title and exit but drops the placeholder for a slot with no summary", () => {
    const scene = buildScene(bangkok, [], idle);
    expect(scene.items.every((i) => i.kind !== "placeholder")).toBe(true);
    expect(scene.items).toHaveLength(7 * 2);
  });

  it("places a loaded bucket's tiles by the layout, in rank order, offset by the slot", () => {
    const data = bucket("food-drink", 30);
    const scene = buildScene(bangkok, summaries, (slug) =>
      slug === "food-drink" ? { status: "ready", data } : idle(),
    );
    const food = scene.items.filter((i) => i.slot.categorySlug === "food-drink");
    expect(food[0].kind).toBe("title");
    expect(food[food.length - 1].kind).toBe("exit");
    const tours = food.filter((i) => i.kind === "tour");
    expect(tours.map((t) => (t.kind === "tour" ? t.tile.rank : 0))).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );

    const layout = layoutBucket({ bucketKey: "bangkok/food-drink", tiles: data.tiles });
    const origin = citySlots(bangkok)[2].origin;
    const first = tours[0];
    expect(first.rect).toEqual({ x: origin.x + layout.tiles[0].x, y: origin.y + layout.tiles[0].y, w: layout.tiles[0].w, h: layout.tiles[0].h });
  });

  it("gives every item bounds inside the region, covering rotated tiles", () => {
    const states = new Map<string, BucketState>(
      CANVAS_CATEGORIES.map((c) => [c.slug, { status: "ready", data: bucket(c.slug, 50) }]),
    );
    const scene = buildScene(bangkok, summaries, (slug) => states.get(slug)!);
    expect(scene.bounds).toHaveLength(scene.items.length);
    scene.items.forEach((item, i) => {
      const b = scene.bounds[i];
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(REGION_SIZE.width);
      expect(b.y + b.h).toBeLessThanOrEqual(REGION_SIZE.height);
      if (item.kind === "tour" && item.rot !== 0) expect(b.w).toBeGreaterThan(item.rect.w);
    });
  });

  it("puts every tile upright on its grid spot with tilt off (perf switch tilt=0)", () => {
    const states = new Map<string, BucketState>(
      CANVAS_CATEGORIES.map((c) => [c.slug, { status: "ready", data: bucket(c.slug, 50) }]),
    );
    const tilted = buildScene(bangkok, summaries, (slug) => states.get(slug)!);
    expect(tilted.items.some((i) => i.kind === "tour" && i.rot !== 0)).toBe(true);

    const scene = buildScene(bangkok, summaries, (slug) => states.get(slug)!, { tilt: false });
    const pinned = { x: TITLE_BLOCK.x + TITLE_BLOCK.width + RANK_ONE_OFFSET, y: TITLE_BLOCK.y };
    for (const item of scene.items) {
      if (item.kind !== "tour") continue;
      expect(item.rot).toBe(0);
      const x = item.rect.x - item.slot.origin.x;
      const y = item.rect.y - item.slot.origin.y;
      const onGrid = (x - MARGIN) % GRID_SIZE === 0 && (y - MARGIN) % GRID_SIZE === 0;
      expect(onGrid || (x === pinned.x && y === pinned.y)).toBe(true);
    }
  });
});
