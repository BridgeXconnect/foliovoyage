import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import { CategoryResolver } from "./category-resolver";
import { ViatorClient } from "./clients/viator.client";
import { ExchangeRateResolver, PrismaExchangeRateCache } from "./exchange-rate-resolver";
import { ExperienceAutoPromoter } from "./experience-auto-promoter";
import { ExperienceLinker } from "./experience-linker";
import { AllowlistFetch } from "./http/allowlist-fetch";
import { ImportPipeline } from "./import.pipeline";
import { PrismaLocationCache } from "./location-cache.prisma";
import {
  LocationResolver,
  type LocationCache,
} from "./location-resolver";
import { PriceResolver } from "./price-resolver";
import { PrismaQuarantineStore } from "./quarantine-store.prisma";
import { ReferencePriceResolver } from "./reference-price";
import {
  R2RawArchiveStore,
  type RawArchiveStore,
} from "./storage/raw-archive.store";
import { PrismaTagVocabularyCache, TagResolver } from "./tag-resolver";
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
 * Ingest core module (ST-6 / BRI-103, split out of `ImportModule` by BRI-176).
 *
 * Everything a crawl *segment* needs to run — {@link ViatorClient},
 * {@link LocationResolver}, {@link PriceResolver}, {@link TourValidator},
 * {@link TourUpsertService}, {@link ExperienceLinker}, {@link ImportPipeline}
 * — and nothing else: no HTTP controller, no `ScheduleModule`/cron. That
 * split matters, not just for tidiness: `segment-worker.cli.ts` (BRI-176)
 * boots this module alone in a short-lived child process, and a registered
 * cron job's timer (from the *full* `ImportModule`'s `ImportScheduler`)
 * would keep that process alive indefinitely — the child would never exit,
 * breaking the parent's "spawn, wait for exit" orchestration entirely. The
 * full `ImportModule` re-exports everything here and adds the
 * scheduler/controller/`ImportRunService` orchestrator on top, for the main
 * API process.
 */
@Module({
  providers: [
    {
      provide: VIATOR_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): AllowlistFetch => {
        const baseUrl = config.get("VIATOR_API_BASE_URL", { infer: true });
        // Only the Viator API host is reachable through this fetcher.
        return new AllowlistFetch([new URL(baseUrl).hostname], undefined, {
          timeoutMs: config.get("VIATOR_REQUEST_TIMEOUT_MS", { infer: true }),
        });
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
      // BRI-165: resolves the "from" price per product from
      // `/availability/schedules/{code}`. Reuses VIATOR_HTTP — the same
      // host-allowlisted fetcher — so schedules calls share the SSRF guard. No
      // persistent cache: a "from" price is volatile, so it is fetched per run.
      provide: PriceResolver,
      inject: [ConfigService, VIATOR_HTTP],
      useFactory: (
        config: ConfigService<Env, true>,
        http: AllowlistFetch,
      ): PriceResolver =>
        new PriceResolver(
          {
            baseUrl: config.get("VIATOR_API_BASE_URL", { infer: true }),
            apiKey: config.get("VIATOR_API_KEY", { infer: true }),
            language: config.get("VIATOR_API_LANGUAGE", { infer: true }),
          },
          http,
        ),
    },
    {
      // Category/currency promotion plan Task 2: caches Viator /exchange-rates
      // in ProviderExchangeRate, honoring each rate's own expiry. Reuses
      // VIATOR_HTTP — same host-allowlisted fetcher as the crawl/location/price
      // resolvers.
      provide: ExchangeRateResolver,
      inject: [ConfigService, VIATOR_HTTP, PrismaService],
      useFactory: (
        config: ConfigService<Env, true>,
        http: AllowlistFetch,
        prisma: PrismaService,
      ): ExchangeRateResolver => {
        const targetCurrency = config.get("PRICE_REFERENCE_CURRENCY", {
          infer: true,
        });
        return new ExchangeRateResolver(
          {
            baseUrl: config.get("VIATOR_API_BASE_URL", { infer: true }),
            apiKey: config.get("VIATOR_API_KEY", { infer: true }),
            language: config.get("VIATOR_API_LANGUAGE", { infer: true }),
            targetCurrency,
          },
          http,
          new PrismaExchangeRateCache(prisma, targetCurrency),
        );
      },
    },
    {
      // Task 4: converts each tour's supplier-currency "from" price to a
      // PRICE_REFERENCE_CURRENCY (USD) reference price at ingest time, one
      // batched FX-rate resolve per page.
      provide: ReferencePriceResolver,
      inject: [ExchangeRateResolver, ConfigService],
      useFactory: (
        rates: ExchangeRateResolver,
        config: ConfigService<Env, true>,
      ): ReferencePriceResolver =>
        new ReferencePriceResolver(
          rates,
          config.get("PRICE_REFERENCE_CURRENCY", { infer: true }),
        ),
    },
    {
      // BRI-224: caches Viator's tag vocabulary (`/products/tags`) in
      // ViatorTag, refreshed wholesale every 7 days. Reuses VIATOR_HTTP — same
      // host-allowlisted fetcher as the crawl/location/price resolvers.
      provide: TagResolver,
      inject: [ConfigService, VIATOR_HTTP, PrismaService],
      useFactory: (
        config: ConfigService<Env, true>,
        http: AllowlistFetch,
        prisma: PrismaService,
      ): TagResolver =>
        new TagResolver(
          {
            baseUrl: config.get("VIATOR_API_BASE_URL", { infer: true }),
            apiKey: config.get("VIATOR_API_KEY", { infer: true }),
            language: config.get("VIATOR_API_LANGUAGE", { infer: true }),
          },
          http,
          new PrismaTagVocabularyCache(prisma),
        ),
    },
    {
      // BRI-224: derives each tour's primaryCategoryTagId from its tags,
      // against the vocabulary TagResolver resolves.
      provide: CategoryResolver,
      inject: [TagResolver],
      useFactory: (tagResolver: TagResolver): CategoryResolver =>
        new CategoryResolver(tagResolver),
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
      // ST-11: auto-creates/links draft Experiences from imported tours.
      provide: ExperienceLinker,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): ExperienceLinker =>
        new ExperienceLinker(prisma),
    },
    {
      // Category/currency promotion plan Task 8: promotes eligible draft
      // Experiences to published after every successful import run.
      provide: ExperienceAutoPromoter,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): ExperienceAutoPromoter =>
        new ExperienceAutoPromoter(prisma),
    },
    {
      // ST-10: threads the stages above into one bounded segment (BRI-176).
      provide: ImportPipeline,
      inject: [
        ViatorClient,
        LocationResolver,
        PriceResolver,
        ReferencePriceResolver,
        CategoryResolver,
        TourValidator,
        TourUpsertService,
      ],
      useFactory: (
        client: ViatorClient,
        resolver: LocationResolver,
        priceResolver: PriceResolver,
        referencePriceResolver: ReferencePriceResolver,
        categoryResolver: CategoryResolver,
        validator: TourValidator,
        upsert: TourUpsertService,
      ): ImportPipeline =>
        new ImportPipeline(
          client,
          resolver,
          priceResolver,
          referencePriceResolver,
          categoryResolver,
          validator,
          upsert,
        ),
    },
  ],
  exports: [
    ViatorClient,
    VIATOR_HTTP,
    RAW_ARCHIVE_STORE,
    LOCATION_CACHE,
    LocationResolver,
    PriceResolver,
    TagResolver,
    CategoryResolver,
    QUARANTINE_STORE,
    TourValidator,
    TourUpsertService,
    ExperienceLinker,
    ExperienceAutoPromoter,
    ImportPipeline,
  ],
})
export class ImportCoreModule {}
