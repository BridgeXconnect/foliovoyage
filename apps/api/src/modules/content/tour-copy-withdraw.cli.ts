import { randomUUID } from "node:crypto";

import { PrismaService } from "../../prisma/prisma.service";
import { setDbRetryProfile } from "../../prisma/transient-retry";
import { EVAL_MAX_BAD_RATE, EVAL_MIN_JUDGED } from "./tour-copy-eval.constants";
import { decideKillSwitch, getPairStats, type PairStats, type PromptModelPair } from "./tour-copy-eval-stats";
import { getJudgeRubric } from "./tour-copy-judge-rubric";

/**
 * `tour-copy-withdraw:run --prompt-version N --model M [--restore] [--execute]`
 * (BRI-201 / spec 0003, AC-10). Withdraws a (promptVersion, model) pair by
 * hand, or returns its `withdrawn` rows to `published`. Both are dry runs
 * unless `--execute` is given. Reads and writes the database only: it needs
 * no gateway settings and never calls a model.
 *
 * `--restore` refuses while the pair's judged rows, counted over both
 * `published` and `withdrawn` rows at the current rubric version, still cross
 * the kill switch limit. Exit codes: 0 ok, 1 refused or bad arguments.
 */

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** The database reads and writes this CLI needs, so tests can run without one. */
export interface WithdrawStore {
  countByStatus(pair: PromptModelPair, status: "published" | "withdrawn"): Promise<number>;
  /** Judge verdict counts over published and withdrawn rows at the given rubric version. */
  judgedStats(pair: PromptModelPair, rubricVersion: number): Promise<PairStats>;
  withdraw(pair: PromptModelPair, runId: string): Promise<number>;
  restore(pair: PromptModelPair): Promise<number>;
}

export interface WithdrawCliDeps {
  runId?: () => string;
  store?: WithdrawStore;
  disconnect?: () => Promise<void>;
}

interface ParsedArgs {
  promptVersion: number;
  model: string;
  restore: boolean;
  execute: boolean;
}

const USAGE = "Usage: tour-copy-withdraw:run --prompt-version N --model M [--restore] [--execute]";

function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  let promptVersion: number | undefined;
  let model: string | undefined;
  let restore = false;
  let execute = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--restore") restore = true;
    else if (arg === "--execute") execute = true;
    else if (arg === "--prompt-version") {
      const raw = argv[++i];
      const value = raw === undefined ? NaN : Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        return { error: `--prompt-version needs a positive integer, got ${raw ?? "(nothing)"}.\n${USAGE}` };
      }
      promptVersion = value;
    } else if (arg === "--model") {
      const raw = argv[++i];
      if (raw === undefined || raw.startsWith("--")) return { error: `--model needs a model id.\n${USAGE}` };
      model = raw;
    } else {
      return { error: `Unknown argument "${arg}".\n${USAGE}` };
    }
  }
  if (promptVersion === undefined || model === undefined) {
    return { error: `Both --prompt-version and --model are required.\n${USAGE}` };
  }
  return { promptVersion, model, restore, execute };
}

export function createPrismaWithdrawStore(prisma: PrismaService): WithdrawStore {
  return {
    countByStatus: (pair, status) => prisma.tourCopy.count({ where: { status, ...pair } }),
    judgedStats: (pair, rubricVersion) => getPairStats(prisma, pair, ["published", "withdrawn"], rubricVersion),
    withdraw: async (pair, runId) =>
      (
        await prisma.tourCopy.updateMany({
          where: { status: "published", ...pair },
          data: { status: "withdrawn", withdrawnAt: new Date(), withdrawnByRunId: runId },
        })
      ).count,
    restore: async (pair) =>
      (
        await prisma.tourCopy.updateMany({
          where: { status: "withdrawn", ...pair },
          data: { status: "published", withdrawnAt: null, withdrawnByRunId: null },
        })
      ).count,
  };
}

const plural = (n: number): string => `${n} row${n === 1 ? "" : "s"}`;

export async function main(
  argv: readonly string[],
  _env: NodeJS.ProcessEnv,
  io: CliIo,
  deps: WithdrawCliDeps = {},
): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    io.err(parsed.error);
    return 1;
  }

  const prisma = deps.store === undefined ? new PrismaService() : undefined;
  const store = deps.store ?? createPrismaWithdrawStore(prisma!);
  const disconnect = deps.disconnect ?? (prisma !== undefined ? () => prisma.$disconnect() : undefined);
  const pair: PromptModelPair = { promptVersion: parsed.promptVersion, model: parsed.model };
  const label = `prompt version ${pair.promptVersion}, model ${pair.model}`;
  const mode = parsed.execute ? "EXECUTE, this will change rows" : "dry run, nothing is changed";

  try {
    if (!parsed.restore) {
      const published = await store.countByStatus(pair, "published");
      io.out(`tour-copy withdraw (${mode}): ${label}`);
      if (published === 0) {
        io.out("  No published rows at this pair, nothing to withdraw.");
        return 0;
      }
      if (!parsed.execute) {
        io.out(`  Would withdraw ${plural(published)}. Run again with --execute to do it.`);
        return 0;
      }
      const runId = (deps.runId ?? (() => randomUUID()))();
      const withdrawn = await store.withdraw(pair, runId);
      io.out(`  Withdrew ${plural(withdrawn)} (withdraw run ${runId}). Nothing at this pair is served now.`);
      return 0;
    }

    const rubricVersion = getJudgeRubric("tour_copy").version;
    const [withdrawn, stats] = await Promise.all([
      store.countByStatus(pair, "withdrawn"),
      store.judgedStats(pair, rubricVersion),
    ]);
    io.out(`tour-copy restore (${mode}): ${label}`);
    if (decideKillSwitch(stats) === "withdraw") {
      io.err(
        `Refusing to restore: ${stats.bad} of ${stats.judged} judged rows at this pair are bad ` +
          `(the limit is at least ${EVAL_MIN_JUDGED} judged rows and more than ${EVAL_MAX_BAD_RATE * 100}% bad). ` +
          "Fix the prompt or bump the rubric version first, then run this again.",
      );
      return 1;
    }
    if (withdrawn === 0) {
      io.out("  No withdrawn rows at this pair, nothing to restore.");
      return 0;
    }
    io.out(`  Judged rows: ${stats.judged}, bad: ${stats.bad}.`);
    if (!parsed.execute) {
      io.out(`  Would restore ${plural(withdrawn)} to published. Run again with --execute to do it.`);
      return 0;
    }
    const restored = await store.restore(pair);
    io.out(`  Restored ${plural(restored)} to published.`);
    return 0;
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
