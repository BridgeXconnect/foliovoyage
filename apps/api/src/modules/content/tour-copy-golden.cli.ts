import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import { envSchema } from "../../config/env.validation";
import { AnthropicTourCopyGenerator } from "./tour-copy-anthropic-generator";
import { AnthropicTourCopyJudge } from "./tour-copy-anthropic-judge";
import { TOUR_COPY_JUDGE_MODEL_DEFAULT } from "./tour-copy-eval.constants";
import { formatCfAigHeaders } from "./tour-copy-eval.cli";
import { generateChecked } from "./tour-copy-generate-checked";
import {
  computeGoldenStampKey,
  GoldenDataMissingError,
  GOLDEN_REFERENCES_DRAFT_FILE,
  GOLDEN_STAMP_FILE,
  GOLDEN_TOURS_FILE,
  loadGoldenData,
  readGoldenJson,
  validateSnapshotShape,
  type GoldenData,
  type GoldenStamp,
  type GoldenTourSource,
} from "./tour-copy-golden-data";
import {
  runGolden,
  sourceOf,
  type GoldenOutcome,
  type GoldenPart,
  type GoldenRunDeps,
  type GoldenStop,
  type PartAResult,
  type PartBResult,
} from "./tour-copy-golden";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
import type { TourCopyGenerator } from "./tour-copy-generator";
import type { TourCopyJudge } from "./tour-copy-judge";
import { formatAttempts, formatRetryStats } from "./tour-copy-judge-log";
import type { TourCopyStartupConfig } from "./tour-copy-startup-check";
import { checkTourCopyJudgeStartup, TourCopyJudgeStartupError } from "./tour-copy-judge-startup-check";
import { buildJudgeUserMessage, getJudgeRubric } from "./tour-copy-judge-rubric";
import { TOUR_COPY_MODEL_DEFAULT, TOUR_COPY_PROMPT_VERSION, CHARS_PER_TOKEN } from "./tour-copy.constants";

/**
 * `tour-copy-golden:run` (BRI-201 / spec 0003, AC-15, AC-16, AC-19). Grades the
 * judge (Part A) and the current prompt (Part B) against the golden set, one
 * call at a time, and writes nothing to the database. Only `--part both` with
 * both parts passing and both models at their defaults writes the stamp.
 *
 * `--freeze-references` is the other mode: it asks the generator for a draft
 * reference paragraph per golden tour and writes a draft file Roy merges by
 * hand into the tours file.
 *
 * Exit codes: 0 pass (or a finished ungated part), 1 anything else.
 */

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface GoldenCliDeps {
  runId?: () => string;
  now?: () => Date;
  judge?: TourCopyJudge;
  generator?: TourCopyGenerator;
  /** Reads and validates both golden files. Defaults to the committed files. */
  loadData?: () => GoldenData;
  /** Reads the raw tours file for `--freeze-references`. Defaults to the committed file. */
  loadTours?: () => unknown;
  writeFile?: (file: string, content: string) => void;
  fileExists?: (file: string) => boolean;
}

interface ParsedArgs {
  execute: boolean;
  part: GoldenPart;
  freezeReferences: boolean;
}

const USAGE = "Usage: tour-copy-golden:run [--execute] [--part a|b|both] [--freeze-references]";

function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  const parsed: ParsedArgs = { execute: false, part: "both", freezeReferences: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--execute") parsed.execute = true;
    else if (arg === "--freeze-references") parsed.freezeReferences = true;
    else if (arg === "--part") {
      const raw = argv[++i];
      if (raw !== "a" && raw !== "b" && raw !== "both") return { error: `--part needs a, b or both, got ${raw ?? "(nothing)"}.\n${USAGE}` };
      parsed.part = raw;
    } else return { error: `Unknown argument "${arg}".\n${USAGE}` };
  }
  if (parsed.freezeReferences && !parsed.execute) {
    return { error: `--freeze-references calls the generator, so it needs --execute.\n${USAGE}` };
  }
  return parsed;
}

const configSchema = envSchema.pick({
  AI_GATEWAY_BASE_URL: true,
  AI_GATEWAY_TOKEN: true,
  TOUR_COPY_MODEL: true,
  TOUR_COPY_JUDGE_MODEL: true,
});

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** The stamp is only ever written for a run on the default models (AC-16). Returns the refusal, or null. */
export function stampRefusal(generatorModel: string, judgeModel: string): string | null {
  if (generatorModel === TOUR_COPY_MODEL_DEFAULT && judgeModel === TOUR_COPY_JUDGE_MODEL_DEFAULT) return null;
  return (
    `The stamp only records a run on the default models (generator ${TOUR_COPY_MODEL_DEFAULT}, judge ${TOUR_COPY_JUDGE_MODEL_DEFAULT}). ` +
    `This run would use generator ${generatorModel} and judge ${judgeModel}. Unset TOUR_COPY_MODEL and TOUR_COPY_JUDGE_MODEL, or run with --part a or --part b for a diagnostic run.`
  );
}

function printPartA(a: PartAResult, io: CliIo): void {
  io.out(`Part A (the judge): ${a.passed ? "PASS" : "FAIL"}`);
  io.out(`  defects caught: ${a.caught} of ${a.defects} (${percent(a.recall)}, needs 90.0%)`);
  io.out(`  clean pages flagged: ${a.flaggedClean} of ${a.clean} (${percent(a.cleanFlagRate)}, allowed 2.0%)`);
  io.out(`  leadsWithFact agreement on the seeded paragraphs: ${a.leadsWithFactAgreement.agreed} of ${a.leadsWithFactAgreement.total} (report only)`);
  for (const missed of a.missedDefects) io.out(`  missed: ${missed}`);
  for (const page of a.flaggedCleanPages) io.out(`  wrongly flagged: ${page}`);
}

function printPartB(b: PartBResult, io: CliIo): void {
  io.out(`Part B (the prompt): ${b.passed ? "PASS" : "FAIL"}`);
  io.out(`  inline check pass rate: ${b.published} of ${b.tours} (${percent(b.checkPassRate)})`);
  const reasons = Object.entries(b.reasonCounts).sort(([x], [y]) => x.localeCompare(y));
  io.out(`  reason codes: ${reasons.length === 0 ? "none" : reasons.map(([code, count]) => `${code} ${count}`).join(", ")}`);
  io.out(`  judged: ${b.judged}, bad: ${b.bad} (${percent(b.badRate)}, allowed 5.0%, needs at least 30 judged)`);
  io.out(`  leadsWithFact share: ${percent(b.leadsWithFactShare)}`);
  io.out(`  duration openings: ${percent(b.durationOpeningShare)} of published`);
  for (const id of b.badTourIds) io.out(`  bad: tour ${id}`);
}

function printStop(stop: GoldenStop, outcome: Extract<GoldenOutcome, { kind: "stopped" }>, io: CliIo): void {
  io.err(`Stopped at ${stop.call}.`);
  if (stop.reason === "api_error") {
    const error = stop.error;
    io.err(`  API error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Anthropic.RateLimitError) {
      io.err(`  status: ${error.status}`);
      for (const line of formatCfAigHeaders(error.headers)) io.err(line);
    }
  } else {
    io.err(`  The judge answered ${stop.reason === "judge_invalid" ? "with an invalid verdict" : "with a refusal"}. The golden run does not carry on past that.`);
    if (stop.attempts !== undefined && stop.attempts.length > 0) io.err(`  judge attempts: ${formatAttempts(stop.attempts)}`);
  }
  io.err(
    `  Calls made so far: Part A ${outcome.progress.partACalls}, Part B generated ${outcome.progress.partBGenerated}, Part B judged ${outcome.progress.partBJudged}.`,
  );
  io.err(`  ${formatRetryStats(outcome.progress.judgeRetries)}`);
  io.err("  No pass rates are printed for a stopped run, and no stamp is written.");
}

function printDryRun(part: GoldenPart, data: GoldenData, io: CliIo): void {
  const defects = data.seeded.filter((s) => s.claimVerdict !== "clean").length;
  const cleanPages = data.seeded.length - defects + data.tours.length;
  const rubric = getJudgeRubric("tour_copy");
  const toursById = new Map(data.tours.map((tour) => [tour.id, tour]));
  const pages = [
    ...data.seeded.map((s) => buildJudgeUserMessage(sourceOf(toursById.get(s.tourId)!), s.paragraph)),
    ...data.tours.map((tour) => buildJudgeUserMessage(sourceOf(tour), tour.referenceParagraph)),
  ];
  const partAChars = pages.reduce((sum, page) => sum + page.length + rubric.systemPrompt.length, 0);
  io.out(`Golden set: ${data.tours.length} tours, ${data.seeded.length} seeded paragraphs (${defects} defects, ${data.seeded.length - defects} clean controls).`);
  if (part !== "b") {
    io.out(`  Part A: ${defects + cleanPages} judge calls (${defects} defects, ${cleanPages} clean pages)`);
    io.out(`  estimated Part A input tokens: ~${Math.ceil(partAChars / CHARS_PER_TOKEN)} (rough estimate, not a cost figure)`);
  }
  if (part !== "a") {
    io.out(`  Part B: ${data.tours.length} generations (up to ${data.tours.length * 2} calls with the corrective retry), then up to ${data.tours.length} judge calls`);
  }
  io.out("Dry run: no model calls were made. Add --execute to run.");
}

const defaultWrite = (file: string, content: string): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
};

async function freezeReferences(
  generator: TourCopyGenerator,
  runId: string,
  deps: GoldenCliDeps,
  io: CliIo,
): Promise<number> {
  const exists = deps.fileExists ?? existsSync;
  if (exists(GOLDEN_REFERENCES_DRAFT_FILE)) {
    io.err(`${GOLDEN_REFERENCES_DRAFT_FILE} already exists. Merge it into the tours file or delete it first, this command will not overwrite it.`);
    return 1;
  }
  let raw: unknown;
  try {
    raw = (deps.loadTours ?? (() => readGoldenJson(GOLDEN_TOURS_FILE)))();
  } catch (error) {
    if (error instanceof GoldenDataMissingError) {
      io.err(`${error.message}. Run tour-copy-golden:snapshot --execute first.`);
      return 1;
    }
    throw error;
  }
  const problems = validateSnapshotShape(raw);
  if (problems.length > 0) {
    io.err(`The tours file is not valid:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    return 1;
  }

  const tours = raw as GoldenTourSource[];
  const draft: Array<GoldenTourSource & { referenceParagraph: string | null }> = [];
  const failed: string[] = [];
  for (const tour of tours) {
    const source = sourceOf({ ...tour, referenceParagraph: "" });
    try {
      const result = await generateChecked(generator, source, { runId, tourId: tour.id, groundingHash: computeGroundingHash(source) });
      if (result.status === "published") draft.push({ ...tour, referenceParagraph: result.text });
      else {
        failed.push(`${tour.id} (${result.failureReasons.join(", ")})`);
        draft.push({ ...tour, referenceParagraph: null });
      }
    } catch (error) {
      io.err(`Stopped at tour ${tour.id}: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Anthropic.RateLimitError) {
        io.err(`  status: ${error.status}`);
        for (const line of formatCfAigHeaders(error.headers)) io.err(line);
      }
      io.err("No draft file was written.");
      return 1;
    }
  }
  (deps.writeFile ?? defaultWrite)(GOLDEN_REFERENCES_DRAFT_FILE, `${JSON.stringify(draft, null, 2)}\n`);
  io.out(`Wrote draft reference paragraphs for ${draft.length - failed.length} of ${draft.length} tours to ${GOLDEN_REFERENCES_DRAFT_FILE}.`);
  if (failed.length > 0) io.out(`  No draft for: ${failed.join("; ")}. Write those by hand.`);
  io.out("Review every draft, then merge the paragraphs into the tours file by hand. Nothing here is a reviewed reference until you say so.");
  return 0;
}

export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: CliIo,
  deps: GoldenCliDeps = {},
): Promise<number> {
  const args = parseArgs(argv);
  if ("error" in args) {
    io.err(args.error);
    return 1;
  }

  const parsedEnv = configSchema.safeParse(env);
  if (!parsedEnv.success) {
    io.err("Invalid tour-copy golden configuration:");
    for (const issue of parsedEnv.error.issues) io.err(`  - ${issue.path.join(".")}: ${issue.message}`);
    return 1;
  }

  // AC-19: the gateway variables and both model ids, before anything else, and this run never opens the database.
  let startup;
  try {
    startup = checkTourCopyJudgeStartup(parsedEnv.data);
  } catch (error) {
    if (error instanceof TourCopyJudgeStartupError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }

  const runId = (deps.runId ?? (() => randomUUID()))();
  const generator = deps.generator ?? new AnthropicTourCopyGenerator({ gatewayBaseUrl: startup.gatewayBaseUrl, gatewayToken: startup.gatewayToken, model: startup.generatorModel as TourCopyStartupConfig["model"] });

  io.out(`tour-copy-golden run ${runId}: ${args.execute ? "EXECUTE, this will call the models" : "dry run, no model calls"}`);
  io.out(`  generator model: ${startup.generatorModel}`);
  io.out(`  judge model: ${startup.judgeModel}`);

  if (args.freezeReferences) return freezeReferences(generator, runId, deps, io);

  if (args.execute && args.part === "both") {
    const refusal = stampRefusal(startup.generatorModel, startup.judgeModel);
    if (refusal !== null) {
      io.err(refusal);
      return 1;
    }
  }

  let data: GoldenData;
  try {
    data = (deps.loadData ?? loadGoldenData)();
  } catch (error) {
    if (error instanceof GoldenDataMissingError) {
      io.err(`${error.message}. Run tour-copy-golden:snapshot --execute, then write the references and seeded paragraphs (spec 0003, Build plan task 13).`);
      return 1;
    }
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (!args.execute) {
    printDryRun(args.part, data, io);
    return 0;
  }

  const judge = deps.judge ?? new AnthropicTourCopyJudge(startup);
  const runDeps: GoldenRunDeps = { judge, generator, runId, onProgress: (line) => io.out(line) };
  const outcome = await runGolden(args.part, data, runDeps);

  if (outcome.kind === "stopped") {
    printStop(outcome.stop, outcome, io);
    return 1;
  }

  if (outcome.partA) printPartA(outcome.partA, io);
  if (outcome.partBSkipped) io.out("Part B was not run because Part A did not pass.");
  if (outcome.partB) printPartB(outcome.partB, io);
  io.out(`  judge_invalid: 0 (a run stops on the first one)`);
  io.out(`  ${formatRetryStats(outcome.progress.judgeRetries)}`);

  const passed = (outcome.partA?.passed ?? true) && (outcome.partB?.passed ?? true) && !outcome.partBSkipped;
  if (args.part === "b") {
    io.out("Part B alone is a diagnostic run, ungated by Part A. It never writes the stamp.");
    return passed ? 0 : 1;
  }
  if (args.part === "a") {
    io.out("Part A alone never writes the stamp. Run --part both for that.");
    return passed ? 0 : 1;
  }
  if (!passed) {
    io.out("The golden run did not pass, so no stamp was written.");
    return 1;
  }

  const stamp: GoldenStamp = {
    key: computeGoldenStampKey(data),
    passed: true,
    runId,
    date: (deps.now ?? (() => new Date()))().toISOString(),
    generatorModel: startup.generatorModel,
    judgeModel: startup.judgeModel,
    rubricVersion: getJudgeRubric("tour_copy").version,
    promptVersion: TOUR_COPY_PROMPT_VERSION,
    partA: { ...outcome.partA! },
    partB: { ...outcome.partB! },
  };
  (deps.writeFile ?? defaultWrite)(GOLDEN_STAMP_FILE, `${JSON.stringify(stamp, null, 2)}\n`);
  io.out(`Wrote the stamp to ${GOLDEN_STAMP_FILE}. Commit it with the golden files.`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2), process.env, {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
