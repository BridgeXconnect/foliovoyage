import { describe, expect, it } from "@jest/globals";

import { computeReferenceMinor } from "./reference-price";

describe("computeReferenceMinor", () => {
  it("converts a supplier minor amount to USD minor via the rate", () => {
    // 500000 minor THB = 5000.00 THB major; ×0.028 = 140.00 USD → 14000 USD minor
    expect(computeReferenceMinor(500000, 0.028)).toBe(14000);
  });

  it("is identity at rate 1 (USD source)", () => {
    expect(computeReferenceMinor(2800, 1)).toBe(2800);
  });

  it("returns null when price or rate is missing", () => {
    expect(computeReferenceMinor(null, 0.028)).toBeNull();
    expect(computeReferenceMinor(2800, undefined)).toBeNull();
  });
});
