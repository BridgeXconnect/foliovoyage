import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SeoSliceSnapshot } from "@folio/shared";
import { canonicalFileJson, canonicalHash, canonicalJson } from "./seo-slice-hash";

/**
 * The golden vector. apps/web's `src/lib/seo-slice/hash.spec.ts` pins the same input to
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
  it("pins the golden vector shared with apps/web", () => {
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

/**
 * The shared fixture (spec 0006 prod snapshot, Build plan task 2), pinned to
 * the same literals as apps/web's `src/lib/seo-slice/golden.spec.ts`.
 */
const FIXTURE = path.resolve(__dirname, "../../../../../packages/shared/fixtures/seo-slice-golden.json");
const FACTS_HASH = "v1:14eb0600e3ac1d197e9ea1c21a6474efe5f5bd70c036b9be0cedf0e828a5d0c2";
const PICKS_HASH = "v1:f09da8ed1fbcbe1372f0462e11a4031fe9b493e6bdf86a3bff50cb6be499f653";

describe("canonicalHash on the shared golden fixture", () => {
  const golden = JSON.parse(readFileSync(FIXTURE, "utf8")) as { snapshot: SeoSliceSnapshot };

  it("pins factsHash", () => {
    expect(canonicalHash(golden.snapshot.facts)).toBe(FACTS_HASH);
    expect(golden.snapshot.factsHash).toBe(FACTS_HASH);
  });

  it("pins picksHash", () => {
    expect(canonicalHash(golden.snapshot.picks)).toBe(PICKS_HASH);
    expect(golden.snapshot.picksHash).toBe(PICKS_HASH);
  });
});

describe("canonicalFileJson", () => {
  it("sorts keys, indents by two spaces and ends with a newline", () => {
    expect(canonicalFileJson({ b: [2, 1], a: { d: 1, c: null } })).toBe(
      '{\n  "a": {\n    "c": null,\n    "d": 1\n  },\n  "b": [\n    2,\n    1\n  ]\n}\n',
    );
  });
});
