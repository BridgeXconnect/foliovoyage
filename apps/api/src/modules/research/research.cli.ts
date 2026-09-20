import * as path from "node:path";

import { envSchema } from "../../config/env.validation";
import {
  Ledger,
  MONTH_CEILING_USD,
  RUN_CAP_HARD_MAX_USD,
  SpendGuard,
  formatUsd,
  resolveRunCap,
  toMicros,
} from "./spend-guard";

/**
 * Hub page research CLI (BRI-206).
 *
 * Plain TypeScript, not a Nest module: it needs no HTTP server and no DI, and
 * the `spend` command works without a database. Run from the repo root:
 *
 *   doppler run -- pnpm --filter @folio/api research:hub <stage> --city <slug> [--execute]
 *
 * Every stage is a dry run unless `--execute` is passed. Only `spend` exists
 * so far; the stages that call the provider are built in later tasks of the
 * BRI-206 build plan and reuse `SpendGuard` and `SearchProviderClient`.
 */

/** `apps/api/research-data`, resolved the same from `src/` and from `dist/`. */
export const RESEARCH_DATA_DIR = path.resolve(__dirname, "../../../research-data");

const PENDING_STAGES: Record<string, string> = {
  candidates: "task 6",
  demand: "tasks 5 and 7",
  serp: "tasks 5 and 7",
  classify: "tasks 5 and 7",
};

const USAGE =
  "Usage: research:hub <candidates|demand|serp|classify|spend> [--city <slug>] [--execute]";

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface CliDeps {
  dataDir?: string;
  now?: () => Date;
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

  if (stage in PENDING_STAGES) {
    io.err(
      `Stage "${stage}" is not built yet (BRI-206 build plan ${PENDING_STAGES[stage]}). ` +
        `Nothing was sent and nothing was spent.`,
    );
    return 2;
  }

  if (stage !== "spend") {
    io.err(`Unknown stage "${stage}". ${USAGE}`);
    return 2;
  }

  return runSpend(env, io, deps);
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
