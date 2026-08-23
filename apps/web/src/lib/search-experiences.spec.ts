import { describe, expect, it } from "@jest/globals";
import { runSearch, durationBucketOf, hasExperienceFilters } from "@/lib/search-experiences";
import { EMPTY_SEARCH_STATE, type SearchState } from "@/lib/search-url";
import { getAllDestinations } from "@/data/destinations-helpers";

function state(over: Partial<SearchState> = {}): SearchState {
  return { ...EMPTY_SEARCH_STATE, ...over };
}

describe("durationBucketOf", () => {
  it("buckets known labels and nulls the unknown", () => {
    expect(durationBucketOf("Half day")).toBe("half-day");
    expect(durationBucketOf("1–2 hours")).toBe("short");
    expect(durationBucketOf("Evening")).toBe("short");
    expect(durationBucketOf("Full day")).toBe("full-day");
    expect(durationBucketOf("1–2 days")).toBe("multi-day");
    expect(durationBucketOf("banana")).toBeNull();
    expect(durationBucketOf(undefined)).toBeNull();
  });

  it("buckets every distinct duration label present in the static data (no silent gaps)", () => {
    const labels = new Set<string>();
    for (const d of getAllDestinations())
      for (const e of d.experiences) if (e.duration) labels.add(e.duration);
    expect(labels.size).toBeGreaterThan(0);
    for (const label of labels)
      expect(durationBucketOf(label)).not.toBeNull();
  });
});

describe("hasExperienceFilters", () => {
  it("is true when any experience-only filter is set", () => {
    expect(hasExperienceFilters(state())).toBe(false);
    expect(hasExperienceFilters(state({ priceBands: ["$"] }))).toBe(true);
    expect(hasExperienceFilters(state({ categories: ["Food & Drink"] }))).toBe(true);
    expect(hasExperienceFilters(state({ durations: ["short"] }))).toBe(true);
    expect(hasExperienceFilters(state({ minRating: 4 }))).toBe(true);
  });
});

describe("runSearch — featured (empty query)", () => {
  it("returns destinations first, then experiences, and counts everything", () => {
    const out = runSearch(state(), 200);
    const all = getAllDestinations();
    const expCount = all.reduce((n, d) => n + d.experiences.length, 0);
    expect(out.total).toBe(all.length + expCount);
    expect(out.results[0].type).toBe("destination");
    // a destination appears before any experience in the featured order
    const firstExp = out.results.findIndex((r) => r.type === "experience");
    const lastDest = out.results.map((r) => r.type).lastIndexOf("destination");
    expect(lastDest).toBeLessThan(firstExp);
  });
});

describe("runSearch — text query", () => {
  it("matches experiences by title/description/city, excludes non-matches", () => {
    // Probe term swapped from the brief's "temple" to "market" (BRI-178 task-2
    // Step 4 fallback): "temple" appears in the required title/description/
    // category/city/country fields (see grep in the report), but it ALSO
    // appears in Hanoi's `intro` — a field the engine's destination matcher
    // reads (`destinationHaystack` includes `intro`/`knownFor`) but this
    // per-result assertion deliberately does not, so Hanoi matched-but-failed
    // the assertion. "market" has no such intro/knownFor-only hits (confirmed
    // via grep — every non-Bangkok "market" occurrence is inside an
    // experience's title/description, and Bangkok's is in its tagline too),
    // so it exercises the same matching path without the false failure.
    const out = runSearch(state({ q: "market" }), 200);
    expect(out.results.length).toBeGreaterThan(0);
    for (const r of out.results) {
      const hay =
        r.type === "experience"
          ? `${r.experience.title} ${r.experience.description} ${r.experience.category} ${r.destination.city} ${r.destination.country}`
          : `${r.destination.city} ${r.destination.country} ${r.destination.tagline}`;
      expect(hay.toLowerCase()).toContain("market");
    }
  });

  it("returns an empty result set (not an error) for a nonsense query", () => {
    const out = runSearch(state({ q: "zzzzqxwv" }), 200);
    expect(out.results).toEqual([]);
    expect(out.total).toBe(0);
    expect(out.totalPages).toBe(1);
  });
});

describe("runSearch — filters", () => {
  it("ANDs priceBand + category and drops destinations once a filter is set", () => {
    const out = runSearch(state({ priceBands: ["$"], categories: ["Food & Drink"] }), 200);
    expect(out.results.every((r) => r.type === "experience")).toBe(true);
    for (const r of out.results) {
      if (r.type !== "experience") continue;
      expect(r.experience.priceBand).toBe("$");
      expect(r.experience.category).toBe("Food & Drink");
    }
  });

  it("filters by duration bucket", () => {
    const out = runSearch(state({ durations: ["multi-day"] }), 200);
    for (const r of out.results) {
      if (r.type !== "experience") continue;
      expect(durationBucketOf(r.experience.duration)).toBe("multi-day");
    }
  });

  it("minRating excludes experiences with no rating (honest partial data)", () => {
    // viator-links.json is empty today → no static experience has a rating →
    // a minRating filter legitimately yields zero results.
    const out = runSearch(state({ minRating: 4 }), 200);
    for (const r of out.results) {
      if (r.type !== "experience") continue;
      expect(typeof r.experience.rating).toBe("number");
      expect(r.experience.rating!).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("runSearch — facets & pagination", () => {
  it("reports facet counts over the query-matched experiences", () => {
    const out = runSearch(state({ q: "" }), 200);
    const totalFacetPrice = out.facets.priceBands.reduce((n, f) => n + f.count, 0);
    const expCount = getAllDestinations().reduce((n, d) => n + d.experiences.length, 0);
    expect(totalFacetPrice).toBe(expCount);
    expect(out.facets.categories.length).toBeGreaterThan(0);
  });

  it("paginates deterministically", () => {
    const p1 = runSearch(state({ page: 1 }), 5);
    const p2 = runSearch(state({ page: 2 }), 5);
    expect(p1.results.length).toBe(5);
    expect(p1.pageSize).toBe(5);
    expect(p1.results).not.toEqual(p2.results);
    expect(p1.totalPages).toBe(Math.ceil(p1.total / 5));
  });
});
