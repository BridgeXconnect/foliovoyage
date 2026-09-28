import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import type { CategoryResolver } from "./category-resolver";
import type { ViatorClient, ViatorPage } from "./clients/viator.client";
import type { ViatorProduct } from "./clients/viator.types";
import { ExperienceAutoPromoter } from "./experience-auto-promoter";
import { ExperienceLinker } from "./experience-linker";
import { ImportPipeline, ImportRunCounts } from "./import.pipeline";
import type { LocationResolver } from "./location-resolver";
import type { TourDTO } from "./normalizer";
import type { PriceResolver } from "./price-resolver";
import type { ReferencePriceResolver } from "./reference-price";
import { PrismaQuarantineStore } from "./quarantine-store.prisma";
import type { PrismaService } from "../../prisma/prisma.service";
import { MassDeletionAbortError, TourUpsertService } from "./upsert";
import { TourValidator } from "./validator";

/**
 * Integration test for the ST-10 run's data path (BRI-107, restructured by
 * BRI-176), against a **real Postgres**. Drives {@link ImportPipeline} +
 * (real validator + real upsert + real `ExperienceLinker` + real Prisma)
 * directly — the same stages a real `segment-worker.cli.ts` child threads
 * together, minus its own process boundary and DB-row bookkeeping (covered
 * separately by `segment-worker.integration.spec.ts`, which spawns the real
 * compiled CLI as a child process). Only the Viator network legs (product
 * fetch, location resolve, price resolve) are stubbed, since those need live
 * credentials. It proves the acceptance criteria that can't be faked:
 *
 * - a run actually writes validated tours to the live catalogue;
 * - a quarantined tour is counted and kept out of the catalogue;
 * - a guard-tripped run commits its upserts but rolls back only the
 *   soft-delete (BRI-170);
 * - re-running is idempotent: no new tours, nothing soft-deleted;
 * - `TourUpsertService.findUpsertedIds` (BRI-176) reconstructs the exact
 *   same incoming-id set `finalizeGuardedSoftDelete` needs, straight from
 *   the DB — the mechanism that replaces carrying that list across process
 *   boundaries.
 *
 * Requires `DATABASE_URL` pointed at a migrated dev database. Excluded from the
 * default `test` task (runs via `pnpm --filter @folio/api test:integration`).
 */

const DATABASE_URL = process.env.DATABASE_URL;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const PROVIDER = "viator";
const FETCHED_AT = new Date("2026-08-20T00:00:00.000Z");

/**
 * A raw Viator product the normalizer accepts and — since BRI-170 — that
 * survives the scope filter too (curated destination, ACTIVE, instant
 * confirmation), so these fixtures actually reach normalize/upsert.
 */
function rawProduct(code: string, overrides: Record<string, unknown> = {}): ViatorProduct {
  return {
    productCode: code,
    title: `Tour ${code}`,
    description: `Description ${code}`,
    status: "ACTIVE",
    destinations: [{ ref: "343", primary: true }], // Bangkok — a curated ref
    bookingConfirmationSettings: { confirmationType: "INSTANT" },
    // No price in the payload (BRI-165) — the price resolver attaches it below.
    reviews: { combinedAverageRating: 4.5, totalReviews: 100 },
    productUrl: `https://www.viator.com/tours/${code}`,
    ...overrides,
  };
}

/** A Viator client stub yielding one page of the given products. */
function client(products: ViatorProduct[]): ViatorClient {
  return {
    async *fetchModifiedSince(): AsyncGenerator<ViatorPage> {
      yield {
        page: 1,
        products,
        nextCursor: undefined,
        archive: { bucket: "test", key: "test" },
      };
    },
  } as unknown as ViatorClient;
}

/** A resolver that leaves coordinates null (the network leg is stubbed out). */
const resolver = {
  attachLocations: async (tours: TourDTO[]): Promise<TourDTO[]> =>
    tours.map((t) => ({ ...t })),
} as unknown as LocationResolver;

/**
 * A price resolver stub (the schedules network leg is stubbed out). Prices every
 * tour at a valid positive amount by default; `priceFor` returning `null` leaves
 * a tour unpriced so it quarantines.
 */
function priceResolverFor(
  priceFor: (code: string) => number | null = () => 2500,
): PriceResolver {
  return {
    attachPrices: async (tours: TourDTO[]): Promise<TourDTO[]> =>
      tours.map((t) => {
        const price = priceFor(t.provider_tour_id);
        return price === null
          ? { ...t }
          : { ...t, price_minor: price, currency: "USD" };
      }),
  } as unknown as PriceResolver;
}

/** A reference-price resolver that passes tours through unchanged. */
const passthroughReferencePriceResolver = {
  attachReferencePrices: async (tours: TourDTO[]): Promise<TourDTO[]> =>
    tours.map((t) => ({ ...t })),
} as unknown as ReferencePriceResolver;

/** A category resolver that passes tours through unchanged (no vocabulary needed here). */
const passthroughCategoryResolver = {
  attachCategories: async (tours: TourDTO[]): Promise<TourDTO[]> =>
    tours.map((t) => ({ ...t })),
} as unknown as CategoryResolver;

const upsert = new TourUpsertService(prisma);
const linker = new ExperienceLinker(prisma);
const autoPromoter = new ExperienceAutoPromoter(prisma);

/**
 * Runs one full (single-segment) crawl through `ImportPipeline.runSegment`
 * and then, mirroring exactly what `segment-worker.cli.ts` does when a
 * segment reports `done`, reconstructs `incomingIds` from the DB and calls
 * the finalize steps. Returns the same shape the old whole-run test cared
 * about, so the acceptance criteria below stay a direct, readable diff of
 * what changed.
 */
async function runOnce(
  deleteGuardThresholdPct: number,
  products: ViatorProduct[],
  priceFor?: (code: string) => number | null,
  isFullCrawl = true,
  referencePriceResolver: ReferencePriceResolver = passthroughReferencePriceResolver,
): Promise<{
  counts: ImportRunCounts;
  status: "succeeded" | "aborted";
  error: string | null;
  softDeleted: number;
  promoted: number;
}> {
  const validator = new TourValidator(
    new PrismaQuarantineStore(prisma as unknown as PrismaService),
  );
  const pipeline = new ImportPipeline(
    client(products),
    resolver,
    priceResolverFor(priceFor),
    referencePriceResolver,
    passthroughCategoryResolver,
    validator,
    upsert,
  );

  // A fresh timestamp per call (never the shared FETCHED_AT constant below)
  // — every real run gets a unique ImportRun.startedAt, and findUpsertedIds
  // matches by exact fetchedAt, so two `runOnce` calls sharing one timestamp
  // would incorrectly see each other's rows as "this run's" incoming set.
  const fetchedAt = new Date();
  const counts = new ImportRunCounts();
  const result = await pipeline.runSegment(counts, {
    fetchedAt: fetchedAt.toISOString(),
    restartEveryNPages: 1000,
  });
  expect(result.done).toBe(true); // every fixture here is one page

  // Mirrors segment-worker.cli.ts's own conditional (BRI-184): a delta run
  // (isFullCrawl === false) never even reconstructs incomingIds or calls
  // finalizeGuardedSoftDelete — it just links, auto-promotes (Task 8), and
  // succeeds.
  if (!isFullCrawl) {
    await linker.linkRun(PROVIDER);
    const promotion = await autoPromoter.promoteEligible(PROVIDER);
    return {
      counts,
      status: "succeeded",
      error: null,
      softDeleted: 0,
      promoted: promotion.promoted,
    };
  }

  const incomingIds = await upsert.findUpsertedIds(PROVIDER, fetchedAt);
  try {
    const deletion = await upsert.finalizeGuardedSoftDelete(incomingIds, PROVIDER, {
      deleteGuardThresholdPct,
    });
    await linker.linkRun(PROVIDER);
    // Task 8: auto-promote eligible drafts on every successful run, after
    // linking — never on the aborted path (the catch block below returns
    // without ever reaching this call).
    const promotion = await autoPromoter.promoteEligible(PROVIDER);
    return {
      counts,
      status: "succeeded",
      error: null,
      softDeleted: deletion.softDeleted,
      promoted: promotion.promoted,
    };
  } catch (error) {
    if (error instanceof MassDeletionAbortError) {
      return { counts, status: "aborted", error: error.message, softDeleted: 0, promoted: 0 };
    }
    throw error;
  }
}

function activeCount(): Promise<number> {
  return prisma.tour.count({ where: { provider: PROVIDER, deletedAt: null } });
}

beforeEach(async () => {
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.quarantinedTour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.importRun.deleteMany({ where: { provider: PROVIDER } });
  // Task 8: the auto-promotion tests below create/promote Experience rows
  // (unlike the pre-existing tests, which never assert on Experience state)
  // -- clean these up too, or a leftover published/draft row from a prior
  // run collides (unique sourceProvider+sourceProviderTourId) or skews a
  // later promoteEligible() scan count.
  await prisma.experience.deleteMany({ where: { sourceProvider: PROVIDER } });
});

afterAll(async () => {
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.quarantinedTour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.importRun.deleteMany({ where: { provider: PROVIDER } });
  await prisma.experience.deleteMany({ where: { sourceProvider: PROVIDER } });
  await prisma.$disconnect();
});

describe("ImportPipeline data path end-to-end", () => {
  it("writes tours to the catalogue on a clean segment", async () => {
    const { counts, status, softDeleted } = await runOnce(10, [
      rawProduct("A"),
      rawProduct("B"),
      rawProduct("C"),
    ]);

    expect(status).toBe("succeeded");
    expect(counts.fetched).toBe(3);
    expect(counts.normalized).toBe(3);
    expect(counts.quarantined).toBe(0);
    expect(counts.upserted).toBe(3);
    expect(softDeleted).toBe(0);
    expect(await activeCount()).toBe(3);
  });

  it("counts a quarantined tour and keeps it out of the catalogue", async () => {
    // "B" resolves to no price → quarantined by the real validator (MISSING_PRICE).
    const { counts, status } = await runOnce(
      10,
      [rawProduct("A"), rawProduct("B")],
      (code) => (code === "B" ? null : 2500),
    );

    expect(status).toBe("succeeded");
    expect(counts.fetched).toBe(2);
    expect(counts.quarantined).toBe(1);
    expect(counts.upserted).toBe(1);
    expect(await activeCount()).toBe(1);
    expect(
      await prisma.quarantinedTour.count({ where: { provider: PROVIDER } }),
    ).toBe(1);
  });

  it("commits nothing extra and rolls back only the soft-delete when the guard trips", async () => {
    // Seed a 10-tour catalogue via a first successful segment.
    const seed = Array.from({ length: 10 }, (_, i) => rawProduct(`t${i}`));
    await runOnce(10, seed);
    expect(await activeCount()).toBe(10);

    // A second, empty segment would soft-delete 100% → guard trips.
    const { status, error, softDeleted } = await runOnce(10, []);

    expect(status).toBe("aborted");
    expect(error).toContain("Mass-deletion guard tripped");
    expect(softDeleted).toBe(0);
    // The catalogue is untouched: nothing soft-deleted.
    expect(await activeCount()).toBe(10);
  });

  it("is idempotent: a re-run creates no new tours and soft-deletes nothing", async () => {
    const products = [rawProduct("A"), rawProduct("B")];
    await runOnce(10, products);
    const second = await runOnce(10, products);

    expect(second.status).toBe("succeeded");
    expect(second.counts.upserted).toBe(2);
    expect(second.softDeleted).toBe(0);
    expect(await activeCount()).toBe(2);
    expect(await prisma.tour.count({ where: { provider: PROVIDER } })).toBe(2);
  });

  it("BRI-176: findUpsertedIds reconstructs exactly the ids this fetchedAt touched, across multiple upsertBatch calls", async () => {
    // Two separate upsertBatch calls sharing one fetchedAt — simulating two
    // different segment-worker children in the same run.
    const dto = (code: string): TourDTO => ({
      provider: PROVIDER,
      provider_tour_id: code,
      title: `Tour ${code}`,
      description: null,
      duration_min: null,
      rating_avg: null,
      rating_count: null,
      price_minor: 2500,
      currency: "USD",
      price_reference_minor: null,
      price_reference_currency: null,
      affiliate_url: null,
      location_ref: null,
      latitude: null,
      longitude: null,
      image_url: null,
      image_alt: null,
      destination_refs: ["343"],
      tags: [],
      primary_category_tag_id: null,
      images: [],
      inclusions: [],
      exclusions: [],
      cancellation_policy: null,
      reviews_by_source: [],
      fetched_at: FETCHED_AT.toISOString(),
      source_hash: "hash",
    });

    await upsert.upsertBatch([dto("X")]);
    await upsert.upsertBatch([dto("Y")]);

    const ids = await upsert.findUpsertedIds(PROVIDER, FETCHED_AT);
    expect(ids.sort()).toEqual(["X", "Y"]);
  });
});

describe("delta runs never attempt the guarded soft-delete (BRI-184)", () => {
  it("succeeds with real upserts even when the diff would have tripped the guard on a full crawl", async () => {
    // Seed a 10-tour catalogue via a full-crawl segment.
    const seed = Array.from({ length: 10 }, (_, i) => rawProduct(`t${i}`));
    await runOnce(10, seed);
    expect(await activeCount()).toBe(10);

    // A second, near-empty segment (1 new tour) would soft-delete ~90% of
    // the catalogue on a full crawl -- guaranteed to trip a 10% threshold.
    // As a delta run, it must skip the guard entirely: real upsert commits,
    // status succeeded, softDeleted stays 0, and the existing 10 tours are
    // completely untouched (not even diffed).
    const { status, error, softDeleted, counts } = await runOnce(
      10,
      [rawProduct("new-tour")],
      undefined,
      false,
    );

    expect(status).toBe("succeeded");
    expect(error).toBeNull();
    expect(counts.upserted).toBe(1);
    expect(softDeleted).toBe(0);
    expect(await activeCount()).toBe(11); // 10 untouched + 1 new, nothing soft-deleted
  });

  it("still guards a full crawl exactly as before, including a genuine mass-deletion abort", async () => {
    const seed = Array.from({ length: 10 }, (_, i) => rawProduct(`t${i}`));
    await runOnce(10, seed);
    expect(await activeCount()).toBe(10);

    // Same guard-tripping scenario as the pre-existing full-crawl test
    // above, run again here to pin the "full crawl still guards" half of
    // BRI-184's acceptance criteria in the same describe block.
    const { status, error, softDeleted } = await runOnce(10, [], undefined, true);

    expect(status).toBe("aborted");
    expect(error).toContain("Mass-deletion guard tripped");
    expect(softDeleted).toBe(0);
    expect(await activeCount()).toBe(10);
  });
});

describe("auto-promotion after a successful run (Task 8)", () => {
  /**
   * A raw product with a cover image, so once linked (affiliate_url comes
   * free from productUrl) it's missing only a reference price to qualify
   * under `isPromotable` -- supplied by `pricedReferencePriceResolver` below.
   */
  function promotableRawProduct(code: string): ViatorProduct {
    return rawProduct(code, {
      images: [
        {
          isCover: true,
          caption: "cover",
          variants: [{ width: 540, height: 360, url: `https://img/${code}.jpg` }],
        },
      ],
    });
  }

  /**
   * Unlike the module-level passthrough, attaches a fixed positive USD
   * reference price to every tour -- the one field a promotable fixture
   * needs that the real (network-stubbed) FX leg would otherwise supply.
   */
  const pricedReferencePriceResolver = {
    attachReferencePrices: async (tours: TourDTO[]): Promise<TourDTO[]> =>
      tours.map((t) => ({
        ...t,
        price_reference_minor: 3000,
        price_reference_currency: "USD",
      })),
  } as unknown as ReferencePriceResolver;

  it("promotes the one eligible draft Experience once, after linkRun, on a successful run", async () => {
    const result = await runOnce(
      10,
      [promotableRawProduct("AP1")],
      undefined,
      true,
      pricedReferencePriceResolver,
    );

    expect(result.status).toBe("succeeded");
    expect(result.promoted).toBe(1);

    const experience = await prisma.experience.findFirstOrThrow({
      where: { sourceProvider: PROVIDER, sourceProviderTourId: "AP1" },
    });
    expect(experience.status).toBe("published");
  });

  it("does not promote anything when the run aborts (mass-deletion guard)", async () => {
    // Seed a full catalogue via a plain successful segment (not promotable --
    // irrelevant here, just needs to exist so the next segment's diff trips
    // the guard).
    const seed = Array.from({ length: 10 }, (_, i) => rawProduct(`g${i}`));
    await runOnce(10, seed);

    // A separate, directly-seeded draft Experience that WOULD be promoted if
    // promoteEligible ran -- bypasses the crawl pipeline entirely so its
    // presence either way is unambiguous evidence.
    const city = await prisma.city.findFirstOrThrow({
      where: { viatorDestRef: "343" },
    });
    const experience = await prisma.experience.create({
      data: {
        title: "Abort Test Tour",
        description: "Description",
        status: "draft",
        latitude: 13.75,
        longitude: 100.5,
        cityId: city.id,
        sourceProvider: PROVIDER,
        sourceProviderTourId: "AP-ABORT",
      },
    });
    await prisma.tour.create({
      data: {
        provider: PROVIDER,
        providerTourId: "AP-ABORT",
        title: "Abort Test Tour",
        experienceId: experience.id,
        imageUrl: "https://img/abort.jpg",
        affiliateUrl: "https://go/abort",
        priceReferenceMinor: 3000,
        priceMinor: 3000,
        currency: "USD",
        fetchedAt: new Date(),
        sourceHash: "hash-AP-ABORT",
      },
    });

    // An empty segment now soft-deletes the whole (11-tour) catalogue -> guard trips.
    const result = await runOnce(10, [], undefined, true, pricedReferencePriceResolver);

    expect(result.status).toBe("aborted");
    expect(result.promoted).toBe(0);

    const reloaded = await prisma.experience.findUniqueOrThrow({
      where: { id: experience.id },
    });
    expect(reloaded.status).toBe("draft");
  });
});
