import { describe, expect, it } from "@jest/globals";

import {
  MIN_RATING,
  MIN_REVIEW_COUNT,
  evaluateTourCopyEligibility,
} from "./tour-copy-eligibility";

describe("evaluateTourCopyEligibility", () => {
  it("pins the confirmed thresholds", () => {
    expect(MIN_REVIEW_COUNT).toBe(5);
    expect(MIN_RATING).toBe(4.0);
  });

  describe("passes both rules", () => {
    it("is eligible with a well-rated, well-reviewed tour", () => {
      expect(evaluateTourCopyEligibility({ ratingAvg: 4.7, ratingCount: 120 })).toEqual({
        eligible: true,
        reasons: [],
      });
    });

    it("is eligible at exactly the review-count floor", () => {
      const r = evaluateTourCopyEligibility({ ratingAvg: 4.5, ratingCount: MIN_REVIEW_COUNT });
      expect(r).toEqual({ eligible: true, reasons: [] });
    });

    it("is eligible at exactly the rating floor", () => {
      const r = evaluateTourCopyEligibility({ ratingAvg: MIN_RATING, ratingCount: 50 });
      expect(r).toEqual({ eligible: true, reasons: [] });
    });

    it("is eligible with both values exactly at their floors", () => {
      const r = evaluateTourCopyEligibility({
        ratingAvg: MIN_RATING,
        ratingCount: MIN_REVIEW_COUNT,
      });
      expect(r).toEqual({ eligible: true, reasons: [] });
    });
  });

  describe("fails one rule", () => {
    it("names only the review-count rule when just the count is too low", () => {
      expect(evaluateTourCopyEligibility({ ratingAvg: 4.8, ratingCount: 4 })).toEqual({
        eligible: false,
        reasons: ["review_count_below_floor"],
      });
    });

    it("names only the rating rule when just the rating is too low", () => {
      expect(evaluateTourCopyEligibility({ ratingAvg: 3.2, ratingCount: 80 })).toEqual({
        eligible: false,
        reasons: ["rating_below_floor"],
      });
    });

    it("is ineligible just under the rating floor", () => {
      const r = evaluateTourCopyEligibility({ ratingAvg: 3.99, ratingCount: 80 });
      expect(r).toEqual({ eligible: false, reasons: ["rating_below_floor"] });
    });

    it("is ineligible one review under the count floor", () => {
      const r = evaluateTourCopyEligibility({
        ratingAvg: 5,
        ratingCount: MIN_REVIEW_COUNT - 1,
      });
      expect(r).toEqual({ eligible: false, reasons: ["review_count_below_floor"] });
    });
  });

  describe("fails both rules", () => {
    it("reports both reasons, count first", () => {
      expect(evaluateTourCopyEligibility({ ratingAvg: 2.5, ratingCount: 2 })).toEqual({
        eligible: false,
        reasons: ["review_count_below_floor", "rating_below_floor"],
      });
    });
  });

  describe("missing data is ineligible, with a reason distinct from 'below floor'", () => {
    it("flags a null rating", () => {
      expect(evaluateTourCopyEligibility({ ratingAvg: null, ratingCount: 50 })).toEqual({
        eligible: false,
        reasons: ["rating_missing"],
      });
    });

    it("flags a null review count", () => {
      expect(evaluateTourCopyEligibility({ ratingAvg: 4.6, ratingCount: null })).toEqual({
        eligible: false,
        reasons: ["review_count_missing"],
      });
    });

    it("flags both when both are null", () => {
      expect(evaluateTourCopyEligibility({ ratingAvg: null, ratingCount: null })).toEqual({
        eligible: false,
        reasons: ["review_count_missing", "rating_missing"],
      });
    });

    it("treats an unrated tour as the import stores it (count 0, rating null)", () => {
      expect(evaluateTourCopyEligibility({ ratingAvg: null, ratingCount: 0 })).toEqual({
        eligible: false,
        reasons: ["review_count_below_floor", "rating_missing"],
      });
    });

    it("treats non-finite numbers as missing rather than comparing them", () => {
      expect(evaluateTourCopyEligibility({ ratingAvg: Number.NaN, ratingCount: 50 })).toEqual({
        eligible: false,
        reasons: ["rating_missing"],
      });
      expect(evaluateTourCopyEligibility({ ratingAvg: 4.5, ratingCount: Number.NaN })).toEqual({
        eligible: false,
        reasons: ["review_count_missing"],
      });
    });
  });

  it("does not mutate its input", () => {
    const input = Object.freeze({ ratingAvg: 3, ratingCount: 1 });
    expect(() => evaluateTourCopyEligibility(input)).not.toThrow();
  });
});
