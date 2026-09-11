import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import type { ViatorProduct } from "./clients/viator.types";
import { normalizeViatorProduct, type TourDTO } from "./normalizer";

const FIXTURES = join(__dirname, "__fixtures__");

/** Load a recorded fixture from disk (mirrors reading a page from the archive). */
function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as T;
}

// The provenance timestamp is injected, never read from the clock — here we pin
// it to when the fixture was actually retrieved (grounded example, 2026-07-18).
const FETCHED_AT = "2026-07-18T00:00:00.000Z";

describe("normalizeViatorProduct — golden file", () => {
  // The **verbatim** live response of `GET /products/57189P2` (Viator Partner
  // API production, captured 2026-07-25) — the exact bytes the ST-6 crawl
  // archives and this normalizer consumes. Real, not invented, and deliberately
  // whole (18 images, full itinerary, productOptions, …) so no assumed shape can
  // slip past unnoticed the way the fabricated `pricing.summary.fromPrice` did
  // (BRI-165). The expected `.tour.json` was regenerated from this payload.
  const raw = loadJson<ViatorProduct>("viator-product-57189P2.json");

  it("normalizes the recorded payload to the expected Tour record, exactly", () => {
    const expected = loadJson<TourDTO>("viator-product-57189P2.tour.json");

    const tour = normalizeViatorProduct(raw, { fetchedAt: FETCHED_AT });

    expect(tour).toEqual(expected);
  });

  it("leaves price_minor/currency null — the real payload carries no price (BRI-165)", () => {
    // The core BRI-165 regression: a real Viator product detail has no price at
    // all (its `pricingInfo` is booking constraints only). Price is resolved
    // after normalization from `/availability/schedules` by the ST-7c
    // PriceResolver, so the normalizer must leave both null here. This asserts
    // against the real captured payload, so a re-introduced in-payload price path
    // (like the old `pricing.summary.fromPrice`) would fail it.
    const tour = normalizeViatorProduct(raw, { fetchedAt: FETCHED_AT });
    expect(tour.price_minor).toBeNull();
    expect(tour.currency).toBeNull();
  });

  it("maps the other provider fields from the real payload (field-path spot-check)", () => {
    // Guards the whole set of real field paths at once, so a second BRI-165-class
    // path mismatch elsewhere can't hide. Values are read verbatim from the
    // captured payload.
    const tour = normalizeViatorProduct(raw, { fetchedAt: FETCHED_AT });
    expect(tour.provider_tour_id).toBe("57189P2");
    expect(tour.duration_min).toBe(180); // itinerary.duration.fixedDurationInMinutes
    expect(tour.rating_avg).toBe(5); // reviews.combinedAverageRating 4.97… → 5.0
    expect(tour.rating_count).toBe(5175); // reviews.totalReviews
    expect(tour.affiliate_url).toContain("mcid=42383"); // productUrl, affiliate params intact
    expect(tour.location_ref).toMatch(/^LOC-/); // logistics.start[0].location.ref
    expect(tour.image_url).toContain("540x360"); // isCover image, preferred variant
    expect(tour.image_alt).toBe("Hanoi Street Food Tour"); // cover caption
    expect(tour.destination_refs).toEqual(["351"]); // destinations[].ref (Hanoi)
  });

  it("sets all four provenance fields", () => {
    const tour = normalizeViatorProduct(raw, { fetchedAt: FETCHED_AT });

    expect(tour.provider).toBe("viator");
    expect(tour.provider_tour_id).toBe("57189P2");
    expect(tour.fetched_at).toBe(FETCHED_AT);
    expect(tour.source_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not set any Atlas-owned fields (ownership boundary)", () => {
    const tour = normalizeViatorProduct(raw, { fetchedAt: FETCHED_AT });
    const keys = Object.keys(tour);

    // Editorial/enrichment + dedup + DB-assigned columns are not ours to set.
    // Note: raw provider `tags` (opaque numeric IDs) is provenance, not an
    // Atlas-owned field, so it's deliberately absent from this list (category
    // Stage A) — the *resolved* Atlas category remains forbidden below.
    for (const forbidden of [
      "id",
      "experience_id",
      "slug",
      "geom",
      "editor_rating",
      "categories",
      "category",
      "status",
      "curation_status",
      "created_at",
      "updated_at",
      "deleted_at",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("normalizeViatorProduct — purity & determinism", () => {
  const raw = loadJson<ViatorProduct>("viator-product-57189P2.json");

  it("is deterministic: same input → identical output", () => {
    const a = normalizeViatorProduct(raw, { fetchedAt: FETCHED_AT });
    const b = normalizeViatorProduct(raw, { fetchedAt: FETCHED_AT });
    expect(a).toEqual(b);
  });

  it("does not mutate its input", () => {
    const snapshot = JSON.stringify(raw);
    normalizeViatorProduct(raw, { fetchedAt: FETCHED_AT });
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it("source_hash ignores fetched_at but tracks content changes", () => {
    const base = normalizeViatorProduct(raw, { fetchedAt: FETCHED_AT });

    // A later re-fetch of unchanged content must keep the same hash …
    const refetched = normalizeViatorProduct(raw, {
      fetchedAt: "2026-09-01T12:00:00.000Z",
    });
    expect(refetched.source_hash).toBe(base.source_hash);
    expect(refetched.fetched_at).not.toBe(base.fetched_at);

    // … but a changed content field (the title) must change the hash.
    const retitled = normalizeViatorProduct(
      { ...raw, title: "A different tour title" },
      { fetchedAt: FETCHED_AT },
    );
    expect(retitled.source_hash).not.toBe(base.source_hash);
  });

  it("excludes price/currency from source_hash (resolved downstream + volatile)", () => {
    // Price and currency are attached after normalization (ST-7c) and are
    // volatile, so — like lat/lng — they are deliberately NOT part of the content
    // hash. The normalizer never reads price from the payload, so injecting a
    // would-be price field must not change the hash (and must not set a price).
    const base = normalizeViatorProduct(raw, { fetchedAt: FETCHED_AT });
    const withPhantomPrice = normalizeViatorProduct(
      { ...raw, pricing: { currency: "USD", summary: { fromPrice: 999 } } },
      { fetchedAt: FETCHED_AT },
    );
    expect(withPhantomPrice.source_hash).toBe(base.source_hash);
    expect(withPhantomPrice.price_minor).toBeNull();
    expect(withPhantomPrice.currency).toBeNull();
  });
});

describe("normalizeViatorProduct — field handling", () => {
  it("throws when a required NOT NULL field is missing", () => {
    expect(() =>
      normalizeViatorProduct({ title: "no code" }, { fetchedAt: FETCHED_AT }),
    ).toThrow(/productCode/);
    expect(() =>
      normalizeViatorProduct({ productCode: "X1" }, { fetchedAt: FETCHED_AT }),
    ).toThrow(/title/);
  });

  it("normalizes optional/absent provider fields to null, not undefined", () => {
    const tour = normalizeViatorProduct(
      { productCode: "X1", title: "Minimal tour" },
      { fetchedAt: FETCHED_AT },
    );

    expect(tour.description).toBeNull();
    expect(tour.duration_min).toBeNull();
    expect(tour.rating_avg).toBeNull();
    expect(tour.rating_count).toBeNull();
    expect(tour.price_minor).toBeNull();
    expect(tour.currency).toBeNull();
    expect(tour.affiliate_url).toBeNull();
    expect(tour.location_ref).toBeNull();
    expect(tour.latitude).toBeNull();
    expect(tour.longitude).toBeNull();
  });
});

describe("normalizeViatorProduct — start location reference (ST-7b)", () => {
  it("extracts logistics.start[0].location.ref as location_ref", () => {
    const tour = normalizeViatorProduct(
      {
        productCode: "X1",
        title: "Tour with a start point",
        logistics: {
          start: [
            { location: { ref: "LOC-abc123" }, description: "Meet at gate" },
            { location: { ref: "LOC-second" } },
          ],
        },
      },
      { fetchedAt: FETCHED_AT },
    );

    // First start entry wins (the tour's single map start point).
    expect(tour.location_ref).toBe("LOC-abc123");
    // Coordinates are resolved later by the ST-7b resolver, not by normalization.
    expect(tour.latitude).toBeNull();
    expect(tour.longitude).toBeNull();
  });

  it("normalizes a legacy UNSTRUCTURED itinerary (no start ref) to null", () => {
    const tour = normalizeViatorProduct(
      {
        productCode: "X1",
        title: "Legacy tour",
        logistics: { start: [] },
      },
      { fetchedAt: FETCHED_AT },
    );

    expect(tour.location_ref).toBeNull();
  });

  it("folds the start reference into source_hash (location is content)", () => {
    const base = normalizeViatorProduct(
      { productCode: "X1", title: "T", logistics: { start: [{ location: { ref: "LOC-a" } }] } },
      { fetchedAt: FETCHED_AT },
    );
    const moved = normalizeViatorProduct(
      { productCode: "X1", title: "T", logistics: { start: [{ location: { ref: "LOC-b" } }] } },
      { fetchedAt: FETCHED_AT },
    );

    expect(moved.source_hash).not.toBe(base.source_hash);
  });
});

describe("normalizeViatorProduct — cover image (ST-11 / BRI-164)", () => {
  const IMAGES = [
    {
      isCover: false,
      caption: "not the cover",
      variants: [{ width: 540, height: 360, url: "https://img/other-540.jpg" }],
    },
    {
      isCover: true,
      caption: "Wat Arun at dusk",
      variants: [
        { width: 100, height: 100, url: "https://img/cover-100.jpg" },
        { width: 540, height: 360, url: "https://img/cover-540.jpg" },
        { width: 720, height: 480, url: "https://img/cover-720.jpg" },
      ],
    },
  ];

  it("picks the isCover image's preferred (540×360) variant + caption alt", () => {
    const tour = normalizeViatorProduct(
      { productCode: "IMG1", title: "T", images: IMAGES },
      { fetchedAt: FETCHED_AT },
    );
    expect(tour.image_url).toBe("https://img/cover-540.jpg");
    expect(tour.image_alt).toBe("Wat Arun at dusk");
  });

  it("falls back to the largest variant when preferred sizes are absent", () => {
    const tour = normalizeViatorProduct(
      {
        productCode: "IMG2",
        title: "T",
        images: [
          {
            isCover: true,
            variants: [
              { width: 75, height: 75, url: "https://img/s.jpg" },
              { width: 674, height: 446, url: "https://img/l.jpg" },
            ],
          },
        ],
      },
      { fetchedAt: FETCHED_AT },
    );
    expect(tour.image_url).toBe("https://img/l.jpg");
    expect(tour.image_alt).toBeNull(); // no caption
  });

  it("falls back to the first image when none is marked isCover", () => {
    const tour = normalizeViatorProduct(
      {
        productCode: "IMG3",
        title: "T",
        images: [
          { variants: [{ width: 540, height: 360, url: "https://img/first.jpg" }] },
        ],
      },
      { fetchedAt: FETCHED_AT },
    );
    expect(tour.image_url).toBe("https://img/first.jpg");
  });

  it("normalizes a product with no images to null", () => {
    const tour = normalizeViatorProduct(
      { productCode: "IMG4", title: "T", images: [] },
      { fetchedAt: FETCHED_AT },
    );
    expect(tour.image_url).toBeNull();
    expect(tour.image_alt).toBeNull();
  });

  it("folds the cover image into source_hash (image is content)", () => {
    const base = normalizeViatorProduct(
      { productCode: "IMG5", title: "T", images: IMAGES },
      { fetchedAt: FETCHED_AT },
    );
    const changed = normalizeViatorProduct(
      {
        productCode: "IMG5",
        title: "T",
        images: [
          { isCover: true, variants: [{ width: 540, height: 360, url: "https://img/new.jpg" }] },
        ],
      },
      { fetchedAt: FETCHED_AT },
    );
    expect(changed.source_hash).not.toBe(base.source_hash);
  });
});

describe("normalizeViatorProduct — tags (category Stage A)", () => {
  it("captures the top-level numeric tags array", () => {
    const dto = normalizeViatorProduct(
      { productCode: "P1", title: "T", tags: [12075, 11929, 367654] },
      { fetchedAt: FETCHED_AT },
    );
    expect(dto.tags).toEqual([12075, 11929, 367654]);
  });

  it("defaults tags to an empty array when absent or malformed", () => {
    const base = { productCode: "P1", title: "T" };
    expect(
      normalizeViatorProduct(base, { fetchedAt: FETCHED_AT }).tags,
    ).toEqual([]);
    expect(
      normalizeViatorProduct(
        { ...base, tags: ["x", 5, null, 7.9] },
        { fetchedAt: FETCHED_AT },
      ).tags,
    ).toEqual([5, 7]); // non-integers dropped, floats truncated
  });

  it("includes tags in the source hash (a tag change is a content change)", () => {
    const ctx = { fetchedAt: FETCHED_AT };
    const a = normalizeViatorProduct(
      { productCode: "P1", title: "T", tags: [1] },
      ctx,
    );
    const b = normalizeViatorProduct(
      { productCode: "P1", title: "T", tags: [2] },
      ctx,
    );
    expect(a.source_hash).not.toBe(b.source_hash);
  });
});

describe("normalizeViatorProduct — destination refs (ST-11 / BRI-164)", () => {
  it("extracts destinations[].ref verbatim", () => {
    const tour = normalizeViatorProduct(
      {
        productCode: "D1",
        title: "T",
        destinations: [{ ref: "343", primary: true }, { ref: "20" }],
      },
      { fetchedAt: FETCHED_AT },
    );
    expect(tour.destination_refs).toEqual(["343", "20"]);
  });

  it("coerces a numeric ref to string and drops malformed entries", () => {
    const tour = normalizeViatorProduct(
      {
        productCode: "D2",
        title: "T",
        destinations: [{ ref: 511 }, { notARef: true }, { ref: "" }],
      },
      { fetchedAt: FETCHED_AT },
    );
    expect(tour.destination_refs).toEqual(["511"]);
  });

  it("is an empty array when the payload has no destinations", () => {
    const tour = normalizeViatorProduct(
      { productCode: "D3", title: "T" },
      { fetchedAt: FETCHED_AT },
    );
    expect(tour.destination_refs).toEqual([]);
  });

  it("folds destination refs into source_hash (belonging is content)", () => {
    const base = normalizeViatorProduct(
      { productCode: "D4", title: "T", destinations: [{ ref: "343" }] },
      { fetchedAt: FETCHED_AT },
    );
    const moved = normalizeViatorProduct(
      { productCode: "D4", title: "T", destinations: [{ ref: "511" }] },
      { fetchedAt: FETCHED_AT },
    );
    expect(moved.source_hash).not.toBe(base.source_hash);
  });
});
