import { Logger } from "@nestjs/common";
import type { ImportRun, PrismaClient } from "@prisma/client";

import { ImportRunHeartbeat } from "./heartbeat";
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
 *
 * **BRI-170.** Invariant 2 above ("no run is left stuck as `running`") holds
 * for every failure mode this class's own try/catch can see — but not for a
 * process that dies *without unwinding the stack at all* (a `kill -9`, or an
 * OOM kill, exactly what BRI-170's evidence showed: one `ImportRun` row left
 * `running` with no `finishedAt` and no `error`, because the OOM killed the
 * process before the `catch` block ever ran). No in-process guarantee can
 * cover that — the fix is {@link reapStuckRuns}, an out-of-process safeguard
 * run once at every app boot (see `scheduler.ts`), which finalizes any row
 * still `running` well past how long a real run should ever take.
 */

/**
 * How a run was kicked off — persisted on the record for later triage.
 *
 * `"scheduled-external"` (BRI-173): Render's free-tier web service sleeps
 * after 15 minutes idle, so the in-process `ImportScheduler` cron cannot
 * fire while asleep. A GitHub Actions workflow calls `POST /v1/import/trigger`
 * on the same schedule to wake the instance and start the run instead — it's
 * still *the* nightly run in intent, just kicked off externally rather than
 * by the in-process timer, so it gets its own label distinct from both the
 * (currently unreachable) in-process `"scheduled"` path and an ad hoc
 * human-initiated `"manual"` run.
 */
export type ImportRunTrigger = "scheduled" | "manual" | "scheduled-external";

/** Just the `importRun` surface this service needs (a `PrismaClient` satisfies it). */
export type ImportRunPrisma = Pick<PrismaClient, "importRun">;

/** Config the recorder needs, injected so it doesn't read env directly. */
export interface ImportRunServiceConfig {
  /** Mass-deletion abort threshold (0–100), from `DELETE_GUARD_THRESHOLD_PCT`. */
  readonly deleteGuardThresholdPct: number;
  /** Provider this deployment crawls. Always "viator" today. */
  readonly provider?: string;
  /**
   * Minutes a run may sit `running` before {@link reapStuckRuns} finalizes it
   * as `failed`, from `IMPORT_STUCK_RUN_TIMEOUT_MINUTES`. Defaults to 120.
   */
  readonly stuckRunTimeoutMinutes?: number;
  /**
   * The service's own public URL (`RENDER_EXTERNAL_URL`), used to build the
   * self-heartbeat ping target for the run's duration (BRI-173). Undefined
   * off-Render (local dev, tests, CI), where {@link ImportRunHeartbeat}
   * simply no-ops.
   */
  readonly heartbeatUrl?: string;
}

export class ImportRunService {
  private readonly logger = new Logger(ImportRunService.name);
  private readonly provider: string;
  private readonly stuckRunTimeoutMinutes: number;

  constructor(
    private readonly prisma: ImportRunPrisma,
    private readonly pipeline: ImportPipeline,
    private readonly config: ImportRunServiceConfig,
  ) {
    this.provider = config.provider ?? "viator";
    this.stuckRunTimeoutMinutes = config.stuckRunTimeoutMinutes ?? 120;
  }

  /**
   * Finalize as `failed` any run still `running` past
   * {@link ImportRunServiceConfig.stuckRunTimeoutMinutes}. Intended to run once
   * at process boot (before a new run might start), so an orphaned row from a
   * crashed previous process is cleaned up before it can confuse "is an import
   * currently running?" checks or clutter the audit trail. A run that is
   * merely slow (still legitimately in flight) is untouched — the timeout is
   * set well above how long a real crawl+ingest takes.
   */
  async reapStuckRuns(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.stuckRunTimeoutMinutes * 60_000,
    );
    const result = await this.prisma.importRun.updateMany({
      where: { status: "running", startedAt: { lt: cutoff } },
      data: {
        status: "failed",
        error:
          `Marked failed at startup: still "running" after ` +
          `${this.stuckRunTimeoutMinutes} minutes with no finishedAt — ` +
          `orphaned by a process that exited without unwinding (crash/OOM kill).`,
        finishedAt: new Date(),
      },
    });
    if (result.count > 0) {
      this.logger.warn(
        `Reaped ${result.count} stuck "running" import run(s), stuck past ` +
          `${this.stuckRunTimeoutMinutes} minutes, as failed.`,
      );
    }
    return result.count;
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

    // BRI-173: started right before the work begins, stopped in `finally` so
    // it never outlives this run regardless of how it ends — the same
    // cleanup shape `reapStuckRuns` uses for its own best-effort guarantee.
    // No-ops entirely when `heartbeatUrl` is unset (off-Render).
    const heartbeat = new ImportRunHeartbeat({ url: this.config.heartbeatUrl });
    heartbeat.start();

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
    } finally {
      heartbeat.stop();
    }
  }

  /**
   * Whether a run is currently `running` for this provider. Used by
   * {@link import("./import-trigger.controller").ImportTriggerController} to
   * reject a trigger while one is already in flight (BRI-173) — a naive
   * double-fire (a retried GitHub Actions step, or a manual trigger racing the
   * nightly schedule) must not start two concurrent crawls against the same
   * OTA and catalogue.
   */
  async hasRunningRun(): Promise<boolean> {
    const existing = await this.prisma.importRun.findFirst({
      where: { provider: this.provider, status: "running" },
      select: { id: true },
    });
    return existing !== null;
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
