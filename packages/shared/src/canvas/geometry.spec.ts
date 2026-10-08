import { describe, expect, it } from "@jest/globals";

import {
  CANVAS_CATEGORIES,
  CANVAS_CITIES,
  EXCLUDED_CATEGORY_TAG_ID,
  MAX_TILES_PER_BUCKET,
  tierForRank,
} from "./geometry";

describe("canvas feed lists", () => {
  it("keeps the fixed city and category order", () => {
    expect(CANVAS_CITIES.map((c) => c.slug)).toEqual([
      "bangkok",
      "kyoto",
      "hanoi",
      "rome",
      "lisbon",
      "bali",
    ]);
    expect(CANVAS_CATEGORIES.map((c) => c.tagId)).toEqual([
      21909, 21910, 21911, 21912, 21913, 21915, 21916,
    ]);
    expect(CANVAS_CATEGORIES.map((c) => c.slug)).toEqual([
      "outdoor-activities",
      "art-culture",
      "food-drink",
      "tickets-passes",
      "tours-sightseeing",
      "classes-workshops",
      "seasonal-events",
    ]);
  });

  it("never lists the excluded category", () => {
    expect(EXCLUDED_CATEGORY_TAG_ID).toBe(21914);
    expect(CANVAS_CATEGORIES.map((c) => c.tagId)).not.toContain(21914);
  });

  it("maps rank to tier: 1 to 4 lg, 5 to 20 md, 21 to 50 sm", () => {
    expect([1, 4].map(tierForRank)).toEqual(["lg", "lg"]);
    expect([5, 20].map(tierForRank)).toEqual(["md", "md"]);
    expect([21, MAX_TILES_PER_BUCKET].map(tierForRank)).toEqual(["sm", "sm"]);
  });
});
