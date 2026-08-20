import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { validateEnv } from "../../config/env.validation";
import { PrismaModule } from "../../prisma/prisma.module";
import { ImportCoreModule } from "./import-core.module";

/**
 * Segment-worker application module (BRI-176).
 *
 * The whole DI graph `segment-worker.cli.ts` boots — just {@link PrismaModule}
 * (global, needed by {@link ImportCoreModule}'s providers), env validation,
 * and the crawl DI itself. Deliberately excludes everything `ImportModule`
 * adds on top for the main API process (`ImportScheduler`, the HTTP
 * controller, `ImportRunService`'s orchestration) — most importantly the
 * scheduler, whose registered cron job's timer would keep this short-lived
 * process alive indefinitely and break the parent's "spawn, wait for exit"
 * orchestration. See `ImportCoreModule`'s docstring.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    ImportCoreModule,
  ],
})
export class ImportSegmentWorkerModule {}
