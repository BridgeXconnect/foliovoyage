import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";

import type { Env } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import { ViatorClient } from "./clients/viator.client";
import { AllowlistFetch } from "./http/allowlist-fetch";
import { ImportRunService } from "./import-run.service";
import { ImportPipeline } from "./import.pipeline";
import { PrismaLocationCache } from "./location-cache.prisma";
import {
  LocationResolver,
  type LocationCache,
} from "./location-resolver";
import { PrismaQuarantineStore } from "./quarantine-store.prisma";
import { ImportScheduler } from "./scheduler";
import {
  R2RawArchiveStore,
  type RawArchiveStore,
} from "./storage/raw-archive.store";
import { TourUpsertService } from "./upsert";
import { TourValidator, type QuarantineStore } from "./validator";

/** DI token for the SSRF-safe fetcher scoped to the Viator host. */
export const VIATOR_HTTP = Symbol("VIATOR_HTTP");
/** DI token for the raw-payload archive store. */
export const RAW_ARCHIVE_STORE = Symbol("RAW_ARCHIVE_STORE");
/** DI token for the persistent resolved-location cache. */
export const LOCATION_CACHE = Symbol("LOCATION_CACHE");
/** DI token for the persistent quarantine store. */
export const QUARANTINE_STORE = Symbol("QUARANTINE_STORE");

/**
 * Ingest module (ST-6 / BRI-103).
 *
 * Wires the Viator client together from validated env: an {@link AllowlistFetch}
 * locked to the Viator API host, an R2-backed {@link RawArchiveStore}, and the
 * {@link ViatorClient} itself. Downstream ingest stories (ST-7 normalization,
 * ST-8 scheduling) consume {@link ViatorClient} from here.
 */
@Module({
  // ScheduleModule.forRoot() sets up the SchedulerRegistry the ImportScheduler
  // registers the nightly cron job on. It is idempotent to include once here.
  imports: [ScheduleModule.forRoot()],
  providers: [
    {
      provide: VIATOR_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): AllowlistFetch => {
        const baseUrl = config.get("VIATOR_API_BASE_URL", { infer: true });
        // Only the Viator API host is reachable through this fetcher.
        return new AllowlistFetch([new URL(baseUrl).hostname]);
      },
    },
    {
      provide: RAW_ARCHIVE_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RawArchiveStore =>
        new R2RawArchiveStore({
          endpoint: config.get("R2_ENDPOINT", { infer: true }),
          bucket: config.get("R2_BUCKET", { infer: true }),
          accessKeyId: config.get("R2_ACCESS_KEY_ID", { infer: true }),
          secretAccessKey: config.get("R2_SECRET_ACCESS_KEY", { infer: true }),
        }),
    },
    {
      provide: ViatorClient,
      inject: [ConfigService, VIATOR_HTTP, RAW_ARCHIVE_STORE],
      useFactory: (
        config: ConfigService<Env, true>,
        http: AllowlistFetch,
        archive: RawArchiveStore,
      ): ViatorClient =>
        new ViatorClient(
          {
            baseUrl: config.get("VIATOR_API_BASE_URL", { infer: true }),
            apiKey: config.get("VIATOR_API_KEY", { infer: true }),
            language: config.get("VIATOR_API_LANGUAGE", { infer: true }),
          },
          http,
          archive,
        ),
    },
    {
      provide: LOCATION_CACHE,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): LocationCache =>
        new PrismaLocationCache(prisma),
    },
    {
      // Reuses VIATOR_HTTP — the same host-allowlisted fetcher ST-6 uses — so
      // /locations/bulk is subject to the same SSRF guard as the crawl.
      provide: LocationResolver,
      inject: [ConfigService, VIATOR_HTTP, LOCATION_CACHE],
      useFactory: (
        config: ConfigService<Env, true>,
        http: AllowlistFetch,
        cache: LocationCache,
      ): LocationResolver =>
        new LocationResolver(
          {
            baseUrl: config.get("VIATOR_API_BASE_URL", { infer: true }),
            apiKey: config.get("VIATOR_API_KEY", { infer: true }),
            language: config.get("VIATOR_API_LANGUAGE", { infer: true }),
          },
          http,
          cache,
        ),
    },
    {
      provide: QUARANTINE_STORE,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): QuarantineStore =>
        new PrismaQuarantineStore(prisma),
    },
    {
      provide: TourValidator,
      inject: [QUARANTINE_STORE],
      useFactory: (store: QuarantineStore): TourValidator =>
        new TourValidator(store),
    },
    {
      // Writes validated rows to the live catalogue. The abort-guard threshold
      // is passed per-run (from DELETE_GUARD_THRESHOLD_PCT) by the caller, so
      // the service itself only needs Prisma.
      provide: TourUpsertService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): TourUpsertService =>
        new TourUpsertService(prisma),
    },
    {
      // ST-10: threads the stages above into one straight-through run.
      provide: ImportPipeline,
      inject: [
        ViatorClient,
        LocationResolver,
        TourValidator,
        TourUpsertService,
      ],
      useFactory: (
        client: ViatorClient,
        resolver: LocationResolver,
        validator: TourValidator,
        upsert: TourUpsertService,
      ): ImportPipeline =>
        new ImportPipeline(client, resolver, validator, upsert),
    },
    {
      // ST-10: runs the pipeline and records each run as an `import_run`. The
      // abort threshold is read from validated env and injected as config.
      provide: ImportRunService,
      inject: [PrismaService, ImportPipeline, ConfigService],
      useFactory: (
        prisma: PrismaService,
        pipeline: ImportPipeline,
        config: ConfigService<Env, true>,
      ): ImportRunService =>
        new ImportRunService(prisma, pipeline, {
          deleteGuardThresholdPct: config.get("DELETE_GUARD_THRESHOLD_PCT", {
            infer: true,
          }),
        }),
    },
    // ST-10: registers the nightly cron trigger at boot (env-gated).
    ImportScheduler,
  ],
  exports: [
    ViatorClient,
    VIATOR_HTTP,
    RAW_ARCHIVE_STORE,
    LOCATION_CACHE,
    LocationResolver,
    QUARANTINE_STORE,
    TourValidator,
    TourUpsertService,
    ImportPipeline,
    ImportRunService,
  ],
})
export class ImportModule {}
