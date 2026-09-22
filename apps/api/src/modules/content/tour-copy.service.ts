import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";
import { checkTourCopy } from "./tour-copy-check";
import { CORRECTIVE_SENTENCES } from "./tour-copy-check.constants";
import { evaluateTourCopyEligibility } from "./tour-copy-eligibility";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
import { buildTourCopyUserMessage, TOUR_COPY_SYSTEM_PROMPT } from "./tour-copy-prompt";
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
  | "failed_current";

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
        tourCopy: { select: { status: true, groundingHash: true, promptVersion: true } },
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

    const firstAttempt = await this.generator.generate({
      runId: options.runId,
      tourId: tour.id,
      groundingHash,
      attempt: 1,
      systemPrompt: TOUR_COPY_SYSTEM_PROMPT,
      userMessage: buildTourCopyUserMessage(tour),
    });

    if (firstAttempt.kind === "refusal") {
      await this.saveRow(tour.id, {
        status: "failed",
        aiSummary: null,
        groundingHash,
        model: options.model,
        attempts: 1,
        failureReasons: ["refusal"],
        runId: options.runId,
      });
      return { kind: "generated", status: "failed" };
    }

    const firstCheck = checkTourCopy({ candidate: firstAttempt.text, source: tour });
    if (firstCheck.passed) {
      await this.saveRow(tour.id, {
        status: "published",
        aiSummary: firstAttempt.text,
        groundingHash,
        model: options.model,
        attempts: 1,
        failureReasons: [],
        runId: options.runId,
      });
      return { kind: "generated", status: "published" };
    }

    // AC-6: exactly one corrective retry, holding one fixed sentence per
    // failed reason code (in the check's closed-set order).
    const correctiveMessage = firstCheck.reasons.map((reason) => CORRECTIVE_SENTENCES[reason]).join(" ");
    const secondAttempt = await this.generator.generate({
      runId: options.runId,
      tourId: tour.id,
      groundingHash,
      attempt: 2,
      systemPrompt: TOUR_COPY_SYSTEM_PROMPT,
      userMessage: correctiveMessage,
    });

    if (secondAttempt.kind === "refusal") {
      // No check ran on a refusal, same as attempt 1 (AC-13): the reason the
      // row failed is the refusal itself, not whatever the first attempt's
      // check found.
      await this.saveRow(tour.id, {
        status: "failed",
        aiSummary: null,
        groundingHash,
        model: options.model,
        attempts: 2,
        failureReasons: ["refusal"],
        runId: options.runId,
      });
      return { kind: "generated", status: "failed" };
    }

    const secondCheck = checkTourCopy({ candidate: secondAttempt.text, source: tour });
    if (secondCheck.passed) {
      // AC-6: failureReasons keeps the first attempt's codes even though
      // this row ends up published.
      await this.saveRow(tour.id, {
        status: "published",
        aiSummary: secondAttempt.text,
        groundingHash,
        model: options.model,
        attempts: 2,
        failureReasons: firstCheck.reasons,
        runId: options.runId,
      });
      return { kind: "generated", status: "published" };
    }

    // No further retry regardless of outcome (AC-6): the retry's own check
    // result is what the failed row records — it's what's currently wrong.
    await this.saveRow(tour.id, {
      status: "failed",
      aiSummary: null,
      groundingHash,
      model: options.model,
      attempts: 2,
      failureReasons: secondCheck.reasons,
      runId: options.runId,
    });
    return { kind: "generated", status: "failed" };
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
