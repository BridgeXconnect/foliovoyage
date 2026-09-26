import { GOLDEN_CLEAN_FLAG_MAX, GOLDEN_RECALL_MIN } from "./tour-copy-eval.constants";
import { decideKillSwitch } from "./tour-copy-eval-stats";
import type { GoldenData, GoldenSeeded, GoldenTour } from "./tour-copy-golden-data";
import { generateChecked } from "./tour-copy-generate-checked";
import type { TourCopyGenerator } from "./tour-copy-generator";
import { computeGroundingHash, type TourCopyGroundingInput } from "./tour-copy-grounding-hash";
import type { PageVerdict, TourCopyJudge } from "./tour-copy-judge";

/**
 * The golden run (BRI-201 / spec 0003, AC-15). Two parts, each one call at a
 * time, never in parallel, and writes nothing to the database.
 *
 * Part A tests the judge: it must flag the planted defects and leave the clean
 * pages alone. Part B tests the prompt: it generates copy for the 60 tours with
 * the current prompt and generator model, runs the inline check, judges what
 * passes, and applies the same bad rate limit as the kill switch.
 *
 * Any API error, and any judge call that ends as `judge_invalid` or
 * `judge_refusal`, stops the run at that call. A generator refusal is not an
 * error: it counts as a failed outcome in the inline check pass rate.
 */

export type GoldenPart = "a" | "b" | "both";

export type GoldenStop =
  | { reason: "api_error"; call: string; error: unknown }
  | { reason: "judge_invalid" | "judge_refusal"; call: string };

export interface PartAResult {
  defects: number;
  caught: number;
  recall: number;
  clean: number;
  flaggedClean: number;
  cleanFlagRate: number;
  passed: boolean;
  /** Seeded paragraphs where the judge's `leadsWithFact` matched the label. Report only. */
  leadsWithFactAgreement: { agreed: number; total: number };
  missedDefects: string[];
  flaggedCleanPages: string[];
}

export interface PartBResult {
  tours: number;
  published: number;
  failed: number;
  checkPassRate: number;
  /** How often each reason code came up, on either attempt. */
  reasonCounts: Record<string, number>;
  judged: number;
  bad: number;
  badRate: number;
  passed: boolean;
  leadsWithFactShare: number;
  durationOpeningShare: number;
  badTourIds: string[];
}

export interface GoldenProgress {
  partACalls: number;
  partBGenerated: number;
  partBJudged: number;
}

export type GoldenOutcome =
  | { kind: "completed"; partA?: PartAResult; partB?: PartBResult; partBSkipped: boolean; progress: GoldenProgress }
  | { kind: "stopped"; stop: GoldenStop; progress: GoldenProgress };

export interface GoldenRunDeps {
  judge: TourCopyJudge;
  generator: TourCopyGenerator;
  runId: string;
  /** Called after every finished call, for a progress line. */
  onProgress?: (line: string) => void;
}

/** Only the five source fields ever reach a model, never the reference paragraph or the stratum. */
export function sourceOf(tour: GoldenTour): TourCopyGroundingInput {
  return {
    title: tour.title,
    description: tour.description,
    durationMin: tour.durationMin,
    inclusions: tour.inclusions,
    exclusions: tour.exclusions,
  };
}

const isBad = (verdict: PageVerdict): boolean => verdict !== "clean";
const share = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

// Judge results shared by both parts: a verdict, or a reason to stop.
type Judged = { ok: true; claimVerdict: PageVerdict; leadsWithFact: boolean } | { ok: false; stop: GoldenStop };

async function judgeCall(deps: GoldenRunDeps, tour: GoldenTour, paragraph: string, call: string): Promise<Judged> {
  try {
    const result = await deps.judge.judge({
      contentType: "tour_copy",
      runId: deps.runId,
      tourId: tour.id,
      groundingHash: computeGroundingHash(sourceOf(tour)),
      source: sourceOf(tour),
      paragraph,
    });
    if (result.kind === "refusal") return { ok: false, stop: { reason: "judge_refusal", call } };
    if (result.kind === "invalid") return { ok: false, stop: { reason: "judge_invalid", call } };
    return { ok: true, claimVerdict: result.verdict.claimVerdict, leadsWithFact: result.verdict.leadsWithFact };
  } catch (error) {
    return { ok: false, stop: { reason: "api_error", call, error } };
  }
}

/** Part A pass rule (pure): recall at least the minimum, clean flag rate at most the maximum. */
export function scorePartA(input: {
  defects: number;
  caught: number;
  clean: number;
  flaggedClean: number;
}): Pick<PartAResult, "recall" | "cleanFlagRate" | "passed"> {
  const recall = share(input.caught, input.defects);
  const cleanFlagRate = share(input.flaggedClean, input.clean);
  // Compared as counts so no floating point division decides a boundary case (18 of 20 is exactly 90%).
  const passed = input.caught >= input.defects * GOLDEN_RECALL_MIN - 1e-9 && input.flaggedClean <= input.clean * GOLDEN_CLEAN_FLAG_MAX + 1e-9;
  return { recall, cleanFlagRate, passed };
}

export async function runPartA(
  data: GoldenData,
  deps: GoldenRunDeps,
  progress: GoldenProgress,
): Promise<{ result: PartAResult } | { stop: GoldenStop }> {
  const toursById = new Map(data.tours.map((tour) => [tour.id, tour]));
  const pages: Array<{ tour: GoldenTour; paragraph: string; label: string; expected: GoldenSeeded | null }> = [
    ...data.seeded.map((entry, index) => ({
      tour: toursById.get(entry.tourId) as GoldenTour,
      paragraph: entry.paragraph,
      label: `seeded paragraph ${index + 1} (tour ${entry.tourId})`,
      expected: entry,
    })),
    ...data.tours.map((tour, index) => ({
      tour,
      paragraph: tour.referenceParagraph,
      label: `reference paragraph ${index + 1} (tour ${tour.id})`,
      expected: null,
    })),
  ];

  let defects = 0;
  let caught = 0;
  let clean = 0;
  let flaggedClean = 0;
  let agreed = 0;
  let labelled = 0;
  const missedDefects: string[] = [];
  const flaggedCleanPages: string[] = [];

  for (const page of pages) {
    const judged = await judgeCall(deps, page.tour, page.paragraph, `Part A, ${page.label}`);
    progress.partACalls++;
    deps.onProgress?.(`  Part A ${progress.partACalls} of ${pages.length}`);
    if (!judged.ok) return { stop: judged.stop };

    const expectedBad = page.expected !== null && page.expected.claimVerdict !== "clean";
    if (expectedBad) {
      defects++;
      if (isBad(judged.claimVerdict)) caught++;
      else missedDefects.push(`${page.label}: ${page.expected!.defect}`);
    } else {
      clean++;
      if (isBad(judged.claimVerdict)) {
        flaggedClean++;
        flaggedCleanPages.push(page.label);
      }
    }
    if (page.expected !== null) {
      labelled++;
      if (judged.leadsWithFact === page.expected.leadsWithFact) agreed++;
    }
  }

  return {
    result: {
      defects,
      caught,
      clean,
      flaggedClean,
      ...scorePartA({ defects, caught, clean, flaggedClean }),
      leadsWithFactAgreement: { agreed, total: labelled },
      missedDefects,
      flaggedCleanPages,
    },
  };
}

export async function runPartB(
  data: GoldenData,
  deps: GoldenRunDeps,
  progress: GoldenProgress,
): Promise<{ result: PartBResult } | { stop: GoldenStop }> {
  let published = 0;
  let failed = 0;
  let judged = 0;
  let bad = 0;
  let leads = 0;
  let durationOpenings = 0;
  const reasonCounts: Record<string, number> = {};
  const badTourIds: string[] = [];

  for (const tour of data.tours) {
    const call = `Part B, tour ${tour.id}`;
    let generated;
    try {
      generated = await generateChecked(deps.generator, sourceOf(tour), {
        runId: deps.runId,
        tourId: tour.id,
        groundingHash: computeGroundingHash(sourceOf(tour)),
      });
    } catch (error) {
      return { stop: { reason: "api_error", call: `${call}, generation`, error } };
    }
    progress.partBGenerated++;
    for (const reason of generated.failureReasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;

    if (generated.status === "failed") {
      failed++;
      deps.onProgress?.(`  Part B ${progress.partBGenerated} of ${data.tours.length}`);
      continue;
    }
    published++;
    if (generated.openingPattern === "duration") durationOpenings++;

    const verdict = await judgeCall(deps, tour, generated.text, `${call}, judging`);
    progress.partBJudged++;
    deps.onProgress?.(`  Part B ${progress.partBGenerated} of ${data.tours.length}`);
    if (!verdict.ok) return { stop: verdict.stop };
    judged++;
    if (verdict.leadsWithFact) leads++;
    if (isBad(verdict.claimVerdict)) {
      bad++;
      badTourIds.push(tour.id);
    }
  }

  return {
    result: {
      tours: data.tours.length,
      published,
      failed,
      checkPassRate: share(published, data.tours.length),
      reasonCounts,
      judged,
      bad,
      badRate: share(bad, judged),
      // The same limit as the kill switch: enough judged pages, and not more than 5% bad.
      passed: decideKillSwitch({ judged, bad }) === "ok",
      leadsWithFactShare: share(leads, judged),
      durationOpeningShare: share(durationOpenings, published),
      badTourIds,
    },
  };
}

/** Runs the chosen part or parts. Part B only follows Part A in `both`, and only when Part A passed. */
export async function runGolden(part: GoldenPart, data: GoldenData, deps: GoldenRunDeps): Promise<GoldenOutcome> {
  const progress: GoldenProgress = { partACalls: 0, partBGenerated: 0, partBJudged: 0 };
  let partA: PartAResult | undefined;
  let partB: PartBResult | undefined;

  if (part !== "b") {
    const outcome = await runPartA(data, deps, progress);
    if ("stop" in outcome) return { kind: "stopped", stop: outcome.stop, progress };
    partA = outcome.result;
  }
  const partBSkipped = part === "both" && partA !== undefined && !partA.passed;
  if (part !== "a" && !partBSkipped) {
    const outcome = await runPartB(data, deps, progress);
    if ("stop" in outcome) return { kind: "stopped", stop: outcome.stop, progress };
    partB = outcome.result;
  }
  return { kind: "completed", partA, partB, partBSkipped, progress };
}
