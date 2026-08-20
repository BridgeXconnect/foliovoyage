import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";

import type { Env } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import { ImportCoreModule } from "./import-core.module";
import { ImportRunService } from "./import-run.service";
import { ImportTriggerController } from "./import-trigger.controller";
import { ExperiencePromoter } from "./promote-experience.service";
import { NodeSegmentRunner } from "./segment-runner";
import { ImportScheduler } from "./scheduler";

/**
 * Ingest module (ST-6 / BRI-103).
 *
 * The full module for the main API process: {@link ImportCoreModule}'s crawl
 * DI (re-exported unchanged) plus the pieces only the long-lived process
 * needs — the nightly cron ({@link ImportScheduler}), the external wake/
 * trigger endpoint ({@link ImportTriggerController}, BRI-173), and the
 * orchestrator ({@link ImportRunService}, restructured by BRI-176 to spawn a
 * `segment-worker.cli.ts` child per crawl segment rather than run the whole
 * crawl in-process — see that class's docstring).
 */
@Module({
  // ScheduleModule.forRoot() sets up the SchedulerRegistry the ImportScheduler
  // registers the nightly cron job on. It is idempotent to include once here.
  imports: [ImportCoreModule, ScheduleModule.forRoot()],
  // BRI-173: the external wake/trigger endpoint a GitHub Actions workflow
  // calls on Render's free tier, where the in-process cron above can't fire
  // while the service is asleep.
  controllers: [ImportTriggerController],
  providers: [
    {
      // ST-11: the manual draft→published promoter (stand-in for Admin review).
      provide: ExperiencePromoter,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): ExperiencePromoter =>
        new ExperiencePromoter(prisma),
    },
    {
      // BRI-176: spawns a `segment-worker.cli.ts` child per crawl segment,
      // inheriting the parent's env — see ImportRunService's docstring.
      provide: NodeSegmentRunner,
      useFactory: (): NodeSegmentRunner => new NodeSegmentRunner(),
    },
    {
      // ST-10: orchestrates a run's segment-worker children and records each
      // run as an `import_run`. BRI-176: no longer runs the pipeline itself
      // — DELETE_GUARD_THRESHOLD_PCT and IMPORT_CRAWL_RESTART_PAGES are now
      // read by each segment-worker child directly from its own (inherited)
      // env, not threaded through here.
      provide: ImportRunService,
      inject: [PrismaService, NodeSegmentRunner, ConfigService],
      useFactory: (
        prisma: PrismaService,
        segmentRunner: NodeSegmentRunner,
        config: ConfigService<Env, true>,
      ): ImportRunService =>
        new ImportRunService(prisma, segmentRunner, {
          // BRI-170: the startup safeguard that reaps a run orphaned by a
          // crashed previous process (see ImportRunService.reapStuckRuns).
          stuckRunTimeoutMinutes: config.get(
            "IMPORT_STUCK_RUN_TIMEOUT_MINUTES",
            { infer: true },
          ),
          // BRI-173: Render-injected public URL, used only to self-heartbeat
          // during a run so the free tier's idle timer never trips mid-crawl.
          // Undefined off-Render, where the heartbeat no-ops.
          heartbeatUrl: config.get("RENDER_EXTERNAL_URL", { infer: true }),
        }),
    },
    // ST-10: registers the nightly cron trigger at boot (env-gated).
    ImportScheduler,
  ],
  exports: [
    // Re-exports every token ImportCoreModule exports (ViatorClient,
    // VIATOR_HTTP, LocationResolver, PriceResolver, TourValidator,
    // TourUpsertService, ExperienceLinker, ImportPipeline, …) unchanged, so
    // nothing outside this module (or its tests) needs to know the crawl DI
    // moved there.
    ImportCoreModule,
    ExperiencePromoter,
    ImportRunService,
  ],
})
export class ImportModule {}
