import { describe, expect, it } from "@jest/globals";
import {
  CANVAS_CATEGORIES,
  CANVAS_CITIES,
  EXCLUDED_CATEGORY_TAG_ID,
  MAX_TILES_PER_BUCKET,
  TIER_LAST_RANK,
} from "@folio/shared";

import { CATEGORY_ROOTS_PRIORITY } from "../modules/import/category-rule";
import { CURATED_CITIES } from "../modules/import/curated-cities";
import { CANVAS_CATEGORY_COPY, SHOWN_CATEGORY_TAG_IDS } from "./canvas-categories";
import { SM_FIRST_RANK } from "./canvas-image";
import { MAX_TILES } from "./canvas.service";

/**
 * Parity tests (BRI-225). The API compiles to CommonJS and cannot import values
 * from `@folio/shared`, so it keeps a copy of the category slug and label map and
 * reads the cities from `curated-cities.ts`. These specs make a drift between the
 * copies a CI failure instead of a silent bug. Specs may import shared values
 * (ts-jest transpiles them); production code may not.
 */
describe("canvas parity", () => {
  it("the API category map equals the shared one: ids, slugs, labels and order", () => {
    expect(CANVAS_CATEGORY_COPY).toEqual(CANVAS_CATEGORIES.map((c) => ({ ...c })));
  });

  it("the shown category ids are the category roots in category-rule.ts, minus 21914", () => {
    expect(EXCLUDED_CATEGORY_TAG_ID).toBe(21914);
    expect([...SHOWN_CATEGORY_TAG_IDS].sort()).toEqual(
      CATEGORY_ROOTS_PRIORITY.filter((id) => id !== EXCLUDED_CATEGORY_TAG_ID).sort(),
    );
    expect(SHOWN_CATEGORY_TAG_IDS).not.toContain(21914);
  });

  it("the shared city list equals curated-cities.ts: slug, country slug, name and order", () => {
    expect(CANVAS_CITIES.map((c) => ({ ...c }))).toEqual(
      CURATED_CITIES.map((c) => ({ slug: c.slug, countrySlug: c.countrySlug, name: c.name })),
    );
  });

  it("does not list Paris, which the seed creates but the canvas does not show", () => {
    expect(CANVAS_CITIES.map((c) => c.slug)).not.toContain("paris");
  });

  it("the API tile cap and the sm tier start match the shared tiers", () => {
    expect(MAX_TILES).toBe(MAX_TILES_PER_BUCKET);
    expect(SM_FIRST_RANK).toBe(TIER_LAST_RANK.md + 1);
  });
});
