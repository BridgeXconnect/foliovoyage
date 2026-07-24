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
  // A real recorded Viator product (code 57189P2), every field verbatim from
  // docs/apps/web/content-examples/viator-grounded-example.md — the one live
  // Viator payload the repo documents. Not invented.
  const raw = loadJson<ViatorProduct>("viator-product-57189P2.json");

  it("normalizes the recorded payload to the expected Tour record, exactly", () => {
    const expected = loadJson<TourDTO>("viator-product-57189P2.tour.json");

    const tour = normalizeViatorProduct(raw, { fetchedAt: FETCHED_AT });

    expect(tour).toEqual(expected);
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
    for (const forbidden of [
      "id",
      "experience_id",
      "slug",
      "geom",
      "editor_rating",
      "categories",
      "tags",
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

    // … but a changed price must change the hash.
    const repriced = normalizeViatorProduct(
      { ...raw, pricing: { currency: "USD", summary: { fromPrice: 35 } } },
      { fetchedAt: FETCHED_AT },
    );
    expect(repriced.source_hash).not.toBe(base.source_hash);
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
  });
});
