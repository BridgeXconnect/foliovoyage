/**
 * The items the `/discover` canvas mounts, in world order (spec 0004, AC-L10).
 *
 * For each of a city's seven slots: its title block, then either its tiles in
 * rank order (from `layoutBucket`) or, until they load, a placeholder with the
 * summary's representative image, then the exit tile. DOM order follows this
 * list, so Tab walks a bucket's tiles in rank order. Every position comes from
 * the shared geometry and the layout; nothing here holds a pixel value.
 *
 * Coordinates are relative to the city region's top left corner, which is the
 * world element's origin: the canvas shows one city, so the pan clamps to its
 * region. Pure: no DOM, no React.
 */

import {
  CANVAS_CATEGORIES,
  CANVAS_CITIES,
  CITY_REGION_HEIGHT,
  CITY_REGION_WIDTH,
  EXIT_TILE_CORNER,
  EXIT_TILE_HEIGHT,
  EXIT_TILE_WIDTH,
  JITTER,
  LANDSCAPE_RATIO,
  RANK_ONE_OFFSET,
  SLOT_HEIGHT,
  SLOT_WIDTH,
  TIER_PHOTO_WIDTH,
  TILT_DEGREES,
  TILT_STEPS_PER_DEGREE,
  TITLE_BLOCK,
  fnv1a,
  layoutBucket,
  mulberry32,
  slotOriginByIndex,
  type CanvasBucketResponse,
  type CanvasBucketSummary,
  type CanvasCity,
  type CanvasImage,
  type CanvasTile,
  type LayoutResult,
  type TileShape,
  type TileTier,
} from "@folio/shared";
import type { BucketState } from "./bucket-store";
import { rotatedBounds, type Point, type Rect, type Size } from "./engine";

export interface Slot {
  readonly categorySlug: string;
  readonly categoryLabel: string;
  readonly categoryIndex: number;
  /** Top left corner, relative to the city region. */
  readonly origin: Point;
}

interface ItemBase {
  readonly key: string;
  readonly slot: Slot;
  /** Pre rotation outline, relative to the city region. */
  readonly rect: Rect;
}

export type SceneItem =
  | (ItemBase & { readonly kind: "title"; readonly total: number | null })
  | (ItemBase & { readonly kind: "placeholder"; readonly image: CanvasImage })
  | (ItemBase & {
      readonly kind: "tour";
      readonly tile: CanvasTile;
      readonly tier: TileTier;
      readonly shape: TileShape;
      readonly rot: number;
    })
  | (ItemBase & { readonly kind: "exit" });

export interface Scene {
  readonly items: readonly SceneItem[];
  /** Rotated bounds of each item, for the section index. */
  readonly bounds: readonly Rect[];
}

/** The pan bounds: one city region. */
export const REGION_SIZE: Size = { width: CITY_REGION_WIDTH, height: CITY_REGION_HEIGHT };

/** Where a slot's placeholder image sits until its tiles load: rank 1's spot, at `lg` 3:2. */
export const PLACEHOLDER_RECT: Rect = {
  x: TITLE_BLOCK.x + TITLE_BLOCK.width + RANK_ONE_OFFSET,
  y: TITLE_BLOCK.y,
  w: TIER_PHOTO_WIDTH.lg,
  h: (TIER_PHOTO_WIDTH.lg * LANDSCAPE_RATIO.height) / LANDSCAPE_RATIO.width,
};

const TITLE_RECT: Rect = { x: TITLE_BLOCK.x, y: TITLE_BLOCK.y, w: TITLE_BLOCK.width, h: TITLE_BLOCK.height };
const EXIT_RECT: Rect = { x: EXIT_TILE_CORNER.x, y: EXIT_TILE_CORNER.y, w: EXIT_TILE_WIDTH, h: EXIT_TILE_HEIGHT };

/** A city's seven slots in category order, relative to its region. */
export function citySlots(city: CanvasCity): Slot[] {
  const cityIndex = CANVAS_CITIES.findIndex((c) => c.slug === city.slug);
  const region = slotOriginByIndex(cityIndex, 0);
  return CANVAS_CATEGORIES.map((category, categoryIndex) => {
    const origin = slotOriginByIndex(cityIndex, categoryIndex);
    return {
      categorySlug: category.slug,
      categoryLabel: category.label,
      categoryIndex,
      origin: { x: origin.x - region.x, y: origin.y - region.y },
    };
  });
}

/** The slot under a region point, or null over the spare cell or outside the region. */
export function slotAt(slots: readonly Slot[], point: Point): Slot | null {
  return (
    slots.find(
      (s) =>
        point.x >= s.origin.x &&
        point.x < s.origin.x + SLOT_WIDTH &&
        point.y >= s.origin.y &&
        point.y < s.origin.y + SLOT_HEIGHT,
    ) ?? null
  );
}

/** The slots that overlap a region rect. */
export function slotsInRect(slots: readonly Slot[], rect: Rect): Slot[] {
  return slots.filter(
    (s) =>
      s.origin.x < rect.x + rect.w &&
      s.origin.x + SLOT_WIDTH > rect.x &&
      s.origin.y < rect.y + rect.h &&
      s.origin.y + SLOT_HEIGHT > rect.y,
  );
}

const offset = (rect: Rect, origin: Point): Rect => ({
  x: origin.x + rect.x,
  y: origin.y + rect.y,
  w: rect.w,
  h: rect.h,
});

// A bucket's layout never changes once loaded, so it is computed once per response.
const layouts = new WeakMap<CanvasBucketResponse, LayoutResult>();

function layoutFor(city: CanvasCity, data: CanvasBucketResponse): LayoutResult {
  let layout = layouts.get(data);
  if (!layout) {
    layout = layoutBucket({ bucketKey: `${city.slug}/${data.categorySlug}`, tiles: data.tiles });
    layouts.set(data, layout);
  }
  return layout;
}

/**
 * The jitter and tilt `layoutBucket` seeded for a tile, drawn the same way
 * (`seedTile` in the shared layout), so the perf switch `tilt=0` can take them
 * back out. A tile the layout straightened has rot 0 and no jitter; a tile whose
 * seeded tilt rounds to 0 can't be told apart from one, so its jitter is taken
 * out too (at most `JITTER` px off for such a tile, in a perf run only).
 */
function seededLook(id: string): { jx: number; jy: number; rot: number } {
  const rand = mulberry32(fnv1a(id));
  const jx = Math.round((rand() * 2 - 1) * JITTER) + 0;
  const jy = Math.round((rand() * 2 - 1) * JITTER) + 0;
  const rot = Math.round((rand() * 2 - 1) * TILT_DEGREES * TILT_STEPS_PER_DEGREE) / TILT_STEPS_PER_DEGREE + 0;
  return { jx, jy, rot };
}

export interface SceneOptions {
  /** False for the perf switch `tilt=0`: every tile upright and on its grid spot. */
  readonly tilt?: boolean;
}

export function buildScene(
  city: CanvasCity,
  summaries: readonly CanvasBucketSummary[],
  stateOf: (categorySlug: string) => BucketState,
  options: SceneOptions = {},
): Scene {
  const tilt = options.tilt ?? true;
  const items: SceneItem[] = [];
  for (const slot of citySlots(city)) {
    const summary = summaries.find((s) => s.categorySlug === slot.categorySlug);
    const state = stateOf(slot.categorySlug);
    const prefix = `${city.slug}/${slot.categorySlug}`;
    items.push({
      kind: "title",
      key: `${prefix}/title`,
      slot,
      rect: offset(TITLE_RECT, slot.origin),
      total: state.status === "ready" ? state.data.total : (summary?.total ?? null),
    });
    if (state.status === "ready") {
      const layout = layoutFor(city, state.data);
      const byId = new Map(state.data.tiles.map((t) => [t.id, t]));
      for (const p of layout.tiles) {
        const tile = byId.get(p.id);
        if (!tile) continue;
        let rect = offset(p, slot.origin);
        if (!tilt) {
          const seeded = seededLook(p.id);
          if (p.rot === seeded.rot) rect = { ...rect, x: rect.x - seeded.jx, y: rect.y - seeded.jy };
        }
        items.push({
          kind: "tour",
          key: `${prefix}/${p.id}`,
          slot,
          rect,
          tile,
          tier: p.tier,
          shape: p.shape,
          rot: tilt ? p.rot : 0,
        });
      }
    } else if (summary) {
      items.push({
        kind: "placeholder",
        key: `${prefix}/placeholder`,
        slot,
        rect: offset(PLACEHOLDER_RECT, slot.origin),
        image: summary.image,
      });
    }
    items.push({ kind: "exit", key: `${prefix}/exit`, slot, rect: offset(EXIT_RECT, slot.origin) });
  }
  return {
    items,
    bounds: items.map((item) => (item.kind === "tour" ? rotatedBounds(item.rect, item.rot) : item.rect)),
  };
}
