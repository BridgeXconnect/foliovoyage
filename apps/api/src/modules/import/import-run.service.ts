import { Logger } from "@nestjs/common";
import type { ImportRun, PrismaClient } from "@prisma/client";

import {
  ImportPipeline,
  ImportRunCounts,
  type ImportPipelineOptions,
} from "./import.pipeline";
import { MassDeletionAbortError } from "./upsert";

/**
 * Import-run recorder (ST-10 / BRI-107).
 *
 * Owns the `import_run` audit record around one execution of the
 * {@link ImportPipeline}: it writes a `running` row before the pipeline starts
 * and updates that same row exactly once when the run reaches a terminal state.
 * The row is the durable answer to "did the nightly import run, and what
 * happened?" — so the two invariants this class guarantees are:
 *
 * 1. **Every run leaves exactly one record.** A run is never silently missing.
 * 2. **No run is left stuck as `running`.** Success, failure, and the guard's
 *    abort all finalize the row (status + counts + `finishedAt`).
 *
 * The abort case is called out explicitly in the spec: when ST-9's guard trips,
 * the pipeline throws {@link MassDeletionAbortError} after the earlier stages'
 * counts are already tallied, so the row is finalized as `aborted` carrying
 * those partial counts — not `failed`, and not left `running`.
 *
 * It does **not** re-throw: a scheduled cron and a manual trigger both want the
 * finalized record back (describing the failure) rather than an exception to
 * handle. The record's `status` + `error` communicate the outcome.
 */

/** How a run was kicked off — persisted on the record for later triage. */
export type ImportRunTrigger = "scheduled" | "manual";

/** Just the `importRun` surface this service needs (a `PrismaClient` satisfies it). */
export type ImportRunPrisma = Pick<PrismaClient, "importRun">;

/** Config the recorder needs, injected so it doesn't read env directly. */
export interface ImportRunServiceConfig {
  /** Mass-deletion abort threshold (0–100), from `DELETE_GUARD_THRESHOLD_PCT`. */
  readonly deleteGuardThresholdPct: number;
  /** Provider this deployment crawls. Always "viator" today. */
  readonly provider?: string;
}

export class ImportRunService {
  private readonly logger = new Logger(ImportRunService.name);
  private readonly provider: string;

  constructor(
    private readonly prisma: ImportRunPrisma,
    private readonly pipeline: ImportPipeline,
    private readonly config: ImportRunServiceConfig,
  ) {
    this.provider = config.provider ?? "viator";
  }

  /**
   * Execute one import run and record it. Creates the `running` row, runs the
   * pipeline, then finalizes the row to `succeeded` / `aborted` / `failed`.
   * Always resolves to the finalized record; never re-throws.
   *
   * @param trigger  Whether the nightly cron or a manual path started this run.
   * @param options  Pipeline overrides (e.g. a `modifiedSince` for a delta crawl).
   */
  async execute(
    trigger: ImportRunTrigger,
    options: Partial<ImportPipelineOptions> = {},
  ): Promise<ImportRun> {
    const run = await this.prisma.importRun.create({
      data: { provider: this.provider, trigger, status: "running" },
    });
    this.logger.log(`Import run ${run.id} started (trigger: ${trigger}).`);

    // Owned here so its tallies survive a pipeline throw (see ImportPipeline).
    const counts = new ImportRunCounts();

    try {
      await this.pipeline.run(counts, {
        deleteGuardThresholdPct: this.config.deleteGuardThresholdPct,
        ...options,
      });
      const finalized = await this.finalize(run.id, "succeeded", counts, null);
      this.logger.log(
        `Import run ${run.id} succeeded — ` +
          `fetched ${counts.fetched}, normalized ${counts.normalized}, ` +
          `quarantined ${counts.quarantined}, upserted ${counts.upserted}, ` +
          `soft-deleted ${counts.softDeleted}.`,
      );
      return finalized;
    } catch (error) {
      if (error instanceof MassDeletionAbortError) {
        // The guard did its job: a deliberate rollback, not a crash. Record the
        // partial counts gathered before the abort.
        this.logger.warn(
          `Import run ${run.id} aborted by mass-deletion guard: ${error.message}`,
        );
        return this.finalize(run.id, "aborted", counts, error.message);
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Import run ${run.id} failed: ${message}`);
      return this.finalize(run.id, "failed", counts, message);
    }
  }

  /** Update the run row to a terminal state in one write. */
  private finalize(
    id: string,
    status: "succeeded" | "failed" | "aborted",
    counts: ImportRunCounts,
    error: string | null,
  ): Promise<ImportRun> {
    return this.prisma.importRun.update({
      where: { id },
      data: {
        status,
        fetched: counts.fetched,
        normalized: counts.normalized,
        quarantined: counts.quarantined,
        upserted: counts.upserted,
        softDeleted: counts.softDeleted,
        cursor: counts.cursor,
        error,
        finishedAt: new Date(),
      },
    });
  }
}
