import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import type { TourDTO } from "./normalizer";
import { MassDeletionAbortError, TourUpsertService } from "./upsert";

/**
 * Integration tests for {@link TourUpsertService} against a **real Postgres**
 * (ST-9 / BRI-106). These are the acceptance-criteria tests the story insists be
 * run, not inspected:
 *
 * - idempotency proven by running the same import twice and counting rows;
 * - soft-delete of an active-but-absent tour, and its revival;
 * - the mass-deletion guard tripping and committing *nothing*;
 * - transactional rollback when a write fails part way through the batch.
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
    affiliate_url: `https://www.viator.com/tours/${id}`,
    location_ref: "LOC-abc123",
    latitude: 21.03,
    longitude: 105.85,
    image_url: null,
    image_alt: null,
    destination_refs: ["351"],
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

    const first = await svc.upsertRun(tours, DEFAULT_OPTS);
    expect(first.upserted).toBe(3);
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

    const second = await svc.upsertRun(tours, DEFAULT_OPTS);
    expect(second.softDeleted).toBe(0);
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
    await svc.upsertRun([makeTour("A", { price_minor: 2500 })], DEFAULT_OPTS);

    await svc.upsertRun(
      [makeTour("A", { price_minor: 9900, source_hash: "hash-A-v2" })],
      DEFAULT_OPTS,
    );

    const row = await prisma.tour.findUniqueOrThrow({
      where: {
        provider_providerTourId: { provider: PROVIDER, providerTourId: "A" },
      },
    });
    expect(row.priceMinor).toBe(9900);
    expect(row.sourceHash).toBe("hash-A-v2");
    expect(await totalCount()).toBe(1);
  });
});

describe("soft-delete of active-but-absent tours", () => {
  it("sets deletedAt on a tour missing from a later run", async () => {
    const svc = service();
    await svc.upsertRun(
      [makeTour("A"), makeTour("B"), makeTour("C")],
      DEFAULT_OPTS,
    );

    // Re-run without "C". 1 of 3 = 33% > 10%, so raise the threshold for this
    // legitimate drop (the guard is tested separately below).
    const result = await svc.upsertRun([makeTour("A"), makeTour("B")], {
      deleteGuardThresholdPct: 90,
    });

    expect(result.softDeleted).toBe(1);
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
    await svc.upsertRun([makeTour("A"), makeTour("B")], DEFAULT_OPTS);
    await svc.upsertRun([makeTour("A")], { deleteGuardThresholdPct: 90 });

    const visible = await prisma.tour.findMany({
      where: { provider: PROVIDER, deletedAt: null },
      select: { providerTourId: true },
    });
    expect(visible.map((r) => r.providerTourId)).toEqual(["A"]);
  });

  it("revives a previously soft-deleted tour when it reappears", async () => {
    const svc = service();
    await svc.upsertRun([makeTour("A"), makeTour("B")], DEFAULT_OPTS);
    await svc.upsertRun([makeTour("A")], { deleteGuardThresholdPct: 90 }); // B tombstoned

    // B comes back in a later run → deletedAt cleared.
    await svc.upsertRun([makeTour("A"), makeTour("B")], DEFAULT_OPTS);

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

describe("mass-deletion abort guard", () => {
  it("aborts and commits NOTHING when deletion exceeds the threshold", async () => {
    const svc = service();
    // Seed 10 active tours.
    const seed = Array.from({ length: 10 }, (_, i) => makeTour(`t${i}`));
    await svc.upsertRun(seed, DEFAULT_OPTS);
    expect(await activeCount()).toBe(10);

    // Next run drops 2 (20% > 10%) AND changes t0's title. The whole run must
    // roll back: no soft-delete, and t0's title unchanged.
    const badRun = [
      makeTour("t0", { title: "MUTATED — must not persist" }),
      ...seed.slice(3), // keep t0 + t3..t9; omit t1, t2 → would delete 2 of 10
    ];

    await expect(svc.upsertRun(badRun, DEFAULT_OPTS)).rejects.toBeInstanceOf(
      MassDeletionAbortError,
    );

    // Nothing changed: still 10 active, none tombstoned, title untouched.
    expect(await activeCount()).toBe(10);
    expect(await totalCount()).toBe(10);
    const t0 = await prisma.tour.findUniqueOrThrow({
      where: {
        provider_providerTourId: { provider: PROVIDER, providerTourId: "t0" },
      },
    });
    expect(t0.title).toBe("Tour t0");
  });

  it("carries the actual percentage and threshold on the error", async () => {
    const svc = service();
    const seed = Array.from({ length: 10 }, (_, i) => makeTour(`t${i}`));
    await svc.upsertRun(seed, DEFAULT_OPTS);

    let caught: unknown;
    try {
      await svc.upsertRun(seed.slice(3), DEFAULT_OPTS); // drop 3 of 10 = 30%
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
    const result = await svc.upsertRun(seed, DEFAULT_OPTS);
    expect(result.upserted).toBe(50);
    expect(await activeCount()).toBe(50);
  });
});

describe("transactional integrity — failure part way through", () => {
  it("rolls back all upserts when one row fails mid-batch", async () => {
    const svc = service();

    // priceMinor is a Postgres INTEGER; a value past 2^31-1 overflows and the
    // DB rejects the upsert — a real failure occurring *after* the first row has
    // already been written inside the transaction.
    const OVERFLOW = 9_999_999_999;
    const batch = [
      makeTour("ok-1"),
      makeTour("boom", { price_minor: OVERFLOW }),
      makeTour("ok-2"),
    ];

    await expect(svc.upsertRun(batch, DEFAULT_OPTS)).rejects.toThrow();

    // The whole transaction rolled back: not even "ok-1" (written before the
    // failure) survives.
    expect(await totalCount()).toBe(0);
  });

  it("leaves a pre-existing catalogue untouched when a later run fails mid-batch", async () => {
    const svc = service();
    await svc.upsertRun([makeTour("keep")], DEFAULT_OPTS);
    expect(await activeCount()).toBe(1);

    const batch = [
      makeTour("keep", { price_minor: 3300 }), // would-be update
      makeTour("boom", { price_minor: 9_999_999_999 }), // overflow → fail
    ];
    await expect(svc.upsertRun(batch, DEFAULT_OPTS)).rejects.toThrow();

    // "keep" retains its original price; "boom" was never inserted.
    const keep = await prisma.tour.findUniqueOrThrow({
      where: {
        provider_providerTourId: { provider: PROVIDER, providerTourId: "keep" },
      },
    });
    expect(keep.priceMinor).toBe(2500);
    expect(await totalCount()).toBe(1);
  });
});
