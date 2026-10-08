import type { Logger } from "@nestjs/common";
import type { ImportRun, PrismaClient } from "@prisma/client";

/**
 * Completeness guard for full runs (BRI-227).
 *
 * A September 2026 full load ended after ~21 pages (~10,000 products) on a
 * clean end-of-feed signal and was recorded as a success. The loop cannot tell
 * "Viator has nothing more" from "Viator stopped early", and `/products/
 * modified-since` returns no total to compare against, so a run that reaches
 * end-of-feed is checked against a floor instead.
 *
 * What is compared is the **raw products fetched** (`ImportRun.fetched`), not
 * the active `Tour` rows: `Tour` holds only the curated-city survivors of the
 * scope filter (~28k on dev) while `fetched` counts Viator's whole catalogue
 * (241,500 by page 483 on dev's last full run), so a ratio between them would
 * compare different populations. The floor is, in order:
 *
 * 1. `IMPORT_FULL_RUN_MIN_FETCHED`, an absolute number, when set;
 * 2. `IMPORT_FULL_RUN_MIN_PCT` (default 90) of the largest `fetched` of any
 *    earlier `succeeded` full run. The maximum, so one truncated run that was
 *    recorded as a success cannot lower the bar;
 * 3. otherwise there is no reliable floor and the guard skips, loudly.
 *
 * Delta (cursor-resumed or `modifiedSince`) runs are exempt: they see a slice
 * of the catalogue by design.
 */

export interface CompletenessConfig {
  /** `IMPORT_FULL_RUN_MIN_PCT`. */
  readonly minPct: number;
  /** `IMPORT_FULL_RUN_MIN_FETCHED`, when set. */
  readonly minFetched?: number;
}

export type CompletenessVerdict =
  | { readonly outcome: "exempt"; readonly reason: string }
  | { readonly outcome: "skip"; readonly reason: string }
  | {
      readonly outcome: "pass" | "fail";
      readonly fetched: number;
      readonly floor: number;
      readonly basis: string;
    };

/** Pure decision. `baselineFetched` is the best earlier succeeded full run, or null. */
export function evaluateCompleteness(input: {
  isFullRun: boolean;
  fetched: number;
  baselineFetched: number | null;
  config: CompletenessConfig;
}): CompletenessVerdict {
  const { isFullRun, fetched, baselineFetched, config } = input;
  if (!isFullRun) {
    return {
      outcome: "exempt",
      reason: "delta run (started from a cursor or modifiedSince)",
    };
  }

  let floor: number;
  let basis: string;
  if (config.minFetched !== undefined) {
    floor = config.minFetched;
    basis = `IMPORT_FULL_RUN_MIN_FETCHED=${config.minFetched}`;
  } else if (baselineFetched !== null && baselineFetched > 0) {
    floor = Math.ceil((baselineFetched * config.minPct) / 100);
    basis =
      `${config.minPct}% of the ${baselineFetched} products fetched by the ` +
      `largest earlier succeeded full run`;
  } else {
    return {
      outcome: "skip",
      reason:
        "no reliable floor: no earlier succeeded full run and " +
        "IMPORT_FULL_RUN_MIN_FETCHED is not set",
    };
  }

  return { outcome: fetched >= floor ? "pass" : "fail", fetched, floor, basis };
}

type GuardPrisma = Pick<PrismaClient, "importRun">;

/** Largest `fetched` among earlier `succeeded` full runs for the provider, or null. */
export async function loadBaselineFetched(
  prisma: GuardPrisma,
  provider: string,
  excludeRunId: string,
): Promise<number | null> {
  const best = await prisma.importRun.findFirst({
    where: {
      provider,
      status: "succeeded",
      cursorAtStart: null,
      id: { not: excludeRunId },
    },
    orderBy: { fetched: "desc" },
    select: { fetched: true },
  });
  return best?.fetched ?? null;
}

/**
 * Run the guard for a run whose crawl just reached end-of-feed. `run` is the
 * row as it stands after the final segment's counts were written (so
 * `fetched`/`lastPage` cover every segment). Returns `true` when the run was
 * failed here; the caller must then skip soft-delete, linking and promotion.
 *
 * On failure the row is finalized `failed` with the numbers in `error`, and
 * `lastCursor` is cleared. `ImportRunService.lookupResumeCursor` reads the most
 * recent run with a non-null `lastCursor` whatever its status, so leaving it
 * would make the next nightly resume from a truncated feed's end; clearing it
 * makes the lookup fall through to the last good run's cursor.
 */
export async function applyCompletenessGuard(
  prisma: GuardPrisma,
  run: ImportRun,
  config: CompletenessConfig,
  logger: Pick<Logger, "log" | "warn" | "error">,
  modifiedSince?: string,
): Promise<boolean> {
  // `cursorAtStart` alone is not enough: an explicit modifiedSince run also
  // starts with no cursor but is a delta by intent.
  const isFullRun = run.cursorAtStart === null && !modifiedSince;
  const baselineFetched = isFullRun
    ? await loadBaselineFetched(prisma, run.provider, run.id)
    : null;
  const verdict = evaluateCompleteness({
    isFullRun,
    fetched: run.fetched,
    baselineFetched,
    config,
  });

  switch (verdict.outcome) {
    case "exempt":
      logger.log(`[guard] completeness check not applied: ${verdict.reason}.`);
      return false;
    case "skip":
      logger.warn(`[guard] completeness check SKIPPED: ${verdict.reason}.`);
      return false;
    case "pass":
      logger.log(
        `[guard] completeness check passed: fetched ${verdict.fetched} >= floor ` +
          `${verdict.floor} (${verdict.basis}).`,
      );
      return false;
    case "fail": {
      const error =
        `Completeness guard failed: fetched ${verdict.fetched} raw products ` +
        `over ${run.lastPage ?? 0} page(s), below the floor of ${verdict.floor} ` +
        `(${verdict.basis}). The feed signalled end-of-feed early; ` +
        `nothing was soft-deleted and the resume cursor was not advanced.`;
      await prisma.importRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          error,
          finishedAt: new Date(),
          cursor: null,
          lastCursor: null,
        },
      });
      logger.error(`[guard] ${error}`);
      return true;
    }
  }
}
