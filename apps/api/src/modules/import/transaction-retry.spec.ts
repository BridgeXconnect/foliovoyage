import { describe, expect, it, jest } from "@jest/globals";
import { Prisma } from "@prisma/client";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaLocationCache } from "./location-cache.prisma";
import type { TourDTO } from "./normalizer";
import { PrismaTagVocabularyCache } from "./tag-resolver";
import { MassDeletionAbortError, TourUpsertService, type TourUpsertPrisma } from "./upsert";

/**
 * Whole-transaction retry at the import path's four `$transaction` sites
 * (BRI-210). Each fake `$transaction` stages writes and only "commits" them if
 * the unit finishes, so a drop part-way through attempt 1 must rerun the unit
 * from the start and land exactly one commit. Runs on the default `web`
 * profile (2 attempts, sub-100 ms backoff).
 */

const dropped = () =>
  new Prisma.PrismaClientKnownRequestError("Server has closed the connection.", {
    code: "P1017",
    clientVersion: "test",
  });

type TransactionFn = (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => Promise<unknown>;

const tour = (id: string) => ({ provider: "viator", provider_tour_id: id }) as unknown as TourDTO;

describe("TourUpsertService.upsertBatch", () => {
  function fakePrisma() {
    const commits: string[][] = [];
    let attempt = 0;
    const $transaction = jest.fn<TransactionFn>(async (fn) => {
      attempt++;
      const staged: string[] = [];
      const tx = {
        tour: {
          upsert: async (args: { where: { provider_providerTourId: { providerTourId: string } } }) => {
            staged.push(args.where.provider_providerTourId.providerTourId);
            if (attempt === 1 && staged.length === 2) throw dropped();
          },
        },
      };
      const result = await fn(tx);
      commits.push(staged);
      return result;
    });
    return { prisma: { $transaction } as unknown as TourUpsertPrisma, $transaction, commits };
  }

  it("reruns the whole transaction from the start after a drop and commits once", async () => {
    const { prisma, $transaction, commits } = fakePrisma();
    const service = new TourUpsertService(prisma);

    await expect(service.upsertBatch([tour("a"), tour("b"), tour("c")])).resolves.toEqual({ upserted: 3 });

    expect($transaction).toHaveBeenCalledTimes(2);
    expect(commits).toEqual([["a", "b", "c"]]);
  });

  it("sets an explicit maxWait and keeps the timeout", async () => {
    const { prisma, $transaction } = fakePrisma();
    await new TourUpsertService(prisma).upsertBatch([tour("a")]);
    expect($transaction.mock.calls[0][1]).toEqual({ maxWait: 10_000, timeout: 120_000 });
  });
});

describe("TourUpsertService.finalizeGuardedSoftDelete", () => {
  function fakePrisma(active: string[], dropFirstAttempt: boolean) {
    let attempt = 0;
    const updates: unknown[] = [];
    const $transaction = jest.fn<TransactionFn>(async (fn) => {
      attempt++;
      const tx = {
        tour: {
          findMany: async () => {
            if (dropFirstAttempt && attempt === 1) throw dropped();
            return active.map((providerTourId) => ({ providerTourId }));
          },
          updateMany: async (args: unknown) => {
            updates.push(args);
          },
        },
      };
      return fn(tx);
    });
    return { prisma: { $transaction } as unknown as TourUpsertPrisma, $transaction, updates };
  }

  it("reruns after a drop and soft-deletes once", async () => {
    const { prisma, $transaction, updates } = fakePrisma(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], true);
    const result = await new TourUpsertService(prisma).finalizeGuardedSoftDelete(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      "viator",
      { deleteGuardThresholdPct: 10 },
    );
    expect(result).toEqual({ softDeleted: 1, activeCountBefore: 10 });
    expect($transaction).toHaveBeenCalledTimes(2);
    expect(updates).toHaveLength(1);
    expect($transaction.mock.calls[0][1]).toEqual({ maxWait: 10_000, timeout: 120_000 });
  });

  it("lets MassDeletionAbortError through without a retry", async () => {
    const { prisma, $transaction } = fakePrisma(["a", "b"], false);
    await expect(
      new TourUpsertService(prisma).finalizeGuardedSoftDelete([], "viator", { deleteGuardThresholdPct: 10 }),
    ).rejects.toBeInstanceOf(MassDeletionAbortError);
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});

describe("PrismaLocationCache.putMany", () => {
  it("rebuilds the batch array and reruns it after a drop", async () => {
    const built: string[] = [];
    let attempt = 0;
    const prisma = {
      providerLocation: {
        upsert: jest.fn((args: { where: { reference: string } }) => {
          built.push(args.where.reference);
          return args.where.reference;
        }),
      },
      $transaction: jest.fn(async (queries: unknown[]) => {
        attempt++;
        if (attempt === 1) throw dropped();
        return queries;
      }),
    };
    const cache = new PrismaLocationCache(prisma as unknown as PrismaService);

    await cache.putMany([
      { reference: "LOC-1", latitude: 1, longitude: 2, name: "a" },
      { reference: "LOC-2", latitude: 3, longitude: 4, name: "b" },
    ]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    // Fresh queries per attempt: a batch array's PrismaPromises are single-use.
    expect(built).toEqual(["LOC-1", "LOC-2", "LOC-1", "LOC-2"]);
    expect(prisma.$transaction.mock.calls[1][0]).toEqual(["LOC-1", "LOC-2"]);
  });
});

describe("PrismaTagVocabularyCache.replaceAll", () => {
  it("reruns deleteMany + createMany as one unit after a drop", async () => {
    let attempt = 0;
    const prisma = {
      viatorTag: {
        deleteMany: jest.fn(() => "delete"),
        createMany: jest.fn(() => "create"),
      },
      $transaction: jest.fn(async (queries: unknown[]) => {
        attempt++;
        if (attempt === 1) throw dropped();
        return queries;
      }),
    };
    const cache = new PrismaTagVocabularyCache(prisma as unknown as PrismaService);

    await cache.replaceAll([], new Date("2026-10-01T00:00:00Z"));

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.viatorTag.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction.mock.calls[1][0]).toEqual(["delete", "create"]);
  });
});
