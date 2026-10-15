import { describe, expect, it } from "@jest/globals";
import { canonicalHash, canonicalJson } from "./hash";

/**
 * The golden vector. apps/api's `seo-slice-hash.spec.ts` pins the same input to
 * the same literal, so the two copies of the recipe (spec 0006, Hashes) cannot
 * drift apart without one of the two tests failing.
 */
const GOLDEN_INPUT = {
  slug: "floating-markets",
  facts: { memberCount: 431, strip: [], bandCounts: { under4h: 3, fullDay: 1 } },
  title: "Wat Arun ไทย",
  picks: [{ b: 2, a: null }],
};
const GOLDEN_HASH = "v1:2456f89d1e864d7c371e565b998528cb15dd9722a789b0878de97ae00a486f2a";

describe("canonicalHash", () => {
  it("pins the golden vector shared with apps/api", () => {
    expect(canonicalHash(GOLDEN_INPUT)).toBe(GOLDEN_HASH);
  });

  it("sorts keys at every level and keeps array order, with no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });

  it("ignores key order but not array order", () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });
});
