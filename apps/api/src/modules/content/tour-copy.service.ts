import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import type { VoiceCounterName } from "./tour-copy-check.constants";
import { evaluateTourCopyEligibility } from "./tour-copy-eligibility";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
import { generateChecked } from "./tour-copy-generate-checked";
import type { OpeningPattern } from "./tour-copy-opening";
import { combinedSourceTextLength, MIN_SOURCE_CHARS } from "./tour-copy-source-text";
import { TOUR_COPY_PROMPT_VERSION } from "./tour-copy.constants";
import { TOUR_COPY_GENERATOR, type TourCopyGenerator } from "./tour-copy-generator";

/**
 * Why {@link TourCopyService.generateOne} produced no `TourCopy` row and made
 * no model call. Distinct from the AC-5 check-failure reason codes stored in
 * `TourCopy.failureReasons` (`refusal`, `price_language`, and so on) — these
 * are selection-level, never persisted, and the CLI's candidate query (build
 * plan task 8) is expected to already filter most of them out before a tour
 * ever reaches this method.
 */
export type TourCopySkipReason =
  | "not_found"
  | "deleted"
  | "experience_not_published"
  | "not_eligible"
  | "source_too_thin"
  | "already_current"
  /**
   * A `failed` row whose grounding hash and `promptVersion` are both still
   * current, and `--retry-failed` was not passed (AC-7). Distinct from
   * `already_current` (which means a *published* row is already serving the
   * right text): this means the row failed the check on its current inputs
   * already, and a rerun without one of AC-7's escape hatches would just
   * fail the same way at the same cost.
   */
  | "failed_current"
  /**
   * A `withdrawn` row (kill switch or manual withdraw, spec 0003 AC-2) at
   * the current `promptVersion` and the run's model. Skipped whatever its
   * grounding hash is, so a changed tour cannot republish bad copy at a
   * pair the judge pulled. A different prompt version or model regenerates
   * it through the normal path.
   */
  | "withdrawn_current";

export type TourCopyOutcome =
  | { kind: "skipped"; reason: TourCopySkipReason }
  | { kind: "generated"; status: "published" | "failed" };

export interface GenerateOneOptions {
  /** The CLI run this call belongs to; stored as `TourCopy.runId`. */
  runId: string;
  /** The model id to request and to store as `TourCopy.model` (AC-11). */
  model: string;
  /**
   * AC-7: attempt a `failed` row again even though its grounding hash and
   * `promptVersion` are still current (the CLI's `--retry-failed` flag).
   */
  retryFailed?: boolean;
  /**
   * AC-7: regenerate a `published` row whose `promptVersion` is below this
   * value, even though its grounding hash is still current (the CLI's
   * `--regenerate-older-than-version N` flag).
   */
  regenerateOlderThanVersion?: number;
}

/**
 * Generates (or resumes) one tour's AI copy (BRI-154 / spec 0002).
 *
 * Applies the selection rules from AC-1, the thin-source rule, computes the
 * grounding hash, applies the AC-7 skip rules for both `published` and
 * `failed` rows, then calls the injected {@link TourCopyGenerator} with the
 * real prompt (build plan task 4), runs the deterministic check (task 4) on
 * the result, and — on a check failure — makes exactly one corrective retry
 * before falling back to a `failed` row (AC-6, this task).
 *
 * The CLI's candidate query (task 8) is expected to have already filtered to
 * eligible, published, non-deleted, non-thin tours whose skip rules don't
 * apply, but this method re-checks all of it anyway — AC-18 requires "the
 * pure gate is run again in code before every call", so the DB query is
 * never the only thing standing between an ineligible tour and a wasted
 * model call.
 */
@Injectable()
export class TourCopyService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TOUR_COPY_GENERATOR) private readonly generator: TourCopyGenerator,
  ) {}

  async generateOne(tourId: string, options: GenerateOneOptions): Promise<TourCopyOutcome> {
    const tour = await this.prisma.tour.findUnique({
      where: { id: tourId },
      select: {
        id: true,
        title: true,
        description: true,
        durationMin: true,
        inclusions: true,
        exclusions: true,
        ratingAvg: true,
        ratingCount: true,
        deletedAt: true,
        experience: { select: { status: true } },
        tourCopy: { select: { status: true, groundingHash: true, promptVersion: true, model: true } },
      },
    });
    if (!tour) return { kind: "skipped", reason: "not_found" };
    if (tour.deletedAt !== null) return { kind: "skipped", reason: "deleted" };
    if (tour.experience?.status !== "published") {
      return { kind: "skipped", reason: "experience_not_published" };
    }
    const eligibility = evaluateTourCopyEligibility({
      ratingAvg: tour.ratingAvg,
      ratingCount: tour.ratingCount,
    });
    if (!eligibility.eligible) return { kind: "skipped", reason: "not_eligible" };
    if (combinedSourceTextLength(tour) < MIN_SOURCE_CHARS) {
      return { kind: "skipped", reason: "source_too_thin" };
    }

    const groundingHash = computeGroundingHash(tour);

    if (tour.tourCopy) {
      const hashMatches = tour.tourCopy.groundingHash === groundingHash;

      // Spec 0003 AC-2, withdrawn: skip at the same prompt version and model,
      // whatever the hash is. Anything else falls through and regenerates.
      if (
        tour.tourCopy.status === "withdrawn" &&
        tour.tourCopy.promptVersion === TOUR_COPY_PROMPT_VERSION &&
        tour.tourCopy.model === options.model
      ) {
        return { kind: "skipped", reason: "withdrawn_current" };
      }

      // AC-7, published: skip a row already serving the current text, unless
      // --regenerate-older-than-version names a version above its promptVersion.
      if (tour.tourCopy.status === "published" && hashMatches) {
        const stalePromptVersion =
          options.regenerateOlderThanVersion !== undefined &&
          tour.tourCopy.promptVersion < options.regenerateOlderThanVersion;
        if (!stalePromptVersion) {
          return { kind: "skipped", reason: "already_current" };
        }
      }

      // AC-7, failed: skip a row that would just fail the same way at the
      // same cost, unless the hash or promptVersion has moved on, or
      // --retry-failed says to try anyway.
      if (tour.tourCopy.status === "failed") {
        const promptVersionCurrent = tour.tourCopy.promptVersion === TOUR_COPY_PROMPT_VERSION;
        if (hashMatches && promptVersionCurrent && !options.retryFailed) {
          return { kind: "skipped", reason: "failed_current" };
        }
      }
    }

    const generation = await generateChecked(this.generator, tour, {
      runId: options.runId,
      tourId: tour.id,
      groundingHash,
    });

    if (generation.status === "failed") {
      await this.saveRow(tour.id, {
        status: "failed",
        aiSummary: null,
        groundingHash,
        model: options.model,
        attempts: generation.attempts,
        failureReasons: generation.failureReasons,
        runId: options.runId,
        voiceCounts: null,
        openingPattern: null,
      });
      return { kind: "generated", status: "failed" };
    }

    await this.saveRow(tour.id, {
      status: "published",
      aiSummary: generation.text,
      groundingHash,
      model: options.model,
      attempts: generation.attempts,
      failureReasons: generation.failureReasons,
      runId: options.runId,
      // Spec 0003 AC-4: stored on every published row, null on a failed one.
      voiceCounts: generation.voiceCounts,
      openingPattern: generation.openingPattern,
    });
    return { kind: "generated", status: "published" };
  }

  private async saveRow(
    tourId: string,
    data: {
      status: "published" | "failed";
      aiSummary: string | null;
      groundingHash: string;
      model: string;
      attempts: number;
      failureReasons: string[];
      runId: string;
      voiceCounts: Record<VoiceCounterName, number> | null;
      openingPattern: OpeningPattern | null;
    },
  ): Promise<void> {
    const generatedAt = new Date();
    const shared = {
      status: data.status,
      aiSummary: data.aiSummary,
      groundingHash: data.groundingHash,
      model: data.model,
      promptVersion: TOUR_COPY_PROMPT_VERSION,
      generatedAt,
      attempts: data.attempts,
      failureReasons: data.failureReasons,
      runId: data.runId,
      voiceCounts: data.voiceCounts ?? Prisma.DbNull,
      openingPattern: data.openingPattern,
      // Spec 0003 AC-2: regenerating a withdrawn row returns it to service.
      withdrawnAt: null,
      withdrawnByRunId: null,
    };
    // AC-4: regenerating overwrites the existing row rather than adding a
    // second one — `tourId` is unique, so upsert is the natural fit.
    await this.prisma.tourCopy.upsert({
      where: { tourId },
      create: { tourId, ...shared },
      update: shared,
    });
  }
}
