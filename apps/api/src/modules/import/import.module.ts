import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import { ViatorClient } from "./clients/viator.client";
import { AllowlistFetch } from "./http/allowlist-fetch";
import { PrismaLocationCache } from "./location-cache.prisma";
import {
  LocationResolver,
  type LocationCache,
} from "./location-resolver";
import { PrismaQuarantineStore } from "./quarantine-store.prisma";
import {
  R2RawArchiveStore,
  type RawArchiveStore,
} from "./storage/raw-archive.store";
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
  ],
  exports: [
    ViatorClient,
    VIATOR_HTTP,
    RAW_ARCHIVE_STORE,
    LOCATION_CACHE,
    LocationResolver,
    QUARANTINE_STORE,
    TourValidator,
  ],
})
export class ImportModule {}
