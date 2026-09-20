import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import type { TourDTO } from "./normalizer";
import { MassDeletionAbortError, TourUpsertService } from "./upsert";

/**
 * Integration tests for {@link TourUpsertService} against a **real Postgres**
 * (ST-9 / BRI-106, restructured for BRI-170). These are the acceptance-criteria
 * tests the story insists be run, not inspected:
 *
 * - idempotency proven by running the same import twice and counting rows;
 * - soft-delete of an active-but-absent tour, and its revival;
 * - the mass-deletion guard tripping and rolling back *only the soft-delete*
 *   (BRI-170: upserts are no longer gated behind the guard — see the Design
 *   Decision in the BRI-170 plan for why);
 * - transactional rollback of one page's batch when a write fails part way
 *   through it.
 *
 * Requires `DATABASE_URL` pointed at a migrated dev database (see
 * jest.integration.config.js). Excluded from the default `test` task.
 */

const DATABASE_URL = process.env.DATABASE_URL;

const prisma = new PrismaClient(
  DATABASE_URL
    ? { datasources: { db: { url: DATABASE_URL } } }
    : undefined,
);

const PROVIDER = "viator";
const DEFAULT_OPTS = { deleteGuardThresholdPct: 10 };

/** A valid, upsertable DTO. Override single fields per test. */
function makeTour(id: string, overrides: Partial<TourDTO> = {}): TourDTO {
  return {
    provider: "viator",
    provider_tour_id: id,
    title: `Tour ${id}`,
    description: "A tour.",
    duration_min: 120,
    rating_avg: 4.5,
    rating_count: 100,
    price_minor: 2500,
    currency: "USD",
    price_reference_minor: null,
    price_reference_currency: null,
    affiliate_url: `https://www.viator.com/tours/${id}`,
    location_ref: "LOC-abc123",
    latitude: 21.03,
    longitude: 105.85,
    image_url: null,
    image_alt: null,
    destination_refs: ["351"],
    tags: [],
    images: [],
    inclusions: [],
    exclusions: [],
    cancellation_policy: null,
    reviews_by_source: [],
    fetched_at: "2026-07-24T00:00:00.000Z",
    source_hash: `hash-${id}`,
    ...overrides,
  };
}

function service(): TourUpsertService {
  return new TourUpsertService(prisma);
}

/** Count active (non-soft-deleted) tours for the provider. */
function activeCount(): Promise<number> {
  return prisma.tour.count({ where: { provider: PROVIDER, deletedAt: null } });
}

/** Total tours (including soft-deleted) for the provider. */
function totalCount(): Promise<number> {
  return prisma.tour.count({ where: { provider: PROVIDER } });
}

/** Run one full "import" against a set of tours: upsert, then finalize. */
async function runFull(
  svc: TourUpsertService,
  tours: TourDTO[],
  opts = DEFAULT_OPTS,
) {
  const batch = await svc.upsertBatch(tours);
  const finalize = await svc.finalizeGuardedSoftDelete(
    tours.map((t) => t.provider_tour_id),
    PROVIDER,
    opts,
  );
  return { batch, finalize };
}

beforeEach(async () => {
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
});

afterAll(async () => {
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.$disconnect();
});

describe("idempotency — running the same import twice", () => {
  it("creates 0 new rows on the second run", async () => {
    const svc = service();
    const tours = [makeTour("A"), makeTour("B"), makeTour("C")];

    const first = await runFull(svc, tours);
    expect(first.batch.upserted).toBe(3);
    expect(first.finalize.softDeleted).toBe(0);
    expect(await totalCount()).toBe(3);
    expect(await activeCount()).toBe(3);

    // Capture ids so we can prove the exact same rows survive (no churn).
    const idsAfterFirst = (
      await prisma.tour.findMany({
        where: { provider: PROVIDER },
        select: { id: true },
        orderBy: { providerTourId: "asc" },
      })
    ).map((r) => r.id);

    const second = await runFull(svc, tours);
    expect(second.finalize.softDeleted).toBe(0);
    // The invariant: identical run → identical row count, no inserts.
    expect(await totalCount()).toBe(3);
    expect(await activeCount()).toBe(3);

    const idsAfterSecond = (
      await prisma.tour.findMany({
        where: { provider: PROVIDER },
        select: { id: true },
        orderBy: { providerTourId: "asc" },
      })
    ).map((r) => r.id);
    expect(idsAfterSecond).toEqual(idsAfterFirst);
  });

  it("updates mutable fields in place on re-run (no duplicate row)", async () => {
    const svc = service();
    await runFull(svc, [makeTour("A", { price_minor: 2500 })]);

    await runFull(svc, [
      makeTour("A", { price_minor: 9900, source_hash: "hash-A-v2" }),
    ]);

    const row = await prisma.tour.findUniqueOrThrow({
      where: {
        provider_providerTourId: { provider: PROVIDER, providerTourId: "A" },
      },
    });
    expect(row.priceMinor).toBe(9900n);
    expect(row.sourceHash).toBe("hash-A-v2");
    expect(await totalCount()).toBe(1);
  });
});

describe("soft-delete of active-but-absent tours", () => {
  it("sets deletedAt on a tour missing from a later run", async () => {
    const svc = service();
    await runFull(svc, [makeTour("A"), makeTour("B"), makeTour("C")]);

    // Re-run without "C". 1 of 3 = 33% > 10%, so raise the threshold for this
    // legitimate drop (the guard is tested separately below).
    const { finalize } = await runFull(
      svc,
      [makeTour("A"), makeTour("B")],
      { deleteGuardThresholdPct: 90 },
    );

    expect(finalize.softDeleted).toBe(1);
    expect(await activeCount()).toBe(2);
    expect(await totalCount()).toBe(3); // C still present, just tombstoned

    const c = await prisma.tour.findUniqueOrThrow({
      where: {
        provider_providerTourId: { provider: PROVIDER, providerTourId: "C" },
      },
    });
    expect(c.deletedAt).not.toBeNull();
  });

  it("read paths filtering deletedAt: null exclude the soft-deleted row", async () => {
    const svc = service();
    await runFull(svc, [makeTour("A"), makeTour("B")]);
    await runFull(svc, [makeTour("A")], { deleteGuardThresholdPct: 90 });

    const visible = await prisma.tour.findMany({
      where: { provider: PROVIDER, deletedAt: null },
      select: { providerTourId: true },
    });
    expect(visible.map((r) => r.providerTourId)).toEqual(["A"]);
  });

  it("revives a previously soft-deleted tour when it reappears", async () => {
    const svc = service();
    await runFull(svc, [makeTour("A"), makeTour("B")]);
    await runFull(svc, [makeTour("A")], { deleteGuardThresholdPct: 90 }); // B tombstoned

    // B comes back in a later run → deletedAt cleared.
    await runFull(svc, [makeTour("A"), makeTour("B")]);

    const b = await prisma.tour.findUniqueOrThrow({
      where: {
        provider_providerTourId: { provider: PROVIDER, providerTourId: "B" },
      },
    });
    expect(b.deletedAt).toBeNull();
    expect(await activeCount()).toBe(2);
    expect(await totalCount()).toBe(2); // revived, not re-inserted
  });
});

describe("mass-deletion guard — now scoped to only the soft-delete step", () => {
  it("BRI-170: upserts everything it saw even when the guard later trips, but soft-deletes nothing", async () => {
    const svc = service();
    // Seed 10 active tours.
    const seed = Array.from({ length: 10 }, (_, i) => makeTour(`t${i}`));
    await runFull(svc, seed);
    expect(await activeCount()).toBe(10);

    // A later "run" upserts t0 (mutated) + t3..t9 — 8 of 10 — omitting t1, t2.
    // Under the old single-transaction upsertRun, this whole thing rolled back
    // and t0's title was never touched. Under the new design, upsertBatch is
    // unconditional: it commits t0's new title regardless of what the guard
    // later decides about the soft-delete.
    const NEW_TITLE = "Retitled on a run that will later trip the guard";
    const badRunTours = [
      makeTour("t0", { title: NEW_TITLE }),
      ...seed.slice(3),
    ];
    const badRunIds = badRunTours.map((t) => t.provider_tour_id);

    const batchResult = await svc.upsertBatch(badRunTours);
    expect(batchResult.upserted).toBe(8);

    // 2 of 10 active (t1, t2) would be soft-deleted = 20% > 10% threshold → abort.
    await expect(
      svc.finalizeGuardedSoftDelete(badRunIds, PROVIDER, DEFAULT_OPTS),
    ).rejects.toBeInstanceOf(MassDeletionAbortError);

    // The upsert already committed: t0's title WAS changed.
    const t0 = await prisma.tour.findUniqueOrThrow({
      where: {
        provider_providerTourId: { provider: PROVIDER, providerTourId: "t0" },
      },
    });
    expect(t0.title).toBe(NEW_TITLE);

    // But nothing was soft-deleted — the guard's rollback covers only that step.
    expect(await activeCount()).toBe(10);
    expect(await totalCount()).toBe(10);
  });

  it("carries the actual percentage and threshold on the error", async () => {
    const svc = service();
    const seed = Array.from({ length: 10 }, (_, i) => makeTour(`t${i}`));
    await runFull(svc, seed);

    let caught: unknown;
    try {
      const survivors = seed.slice(3); // drop 3 of 10 = 30%
      await svc.upsertBatch(survivors);
      await svc.finalizeGuardedSoftDelete(
        survivors.map((t) => t.provider_tour_id),
        PROVIDER,
        DEFAULT_OPTS,
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(MassDeletionAbortError);
    const err = caught as MassDeletionAbortError;
    expect(err.wouldDeleteCount).toBe(3);
    expect(err.activeCount).toBe(10);
    expect(err.deletionPct).toBeCloseTo(30);
    expect(err.thresholdPct).toBe(10);
  });

  it("does not abort a first run (empty catalogue), even inserting many", async () => {
    const svc = service();
    const seed = Array.from({ length: 50 }, (_, i) => makeTour(`t${i}`));
    const { batch, finalize } = await runFull(svc, seed);
    expect(batch.upserted).toBe(50);
    expect(finalize.softDeleted).toBe(0);
    expect(await activeCount()).toBe(50);
  });
});

describe("transactional integrity — failure part way through one batch", () => {
  it("rolls back all upserts in the batch when one row fails mid-batch", async () => {
    const svc = service();

    // durationMin is (and stays, per BRI-175) a Postgres INTEGER; a value past
    // 2^31-1 overflows and the DB rejects the upsert — a real failure occurring
    // *after* the first row has already been written inside upsertBatch's
    // transaction. (priceMinor itself is BIGINT as of BRI-175, so it can no
    // longer trigger this the way it used to — durationMin still can.)
    const OVERFLOW = 9_999_999_999;
    const batch = [
      makeTour("ok-1"),
      makeTour("boom", { duration_min: OVERFLOW }),
      makeTour("ok-2"),
    ];

    await expect(svc.upsertBatch(batch)).rejects.toThrow();

    // The whole batch transaction rolled back: not even "ok-1" (written
    // before the failure) survives.
    expect(await totalCount()).toBe(0);
  });

  it("leaves a pre-existing catalogue untouched when a later batch fails mid-write", async () => {
    const svc = service();
    await runFull(svc, [makeTour("keep")]);
    expect(await activeCount()).toBe(1);

    const batch = [
      makeTour("keep", { price_minor: 3300 }), // would-be update
      makeTour("boom", { duration_min: 9_999_999_999 }), // overflow → fail
    ];
    await expect(svc.upsertBatch(batch)).rejects.toThrow();

    // "keep" retains its original price; "boom" was never inserted.
    const keep = await prisma.tour.findUniqueOrThrow({
      where: {
        provider_providerTourId: { provider: PROVIDER, providerTourId: "keep" },
      },
    });
    expect(keep.priceMinor).toBe(2500n);
    expect(await totalCount()).toBe(1);
  });
});

describe("high-value minor-unit prices (BRI-175)", () => {
  it("upserts a price that would overflow a 32-bit INTEGER column", async () => {
    const svc = service();
    // The real value that failed in production: a VND-priced Hanoi tour whose
    // minor-unit price (2,850,000,000) exceeds INT4's 2,147,483,647 ceiling.
    const tour = makeTour("vnd-high-value", {
      price_minor: 2_850_000_000,
      currency: "VND",
    });

    const result = await svc.upsertBatch([tour]);
    expect(result.upserted).toBe(1);

    const row = await prisma.tour.findUniqueOrThrow({
      where: {
        provider_providerTourId: { provider: PROVIDER, providerTourId: "vnd-high-value" },
      },
    });
    expect(row.priceMinor).toBe(2_850_000_000n);
    expect(row.currency).toBe("VND");
  });
});
