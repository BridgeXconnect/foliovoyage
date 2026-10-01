import { randomUUID } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";

import { envSchema } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import { setDbRetryProfile } from "../../prisma/transient-retry";
import { evaluateTourCopyEligibility, MIN_RATING, MIN_REVIEW_COUNT } from "./tour-copy-eligibility";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
import { buildTourCopyUserMessage, TOUR_COPY_SYSTEM_PROMPT } from "./tour-copy-prompt";
import { summarizePublishedCopy, type PublishedCopyStats } from "./tour-copy-run-summary";
import { combinedSourceTextLength, MIN_SOURCE_CHARS } from "./tour-copy-source-text";
import { checkTourCopyStartup, TourCopyStartupError } from "./tour-copy-startup-check";
import { AnthropicTourCopyGenerator } from "./tour-copy-anthropic-generator";
import { CHARS_PER_TOKEN, TOUR_COPY_PROMPT_VERSION } from "./tour-copy.constants";
import { TourCopyService, type GenerateOneOptions, type TourCopyOutcome, type TourCopySkipReason } from "./tour-copy.service";

/**
 * `tour-copy:run` — the build-plan task 8 CLI. A thin driver around task 5's
 * startup check and task 7's {@link TourCopyService}: it owns candidate
 * selection, run limits, concurrency, the API-error circuit breaker, and
 * output — not the generation rules themselves (AC-8, AC-9, AC-14, AC-15,
 * AC-17, AC-18, AC-19).
 *
 * Structured like `research.cli.ts` (build plan precedent), not
 * `promote-experience.cli.ts`'s Nest-bootstrap style: a plain
 * `main(argv, env, io, deps)` function so the startup check (AC-19) can run
 * and fail fast before anything constructs a Prisma client.
 */

const CIRCUIT_BREAKER_THRESHOLD = 5;

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface CandidateTour {
  id: string;
  title: string;
  description: string | null;
  durationMin: number | null;
  inclusions: unknown;
  exclusions: unknown;
  ratingAvg: number | null;
  ratingCount: number | null;
  deletedAt: Date | null;
  experience: { status: string } | null;
  tourCopy: { status: string; groundingHash: string; promptVersion: number; model: string } | null;
}

export interface TourCopyServiceLike {
  generateOne(tourId: string, options: GenerateOneOptions): Promise<TourCopyOutcome>;
}

export interface CliDeps {
  runId?: () => string;
  /** Injectable for tests; defaults to a real, Prisma-cursor-paginated query. */
  candidates?: () => AsyncIterable<CandidateTour>;
  /** Injectable for tests; defaults to a real {@link TourCopyService}. */
  service?: TourCopyServiceLike;
  /**
   * Injectable for tests; defaults to a real count of `withdrawn` rows at the
   * pair (spec 0003 AC-2). Only the pair this run is itself running.
   */
  withdrawnCount?: (pair: { promptVersion: number; model: string }) => Promise<number>;
  /**
   * Injectable for tests; defaults to reading the published rows this run
   * stored, for the voice counter and opening pattern lines (spec 0003 AC-4).
   */
  publishedRows?: (runId: string) => Promise<PublishedCopyStats[]>;
  disconnect?: () => Promise<void>;
}

interface ParsedArgs {
  execute: boolean;
  retryFailed: boolean;
  limit?: number;
  regenerateOlderThanVersion?: number;
}

const USAGE =
  "Usage: tour-copy:run [--execute] [--limit N] [--retry-failed] [--regenerate-older-than-version N]";

function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  let execute = false;
  let retryFailed = false;
  let limit: number | undefined;
  let regenerateOlderThanVersion: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--execute") {
      execute = true;
      continue;
    }
    if (arg === "--retry-failed") {
      retryFailed = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[++i];
      const parsed = raw === undefined ? NaN : Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { error: `--limit needs a positive integer, got ${raw ?? "(nothing)"}.\n${USAGE}` };
      }
      limit = parsed;
      continue;
    }
    if (arg === "--regenerate-older-than-version") {
      const raw = argv[++i];
      const parsed = raw === undefined ? NaN : Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return {
          error: `--regenerate-older-than-version needs an integer >= 1, got ${raw ?? "(nothing)"}.\n${USAGE}`,
        };
      }
      regenerateOlderThanVersion = parsed;
      continue;
    }
    return { error: `Unknown argument "${arg}".\n${USAGE}` };
  }

  return { execute, retryFailed, limit, regenerateOlderThanVersion };
}

const configSchema = envSchema.pick({
  AI_GATEWAY_BASE_URL: true,
  AI_GATEWAY_TOKEN: true,
  TOUR_COPY_MODEL: true,
  TOUR_COPY_MAX_TOURS: true,
  TOUR_COPY_CONCURRENCY: true,
});

/**
 * Mirrors {@link TourCopyService.generateOne}'s pre-generation skip rules
 * (deleted / not published / ineligible / thin source / AC-7 hash rules) so
 * a dry run can classify candidates without ever calling the generator. Kept
 * in sync with the service by hand — the service has no dry-run mode to
 * delegate to, and the two are tested against the same fixtures to guard
 * against drift (see the CLI's spec file).
 */
type Classification =
  | { kind: "skip"; reason: TourCopySkipReason }
  | { kind: "would_generate"; userMessage: string };

function classifyCandidate(
  tour: CandidateTour,
  options: { retryFailed: boolean; regenerateOlderThanVersion?: number; model: string },
): Classification {
  if (tour.deletedAt !== null) return { kind: "skip", reason: "deleted" };
  if (tour.experience?.status !== "published") {
    return { kind: "skip", reason: "experience_not_published" };
  }
  const eligibility = evaluateTourCopyEligibility({
    ratingAvg: tour.ratingAvg,
    ratingCount: tour.ratingCount,
  });
  if (!eligibility.eligible) return { kind: "skip", reason: "not_eligible" };
  if (combinedSourceTextLength(tour) < MIN_SOURCE_CHARS) {
    return { kind: "skip", reason: "source_too_thin" };
  }

  const groundingHash = computeGroundingHash(tour);

  if (tour.tourCopy) {
    const hashMatches = tour.tourCopy.groundingHash === groundingHash;

    // Same rule as the service (spec 0003 AC-2), so dry run counts match.
    if (
      tour.tourCopy.status === "withdrawn" &&
      tour.tourCopy.promptVersion === TOUR_COPY_PROMPT_VERSION &&
      tour.tourCopy.model === options.model
    ) {
      return { kind: "skip", reason: "withdrawn_current" };
    }

    if (tour.tourCopy.status === "published" && hashMatches) {
      const stalePromptVersion =
        options.regenerateOlderThanVersion !== undefined &&
        tour.tourCopy.promptVersion < options.regenerateOlderThanVersion;
      if (!stalePromptVersion) return { kind: "skip", reason: "already_current" };
    }

    if (tour.tourCopy.status === "failed") {
      const promptVersionCurrent = tour.tourCopy.promptVersion === TOUR_COPY_PROMPT_VERSION;
      if (hashMatches && promptVersionCurrent && !options.retryFailed) {
        return { kind: "skip", reason: "failed_current" };
      }
    }
  }

  return { kind: "would_generate", userMessage: buildTourCopyUserMessage(tour) };
}

async function* iterateCandidates(prisma: PrismaService): AsyncIterable<CandidateTour> {
  const PAGE_SIZE = 500;
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.tour.findMany({
      where: {
        deletedAt: null,
        experience: { status: "published" },
        ratingAvg: { gte: MIN_RATING },
        ratingCount: { gte: MIN_REVIEW_COUNT },
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
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
    if (page.length === 0) return;
    for (const row of page) yield row;
    cursor = page[page.length - 1]!.id;
  }
}

function formatSkipCounts(skipCounts: Map<TourCopySkipReason, number>): string[] {
  return [...skipCounts.entries()].map(([reason, count]) => `    ${reason}: ${count}`);
}

async function runDryRun(
  candidates: AsyncIterable<CandidateTour>,
  options: { limit: number; retryFailed: boolean; regenerateOlderThanVersion?: number; model: string },
  io: CliIo,
): Promise<number> {
  let wouldGenerate = 0;
  let estimatedTokens = 0;
  const skipCounts = new Map<TourCopySkipReason, number>();
  let lastTourId: string | undefined;

  for await (const tour of candidates) {
    if (wouldGenerate >= options.limit) break;
    lastTourId = tour.id;
    const classification = classifyCandidate(tour, options);
    if (classification.kind === "skip") {
      skipCounts.set(classification.reason, (skipCounts.get(classification.reason) ?? 0) + 1);
      continue;
    }
    wouldGenerate++;
    estimatedTokens += Math.ceil(
      (TOUR_COPY_SYSTEM_PROMPT.length + classification.userMessage.length) / CHARS_PER_TOKEN,
    );
  }

  io.out(`Dry run: would generate ${wouldGenerate} tour${wouldGenerate === 1 ? "" : "s"}.`);
  io.out(`  estimated tokens: ~${estimatedTokens} (rough estimate, not a cost figure)`);
  const totalSkipped = [...skipCounts.values()].reduce((a, b) => a + b, 0);
  io.out(`  skipped: ${totalSkipped}`);
  formatSkipCounts(skipCounts).forEach(io.out);
  if (lastTourId !== undefined) io.out(`  last Tour.id reached: ${lastTourId}`);
  io.out("Add --execute to generate and write rows.");
  return 0;
}

interface ExecuteOptions {
  limit: number;
  concurrency: number;
  runId: string;
  model: string;
  retryFailed: boolean;
  regenerateOlderThanVersion?: number;
  publishedRows: (runId: string) => Promise<PublishedCopyStats[]>;
}

function formatCfAigHeaders(headers: Headers | undefined): string[] {
  if (!headers) return [];
  const lines: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith("cf-aig-")) lines.push(`  ${key}: ${value}`);
  });
  return lines;
}

async function runExecute(
  candidates: AsyncIterable<CandidateTour>,
  service: TourCopyServiceLike,
  options: ExecuteOptions,
  io: CliIo,
): Promise<number> {
  const iterator = candidates[Symbol.asyncIterator]();
  let reserved = 0;
  let published = 0;
  let failed = 0;
  const skipCounts = new Map<TourCopySkipReason, number>();
  let consecutiveApiErrors = 0;
  let apiErrorCount = 0;
  let lastTourId: string | undefined;
  let abortMessage: string | undefined;
  let abortDetailLines: string[] = [];

  async function worker(): Promise<void> {
    for (;;) {
      if (abortMessage !== undefined) return;
      if (reserved >= options.limit) return;
      reserved++;

      const next = await iterator.next();
      if (next.done) {
        reserved--;
        return;
      }
      const tour = next.value;
      lastTourId = tour.id;

      const generateOptions: GenerateOneOptions = {
        runId: options.runId,
        model: options.model,
        retryFailed: options.retryFailed,
        ...(options.regenerateOlderThanVersion !== undefined
          ? { regenerateOlderThanVersion: options.regenerateOlderThanVersion }
          : {}),
      };

      let outcome: TourCopyOutcome;
      try {
        outcome = await service.generateOne(tour.id, generateOptions);
      } catch (error) {
        reserved--;
        if (error instanceof Anthropic.RateLimitError) {
          abortMessage = `Aborted: gateway responded 429 (rate/spend limit) for Tour ${tour.id}: ${error.message}`;
          abortDetailLines = formatCfAigHeaders(error.headers);
          return;
        }
        consecutiveApiErrors++;
        apiErrorCount++;
        if (consecutiveApiErrors >= CIRCUIT_BREAKER_THRESHOLD) {
          abortMessage = `Aborted after ${CIRCUIT_BREAKER_THRESHOLD} consecutive API errors. Last error: ${
            error instanceof Error ? error.message : String(error)
          }`;
          return;
        }
        continue;
      }

      consecutiveApiErrors = 0;
      if (outcome.kind === "skipped") {
        reserved--;
        skipCounts.set(outcome.reason, (skipCounts.get(outcome.reason) ?? 0) + 1);
      } else if (outcome.status === "published") {
        published++;
      } else {
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: options.concurrency }, () => worker()));

  io.out(`Run ${options.runId} summary:`);
  io.out(`  published: ${published}`);
  io.out(`  failed: ${failed}`);
  const totalSkipped = [...skipCounts.values()].reduce((a, b) => a + b, 0);
  io.out(`  skipped: ${totalSkipped}`);
  formatSkipCounts(skipCounts).forEach(io.out);
  if (apiErrorCount > 0) io.out(`  API errors: ${apiErrorCount}`);
  if (lastTourId !== undefined) io.out(`  last Tour.id reached: ${lastTourId}`);
  if (published > 0) summarizePublishedCopy(await options.publishedRows(options.runId)).forEach(io.out);

  if (abortMessage !== undefined) {
    io.err(abortMessage);
    abortDetailLines.forEach(io.err);
    return 1;
  }
  return 0;
}

export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: CliIo,
  deps: CliDeps = {},
): Promise<number> {
  const parsedArgs = parseArgs(argv);
  if ("error" in parsedArgs) {
    io.err(parsedArgs.error);
    return 2;
  }

  const parsedEnv = configSchema.safeParse(env);
  if (!parsedEnv.success) {
    io.err("Invalid tour-copy configuration:");
    for (const issue of parsedEnv.error.issues) {
      io.err(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    return 1;
  }

  let startupConfig;
  try {
    startupConfig = checkTourCopyStartup(parsedEnv.data);
  } catch (error) {
    if (error instanceof TourCopyStartupError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }

  const needsPrisma =
    deps.candidates === undefined ||
    deps.service === undefined ||
    deps.withdrawnCount === undefined ||
    deps.publishedRows === undefined;
  const prisma = needsPrisma ? new PrismaService() : undefined;
  const disconnect = deps.disconnect ?? (prisma !== undefined ? () => prisma.$disconnect() : undefined);

  // Spec 0003 AC-2: refuse to run at a pair with withdrawn rows, in dry run
  // and --execute alike, before any model call. Looks only at this run's own
  // pair, never at another withdrawn pair.
  const pair = { promptVersion: TOUR_COPY_PROMPT_VERSION, model: startupConfig.model };
  const withdrawnCount =
    deps.withdrawnCount ??
    ((p: { promptVersion: number; model: string }) =>
      prisma!.tourCopy.count({ where: { status: "withdrawn", ...p } }));
  try {
    const withdrawn = await withdrawnCount(pair);
    if (withdrawn > 0) {
      io.err(
        `Refusing to run: ${withdrawn} withdrawn row${withdrawn === 1 ? "" : "s"} at prompt version ${pair.promptVersion} and model ${pair.model}. ` +
          "Restore the pair with tour-copy-withdraw:run --restore, or change the prompt version or the model.",
      );
      await disconnect?.();
      return 1;
    }
  } catch (error) {
    await disconnect?.();
    throw error;
  }

  const maxTours = parsedEnv.data.TOUR_COPY_MAX_TOURS;
  const concurrency = parsedEnv.data.TOUR_COPY_CONCURRENCY;

  let limit = maxTours;
  let limitClamped = false;
  if (parsedArgs.limit !== undefined) {
    if (parsedArgs.limit > maxTours) {
      limit = maxTours;
      limitClamped = true;
    } else {
      limit = parsedArgs.limit;
    }
  }

  const runId = (deps.runId ?? (() => randomUUID()))();

  io.out(
    `tour-copy run ${runId}: ${
      parsedArgs.execute ? "EXECUTE — this will call the model and write rows" : "dry run — no model calls, no writes"
    }`,
  );
  io.out(`  model: ${startupConfig.model}`);
  io.out(
    `  limit: ${limit}${
      limitClamped ? ` (--limit ${parsedArgs.limit} exceeds TOUR_COPY_MAX_TOURS=${maxTours}, clamped)` : ""
    }`,
  );
  if (parsedArgs.retryFailed) io.out("  --retry-failed: yes");
  if (parsedArgs.regenerateOlderThanVersion !== undefined) {
    io.out(`  --regenerate-older-than-version: ${parsedArgs.regenerateOlderThanVersion}`);
  }

  const candidatesFn = deps.candidates ?? (() => iterateCandidates(prisma!));
  const service =
    deps.service ?? new TourCopyService(prisma!, new AnthropicTourCopyGenerator(startupConfig));

  try {
    if (!parsedArgs.execute) {
      return await runDryRun(
        candidatesFn(),
        {
          limit,
          retryFailed: parsedArgs.retryFailed,
          regenerateOlderThanVersion: parsedArgs.regenerateOlderThanVersion,
          model: startupConfig.model,
        },
        io,
      );
    }
    return await runExecute(
      candidatesFn(),
      service,
      {
        limit,
        concurrency,
        runId,
        model: startupConfig.model,
        retryFailed: parsedArgs.retryFailed,
        regenerateOlderThanVersion: parsedArgs.regenerateOlderThanVersion,
        publishedRows:
          deps.publishedRows ??
          ((id: string) =>
            prisma!.tourCopy.findMany({
              where: { runId: id, status: "published" },
              select: { voiceCounts: true, openingPattern: true },
            }) as Promise<PublishedCopyStats[]>),
      },
      io,
    );
  } finally {
    await disconnect?.();
  }
}

if (require.main === module) {
  // BRI-210: long-running batch job (paid model calls), so ride out transient DB drops.
  setDbRetryProfile("import");
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
