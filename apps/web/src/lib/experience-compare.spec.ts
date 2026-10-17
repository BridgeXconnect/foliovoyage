import { describe, expect, it } from "@jest/globals";
import type { Destination, Experience } from "@folio/shared";
import {
  MIN_COMPARE,
  MAX_COMPARE,
  toggleCompareSelection,
  canCompare,
  buildComparison,
} from "@/lib/experience-compare";

// A live (matched) tour: carries provider commerce signals.
function live(id: string, over: Partial<Experience> = {}): Experience {
  return {
    id,
    title: `Live ${id}`,
    description: "d",
    image: `https://e.test/${id}.jpg`,
    imageAlt: `alt ${id}`,
    category: "Landmarks",
    priceBand: "$$",
    duration: "2–3 hours",
    provider: "Viator",
    fromPrice: 28,
    currency: "USD",
    rating: 4.7,
    ratingCount: 1200,
    freeCancel: true,
    affiliateUrl: "https://www.viator.com/tours/abc",
    ...over,
  };
}

// A sparse (unmatched) tour: only editorial priceBand + duration.
function sparse(id: string, over: Partial<Experience> = {}): Experience {
  return {
    id,
    title: `Sparse ${id}`,
    description: "d",
    image: `https://e.test/${id}.jpg`,
    imageAlt: `alt ${id}`,
    category: "Culture & History",
    priceBand: "$",
    duration: "Half day",
    ...over,
  };
}

const dest: Destination = {
  slug: "bangkok",
  city: "Bangkok",
  country: "Thailand",
  tagline: "t",
  heroImage: "https://e.test/h.jpg",
  heroImageAlt: "h",
  intro: ["p"],
  knownFor: ["k"],
  bestTime: "Nov–Feb",
  fromPrice: 100,
  experiences: [live("a"), live("b"), live("c"), sparse("d"), sparse("e")],
  lat: 13.75,
  lng: 100.5,
};

describe("selection rule (2..4)", () => {
  it("exposes the documented bounds", () => {
    expect(MIN_COMPARE).toBe(2);
    expect(MAX_COMPARE).toBe(4);
  });

  it("adds ids up to the max of 4, then rejects a 5th (no-op)", () => {
    let sel: string[] = [];
    sel = toggleCompareSelection(sel, "a"); // 1
    sel = toggleCompareSelection(sel, "b"); // 2
    sel = toggleCompareSelection(sel, "c"); // 3
    sel = toggleCompareSelection(sel, "d"); // 4 (max)
    expect(sel).toEqual(["a", "b", "c", "d"]);
    const after5th = toggleCompareSelection(sel, "e"); // attempted 5th
    expect(after5th).toEqual(["a", "b", "c", "d"]); // unchanged
  });

  it("toggling an already-selected id removes it (even at the cap)", () => {
    const sel = ["a", "b", "c", "d"];
    expect(toggleCompareSelection(sel, "b")).toEqual(["a", "c", "d"]);
  });

  it("does not mutate the input array", () => {
    const sel = ["a"];
    const next = toggleCompareSelection(sel, "b");
    expect(sel).toEqual(["a"]);
    expect(next).toEqual(["a", "b"]);
  });

  it("canCompare is true only for 2..4 selected", () => {
    expect(canCompare([])).toBe(false);
    expect(canCompare(["a"])).toBe(false);
    expect(canCompare(["a", "b"])).toBe(true);
    expect(canCompare(["a", "b", "c"])).toBe(true);
    expect(canCompare(["a", "b", "c", "d"])).toBe(true);
    expect(canCompare(["a", "b", "c", "d", "e"])).toBe(false);
  });
});

describe("buildComparison", () => {
  it("builds 2 columns in the given id order with detail paths", () => {
    const m = buildComparison(dest, ["b", "a"]);
    expect(m.tours.map((t) => t.id)).toEqual(["b", "a"]);
    expect(m.tours[0].detailPath).toBe("/destinations/bangkok/experiences/b");
    expect(m.tours[1].detailPath).toBe("/destinations/bangkok/experiences/a");
    // one cell per tour on every row
    for (const row of m.rows) expect(row.values).toHaveLength(2);
    expect(m.rows.map((r) => r.key)).toEqual([
      "price",
      "duration",
      "provider",
      "freeCancel",
    ]);
  });

  it("builds 3 columns", () => {
    const m = buildComparison(dest, ["a", "b", "c"]);
    expect(m.tours).toHaveLength(3);
    for (const row of m.rows) expect(row.values).toHaveLength(3);
  });

  it("builds 4 columns (the max)", () => {
    const m = buildComparison(dest, ["a", "b", "c", "d"]);
    expect(m.tours).toHaveLength(4);
    for (const row of m.rows) expect(row.values).toHaveLength(4);
  });

  it("renders real values for a live tour", () => {
    const m = buildComparison(dest, ["a"]);
    const val = (k: string) => m.rows.find((r) => r.key === k)!.values[0];
    expect(val("price")).toBe("From $28");
    expect(val("duration")).toBe("2–3 hours");
    expect(val("provider")).toBe("Viator");
    expect(val("freeCancel")).toBe("Yes");
  });

  it("emits null (honest absence) for facts a sparse tour lacks", () => {
    // 'd' is sparse: no provider/price/freeCancel; only priceBand + duration.
    const m = buildComparison(dest, ["d"]);
    const val = (k: string) => m.rows.find((r) => r.key === k)!.values[0];
    expect(val("price")).toBe("$"); // editorial priceBand, never fabricated
    expect(val("duration")).toBe("Half day");
    expect(val("provider")).toBeNull();
    expect(val("freeCancel")).toBeNull(); // unknown policy → null, not "No"
  });

  it("keeps per-tour nulls aligned when the set mixes live + sparse", () => {
    const m = buildComparison(dest, ["a", "d"]);
    expect(JSON.stringify(m)).not.toMatch(/4\.7|1,200|"rating"/);
    const provider = m.rows.find((r) => r.key === "provider")!;
    expect(provider.values).toEqual(["Viator", null]);
  });

  it("skips ids that are not in the destination", () => {
    const m = buildComparison(dest, ["a", "does-not-exist", "b"]);
    expect(m.tours.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
