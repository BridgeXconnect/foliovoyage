/**
 * Discovery canvas feed shape (spec 0004, feed sub-spec): the bucket size cap,
 * the rank tiers, and the six cities and seven categories in fixed order.
 *
 * The view that drew these on a pannable canvas was shelved on 8 Oct 2026
 * (BRI-245); the feed and these lists stay in force for EP-21 (BRI-244).
 *
 * `apps/api` compiles to CommonJS and cannot import values from this ESM
 * package yet, so it holds copies of the category slug and label map, the 50
 * tile cap and the tier boundary, pinned to this file by parity tests in
 * `apps/api/src/canvas/canvas-categories.spec.ts`.
 */

// Feed shape ----------------------------------------------------------------

/** A bucket never carries more than this many tiles, so nothing is paged. */
export const MAX_TILES_PER_BUCKET = 50;

export type TileTier = "lg" | "md" | "sm";

/** Highest rank in each tier: ranks 1 to 4 are `lg`, 5 to 20 `md`, 21 to 50 `sm`. */
export const TIER_LAST_RANK = { lg: 4, md: 20, sm: MAX_TILES_PER_BUCKET } as const;

/** The tier a tile of this 1-based rank is drawn in. */
export function tierForRank(rank: number): TileTier {
  if (rank <= TIER_LAST_RANK.lg) return "lg";
  if (rank <= TIER_LAST_RANK.md) return "md";
  return "sm";
}

// Cities and categories, in fixed world order -------------------------------

export interface CanvasCity {
  readonly slug: string;
  readonly countrySlug: string;
  readonly name: string;
}

/**
 * The six canvas cities, row by row: bangkok, kyoto, hanoi (top row), rome,
 * lisbon, bali (bottom row). Matched to the database on `countrySlug` plus
 * `slug`. A parity test pins this to `curated-cities.ts` in the api.
 */
export const CANVAS_CITIES = [
  { slug: "bangkok", countrySlug: "thailand", name: "Bangkok" },
  { slug: "kyoto", countrySlug: "japan", name: "Kyoto" },
  { slug: "hanoi", countrySlug: "vietnam", name: "Hanoi" },
  { slug: "rome", countrySlug: "italy", name: "Rome" },
  { slug: "lisbon", countrySlug: "portugal", name: "Lisbon" },
  { slug: "bali", countrySlug: "indonesia", name: "Bali" },
] as const satisfies readonly CanvasCity[];

export interface CanvasCategory {
  /** The Viator root tag id, the value of `Tour.primaryCategoryTagId`. */
  readonly tagId: number;
  readonly slug: string;
  readonly label: string;
}

/**
 * The seven shown categories in slot order, 4 per row, the eighth cell spare.
 * Category 21914 (Travel & Transportation Services) is deliberately absent,
 * and so is a null category: neither ever appears on the canvas.
 */
export const CANVAS_CATEGORIES = [
  { tagId: 21909, slug: "outdoor-activities", label: "Outdoor Activities" },
  { tagId: 21910, slug: "art-culture", label: "Art & Culture" },
  { tagId: 21911, slug: "food-drink", label: "Food & Drink" },
  { tagId: 21912, slug: "tickets-passes", label: "Tickets & Passes" },
  { tagId: 21913, slug: "tours-sightseeing", label: "Tours, Sightseeing & Cruises" },
  { tagId: 21915, slug: "classes-workshops", label: "Classes & Workshops" },
  { tagId: 21916, slug: "seasonal-events", label: "Seasonal & Special Occasions" },
] as const satisfies readonly CanvasCategory[];

/** The category that is never shown. */
export const EXCLUDED_CATEGORY_TAG_ID = 21914;

export type CanvasCitySlug = (typeof CANVAS_CITIES)[number]["slug"];
export type CanvasCategorySlug = (typeof CANVAS_CATEGORIES)[number]["slug"];
