import { expect, it } from "@jest/globals";

import { isPromotable } from "./experience-auto-promoter";

/**
 * Pure predicate tests for {@link isPromotable} (category/currency promotion
 * plan, Task 7 / Decision 3). No DB — see `experience-auto-promoter.integration.spec.ts`
 * for the `ExperienceAutoPromoter.promoteEligible` DB-backed acceptance tests.
 */

const base = {
  title: "T",
  description: "D",
  status: "draft",
  tour: { imageUrl: "http://img", affiliateUrl: "http://go", priceReferenceMinor: 3000 },
};

it("promotes when all criteria hold", () => expect(isPromotable(base)).toBe(true));

it("rejects empty title/description", () => {
  expect(isPromotable({ ...base, title: "  " })).toBe(false);
  expect(isPromotable({ ...base, description: "" })).toBe(false);
});

it("rejects missing image / affiliate", () => {
  expect(isPromotable({ ...base, tour: { ...base.tour, imageUrl: null } })).toBe(false);
  expect(isPromotable({ ...base, tour: { ...base.tour, affiliateUrl: null } })).toBe(false);
});

it("rejects a degenerate price band (null or non-positive reference)", () => {
  expect(isPromotable({ ...base, tour: { ...base.tour, priceReferenceMinor: null } })).toBe(false);
  expect(isPromotable({ ...base, tour: { ...base.tour, priceReferenceMinor: 0 } })).toBe(false);
});

it("rejects when there is no linked tour", () => expect(isPromotable({ ...base, tour: null })).toBe(false));

it("is a no-op on already-published rows", () => expect(isPromotable({ ...base, status: "published" })).toBe(false));
