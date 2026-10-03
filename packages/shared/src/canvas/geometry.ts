/**
 * Discovery canvas world geometry (BRI-225, spec 0004).
 *
 * The one file in the repo that holds a slot position, a size in pixels, or a
 * layout constant for the canvas. The layout, the minimap, the search jump and
 * the position URL all read it from here (AC-1), so a bucket never moves.
 *
 * Purity rule: this folder has no imports and uses no Node or DOM API, so the
 * layout can run on the server, in a worker, or in a test with the same result.
 * `geometry.spec.ts` fails the build if either rule breaks, or if a pixel
 * literal shows up in another file in this folder.
 *
 * `apps/api` compiles to CommonJS and cannot import values from this ESM
 * package yet, so it holds a copy of the category slug and label map, pinned to
 * this one by a parity test. It has no copy of anything in pixels.
 */

// World geometry ------------------------------------------------------------

/** One bucket's slot, in px. */
export const SLOT_WIDTH = 2400;
export const SLOT_HEIGHT = 1624;

/** A city region is a grid of category slots: 4 columns by 2 rows (7 used, 1 spare). */
export const CITY_REGION_SLOT_COLUMNS = 4;
export const CITY_REGION_SLOT_ROWS = 2;
export const CITY_REGION_WIDTH = CITY_REGION_SLOT_COLUMNS * SLOT_WIDTH; // 9600
export const CITY_REGION_HEIGHT = CITY_REGION_SLOT_ROWS * SLOT_HEIGHT; // 3248

/** The world is a grid of city regions: 3 columns by 2 rows. */
export const WORLD_CITY_COLUMNS = 3;
export const WORLD_CITY_ROWS = 2;
export const WORLD_WIDTH = WORLD_CITY_COLUMNS * CITY_REGION_WIDTH; // 28800
export const WORLD_HEIGHT = WORLD_CITY_ROWS * CITY_REGION_HEIGHT; // 6496

/** Culler section size and overscan, in sections. */
export const SECTION_SIZE = 512;
export const SECTION_OVERSCAN = 1;

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

// Layout constants (prototype `cluster.mjs`, canvas-Gallery commit 2a132ba) -----

/** Photo width per tier, in px. A 3:2 photo is two thirds as tall, a 1:1 photo is as tall as wide. */
export const TIER_PHOTO_WIDTH: Readonly<Record<TileTier, number>> = {
  lg: 360,
  md: 240,
  sm: 168,
};

/** Caption height per tier, in px. */
export const TIER_CAPTION_HEIGHT: Readonly<Record<TileTier, number>> = {
  lg: 68,
  md: 57,
  sm: 14,
};

/** Gap between a tile's photo and its caption, per tier, in px. */
export const TIER_CAPTION_GAP: Readonly<Record<TileTier, number>> = {
  lg: 12,
  md: 10,
  sm: 8,
};

export const GRID_SIZE = 8;
export const GUTTER = 24;
export const MARGIN = 48;
export const CLEARANCE = 6;

/** Placement jitter in px and tilt in degrees, applied as plus or minus. */
export const JITTER = 5;
export const TILT_DEGREES = 1.5;

/**
 * The title block reserved at the top left of every slot. A fixed reservation,
 * so the layout never depends on font metrics. The designer may change it.
 */
export const TITLE_BLOCK = { x: 48, y: 48, width: 201, height: 59 } as const;

/** The exit tile: `md` width at 3:2, no caption, in the bottom right corner of the slot. */
export const EXIT_TILE_WIDTH = TIER_PHOTO_WIDTH.md;
export const EXIT_TILE_HEIGHT = 160;
export const EXIT_TILE_CORNER = {
  x: SLOT_WIDTH - MARGIN - EXIT_TILE_WIDTH, // 2112
  y: SLOT_HEIGHT - MARGIN - EXIT_TILE_HEIGHT, // 1416
} as const;

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

// Slot arithmetic -----------------------------------------------------------

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Top left corner of the slot for a city index and a category index. */
export function slotOriginByIndex(cityIndex: number, categoryIndex: number): Point {
  const cityColumn = cityIndex % WORLD_CITY_COLUMNS;
  const cityRow = Math.floor(cityIndex / WORLD_CITY_COLUMNS);
  const categoryColumn = categoryIndex % CITY_REGION_SLOT_COLUMNS;
  const categoryRow = Math.floor(categoryIndex / CITY_REGION_SLOT_COLUMNS);
  return {
    x: cityColumn * CITY_REGION_WIDTH + categoryColumn * SLOT_WIDTH,
    y: cityRow * CITY_REGION_HEIGHT + categoryRow * SLOT_HEIGHT,
  };
}

/** Top left corner of a bucket's slot, or null for an unknown city or category slug. */
export function slotOrigin(citySlug: string, categorySlug: string): Point | null {
  const cityIndex = CANVAS_CITIES.findIndex((c) => c.slug === citySlug);
  const categoryIndex = CANVAS_CATEGORIES.findIndex((c) => c.slug === categorySlug);
  if (cityIndex < 0 || categoryIndex < 0) return null;
  return slotOriginByIndex(cityIndex, categoryIndex);
}

/** Centre of a bucket's slot, or null for an unknown city or category slug. */
export function slotCentre(citySlug: string, categorySlug: string): Point | null {
  const origin = slotOrigin(citySlug, categorySlug);
  if (!origin) return null;
  return { x: origin.x + SLOT_WIDTH / 2, y: origin.y + SLOT_HEIGHT / 2 };
}
