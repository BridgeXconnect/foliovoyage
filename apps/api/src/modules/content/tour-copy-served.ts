import { evaluateTourCopyEligibility } from "./tour-copy-eligibility";
import { computeGroundingHash, type TourCopyGroundingInput } from "./tour-copy-grounding-hash";

/**
 * "Is this copy currently served" (BRI-201 / spec 0003, AC-7). Pure. The one
 * place the eval selection query and `TourCopyEvalService.judgeOne` agree on
 * it: `published`, a paragraph present, the stored hash equal to a recomputed
 * hash of the tour's current fields, tour not deleted, Experience published,
 * and the tour still eligible.
 */

export interface ServedCheckTour extends TourCopyGroundingInput {
  ratingAvg: number | null;
  ratingCount: number | null;
  deletedAt: Date | null;
  experience: { status: string } | null;
}

export interface ServedCheckCopy {
  status: string;
  aiSummary: string | null;
  groundingHash: string;
}

export function isServedCopy(tour: ServedCheckTour, copy: ServedCheckCopy): boolean {
  return (
    copy.status === "published" &&
    copy.aiSummary !== null &&
    copy.groundingHash === computeGroundingHash(tour) &&
    tour.deletedAt === null &&
    tour.experience?.status === "published" &&
    evaluateTourCopyEligibility({ ratingAvg: tour.ratingAvg, ratingCount: tour.ratingCount }).eligible
  );
}
