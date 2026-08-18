import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import type { ViatorClient, ViatorPage } from "./clients/viator.client";
import type { ViatorProduct } from "./clients/viator.types";
import { ExperienceLinker } from "./experience-linker";
import { ImportPipeline } from "./import.pipeline";
import { ImportRunService } from "./import-run.service";
import type { LocationResolver } from "./location-resolver";
import type { TourDTO } from "./normalizer";
import type { PriceResolver } from "./price-resolver";
import { PrismaQuarantineStore } from "./quarantine-store.prisma";
import type { PrismaService } from "../../prisma/prisma.service";
import { TourUpsertService } from "./upsert";
import { TourValidator } from "./validator";

/**
 * End-to-end integration test for the ST-10 run (BRI-107), against a **real
 * Postgres**. It drives the exact production path a manual/scheduled trigger
 * takes — {@link ImportRunService.execute} → {@link ImportPipeline} →
 * (real validator + real upsert + real Prisma) — with only the Viator network
 * legs (product fetch, location resolve, price resolve) stubbed, since those need
 * live credentials. It proves the acceptance criteria that can't be faked:
 *
 * - every run leaves one `ImportRun` record with accurate status/counts/timestamps;
 * - a run actually writes validated tours to the live catalogue;
 * - a quarantined tour is counted and kept out of the catalogue;
 * - a guard-tripped run is recorded `aborted` (not `running`, not missing) and
 *   commits nothing.
 *
 * Requires `DATABASE_URL` pointed at a migrated dev database. Excluded from the
 * default `test` task (runs via `pnpm --filter @folio/api test:integration`).
 */

const DATABASE_URL = process.env.DATABASE_URL;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const PROVIDER = "viator";

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

function makeService(
  deleteGuardThresholdPct: number,
  products: ViatorProduct[],
  priceFor?: (code: string) => number | null,
) {
  // The bare PrismaClient satisfies the store's query surface; it only lacks
  // PrismaService's Nest lifecycle hooks, which this test doesn't exercise.
  const validator = new TourValidator(
    new PrismaQuarantineStore(prisma as unknown as PrismaService),
  );
  const upsert = new TourUpsertService(prisma);
  const linker = new ExperienceLinker(prisma);
  const pipeline = new ImportPipeline(
    client(products),
    resolver,
    priceResolverFor(priceFor),
    validator,
    upsert,
    linker,
  );
  return new ImportRunService(prisma, pipeline, { deleteGuardThresholdPct });
}

function activeCount(): Promise<number> {
  return prisma.tour.count({ where: { provider: PROVIDER, deletedAt: null } });
}

beforeEach(async () => {
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.quarantinedTour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.importRun.deleteMany({ where: { provider: PROVIDER } });
});

afterAll(async () => {
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.quarantinedTour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.importRun.deleteMany({ where: { provider: PROVIDER } });
  await prisma.$disconnect();
});

describe("ImportRunService end-to-end", () => {
  it("records a succeeded run and writes tours to the catalogue", async () => {
    const service = makeService(10, [
      rawProduct("A"),
      rawProduct("B"),
      rawProduct("C"),
    ]);

    const run = await service.execute("manual");

    expect(run.status).toBe("succeeded");
    expect(run.trigger).toBe("manual");
    expect(run.fetched).toBe(3);
    expect(run.normalized).toBe(3);
    expect(run.quarantined).toBe(0);
    expect(run.upserted).toBe(3);
    expect(run.softDeleted).toBe(0);
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.finishedAt).toBeInstanceOf(Date);
    // The run persisted exactly one record…
    expect(await prisma.importRun.count({ where: { provider: PROVIDER } })).toBe(1);
    // …and actually wrote the tours.
    expect(await activeCount()).toBe(3);
  });

  it("counts a quarantined tour and keeps it out of the catalogue", async () => {
    // "B" resolves to no price → quarantined by the real validator (MISSING_PRICE).
    const service = makeService(
      10,
      [rawProduct("A"), rawProduct("B")],
      (code) => (code === "B" ? null : 2500),
    );

    const run = await service.execute("manual");

    expect(run.status).toBe("succeeded");
    expect(run.fetched).toBe(2);
    expect(run.quarantined).toBe(1);
    expect(run.upserted).toBe(1);
    expect(await activeCount()).toBe(1);
    expect(
      await prisma.quarantinedTour.count({ where: { provider: PROVIDER } }),
    ).toBe(1);
  });

  it("records an aborted run and commits nothing when the guard trips", async () => {
    // Seed a 10-tour catalogue via a first successful run.
    const seed = Array.from({ length: 10 }, (_, i) => rawProduct(`t${i}`));
    await makeService(10, seed).execute("manual");
    expect(await activeCount()).toBe(10);

    // A second run returning nothing would soft-delete 100% → guard trips.
    const run = await makeService(10, []).execute("scheduled");

    expect(run.status).toBe("aborted");
    expect(run.error).toContain("Mass-deletion guard tripped");
    expect(run.upserted).toBe(0);
    expect(run.softDeleted).toBe(0);
    expect(run.finishedAt).toBeInstanceOf(Date);
    // The catalogue is untouched: nothing soft-deleted.
    expect(await activeCount()).toBe(10);
    // Both runs are recorded; none is left "running".
    expect(
      await prisma.importRun.count({
        where: { provider: PROVIDER, status: "running" },
      }),
    ).toBe(0);
    expect(await prisma.importRun.count({ where: { provider: PROVIDER } })).toBe(2);
  });

  it("is idempotent: a re-run creates no new tours and soft-deletes nothing", async () => {
    const products = [rawProduct("A"), rawProduct("B")];
    await makeService(10, products).execute("manual");
    const second = await makeService(10, products).execute("manual");

    expect(second.status).toBe("succeeded");
    expect(second.upserted).toBe(2);
    expect(second.softDeleted).toBe(0);
    expect(await activeCount()).toBe(2);
    expect(await prisma.tour.count({ where: { provider: PROVIDER } })).toBe(2);
  });
});
