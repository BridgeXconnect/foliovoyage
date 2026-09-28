import { describe, expect, it } from "@jest/globals";

import {
  ancestorCategoryRoots,
  CATEGORY_ROOTS_PRIORITY,
  derivePrimaryCategory,
  unresolvedTagIds,
  type TagGraph,
} from "./category-rule";

/**
 * A small fake tag graph, shaped like the real one but tiny:
 *  - The 8 real category roots (parentless).
 *  - 100 → Art & Culture (21910), a single-parent leaf.
 *  - 200 → Tours, Sightseeing & Cruises (21913) only.
 *  - 300 → both Food & Drink (21911) and Tours (21913) — the multi-parent case.
 *  - 12518 → a legacy root (parentless, not a category).
 *  - 999 → an ops-flag tag (parentless, not a category — BRI-228's territory).
 *  - 500 ⇄ 501 → a mutual-parent cycle that reaches no root.
 */
function fakeGraph(): TagGraph {
  return new Map<number, readonly number[]>([
    [21909, []],
    [21910, []],
    [21911, []],
    [21912, []],
    [21913, []],
    [21914, []],
    [21915, []],
    [21916, []],
    [100, [21910]],
    [200, [21913]],
    [300, [21911, 21913]],
    [12518, []],
    [999, []],
    [500, [501]],
    [501, [500]],
  ]);
}

describe("ancestorCategoryRoots", () => {
  it("returns the tag itself when it is directly a category root", () => {
    expect(ancestorCategoryRoots(21915, fakeGraph())).toEqual(new Set([21915]));
  });

  it("walks up a single parent to its root", () => {
    expect(ancestorCategoryRoots(100, fakeGraph())).toEqual(new Set([21910]));
  });

  it("collects every root reachable across multiple parents", () => {
    expect(ancestorCategoryRoots(300, fakeGraph())).toEqual(new Set([21911, 21913]));
  });

  it("returns empty for a parentless tag that isn't a category root (legacy root)", () => {
    expect(ancestorCategoryRoots(12518, fakeGraph())).toEqual(new Set());
  });

  it("returns empty for a parentless ops-flag tag", () => {
    expect(ancestorCategoryRoots(999, fakeGraph())).toEqual(new Set());
  });

  it("returns empty and terminates on a mutual-parent cycle", () => {
    expect(ancestorCategoryRoots(500, fakeGraph())).toEqual(new Set());
  });

  it("returns empty for a tag id missing from the vocabulary", () => {
    expect(ancestorCategoryRoots(88888, fakeGraph())).toEqual(new Set());
  });
});

describe("derivePrimaryCategory — rarest root wins", () => {
  it("returns the single root when only one is reachable", () => {
    expect(derivePrimaryCategory([100], fakeGraph())).toBe(21910);
  });

  it("returns the tour's only root when every tag maps to the same one (21913-only tour)", () => {
    expect(derivePrimaryCategory([200], fakeGraph())).toBe(21913);
  });

  it("picks the rarer root by CATEGORY_ROOTS_PRIORITY when multiple roots are reachable", () => {
    // 300 alone reaches {21911, 21913}; 21911 (Food & Drink) outranks 21913
    // (Tours, Sightseeing & Cruises) in the priority order.
    expect(derivePrimaryCategory([300], fakeGraph())).toBe(21911);
  });

  it("unions roots across all of a tour's tags before picking", () => {
    // 100 → {21910}, 200 → {21913}; 21910 (Art & Culture) outranks 21913.
    expect(derivePrimaryCategory([100, 200], fakeGraph())).toBe(21910);
  });

  it("returns null when every tag is a legacy root / ops flag only", () => {
    expect(derivePrimaryCategory([12518, 999], fakeGraph())).toBeNull();
  });

  it("returns null for an empty tag list", () => {
    expect(derivePrimaryCategory([], fakeGraph())).toBeNull();
  });

  it("ignores a tag id missing from the vocabulary rather than throwing", () => {
    expect(derivePrimaryCategory([100, 88888], fakeGraph())).toBe(21910);
  });

  it("never hangs on a cycle that reaches no root", () => {
    expect(derivePrimaryCategory([500], fakeGraph())).toBeNull();
  });
});

describe("unresolvedTagIds", () => {
  it("reports tag ids absent from the vocabulary, never silently dropping them", () => {
    expect(unresolvedTagIds([100, 88888, 200, 77777], fakeGraph())).toEqual([88888, 77777]);
  });

  it("returns empty when every tag id resolves", () => {
    expect(unresolvedTagIds([100, 200], fakeGraph())).toEqual([]);
  });
});

describe("CATEGORY_ROOTS_PRIORITY", () => {
  it("is the 8 current category roots, rarest first", () => {
    expect(CATEGORY_ROOTS_PRIORITY).toEqual([
      21915, 21916, 21911, 21914, 21912, 21909, 21910, 21913,
    ]);
  });
});
