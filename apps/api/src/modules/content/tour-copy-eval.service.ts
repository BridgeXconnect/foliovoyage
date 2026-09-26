import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { getBadPages, getPairStats, decideKillSwitch, type BadPage, type KillSwitchDecision, type PairStats, type PromptModelPair } from "./tour-copy-eval-stats";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
import type { TourCopyUsage } from "./tour-copy-generator";
import {
  TOUR_COPY_JUDGE,
  type JudgeAttempt,
  type JudgeContentType,
  type JudgedClaim,
  type PageVerdict,
  type TourCopyJudge,
} from "./tour-copy-judge";
import { getJudgeRubric } from "./tour-copy-judge-rubric";
import { isServedCopy } from "./tour-copy-served";

/**
 * Judges one published tour paragraph and applies the kill switch (BRI-201 /
 * spec 0003). Only ever writes `TourCopyEval` rows and the `status`,
 * `withdrawnAt` and `withdrawnByRunId` fields of `TourCopy` (AC-18); it never
 * calls the generator and never writes `aiSummary`.
 */

const CONTENT_TYPE: JudgeContentType = "tour_copy";

export type JudgeSkipReason =
  | "not_found"
  /** Not currently served: not published, hash moved on, tour deleted, Experience not published, or no longer eligible (AC-7). */
  | "not_served"
  /** The row's stored model is the judge model, so the judge would grade its own output (AC-7). */
  | "same_model"
  | "already_judged"
  /** A concurrent run stored the same verdict first (AC-8). */
  | "duplicate";

export type JudgeOneOutcome =
  | {
      kind: "judged";
      claimVerdict: PageVerdict;
      leadsWithFact: boolean;
      usage: TourCopyUsage;
      /** For the run log only, the same claims that are stored on the row. */
      claims?: JudgedClaim[];
      attempts?: JudgeAttempt[];
    }
  | { kind: "skipped"; reason: JudgeSkipReason }
  | { kind: "judge_invalid"; usage: TourCopyUsage; attempts?: JudgeAttempt[] }
  | { kind: "judge_refusal"; usage: TourCopyUsage; attempts?: JudgeAttempt[] };

export interface KillSwitchResult {
  pair: PromptModelPair;
  stats: PairStats;
  decision: KillSwitchDecision;
  /** Published rows moved to `withdrawn`. Zero unless the decision was `withdraw` and this was not a dry run. */
  withdrawn: number;
  badPages: BadPage[];
}

@Injectable()
export class TourCopyEvalService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TOUR_COPY_JUDGE) private readonly judge: TourCopyJudge,
  ) {}

  /** The current rubric version for tour copy, the version every verdict here is stored and counted at. */
  get rubricVersion(): number {
    return getJudgeRubric(CONTENT_TYPE).version;
  }

  async judgeOne(tourId: string, options: { runId: string }): Promise<JudgeOneOutcome> {
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
        tourCopy: {
          select: { id: true, status: true, aiSummary: true, groundingHash: true, promptVersion: true, model: true, generatedAt: true },
        },
      },
    });
    const copy = tour?.tourCopy;
    if (!tour || !copy) return { kind: "skipped", reason: "not_found" };

    // AC-7: only copy that is currently served, re-checked here so the
    // selection query is never the only thing between a stale row and a call.
    if (!isServedCopy(tour, copy)) return { kind: "skipped", reason: "not_served" };
    const groundingHash = computeGroundingHash(tour);

    if (copy.model === this.judge.model) return { kind: "skipped", reason: "same_model" };

    const rubricVersion = this.rubricVersion;
    const existing = await this.prisma.tourCopyEval.findFirst({
      where: { tourCopyId: copy.id, copyGeneratedAt: copy.generatedAt, evaluator: "judge", rubricVersion },
      select: { id: true },
    });
    if (existing) return { kind: "skipped", reason: "already_judged" };

    const result = await this.judge.judge({
      contentType: CONTENT_TYPE,
      runId: options.runId,
      tourId: tour.id,
      groundingHash,
      source: tour,
      paragraph: copy.aiSummary as string,
    });
    if (result.kind === "refusal") return { kind: "judge_refusal", usage: result.usage, attempts: result.attempts };
    if (result.kind === "invalid") return { kind: "judge_invalid", usage: result.usage, attempts: result.attempts };

    const { verdict } = result;
    try {
      await this.prisma.tourCopyEval.create({
        data: {
          tourCopyId: copy.id,
          copyGeneratedAt: copy.generatedAt,
          judgedText: copy.aiSummary as string,
          promptVersion: copy.promptVersion,
          model: copy.model,
          groundingHash: copy.groundingHash,
          evaluator: "judge",
          evaluatorModel: this.judge.model,
          rubricVersion,
          claims: verdict.claims as unknown as Prisma.InputJsonValue,
          claimVerdict: verdict.claimVerdict,
          leadsWithFact: verdict.leadsWithFact,
          evalRunId: options.runId,
        },
      });
    } catch (error) {
      // AC-8: a concurrent run stored the same verdict first. Not a failure.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { kind: "skipped", reason: "duplicate" };
      }
      throw error;
    }

    return {
      kind: "judged",
      claimVerdict: verdict.claimVerdict,
      leadsWithFact: verdict.leadsWithFact,
      usage: result.usage,
      claims: verdict.claims,
      attempts: result.attempts,
    };
  }

  /**
   * AC-9: count the pair's published rows that have a judge verdict for their
   * current copy at the current rubric version. At least 30 judged rows and
   * more than 5% bad withdraws every published row of the pair, judged or
   * not, in one `updateMany`. A dry run decides but changes nothing.
   */
  async applyKillSwitch(
    pair: PromptModelPair,
    options: { runId: string; execute: boolean },
  ): Promise<KillSwitchResult> {
    const stats = await getPairStats(this.prisma, pair, ["published"], this.rubricVersion);
    const decision = decideKillSwitch(stats);
    const badPages = decision === "withdraw" ? await getBadPages(this.prisma, pair, ["published"], this.rubricVersion) : [];

    let withdrawn = 0;
    if (decision === "withdraw" && options.execute) {
      const result = await this.prisma.tourCopy.updateMany({
        where: { status: "published", promptVersion: pair.promptVersion, model: pair.model },
        data: { status: "withdrawn", withdrawnAt: new Date(), withdrawnByRunId: options.runId },
      });
      withdrawn = result.count;
    }
    return { pair, stats, decision, withdrawn, badPages };
  }
}
