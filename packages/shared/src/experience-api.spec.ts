import { describe, expect, it } from "@jest/globals";

import { experiencePageSchema, experienceRatingSchema } from "./api";

const page = {
  experienceId: "cexp000000000000000000001",
  tourId: "ctour00000000000000000001",
  title: "Grand Palace Walking Tour",
  image: { url: "https://img.test/a.jpg", width: 720, height: 480, alt: "The palace" },
  durationMin: 180,
  price: { amountMinor: 4500, currency: "THB" },
  cancellationDescription: "Cancel up to 24 hours before.\nFull refund.",
  summary: { kind: "ai" as const, text: "A calm morning at the palace." },
  affiliateUrl: "https://www.viator.com/tours/Bangkok/x/d343-1P1?pid=P1",
  city: { slug: "bangkok", countrySlug: "thailand", name: "Bangkok" },
};

describe("experiencePageSchema (AC-1, AC-3)", () => {
  it("parses a full page", () => {
    expect(experiencePageSchema.safeParse(page).success).toBe(true);
  });

  it("accepts every nullable field as null, and unknown image size", () => {
    const parsed = experiencePageSchema.safeParse({
      ...page,
      image: { url: page.image.url, width: null, height: null, alt: "x" },
      durationMin: null,
      price: null,
      cancellationDescription: null,
      summary: null,
      affiliateUrl: null,
    });
    expect(parsed.success).toBe(true);
    expect(experiencePageSchema.safeParse({ ...page, image: null }).success).toBe(true);
  });

  it("takes both summary kinds and rejects any other or an empty text", () => {
    expect(experiencePageSchema.safeParse({ ...page, summary: { kind: "provider", text: "Hi" } }).success).toBe(true);
    expect(experiencePageSchema.safeParse({ ...page, summary: { kind: "editor", text: "Hi" } }).success).toBe(false);
    expect(experiencePageSchema.safeParse({ ...page, summary: { kind: "ai", text: "" } }).success).toBe(false);
  });

  it("checks price.amountMinor as a non negative integer", () => {
    expect(experiencePageSchema.safeParse({ ...page, price: { amountMinor: 45.5, currency: "USD" } }).success).toBe(false);
    expect(experiencePageSchema.safeParse({ ...page, price: { amountMinor: -1, currency: "USD" } }).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { tourId: _tourId, ...rest } = page;
    expect(experiencePageSchema.safeParse(rest).success).toBe(false);
    const { city: _city, ...noCity } = page;
    expect(experiencePageSchema.safeParse(noCity).success).toBe(false);
  });

  it("has no rating field anywhere, and strips one if the api ever sent it", () => {
    const keys = JSON.stringify(Object.keys(experiencePageSchema.shape)).toLowerCase();
    expect(keys).not.toContain("rating");
    const parsed = experiencePageSchema.parse({ ...page, ratingAvg: 4.8, ratingCount: 311 });
    expect(parsed).not.toHaveProperty("ratingAvg");
    expect(parsed).not.toHaveProperty("ratingCount");
  });
});

describe("experienceRatingSchema (AC-2)", () => {
  it("parses a rated and an unrated tour", () => {
    expect(experienceRatingSchema.safeParse({ ratingAvg: 4.8, ratingCount: 311 }).success).toBe(true);
    expect(experienceRatingSchema.safeParse({ ratingAvg: null, ratingCount: null }).success).toBe(true);
  });

  it("rejects missing or mistyped fields", () => {
    expect(experienceRatingSchema.safeParse({ ratingAvg: 4.8 }).success).toBe(false);
    expect(experienceRatingSchema.safeParse({ ratingAvg: "4.8", ratingCount: 3 }).success).toBe(false);
    expect(experienceRatingSchema.safeParse({ ratingAvg: 4.8, ratingCount: 3.5 }).success).toBe(false);
  });

  it("carries nothing but the two rating fields", () => {
    expect(Object.keys(experienceRatingSchema.shape).sort()).toEqual(["ratingAvg", "ratingCount"]);
  });
});
