/**
 * The seven categories the canvas shows, in world order, with the slug and
 * label the feed returns (BRI-225, spec 0004).
 *
 * This is an API-local copy of `CANVAS_CATEGORIES` in `@folio/shared`: the API
 * compiles to CommonJS and cannot import values from that ESM package yet (see
 * `packages/shared/AGENTS.md`). `canvas-categories.spec.ts` pins the slug and
 * label map to the shared copy and the ids to `category-rule.ts`, so a drift in
 * any of the three fails CI. It holds slugs and labels only, never a pixel.
 *
 * Category 21914 (Travel & Transportation Services) and a null category are
 * deliberately absent, so no feed query can return them.
 */
export interface CanvasCategoryCopy {
  /** The Viator root tag id, the value of `Tour.primaryCategoryTagId`. */
  readonly tagId: number;
  readonly slug: string;
  readonly label: string;
}

export const CANVAS_CATEGORY_COPY: readonly CanvasCategoryCopy[] = [
  { tagId: 21909, slug: "outdoor-activities", label: "Outdoor Activities" },
  { tagId: 21910, slug: "art-culture", label: "Art & Culture" },
  { tagId: 21911, slug: "food-drink", label: "Food & Drink" },
  { tagId: 21912, slug: "tickets-passes", label: "Tickets & Passes" },
  { tagId: 21913, slug: "tours-sightseeing", label: "Tours, Sightseeing & Cruises" },
  { tagId: 21915, slug: "classes-workshops", label: "Classes & Workshops" },
  { tagId: 21916, slug: "seasonal-events", label: "Seasonal & Special Occasions" },
];

/** Root tag ids of the shown categories, for the SQL filter. */
export const SHOWN_CATEGORY_TAG_IDS: readonly number[] = CANVAS_CATEGORY_COPY.map((c) => c.tagId);

export function categoryBySlug(slug: string): CanvasCategoryCopy | undefined {
  return CANVAS_CATEGORY_COPY.find((c) => c.slug === slug);
}
