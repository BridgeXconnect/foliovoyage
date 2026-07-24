import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";

import type { Env } from "../../config/env.validation";
import { ImportRunService } from "./import-run.service";

/**
 * Nightly import scheduler (ST-10 / BRI-107).
 *
 * Registers a single cron job at boot that fires the full ingest pipeline on its
 * own — no manual intervention — and records each firing as an `import_run` via
 * {@link ImportRunService}. The schedule (default 03:00 daily) and whether it is
 * registered at all are both env-driven (`IMPORT_CRON_SCHEDULE`,
 * `IMPORT_CRON_ENABLED`), so a code change is never needed to retune or to keep
 * a background crawl from firing in local dev / CI.
 *
 * The job is registered dynamically through {@link SchedulerRegistry} rather than
 * with a static `@Cron` decorator precisely so the expression can come from
 * validated config. The scheduler stays deliberately thin: it owns *when* a run
 * fires, nothing about *how* a run works — the pipeline, counts, and record are
 * all {@link ImportRunService}'s job.
 *
 * Scope note (M1 is synchronous): this is a direct in-process call, not a job
 * enqueued onto a queue/worker. A queue is ST-33 (M6), explicitly not this story.
 */
@Injectable()
export class ImportScheduler implements OnModuleInit {
  /** Registry key for the one nightly job — also used to look it up in tests. */
  static readonly JOB_NAME = "nightly-import";

  private readonly logger = new Logger(ImportScheduler.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly registry: SchedulerRegistry,
    private readonly runService: ImportRunService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get("IMPORT_CRON_ENABLED", { infer: true });
    if (!enabled) {
      this.logger.log(
        "Nightly import disabled (IMPORT_CRON_ENABLED=false); no job registered.",
      );
      return;
    }

    const schedule = this.config.get("IMPORT_CRON_SCHEDULE", { infer: true });
    const job = CronJob.from({
      cronTime: schedule,
      onTick: () => {
        void this.trigger();
      },
    });

    this.registry.addCronJob(ImportScheduler.JOB_NAME, job);
    job.start();
    this.logger.log(`Nightly import scheduled (cron: "${schedule}").`);
  }

  /**
   * Fire one scheduled run. {@link ImportRunService.execute} never re-throws —
   * it records failure/abort on the run row — so a bad night can't crash the
   * scheduler; the `catch` here is a last-resort guard for anything truly
   * unexpected, keeping the tick handler from surfacing an unhandled rejection.
   */
  private async trigger(): Promise<void> {
    try {
      await this.runService.execute("scheduled");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Scheduled import trigger errored unexpectedly: ${message}`);
    }
  }
}
