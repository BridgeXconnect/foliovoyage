import { describe, expect, it } from "@jest/globals";
import { findLeakTerms, phrasesMatcher } from "./seo-slice-text";

describe("findLeakTerms (spec 0006 AC-T6)", () => {
  it("finds leak terms by prefix, whole word, symbol and currency", () => {
    expect(findLeakTerms("Highly rated, with reviews")).toEqual(expect.arrayContaining(["rated", "review"]));
    expect(findLeakTerms("five ★ tours")).toContain("★");
    expect(findLeakTerms("from $20")).not.toEqual([]);
    expect(findLeakTerms("about 200 THB")).not.toEqual([]);
    expect(findLeakTerms("Free cancellation")).toContain("cancel");
    expect(findLeakTerms("A quiet morning by the river")).toEqual([]);
  });

  it("does not match inside a longer word", () => {
    expect(findLeakTerms("A berated boatman")).toEqual([]);
  });
});

describe("phrasesMatcher (spec 0006 AC-S8)", () => {
  const pickup = phrasesMatcher(["pick up", "pickup", "pick-up", "hotel transfer"]);

  it("matches each phrase as a whole word, case insensitive", () => {
    expect(pickup("Hotel Pickup and drop off")).toBe(true);
    expect(pickup("Pick-up from central hotels")).toBe(true);
    expect(pickup("pick  up at the pier")).toBe(true);
    expect(pickup("Pickups not offered")).toBe(false);
  });

  it("never matches with no phrases", () => {
    expect(phrasesMatcher([])("anything")).toBe(false);
  });
});
