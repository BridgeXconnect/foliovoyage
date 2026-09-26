import type { TourCopyStatus } from "@prisma/client";

import type { PrismaService } from "../../prisma/prisma.service";
import { EVAL_MAX_BAD_RATE, EVAL_MIN_JUDGED } from "./tour-copy-eval.constants";
import type { JudgedClaim, PageVerdict } from "./tour-copy-judge";

/**
 * Counting of judge verdicts against the copy they judged (BRI-201 / spec
 * 0003, AC-9, AC-10, AC-11). A verdict only counts against the exact copy it
 * judged (`copyGeneratedAt` equals the row's current `generatedAt`) and only
 * at the current rubric version, so a regenerated paragraph or a bumped
 * rubric never inherits an old verdict.
 */

export interface PromptModelPair {
  promptVersion: number;
  model: string;
}

export interface PairStats {
  judged: number;
  bad: number;
  leadsWithFact: number;
}

export interface BadPage {
  tourId: string;
  claimVerdict: PageVerdict;
  claims: JudgedClaim[];
  text: string;
}

export type KillSwitchDecision = "withdraw" | "ok" | "insufficient";

/**
 * At least {@link EVAL_MIN_JUDGED} judged rows and more than
 * {@link EVAL_MAX_BAD_RATE} of them bad (AC-9). Pure. Compared as
 * `bad > judged * rate` so no floating point division decides a boundary
 * case (2 of 40 is exactly 5% and does not withdraw).
 */
export function decideKillSwitch(stats: Pick<PairStats, "judged" | "bad">): KillSwitchDecision {
  if (stats.judged < EVAL_MIN_JUDGED) return "insufficient";
  return stats.bad > stats.judged * EVAL_MAX_BAD_RATE ? "withdraw" : "ok";
}

/** Rows that have a judge verdict for their current copy at this rubric version. */
async function judgedRows(
  prisma: PrismaService,
  pair: PromptModelPair,
  statuses: TourCopyStatus[],
  rubricVersion: number,
) {
  const rows = await prisma.tourCopyEval.findMany({
    where: {
      evaluator: "judge",
      rubricVersion,
      tourCopy: { status: { in: statuses }, promptVersion: pair.promptVersion, model: pair.model },
    },
    select: {
      id: true,
      copyGeneratedAt: true,
      claimVerdict: true,
      leadsWithFact: true,
      tourCopy: { select: { tourId: true, generatedAt: true, aiSummary: true } },
    },
  });
  return rows.filter((row) => row.copyGeneratedAt.getTime() === row.tourCopy.generatedAt.getTime());
}

export async function getPairStats(
  prisma: PrismaService,
  pair: PromptModelPair,
  statuses: TourCopyStatus[],
  rubricVersion: number,
): Promise<PairStats> {
  const rows = await judgedRows(prisma, pair, statuses, rubricVersion);
  return {
    judged: rows.length,
    bad: rows.filter((row) => row.claimVerdict !== "clean").length,
    leadsWithFact: rows.filter((row) => row.leadsWithFact).length,
  };
}

/** Every bad judged page of the pair, with its claims and evidence, for the report (AC-9). */
export async function getBadPages(
  prisma: PrismaService,
  pair: PromptModelPair,
  statuses: TourCopyStatus[],
  rubricVersion: number,
): Promise<BadPage[]> {
  const bad = (await judgedRows(prisma, pair, statuses, rubricVersion)).filter((row) => row.claimVerdict !== "clean");
  if (bad.length === 0) return [];
  const withClaims = await prisma.tourCopyEval.findMany({
    where: { id: { in: bad.map((row) => row.id) } },
    select: { id: true, claims: true },
  });
  const claimsById = new Map(withClaims.map((row) => [row.id, row.claims as unknown as JudgedClaim[]]));
  return bad
    .map((row) => ({
      tourId: row.tourCopy.tourId,
      claimVerdict: row.claimVerdict,
      claims: (claimsById.get(row.id) ?? []).filter((claim) => claim.verdict !== "supported"),
      text: row.tourCopy.aiSummary ?? "",
    }))
    .sort((a, b) => a.tourId.localeCompare(b.tourId));
}
