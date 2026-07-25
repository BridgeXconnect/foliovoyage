import { describe, expect, it } from "@jest/globals";

import {
  CURATED_CITIES,
  CURATED_REFS,
  curatedCityForRefs,
} from "./curated-cities";

describe("curated-cities registry", () => {
  it("has a unique primary ref per city and valid centroids", () => {
    const primaries = CURATED_CITIES.map((c) => c.primaryRef);
    expect(new Set(primaries).size).toBe(primaries.length);
    for (const c of CURATED_CITIES) {
      expect(c.viatorRefs).toContain(c.primaryRef);
      expect(Number.isFinite(c.centroidLat)).toBe(true);
      expect(Number.isFinite(c.centroidLng)).toBe(true);
      expect(Math.abs(c.centroidLat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.centroidLng)).toBeLessThanOrEqual(180);
    }
  });

  it("CURATED_REFS flattens every city's ref set", () => {
    const expected = CURATED_CITIES.flatMap((c) => c.viatorRefs);
    expect([...CURATED_REFS].sort()).toEqual([...expected].sort());
  });

  it("maps a single city ref to its city", () => {
    expect(curatedCityForRefs(["343"])?.slug).toBe("bangkok");
    expect(curatedCityForRefs(["511"])?.slug).toBe("rome");
  });

  it("maps a Bali sub-destination (descendant) ref to Bali via the region set", () => {
    // Bali is a region; tours are tagged with sub-destinations, not ref 98.
    const bali = CURATED_CITIES.find((c) => c.slug === "bali")!;
    const descendant = bali.viatorRefs.find((r) => r !== bali.primaryRef)!;
    expect(curatedCityForRefs([descendant])?.slug).toBe("bali");
  });

  it("returns null when no ref matches a curated city", () => {
    expect(curatedCityForRefs(["99999"])).toBeNull();
    expect(curatedCityForRefs([])).toBeNull();
  });

  it("resolves deterministically (registry order) when refs match two cities", () => {
    // Contrived: a tour tagged with both Bangkok and Rome resolves to whichever
    // comes first in the registry — stable, not order-of-refs dependent.
    const first = curatedCityForRefs(["511", "343"]);
    const firstReordered = curatedCityForRefs(["343", "511"]);
    expect(first?.slug).toBe(firstReordered?.slug);
  });
});
