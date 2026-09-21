/**
 * Eligibility gate for AI tour-copy generation (BRI-200 / ST-49, EP-15).
 *
 * Decides whether a tour is worth spending a generation call on — not what the
 * copy says (that is BRI-154). Pure: tour fields in, verdict + reason codes
 * out. No DB, no clock, no side effects, same pattern as `isPromotable` and
 * `normalizeViatorProduct`.
 *
 * Two rules only, both on fields the import already fills: a review-count
 * floor and a rating floor. Deliberately no data-completeness rule
 * (images / inclusions / cancellation policy / reviews-by-source) — deferred
 * until that data has propagated through delta imports (see BRI-200).
 *
 * An ineligible tour is not removed, hidden or routed anywhere: it keeps
 * showing the provider's text as-is. The verdict is just data for later
 * consumers (BRI-154 to skip generation, BRI-142 to judge page indexability).
 */

/** Minimum `Tour.ratingCount`, inclusive. Confirmed 2026-09-21 (Roy). */
export const MIN_REVIEW_COUNT = 5;

/**
 * Minimum `Tour.ratingAvg`, inclusive. Not set by the ticket — a documented
 * default, adjust here. Viator ratings skew high (among tours with 5+ reviews
 * the median is 4.9 and p10 is 4.3), so 4.0 excludes ~5% of them; a 3.5 floor
 * would exclude under 2% and barely gate anything.
 */
export const MIN_RATING = 4.0;

/**
 * Why a tour failed. `*_missing` means the value is absent (null / non-finite),
 * kept distinct from `*_below_floor` (present but too low) so a consumer can
 * tell "no data" from "bad data". Both fail the gate.
 */
export type IneligibilityReason =
  | "review_count_missing"
  | "review_count_below_floor"
  | "rating_missing"
  | "rating_below_floor";

/** The `Tour` fields the gate reads. A Prisma `Tour` row satisfies it. */
export interface TourCopyEligibilityInput {
  ratingAvg: number | null;
  ratingCount: number | null;
}

export interface TourCopyEligibility {
  eligible: boolean;
  /** Empty exactly when `eligible`; otherwise one entry per failed rule, count rule first. */
  reasons: IneligibilityReason[];
}

/**
 * Both rules are always evaluated, so a tour failing both reports both. A
 * missing (null / NaN / ±Infinity) value is ineligible, never assumed to pass.
 * Note the import stores an unrated tour as `ratingCount: 0, ratingAvg: null`,
 * which yields `["review_count_below_floor", "rating_missing"]`.
 */
export function evaluateTourCopyEligibility(t: TourCopyEligibilityInput): TourCopyEligibility {
  const reasons: IneligibilityReason[] = [];

  if (!isPresent(t.ratingCount)) reasons.push("review_count_missing");
  else if (t.ratingCount < MIN_REVIEW_COUNT) reasons.push("review_count_below_floor");

  if (!isPresent(t.ratingAvg)) reasons.push("rating_missing");
  else if (t.ratingAvg < MIN_RATING) reasons.push("rating_below_floor");

  return { eligible: reasons.length === 0, reasons };
}

function isPresent(n: number | null): n is number {
  return n !== null && Number.isFinite(n);
}
