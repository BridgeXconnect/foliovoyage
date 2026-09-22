import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";
import { evaluateTourCopyEligibility } from "./tour-copy-eligibility";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
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
  | "already_current";

export type TourCopyOutcome =
  | { kind: "skipped"; reason: TourCopySkipReason }
  | { kind: "generated"; status: "published" | "failed" };

export interface GenerateOneOptions {
  /** The CLI run this call belongs to; stored as `TourCopy.runId`. */
  runId: string;
  /** The model id to request and to store as `TourCopy.model` (AC-11). */
  model: string;
}

/**
 * Generates (or resumes) one tour's AI copy (BRI-154 / spec 0002).
 *
 * This is the tracer-bullet slice (build plan task 3): it applies the
 * selection rules from AC-1, the thin-source rule, computes the grounding
 * hash, and applies the AC-7 "already current" skip — then, for now, accepts
 * whatever the injected {@link TourCopyGenerator} returns as-is and stores it
 * `published`. There is no deterministic check yet (that is task 4) and no
 * corrective retry (task 7); both slot into the gap between "call the
 * generator" and "save the row" without changing this method's shape.
 *
 * The CLI's candidate query (task 8) is expected to have already filtered to
 * eligible, published, non-deleted, non-thin tours, but this method re-checks
 * all of it anyway — AC-18 requires "the pure gate is run again in code
 * before every call", so the DB query is never the only thing standing
 * between an ineligible tour and a wasted model call.
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
        tourCopy: { select: { status: true, groundingHash: true } },
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

    // AC-7's "published, matching hash" skip. The failed-row resume flags
    // (--retry-failed, --regenerate-older-than-version) land in task 7.
    if (tour.tourCopy?.status === "published" && tour.tourCopy.groundingHash === groundingHash) {
      return { kind: "skipped", reason: "already_current" };
    }

    const result = await this.generator.generate({
      runId: options.runId,
      tourId: tour.id,
      groundingHash,
      attempt: 1,
      // The prompt module (task 4) fills these in from the tour's grounding
      // fields; the thin thread proves the wiring with a fake generator that
      // doesn't need real prompt text.
      systemPrompt: "",
      userMessage: "",
    });

    if (result.kind === "refusal") {
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

    // Thin thread: no deterministic check yet (task 4) — accept the
    // generator's text as-is. Tasks 4/7 insert the check and the corrective
    // retry here, between the call and the save.
    await this.saveRow(tour.id, {
      status: "published",
      aiSummary: result.text,
      groundingHash,
      model: options.model,
      attempts: 1,
      failureReasons: [],
      runId: options.runId,
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
