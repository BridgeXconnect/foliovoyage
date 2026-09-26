import { randomInt, randomUUID } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";

import { envSchema } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import { AnthropicTourCopyJudge } from "./tour-copy-anthropic-judge";
import {
  DURATION_OPENING_WARN_SHARE,
  EVAL_CIRCUIT_BREAKER_THRESHOLD,
  LEADS_WITH_FACT_WARN_FLOOR,
  SPOTCHECK_SIZE,
} from "./tour-copy-eval.constants";
import {
  loadEvalInputs,
  planEvalSample,
  seededRandom,
  type EvalPlan,
  type PairFilter,
} from "./tour-copy-eval-sample";
import type { PromptModelPair } from "./tour-copy-eval-stats";
import {
  TourCopyEvalService,
  type JudgeOneOutcome,
  type JudgeSkipReason,
  type KillSwitchResult,
} from "./tour-copy-eval.service";
import type { TourCopyUsage } from "./tour-copy-generator";
import { checkTourCopyJudgeStartup, TourCopyJudgeStartupError } from "./tour-copy-judge-startup-check";
import { CHARS_PER_TOKEN } from "./tour-copy.constants";

/**
 * `tour-copy-eval:run` (BRI-201 / spec 0003, AC-7, AC-9, AC-11, AC-12, AC-19).
 * A thin driver: the startup check, the sample plan, the workers with their
 * circuit breaker, the kill switch, and the run summary. The rules for
 * judging one row and for withdrawing a pair live in `TourCopyEvalService`.
 *
 * Same `main(argv, env, io, deps)` shape as `tour-copy.cli.ts`, so the
 * startup check runs and can fail before anything builds a Prisma client.
 * Exit codes: 0 ok, 1 startup, argument or abort error, 2 a pair was
 * withdrawn.
 */

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface EvalServiceLike {
  readonly rubricVersion: number;
  judgeOne(tourId: string, options: { runId: string }): Promise<JudgeOneOutcome>;
  applyKillSwitch(pair: PromptModelPair, options: { runId: string; execute: boolean }): Promise<KillSwitchResult>;
}

/** Numbers the run summary needs that the kill switch count does not hold (AC-11). */
export interface PairExtras {
  /** Answered human rows (`g` or `b`) for the pair at the current rubric version. */
  humanChecked: number;
  /** Published rows of the pair with a non null `openingPattern`, and how many of them open on the duration. */
  openingsTotal: number;
  durationOpenings: number;
}

export interface EvalCliDeps {
  runId?: () => string;
  /** A fixed seed for the random top up; defaults to a fresh one per run, printed in the header. */
  seed?: number;
  /** Injectable for tests; defaults to the real, Prisma backed sample plan. */
  loadPlan?: (args: { filter: PairFilter; cap: number; seed: number; judgeModel: string; rubricVersion: number }) => Promise<EvalPlan>;
  /** Injectable for tests; defaults to a real {@link TourCopyEvalService}. */
  service?: EvalServiceLike;
  /** Injectable for tests; defaults to reading the human rows and the published openings. */
  pairExtras?: (pair: PromptModelPair, rubricVersion: number) => Promise<PairExtras>;
  disconnect?: () => Promise<void>;
}

interface ParsedArgs {
  execute: boolean;
  limit?: number;
  promptVersion?: number;
  model?: string;
}

const USAGE = "Usage: tour-copy-eval:run [--execute] [--limit N] [--prompt-version N] [--model M]";

function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  const parsed: ParsedArgs = { execute: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--execute") {
      parsed.execute = true;
      continue;
    }
    if (arg === "--limit" || arg === "--prompt-version") {
      const raw = argv[++i];
      const value = raw === undefined ? NaN : Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        return { error: `${arg} needs a positive integer, got ${raw ?? "(nothing)"}.\n${USAGE}` };
      }
      if (arg === "--limit") parsed.limit = value;
      else parsed.promptVersion = value;
      continue;
    }
    if (arg === "--model") {
      const raw = argv[++i];
      if (raw === undefined || raw.startsWith("--")) return { error: `--model needs a model id.\n${USAGE}` };
      parsed.model = raw;
      continue;
    }
    return { error: `Unknown argument "${arg}".\n${USAGE}` };
  }
  return parsed;
}

const configSchema = envSchema.pick({
  AI_GATEWAY_BASE_URL: true,
  AI_GATEWAY_TOKEN: true,
  TOUR_COPY_MODEL: true,
  TOUR_COPY_JUDGE_MODEL: true,
  TOUR_COPY_EVAL_MAX_JUDGMENTS: true,
  TOUR_COPY_EVAL_CONCURRENCY: true,
});

const pairLabel = (pair: PromptModelPair): string => `prompt version ${pair.promptVersion}, model ${pair.model}`;
const percent = (part: number, whole: number): string => (whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`);

export function formatCfAigHeaders(headers: Headers | undefined): string[] {
  if (!headers) return [];
  const lines: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith("cf-aig-")) lines.push(`  ${key}: ${value}`);
  });
  return lines;
}

function printBadPages(result: KillSwitchResult, io: CliIo): void {
  for (const page of result.badPages) {
    io.out(`    Tour ${page.tourId} (${page.claimVerdict}): ${page.text}`);
    for (const claim of page.claims) {
      io.out(`      - ${claim.verdict}: ${claim.text}${claim.evidenceQuote ? ` | evidence: "${claim.evidenceQuote}"` : ""}`);
    }
  }
}

function printPlan(plan: EvalPlan, io: CliIo): void {
  for (const pairPlan of plan.pairs) {
    if (pairPlan.sameModel) {
      io.out(`  pair ${pairLabel(pairPlan.pair)}: same_model, ${pairPlan.served} served rows skipped (the judge model wrote them)`);
      continue;
    }
    io.out(
      `  pair ${pairLabel(pairPlan.pair)}: served ${pairPlan.served}, already judged ${pairPlan.alreadyJudged}, ` +
        `stage 1 ${pairPlan.stage1.length}, top up ${pairPlan.topUp.length}`,
    );
    for (const city of pairPlan.cities) {
      io.out(`    city ${city.cityLabel}: served ${city.served}, judged ${city.judged}, would judge ${city.toJudge}`);
    }
  }
}

async function runDry(plan: EvalPlan, service: EvalServiceLike, runId: string, io: CliIo): Promise<number> {
  const estimatedTokens = plan.queue.reduce((sum, row) => sum + Math.ceil(row.promptChars / CHARS_PER_TOKEN), 0);
  io.out(`Dry run: would judge ${plan.queue.length} paragraph${plan.queue.length === 1 ? "" : "s"}.`);
  io.out(`  estimated input tokens: ~${estimatedTokens} (rough estimate, not a cost figure)`);
  if (plan.truncated) io.out("  the cap cut the sample short, raise --limit or TOUR_COPY_EVAL_MAX_JUDGMENTS to judge the rest");
  printPlan(plan, io);

  // AC-9: a dry run says what the kill switch would do on the verdicts already stored, and changes nothing.
  for (const pairPlan of plan.pairs.filter((p) => !p.sameModel)) {
    const result = await service.applyKillSwitch(pairPlan.pair, { runId, execute: false });
    if (result.decision === "withdraw") {
      io.out(
        `  would withdraw pair ${pairLabel(pairPlan.pair)}: ${result.stats.bad} of ${result.stats.judged} judged rows are bad`,
      );
      printBadPages(result, io);
    }
  }
  io.out("Add --execute to judge and write rows.");
  return 0;
}

interface Totals {
  judged: number;
  skipped: Map<JudgeSkipReason, number>;
  judgeInvalid: number;
  judgeRefusal: number;
  apiErrors: number;
  usage: TourCopyUsage;
}

function addUsage(total: TourCopyUsage, usage: TourCopyUsage): void {
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
  total.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  total.cacheReadInputTokens += usage.cacheReadInputTokens;
}

async function runExecute(
  plan: EvalPlan,
  service: EvalServiceLike,
  pairExtras: (pair: PromptModelPair) => Promise<PairExtras>,
  options: { runId: string; concurrency: number; judgeModel: string; generatorModel: string },
  io: CliIo,
): Promise<number> {
  const totals: Totals = {
    judged: 0,
    skipped: new Map(),
    judgeInvalid: 0,
    judgeRefusal: 0,
    apiErrors: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  };
  let next = 0;
  let consecutiveApiErrors = 0;
  let abortMessage: string | undefined;
  let abortDetailLines: string[] = [];
  const queue = plan.queue;

  async function worker(): Promise<void> {
    for (;;) {
      if (abortMessage !== undefined || next >= queue.length) return;
      const row = queue[next++]!;

      let outcome: JudgeOneOutcome;
      try {
        outcome = await service.judgeOne(row.tourId, { runId: options.runId });
      } catch (error) {
        // AC-12: a 429 that survived the SDK's retries stops the run at once.
        if (error instanceof Anthropic.RateLimitError) {
          abortMessage = `Aborted: gateway responded 429 (rate/spend limit) for Tour ${row.tourId}: ${error.message}`;
          abortDetailLines = [`  status: ${error.status}`, ...formatCfAigHeaders(error.headers)];
          return;
        }
        consecutiveApiErrors++;
        totals.apiErrors++;
        if (consecutiveApiErrors >= EVAL_CIRCUIT_BREAKER_THRESHOLD) {
          abortMessage = `Aborted after ${EVAL_CIRCUIT_BREAKER_THRESHOLD} consecutive API errors. Last error: ${
            error instanceof Error ? error.message : String(error)
          }`;
          return;
        }
        continue;
      }

      consecutiveApiErrors = 0;
      if (outcome.kind === "skipped") {
        totals.skipped.set(outcome.reason, (totals.skipped.get(outcome.reason) ?? 0) + 1);
        continue;
      }
      addUsage(totals.usage, outcome.usage);
      if (outcome.kind === "judged") totals.judged++;
      else if (outcome.kind === "judge_invalid") totals.judgeInvalid++;
      else totals.judgeRefusal++;
    }
  }

  await Promise.all(Array.from({ length: options.concurrency }, () => worker()));

  const sameModelRows =
    plan.pairs.filter((p) => p.sameModel).reduce((sum, p) => sum + p.served, 0) + (totals.skipped.get("same_model") ?? 0);
  const otherSkips = [...totals.skipped.entries()].filter(([reason]) => reason !== "same_model");

  io.out(`Run ${options.runId} summary:`);
  io.out(`  judge model: ${options.judgeModel}`);
  io.out(`  generator model: ${options.generatorModel}`);
  io.out(`  judged: ${totals.judged}`);
  io.out(`  skipped: ${otherSkips.reduce((sum, [, count]) => sum + count, 0)}`);
  otherSkips.forEach(([reason, count]) => io.out(`    ${reason}: ${count}`));
  io.out(`  same_model: ${sameModelRows}`);
  io.out(`  judge_invalid: ${totals.judgeInvalid}`);
  io.out(`  judge_refusal: ${totals.judgeRefusal}`);
  io.out(`  API errors: ${totals.apiErrors}`);
  io.out(
    `  tokens: input ${totals.usage.inputTokens}, output ${totals.usage.outputTokens}, ` +
      `cache write ${totals.usage.cacheCreationInputTokens}, cache read ${totals.usage.cacheReadInputTokens}`,
  );

  // AC-12: an aborted run keeps the verdicts already stored and never evaluates the kill switch.
  if (abortMessage !== undefined) {
    io.err(abortMessage);
    abortDetailLines.forEach(io.err);
    io.err("The kill switch was not evaluated for this run.");
    return 1;
  }

  let withdrew = false;
  const warnings: string[] = [];
  for (const pairPlan of plan.pairs) {
    const label = pairLabel(pairPlan.pair);
    if (pairPlan.sameModel) {
      io.out(`  pair ${label}: same_model, no decision (the judge wrote these rows)`);
      continue;
    }
    const result = await service.applyKillSwitch(pairPlan.pair, { runId: options.runId, execute: true });
    io.out(
      `  pair ${label}: judged ${result.stats.judged}, bad ${result.stats.bad} (${percent(result.stats.bad, result.stats.judged)}), ` +
        `leads with fact ${percent(result.stats.leadsWithFact, result.stats.judged)}`,
    );

    if (result.decision === "withdraw") {
      withdrew = true;
      io.out(
        `  KILL SWITCH: withdrew ${result.withdrawn} published rows of ${label}, ` +
          `${result.stats.bad} of ${result.stats.judged} judged rows are bad.`,
      );
      printBadPages(result, io);
    } else if (result.decision === "insufficient") {
      io.out(`  pair ${label}: only ${result.stats.judged} judged rows, below the minimum, no decision`);
    }

    if (result.stats.judged > 0 && result.stats.leadsWithFact / result.stats.judged < LEADS_WITH_FACT_WARN_FLOOR) {
      warnings.push(
        `WARNING: only ${percent(result.stats.leadsWithFact, result.stats.judged)} of judged pages for ${label} open on a fact, below ${LEADS_WITH_FACT_WARN_FLOOR * 100}%. This never withdraws anything, check the openings.`,
      );
    }
    const extras = await pairExtras(pairPlan.pair);
    if (extras.humanChecked < SPOTCHECK_SIZE) {
      warnings.push(
        `WARNING: no human spot check exists for ${label} (${extras.humanChecked} of ${SPOTCHECK_SIZE} answered). Run tour-copy-spotcheck:run before trusting the judge here.`,
      );
    }
    if (extras.openingsTotal > 0 && extras.durationOpenings / extras.openingsTotal > DURATION_OPENING_WARN_SHARE) {
      warnings.push(
        `WARNING: ${percent(extras.durationOpenings, extras.openingsTotal)} of published paragraphs for ${label} open on the duration, above ${DURATION_OPENING_WARN_SHARE * 100}%.`,
      );
    }
  }
  warnings.forEach(io.out);

  return withdrew ? 2 : 0;
}

export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: CliIo,
  deps: EvalCliDeps = {},
): Promise<number> {
  const parsedArgs = parseArgs(argv);
  if ("error" in parsedArgs) {
    io.err(parsedArgs.error);
    return 1;
  }

  const parsedEnv = configSchema.safeParse(env);
  if (!parsedEnv.success) {
    io.err("Invalid tour-copy eval configuration:");
    for (const issue of parsedEnv.error.issues) io.err(`  - ${issue.path.join(".")}: ${issue.message}`);
    return 1;
  }

  // AC-5 and AC-19: both model ids and the gateway variables, before any database access or model call.
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

  const needsPrisma = deps.loadPlan === undefined || deps.service === undefined || deps.pairExtras === undefined;
  const prisma = needsPrisma ? new PrismaService() : undefined;
  const disconnect = deps.disconnect ?? (prisma !== undefined ? () => prisma.$disconnect() : undefined);

  const service: EvalServiceLike = deps.service ?? new TourCopyEvalService(prisma!, new AnthropicTourCopyJudge(startup));
  const runId = (deps.runId ?? (() => randomUUID()))();
  const seed = deps.seed ?? randomInt(2 ** 31);
  const maxJudgments = parsedEnv.data.TOUR_COPY_EVAL_MAX_JUDGMENTS;
  const cap = parsedArgs.limit !== undefined ? Math.min(parsedArgs.limit, maxJudgments) : maxJudgments;
  const filter: PairFilter = { promptVersion: parsedArgs.promptVersion, model: parsedArgs.model };

  io.out(
    `tour-copy-eval run ${runId}: ${
      parsedArgs.execute ? "EXECUTE, this will call the judge and write rows" : "dry run, no model calls, no writes"
    }`,
  );
  io.out(`  judge model: ${startup.judgeModel}`);
  io.out(`  generator model: ${startup.generatorModel}`);
  io.out(
    `  cap: ${cap}${
      parsedArgs.limit !== undefined && parsedArgs.limit > maxJudgments
        ? ` (--limit ${parsedArgs.limit} exceeds TOUR_COPY_EVAL_MAX_JUDGMENTS=${maxJudgments}, clamped)`
        : ""
    }`,
  );
  io.out(`  random seed: ${seed}`);
  if (parsedArgs.promptVersion !== undefined) io.out(`  --prompt-version: ${parsedArgs.promptVersion}`);
  if (parsedArgs.model !== undefined) io.out(`  --model: ${parsedArgs.model}`);

  const loadPlan =
    deps.loadPlan ??
    (async (args: { filter: PairFilter; cap: number; seed: number; judgeModel: string; rubricVersion: number }) => {
      const inputs = await loadEvalInputs(prisma!, args.filter, args.rubricVersion);
      return planEvalSample(inputs.pairs, inputs.rows, {
        judgeModel: args.judgeModel,
        cap: args.cap,
        random: seededRandom(args.seed),
      });
    });
  const pairExtras =
    deps.pairExtras ??
    (async (pair: PromptModelPair, rubricVersion: number): Promise<PairExtras> => {
      const [humanChecked, openings] = await Promise.all([
        prisma!.tourCopyEval.count({
          where: { evaluator: "human", rubricVersion, tourCopy: { promptVersion: pair.promptVersion, model: pair.model } },
        }),
        prisma!.tourCopy.groupBy({
          by: ["openingPattern"],
          where: { status: "published", promptVersion: pair.promptVersion, model: pair.model, openingPattern: { not: null } },
          _count: { _all: true },
        }),
      ]);
      const openingsTotal = openings.reduce((sum, group) => sum + group._count._all, 0);
      const durationOpenings = openings.find((group) => group.openingPattern === "duration")?._count._all ?? 0;
      return { humanChecked, openingsTotal, durationOpenings };
    });

  try {
    const plan = await loadPlan({
      filter,
      cap,
      seed,
      judgeModel: startup.judgeModel,
      rubricVersion: service.rubricVersion,
    });

    if (!parsedArgs.execute) return await runDry(plan, service, runId, io);
    return await runExecute(
      plan,
      service,
      (pair) => pairExtras(pair, service.rubricVersion),
      {
        runId,
        concurrency: parsedEnv.data.TOUR_COPY_EVAL_CONCURRENCY,
        judgeModel: startup.judgeModel,
        generatorModel: startup.generatorModel,
      },
      io,
    );
  } finally {
    await disconnect?.();
  }
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
