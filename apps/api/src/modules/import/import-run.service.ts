import { Logger } from "@nestjs/common";
import type { ImportRun, PrismaClient } from "@prisma/client";

import type { SegmentRunner } from "./segment-runner";

/**
 * Import-run orchestrator (ST-10 / BRI-107, restructured by BRI-176).
 *
 * Owns the `import_run` audit record around one run: it writes a `running`
 * row before any work starts and updates that same row exactly once when the
 * run reaches a terminal state. The row is the durable answer to "did the
 * nightly import run, and what happened?" — so the two invariants this class
 * guarantees are:
 *
 * 1. **Every run leaves exactly one record.** A run is never silently missing.
 * 2. **No run is left stuck as `running`.** Success, failure, and the guard's
 *    abort all finalize the row (status + counts + `finishedAt`).
 *
 * It does **not** re-throw: a scheduled cron and a manual trigger both want the
 * finalized record back (describing the failure) rather than an exception to
 * handle. The record's `status` + `error` communicate the outcome.
 *
 * **BRI-176.** This class no longer runs the crawl itself. It spawns a
 * `segment-worker.cli.ts` child process per segment (via the injected
 * {@link SegmentRunner} — real spawning in production, fakeable in tests)
 * and loops: run a segment, check the row, spawn another if it's still
 * `running`. Each child is the one that calls `ImportPipeline.runSegment`,
 * increments the row's counts/cursor, and — on the segment that finally
 * finishes the crawl — calls `finalizeGuardedSoftDelete`/`ExperienceLinker`
 * and writes the row's terminal state itself; see `segment-worker.cli.ts`.
 * That split exists because an in-process generator restart (tried first)
 * measurably helped but left a real residual memory accumulation across
 * many pages — BRI-176's diagnosis confirmed only a *fully completed*
 * process/generator releases everything, so the restart had to become a real
 * OS process exit, and the real production trigger path (`POST
 * /v1/import/trigger`, BRI-173) runs inside the same long-lived web-server
 * process that also serves other traffic — it cannot `process.exit()` itself
 * to get that release. Spawning a disposable child gets the same guarantee
 * without taking the API down. This class's own memory footprint therefore
 * stays flat regardless of crawl length: it never parses a page or holds a
 * `TourDTO` itself, only spawns and waits.
 *
 * A child's exit code communicates whether it could reliably record its own
 * outcome — 0 whether that outcome was `succeeded`, `aborted`, or a caught
 * `failed` (the row's `status` carries the actual business outcome), non-zero
 * or `null` only when the process died before it could (a crash, or an OOM
 * kill the OS delivered as a raw signal). This class finalizes the row itself
 * only in that latter case; the row's `cursor` still reflects wherever the
 * *last successfully completed* segment left off, so a fresh run resuming
 * from there loses no committed work (idempotent upserts mean, at worst, one
 * partially-done page gets safely redone).
 *
 * **Ledger/reality reconciliation (BRI-182 follow-up).** A died-abnormally
 * child may have already committed several pages' worth of `Tour` rows
 * (`TourUpsertService.upsertBatch` commits per page, incrementally) before
 * the kill — but never reached the point in `segment-worker.cli.ts` where it
 * persists that segment's `ImportRunCounts` back onto this row, since that
 * only happens after `runSegment` returns or a caught error unwinds to its
 * own `catch`. Left alone, a naive finalize would leave `upserted` frozen at
 * whatever the *previous* segment reported, silently undercounting what the
 * `Tour` table actually holds for this run. Both places this class finalizes
 * a run itself — `finalize` (one child died abnormally) and
 * {@link reapStuckRuns} (the parent process itself died mid-orchestration,
 * possibly losing more than one child's worth of unreported progress) —
 * recover exactly that one counter with a real DB count, scoped by
 * `(provider, fetchedAt)`. Every row any segment of a run wrote carries that
 * run's `startedAt` as its `fetchedAt` stamp (see
 * `TourUpsertService.findUpsertedIds`'s docstring), so the count is exact
 * regardless of how many segments ran or where the kill landed.
 * `fetched`/`normalized`/`quarantined` have no equivalent durable, run-scoped
 * key anywhere in the DB (`QuarantinedTour` isn't stamped with a run id or
 * `fetchedAt` at all) and are left as whatever the last successful segment
 * reported — an honest best-effort progress figure, not a reconciled one.
 *
 * **BRI-170.** Invariant 2 above ("no run is left stuck as `running`") holds
 * for every failure mode this class's own try/catch can see — but not for a
 * process that dies *without unwinding the stack at all* (the long-lived
 * parent process itself getting killed mid-orchestration, not just one
 * child). No in-process guarantee can cover that — the fix is
 * {@link reapStuckRuns}, an out-of-process safeguard run once at every app
 * boot (see `scheduler.ts`), which finalizes any row still `running` well
 * past how long a real run should ever take.
 */

/**
 * How a run was kicked off — persisted on the record for later triage.
 * `"scheduled"` is the in-process nightly cron (`ImportScheduler`); `"manual"`
 * is an ad hoc human/CI-initiated run (`trigger-import.cli.ts`).
 */
export type ImportRunTrigger = "scheduled" | "manual";

/**
 * Just the surface this service needs (a `PrismaClient` satisfies it).
 * `tour` is read-only here, for `finalize`'s ledger reconciliation — this
 * class still never writes a `Tour` row itself.
 */
export type ImportRunPrisma = Pick<PrismaClient, "importRun" | "tour">;

/** Options for one {@link ImportRunService.execute} call. */
export interface ExecuteOptions {
  /**
   * Optional ISO-8601 timestamp for a delta crawl (only pages modified since
   * then). Forwarded to every segment-worker child spawned for this run;
   * only the first (the one with no cursor yet) ever actually sends it — see
   * `ViatorClient.fetchModifiedSince`'s `startCursor` gating.
   */
  readonly modifiedSince?: string;
}

/** Config the orchestrator needs, injected so it doesn't read env directly. */
export interface ImportRunServiceConfig {
  /** Provider this deployment crawls. Always "viator" today. */
  readonly provider?: string;
  /**
   * Minutes a run may sit `running` before {@link reapStuckRuns} finalizes it
   * as `failed`, from `IMPORT_STUCK_RUN_TIMEOUT_MINUTES`. Defaults to 120.
   */
  readonly stuckRunTimeoutMinutes?: number;
}

export class ImportRunService {
  private readonly logger = new Logger(ImportRunService.name);
  private readonly provider: string;
  private readonly stuckRunTimeoutMinutes: number;

  constructor(
    private readonly prisma: ImportRunPrisma,
    private readonly segmentRunner: SegmentRunner,
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
   * merely slow (still legitimately in flight, spawning its next segment) is
   * untouched — the timeout is set well above how long a real crawl+ingest
   * takes.
   *
   * Reconciles each reaped row's `upserted` against a real `Tour` count
   * before marking it failed — see this class's own docstring ("Ledger/
   * reality reconciliation") for why. That means one query per stuck row
   * rather than a single bulk update; in practice there are at most a
   * handful of these per boot (this only fires for a run whose *entire*
   * parent process died mid-orchestration), so the extra roundtrips are not
   * a concern.
   */
  async reapStuckRuns(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.stuckRunTimeoutMinutes * 60_000,
    );
    const stuck = await this.prisma.importRun.findMany({
      where: { status: "running", startedAt: { lt: cutoff } },
    });

    for (const run of stuck) {
      const upserted = await this.prisma.tour.count({
        where: { provider: run.provider, fetchedAt: run.startedAt },
      });
      await this.prisma.importRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          error:
            `Marked failed at startup: still "running" after ` +
            `${this.stuckRunTimeoutMinutes} minutes with no finishedAt — ` +
            `orphaned by a process that exited without unwinding (crash/OOM kill).`,
          upserted,
          finishedAt: new Date(),
        },
      });
    }

    if (stuck.length > 0) {
      this.logger.warn(
        `Reaped ${stuck.length} stuck "running" import run(s), stuck past ` +
          `${this.stuckRunTimeoutMinutes} minutes, as failed.`,
      );
    }
    return stuck.length;
  }

  /**
   * Execute one import run and record it: create the `running` row, then
   * spawn segment-worker children one at a time until the row leaves
   * `running` (BRI-176). Always resolves to the finalized record; never
   * re-throws.
   *
   * @param trigger  Whether the nightly cron or a manual path started this run.
   * @param options  E.g. a `modifiedSince` for a delta crawl.
   */
  async execute(
    trigger: ImportRunTrigger,
    options: ExecuteOptions = {},
  ): Promise<ImportRun> {
    // BRI-181: an explicit modifiedSince (the manual one-off re-sync escape
    // hatch) always wins over the auto-discovered cross-run cursor — asking
    // for a specific re-sync point means exactly that, not wherever the last
    // run happened to leave off.
    const resumeCursor = options.modifiedSince
      ? null
      : await this.lookupResumeCursor();

    const run = await this.prisma.importRun.create({
      data: {
        provider: this.provider,
        trigger,
        status: "running",
        cursor: resumeCursor,
        cursorAtStart: resumeCursor,
      },
    });
    this.logger.log(
      resumeCursor
        ? `Import run ${run.id} started (trigger: ${trigger}), resuming from cursor "${resumeCursor}".`
        : `Import run ${run.id} started (trigger: ${trigger}), full crawl (no prior cursor).`,
    );

    for (;;) {
      const result = await this.segmentRunner.runSegment(
        run.id,
        options.modifiedSince,
      );

      if (result.exitCode !== 0) {
        // The child died before it could reliably record its own outcome
        // (crash, or an OS-delivered signal like an OOM kill — exitCode is
        // `null` in that case). Whatever the last successfully completed
        // segment committed (cursor, counts) is untouched; finalize here
        // instead of leaving the row `running` for reapStuckRuns to
        // eventually clean up.
        const message =
          `segment-worker exited abnormally (code ${result.exitCode ?? "null"}) ` +
          `before it could record its own outcome`;
        this.logger.error(`Import run ${run.id} failed: ${message}`);
        return this.finalize(run, message);
      }

      const current = await this.prisma.importRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      if (current.status !== "running") {
        this.logger.log(
          `Import run ${run.id} ${current.status} — ` +
            `fetched ${current.fetched}, normalized ${current.normalized}, ` +
            `quarantined ${current.quarantined}, upserted ${current.upserted}, ` +
            `soft-deleted ${current.softDeleted}.`,
        );
        return current;
      }
      // Still running: the segment that just finished left more pages for
      // the next one (its cursor is already on the row) — loop.
    }
  }

  /**
   * Whether a run is currently `running` for this provider — a guard against
   * starting two concurrent crawls against the same OTA and catalogue.
   */
  async hasRunningRun(): Promise<boolean> {
    const existing = await this.prisma.importRun.findFirst({
      where: { provider: this.provider, status: "running" },
      select: { id: true },
    });
    return existing !== null;
  }

  /**
   * Look up the durable cross-run resume cursor (BRI-181): the most recent
   * *non-running* run for this provider that ever observed a `lastCursor`
   * value, regardless of that run's terminal status. Per Viator's own
   * ongoing-refresh contract (verified live against partnerresources.viator.com,
   * not memory), cursor-based walking is guaranteed not to miss any product
   * update regardless of exactly where a new cycle resumes from, and every
   * upsert in this pipeline is idempotent (see `TourUpsertService`) — so a
   * `failed` or `aborted` prior run is exactly as safe to resume from as a
   * `succeeded` one. Forcing a full re-crawl after any non-`succeeded` run
   * would burn bandwidth (the whole reason BRI-181 exists) for no
   * correctness benefit. A `running` row is excluded — its progress isn't a
   * settled resume point yet. Returns `null` (full crawl) when no row has
   * ever observed a `nextCursor` at all — this deployment's first run.
   */
  private async lookupResumeCursor(): Promise<string | null> {
    const previous = await this.prisma.importRun.findFirst({
      where: {
        provider: this.provider,
        status: { not: "running" },
        lastCursor: { not: null },
      },
      orderBy: { startedAt: "desc" },
    });
    return previous?.lastCursor ?? null;
  }

  /**
   * Finalize a run this class itself is failing (a child died abnormally).
   *
   * Reconciles `upserted` against a real `Tour` count before writing the
   * terminal state — see this class's own docstring ("Ledger/reality
   * reconciliation") for why only this one counter can be recovered this
   * way. Every other field is left as whatever the last successfully
   * completed segment already wrote.
   */
  private async finalize(run: ImportRun, error: string): Promise<ImportRun> {
    const upserted = await this.prisma.tour.count({
      where: { provider: run.provider, fetchedAt: run.startedAt },
    });
    return this.prisma.importRun.update({
      where: { id: run.id },
      data: { status: "failed", error, upserted, finishedAt: new Date() },
    });
  }
}
