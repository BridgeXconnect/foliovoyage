import { describe, expect, it } from "@jest/globals";

import {
  canvasBucketResponseSchema,
  canvasBucketsResponseSchema,
  canvasTileSchema,
} from "./api";

const image = { url: "https://example.test/a.jpg", width: 480, height: 320 };
const tile = {
  id: "exp_1",
  tourId: "tour_1",
  rank: 1,
  title: "Grand Palace",
  image,
  durationMin: 120,
  price: { amountMinor: 4500, currency: "USD" },
  ratingAvg: 4.8,
  ratingCount: 311,
};
const summary = {
  citySlug: "bangkok",
  countrySlug: "thailand",
  cityName: "Bangkok",
  categorySlug: "art-culture",
  categoryLabel: "Art & Culture",
  total: 1,
  image,
};

describe("canvas wire schemas", () => {
  it("parses a bucket response and a summaries response", () => {
    expect(canvasBucketResponseSchema.safeParse({ ...summary, tiles: [tile] }).success).toBe(true);
    expect(canvasBucketsResponseSchema.safeParse({ buckets: [summary] }).success).toBe(true);
  });

  it("accepts unknown image size and unrated tours", () => {
    const parsed = canvasTileSchema.safeParse({
      ...tile,
      image: { url: image.url, width: null, height: null },
      durationMin: null,
      ratingAvg: null,
      ratingCount: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("checks price.amountMinor as an integer", () => {
    const bad = { ...tile, price: { amountMinor: 45.5, currency: "USD" } };
    expect(canvasTileSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a bucket with more than 60 tiles or none", () => {
    const many = Array.from({ length: 61 }, (_, i) => ({ ...tile, id: `e${i}`, rank: i + 1 }));
    expect(canvasBucketResponseSchema.safeParse({ ...summary, tiles: many }).success).toBe(false);
    expect(canvasBucketResponseSchema.safeParse({ ...summary, tiles: [] }).success).toBe(false);
  });
});
