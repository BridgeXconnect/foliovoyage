import * as path from "node:path";

import { envSchema } from "../../config/env.validation";
import type { FetchLike } from "../import/http/allowlist-fetch";
import { CandidatesError, type CatalogSource, runCandidates } from "./stages/candidates.stage";
import type { CatalogReader } from "./stages/catalog-reader";
import { ClassifyError, runClassify } from "./stages/classify.stage";
import { DemandError, runDemand } from "./stages/demand.stage";
import { type GitRunner, RuleError, checkRuleGate, describeRuleCommit, loadRule } from "./core/rule";
import { SearchProviderClient, MissingCredentialsError, ProviderError } from "./providers/search-provider.client";
import { SerpError, runSerp } from "./stages/serp.stage";
import {
  Ledger,
  MONTH_CEILING_USD,
  RUN_CAP_HARD_MAX_USD,
  SpendGuard,
  SpendRefusedError,
  formatUsd,
  resolveRunCap,
  toMicros,
} from "./pricing/spend-guard";
import { ViatorCatalog, ViatorCatalogError } from "./core/viator-catalog";

/**
 * Hub page research CLI (BRI-206).
 *
 * Plain TypeScript, not a Nest module: it needs no HTTP server and no DI, and
 * the `spend` command works without a database. Run from the repo root:
 *
 *   doppler run -- pnpm --filter @folio/api research:hub <stage> --city <slug> [--execute]
 *
 * Every stage that calls the search provider is a dry run unless `--execute`
 * is passed. `candidates` reads the database and the free Viator partner
 * endpoints and never calls the provider. `demand` and `serp` are the only
 * paid stages, both through `SpendGuard` and `SearchProviderClient`, and `serp`
 * refuses to run until the rule file is committed. `classify` reads saved
 * files only and is free. `spend` prints the ledger and the limits.
 */

/** `apps/api/research-data`, resolved the same from `src/` and from `dist/`. */
export const RESEARCH_DATA_DIR = path.resolve(__dirname, "../../../research-data");

/** The repo root is five levels up from `apps/api/src/modules/research`, in `src/` and in `dist/`. */
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const RULE_FILE = path.join(REPO_ROOT, "docs/research/bri-206/rule.md");

const USAGE =
  "Usage: research:hub <candidates|demand|serp|classify|spend> [--city <slug>] [--execute]";

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface CliDeps {
  dataDir?: string;
  now?: () => Date;
  /** Test seams for the candidates stage. Unset means the real database and Viator. */
  reader?: CatalogReader;
  catalog?: CatalogSource;
  /** Test seams for the provider stages. Unset means the real provider, the real rule file and real git. */
  providerFetch?: FetchLike;
  ruleFile?: string;
  repoRoot?: string;
  git?: GitRunner;
}

const configSchema = envSchema.pick({
  DATAFORSEO_LOGIN: true,
  DATAFORSEO_PASSWORD: true,
  HUB_RESEARCH_MAX_USD: true,
  HUB_RESEARCH_BUDGET_USD: true,
});

/** Runs the CLI and returns the process exit code. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: CliIo,
  deps: CliDeps = {},
): Promise<number> {
  const stage = argv[0];
  if (stage === undefined) {
    io.err(USAGE);
    return 2;
  }

  if (stage === "candidates") return runCandidatesStage(argv.slice(1), env, io, deps);
  if (stage === "demand" || stage === "serp") return runProviderStage(stage, argv.slice(1), env, io, deps);
  if (stage === "classify") return runClassifyStage(argv.slice(1), io, deps);

  if (stage !== "spend") {
    io.err(`Unknown stage "${stage}". ${USAGE}`);
    return 2;
  }

  return runSpend(env, io, deps);
}

/** The value after `--city`, or `undefined` when the flag is missing or has no value. */
function cityFlag(args: readonly string[]): string | undefined {
  const i = args.indexOf("--city");
  const value = i === -1 ? undefined : args[i + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

const catalogConfigSchema = envSchema.pick({
  VIATOR_API_KEY: true,
  VIATOR_API_BASE_URL: true,
  VIATOR_API_LANGUAGE: true,
  VIATOR_REQUEST_TIMEOUT_MS: true,
});

async function runCandidatesStage(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  io: CliIo,
  deps: CliDeps,
): Promise<number> {
  const city = cityFlag(args);
  if (city === undefined) {
    io.err("candidates needs --city <slug>, for example --city bangkok.");
    return 2;
  }

  const dataDir = deps.dataDir ?? RESEARCH_DATA_DIR;
  let catalog = deps.catalog;
  if (catalog === undefined) {
    const parsed = catalogConfigSchema.safeParse(env);
    if (!parsed.success) {
      io.err(
        `Invalid Viator configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
      return 1;
    }
    catalog = new ViatorCatalog({
      dataDir,
      apiKey: parsed.data.VIATOR_API_KEY,
      baseUrl: parsed.data.VIATOR_API_BASE_URL,
      language: parsed.data.VIATOR_API_LANGUAGE,
      timeoutMs: parsed.data.VIATOR_REQUEST_TIMEOUT_MS,
    });
  }

  let disconnect: (() => Promise<void>) | undefined;
  let reader = deps.reader;
  if (reader === undefined) {
    // Loaded here so the `spend` command never needs the Prisma client or a database.
    const { PrismaClient } = await import("@prisma/client");
    const { PrismaCatalogReader } = await import("./stages/catalog-reader");
    const prisma = new PrismaClient();
    reader = new PrismaCatalogReader(prisma);
    disconnect = () => prisma.$disconnect();
  }

  try {
    const { file, jsonPath, csvPath } = await runCandidates(city, { dataDir, reader, catalog });
    io.out(`Candidates for ${file.city}: ${file.counts.queries} queries from ${file.counts.tours} tours`);
    io.out(`  tags kept:        ${file.counts.tags} (at least ${file.cutoffs.minTagProducts} products each, top ${file.cutoffs.topTags})`);
    io.out(`  attractions kept: ${file.counts.attractions} (counted by ${file.attractionMode === "viator_count" ? "Viator's own product count" : "title match over stored tours"})`);
    io.out(`  dropped:          ${file.dropped.length}`);
    io.out(`  wrote ${jsonPath}`);
    io.out(`  wrote ${csvPath}`);
    io.out(`Cost: $0.0000. This stage never calls the search provider.`);
    return 0;
  } catch (error) {
    if (error instanceof CandidatesError || error instanceof ViatorCatalogError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  } finally {
    await disconnect?.();
  }
}

/** Prints where the money stands after a paid stage, from the ledger. */
function printSpend(io: CliIo, guard: SpendGuard, ledgerFile: string): void {
  const left = guard.totalBudgetLeftUsd();
  io.out(`  this run:        ${formatUsd(toMicros(guard.runSpentUsd))} of ${formatUsd(toMicros(guard.runCapUsd))} run cap`);
  io.out(`  month:           ${formatUsd(toMicros(guard.monthSpentUsd()))} of ${formatUsd(toMicros(MONTH_CEILING_USD))}`);
  io.out(
    left === undefined || guard.totalBudgetUsd === undefined
      ? `  total budget:    not set`
      : `  total budget:    ${formatUsd(toMicros(left))} left of ${formatUsd(toMicros(guard.totalBudgetUsd))}`,
  );
  io.out(`  ledger:          ${ledgerFile}`);
}

const executeFlag = (args: readonly string[]): boolean => args.includes("--execute");

async function runProviderStage(
  stage: "demand" | "serp",
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  io: CliIo,
  deps: CliDeps,
): Promise<number> {
  const city = cityFlag(args);
  if (city === undefined) {
    io.err(`${stage} needs --city <slug>, for example --city bangkok.`);
    return 2;
  }
  const execute = executeFlag(args);
  const now = deps.now ?? (() => new Date());
  const dataDir = deps.dataDir ?? RESEARCH_DATA_DIR;
  const ruleFile = deps.ruleFile ?? RULE_FILE;
  const repoRoot = deps.repoRoot ?? REPO_ROOT;

  try {
    // The commit first gate comes before anything that could spend, in a dry run too.
    const gate = stage === "serp" ? checkRuleGate({ ruleFile, repoRoot, now: now(), ...(deps.git ? { git: deps.git } : {}) }) : undefined;
    const rule = loadRule(ruleFile);

    const parsed = configSchema.safeParse(env);
    if (!parsed.success) {
      io.err(`Invalid research configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return 1;
    }
    const config = parsed.data;
    const ledger = new Ledger(path.join(dataDir, "ledger.jsonl"));
    const guard = new SpendGuard({
      ledger,
      runCapUsd: resolveRunCap(config.HUB_RESEARCH_MAX_USD),
      ...(config.HUB_RESEARCH_BUDGET_USD === undefined ? {} : { totalBudgetUsd: config.HUB_RESEARCH_BUDGET_USD }),
      now,
    });
    const client = new SearchProviderClient({
      credentials: { login: config.DATAFORSEO_LOGIN, password: config.DATAFORSEO_PASSWORD },
      guard,
      cacheDir: path.join(dataDir, "cache"),
      execute,
      now,
      ...(deps.providerFetch ? { fetchImpl: deps.providerFetch } : {}),
    });

    io.out(`${stage} for ${city}: ${execute ? "EXECUTE, this will send paid requests" : "dry run, nothing will be sent"}`);

    if (stage === "demand") {
      const result = await runDemand(city, { dataDir, client, rule });
      if (result.kind === "dry_run") {
        io.out(`  would send one request with ${result.keywords} keywords, estimated ${formatUsd(toMicros(result.estimateUsd))}`);
        io.out(`  add --execute to send it`);
        return 0;
      }
      const { counts } = result.file;
      io.out(`  ${result.fromCache ? "answered from the saved response, no charge" : "sent"}`);
      io.out(`  provider reported cost: ${result.file.costUsd === null ? "none" : formatUsd(toMicros(result.file.costUsd))}`);
      io.out(`  queries ${counts.queries}: ${counts.ok} with data, ${counts.noData} without, ${counts.validated} at ${result.file.demandFloor} searches a month or more`);
      io.out(`  wrote ${result.path}`);
      printSpend(io, guard, ledger.file);
      return 0;
    }

    if (gate === undefined) throw new Error("unreachable: serp always has a gate");
    io.out(`  rule ${gate.commit.slice(0, 10)} committed ${gate.committedAt}`);
    const summary = await runSerp(city, { dataDir, client, guard, rule, gate, execute, now, log: (l) => io.out(`  ${l}`) });
    io.out(`  validated ${summary.validated}: pulled ${summary.pulled}, from cache ${summary.fromCache}, already saved ${summary.alreadyHad}, failed ${summary.failed}, not pulled ${summary.notPulled}`);
    if (!execute) io.out(`  dry run estimate: ${formatUsd(toMicros(summary.estimateUsd ?? 0))}. Add --execute to send.`);
    if (summary.path !== null) io.out(`  wrote ${summary.path}`);
    if (execute) printSpend(io, guard, ledger.file);
    return summary.failed > 0 || summary.notPulled > 0 ? 1 : 0;
  } catch (error) {
    if (
      error instanceof RuleError ||
      error instanceof DemandError ||
      error instanceof SerpError ||
      error instanceof SpendRefusedError ||
      error instanceof MissingCredentialsError ||
      error instanceof ProviderError
    ) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}

function runClassifyStage(args: readonly string[], io: CliIo, deps: CliDeps): number {
  const city = cityFlag(args);
  if (city === undefined) {
    io.err("classify needs --city <slug>, for example --city bangkok.");
    return 2;
  }
  const dataDir = deps.dataDir ?? RESEARCH_DATA_DIR;
  const ruleFile = deps.ruleFile ?? RULE_FILE;
  try {
    const rule = loadRule(ruleFile);
    const ruleCommit = describeRuleCommit({ ruleFile, repoRoot: deps.repoRoot ?? REPO_ROOT, ...(deps.git ? { git: deps.git } : {}) });
    const { file, classifiedPath, unlistedPath } = runClassify(city, { dataDir, rule, ruleCommit });
    io.out(`Classified ${file.queries.length} validated queries for ${file.city} (rule ${ruleCommit.commit?.slice(0, 10) ?? "none"}${ruleCommit.dirty ? ", with local changes" : ""})`);
    if (file.missingSerp.length > 0) io.out(`  ${file.missingSerp.length} validated queries have no results page and are not counted`);
    for (const f of file.families) {
      const share = f.openShare === null ? "n/a" : `${Math.round(f.openShare * 100)}%`;
      io.out(`  ${f.family}: ${f.validated} validated, ${f.open} open, ${f.closed} closed (${share} open), median marketplaces ${f.medianMarketplaces ?? "n/a"} => ${f.verdict}`);
    }
    io.out(`  wrote ${classifiedPath}`);
    io.out(`  wrote ${unlistedPath}`);
    io.out(`Cost: $0.0000. This stage never calls the search provider.`);
    return 0;
  } catch (error) {
    if (error instanceof RuleError || error instanceof ClassifyError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}

function runSpend(env: NodeJS.ProcessEnv, io: CliIo, deps: CliDeps): number {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    io.err(
      `Invalid research configuration: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    return 1;
  }
  const config = parsed.data;

  let runCapUsd: number;
  try {
    runCapUsd = resolveRunCap(config.HUB_RESEARCH_MAX_USD);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const dataDir = deps.dataDir ?? RESEARCH_DATA_DIR;
  const ledger = new Ledger(path.join(dataDir, "ledger.jsonl"));
  let guard: SpendGuard;
  let monthUsd: number;
  let budgetLeftUsd: number | undefined;
  try {
    guard = new SpendGuard({
      ledger,
      runCapUsd,
      ...(config.HUB_RESEARCH_BUDGET_USD === undefined
        ? {}
        : { totalBudgetUsd: config.HUB_RESEARCH_BUDGET_USD }),
      ...(deps.now ? { now: deps.now } : {}),
    });
    monthUsd = guard.monthSpentUsd();
    budgetLeftUsd = guard.totalBudgetLeftUsd();
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const requested = config.HUB_RESEARCH_MAX_USD;
  const clamped = requested !== undefined && requested > RUN_CAP_HARD_MAX_USD;

  io.out(`Month spent:    ${formatUsd(toMicros(monthUsd))} of ${formatUsd(toMicros(MONTH_CEILING_USD))} (UTC calendar month, this machine's ledger)`);
  io.out(`Month left:     ${formatUsd(toMicros(MONTH_CEILING_USD - monthUsd))}`);
  io.out(`Run cap:        ${formatUsd(toMicros(runCapUsd))} per run${clamped ? ` (HUB_RESEARCH_MAX_USD=${requested} was clamped to the hard maximum)` : ""}`);
  io.out(
    guard.totalBudgetUsd === undefined || budgetLeftUsd === undefined
      ? `Total budget:   not set (HUB_RESEARCH_BUDGET_USD), so nothing limits spend across runs except the month ceiling`
      : `Total budget:   ${formatUsd(toMicros(guard.totalBudgetUsd))} across all runs, ${formatUsd(toMicros(budgetLeftUsd))} left (whole ledger)`,
  );
  io.out(`Run so far:     ${formatUsd(toMicros(guard.runSpentUsd))} (a new run starts at zero)`);
  io.out(`Credentials:    DATAFORSEO_LOGIN ${config.DATAFORSEO_LOGIN ? "set" : "missing"}, DATAFORSEO_PASSWORD ${config.DATAFORSEO_PASSWORD ? "set" : "missing"}`);
  io.out(`Ledger:         ${ledger.file}`);
  io.out(`The provider dashboard stays the source of truth for the real balance.`);
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
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
