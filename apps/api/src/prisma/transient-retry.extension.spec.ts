import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Prisma, PrismaClient } from "@prisma/client";

import {
  classifyTransactionContext,
  isRetryableOperation,
  resetTxContextWarningForTests,
  retryStandaloneQuery,
  type TransactionContext,
} from "./transient-retry.extension";

/**
 * Unit tests for the standalone-query retry extension (BRI-210). The handler
 * is driven with synthetic hook params; the canary block at the bottom uses a
 * real Prisma client (no database needed) to pin the undocumented
 * `__internalParams.transaction` shape the handler relies on.
 */

const transient = () =>
  new Prisma.PrismaClientKnownRequestError("Server has closed the connection.", {
    code: "P1017",
    clientVersion: "test",
  });

const deps = () => ({
  sleep: jest.fn<(ms: number) => Promise<void>>(async () => {}),
  logger: { warn: jest.fn<(message: string) => void>() },
  attempts: 3,
});

/** Hook params as Prisma 6.19 passes them, failing transiently once. */
function hookParams(
  operation: string,
  args: unknown,
  internal: unknown = { transaction: undefined },
) {
  const query = jest
    .fn<(a: unknown) => Promise<unknown>>()
    .mockRejectedValueOnce(transient())
    .mockResolvedValue("row");
  const params: Record<string, unknown> = { model: "Tour", operation, args, query };
  if (internal !== "omit") params.__internalParams = internal;
  return { params, query };
}

describe("isRetryableOperation (allow-list)", () => {
  it.each([
    "findUnique",
    "findUniqueOrThrow",
    "findFirst",
    "findFirstOrThrow",
    "findMany",
    "count",
    "aggregate",
    "groupBy",
    "delete",
    "deleteMany",
  ])("allows %s", (op) => {
    expect(isRetryableOperation(op, {})).toBe(true);
  });

  it("allows update / updateMany setting plain values", () => {
    expect(isRetryableOperation("update", { data: { title: "x", deletedAt: new Date() } })).toBe(true);
    expect(isRetryableOperation("updateMany", { data: { deletedAt: null } })).toBe(true);
  });

  it.each(["increment", "decrement", "multiply", "divide"])(
    "refuses an update containing { %s }",
    (op) => {
      expect(isRetryableOperation("update", { data: { pagesFetched: { [op]: 1 } } })).toBe(false);
      expect(isRetryableOperation("updateMany", { data: { n: { [op]: 2 } } })).toBe(false);
    },
  );

  it("finds an atomic op nested inside a relation write", () => {
    expect(
      isRetryableOperation("update", {
        data: { run: { update: { pagesFetched: { increment: 1 } } } },
      }),
    ).toBe(false);
  });

  it("checks only upsert's update branch for atomic ops", () => {
    expect(isRetryableOperation("upsert", { create: { n: 1 }, update: { title: "x" } })).toBe(true);
    expect(isRetryableOperation("upsert", { create: { n: 1 }, update: { n: { increment: 1 } } })).toBe(false);
  });

  it("refuses create", () => {
    expect(isRetryableOperation("create", { data: { title: "x" } })).toBe(false);
  });

  it("allows createMany only with skipDuplicates: true", () => {
    expect(isRetryableOperation("createMany", { data: [], skipDuplicates: true })).toBe(true);
    expect(isRetryableOperation("createMany", { data: [] })).toBe(false);
    expect(isRetryableOperation("createMany", { data: [], skipDuplicates: false })).toBe(false);
  });

  it("refuses anything not on the list", () => {
    expect(isRetryableOperation("createManyAndReturn", { data: [], skipDuplicates: true })).toBe(false);
    expect(isRetryableOperation("updateManyAndReturn", { data: {} })).toBe(false);
    expect(isRetryableOperation("$queryRaw", {})).toBe(false);
    expect(isRetryableOperation("$executeRawUnsafe", {})).toBe(false);
  });
});

describe("classifyTransactionContext", () => {
  it("is standalone when the transaction field is undefined", () => {
    expect(classifyTransactionContext({ __internalParams: { transaction: undefined } })).toBe("standalone");
    expect(classifyTransactionContext({ __internalParams: {} })).toBe("standalone");
  });

  it("is transaction for itx and batch kinds", () => {
    expect(classifyTransactionContext({ __internalParams: { transaction: { kind: "itx", id: "x" } } })).toBe("transaction");
    expect(classifyTransactionContext({ __internalParams: { transaction: { kind: "batch", id: 1 } } })).toBe("transaction");
  });

  it("is unknown when __internalParams is missing or the field has another shape", () => {
    expect(classifyTransactionContext({})).toBe("unknown");
    expect(classifyTransactionContext({ __internalParams: null })).toBe("unknown");
    expect(classifyTransactionContext({ __internalParams: { transaction: { kind: "nested" } } })).toBe("unknown");
    expect(classifyTransactionContext({ __internalParams: { transaction: "itx" } })).toBe("unknown");
  });
});

describe("retryStandaloneQuery", () => {
  beforeEach(() => resetTxContextWarningForTests());

  it("retries an allowed standalone query through a transient error", async () => {
    const { params, query } = hookParams("findMany", { where: {} });
    await expect(retryStandaloneQuery(params, deps())).resolves.toBe("row");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not retry create", async () => {
    const { params, query } = hookParams("create", { data: { title: "x" } });
    await expect(retryStandaloneQuery(params, deps())).rejects.toMatchObject({ code: "P1017" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("does not retry an update containing { increment }", async () => {
    const { params, query } = hookParams("update", { data: { pagesFetched: { increment: 1 } } });
    await expect(retryStandaloneQuery(params, deps())).rejects.toMatchObject({ code: "P1017" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("retries createMany with skipDuplicates, not without", async () => {
    const withSkip = hookParams("createMany", { data: [], skipDuplicates: true });
    await expect(retryStandaloneQuery(withSkip.params, deps())).resolves.toBe("row");
    expect(withSkip.query).toHaveBeenCalledTimes(2);

    const without = hookParams("createMany", { data: [] });
    await expect(retryStandaloneQuery(without.params, deps())).rejects.toMatchObject({ code: "P1017" });
    expect(without.query).toHaveBeenCalledTimes(1);
  });

  it("does not retry a query inside an interactive transaction", async () => {
    const { params, query } = hookParams("findMany", {}, { transaction: { kind: "itx", id: "t1" } });
    await expect(retryStandaloneQuery(params, deps())).rejects.toMatchObject({ code: "P1017" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("does not retry a query inside a batch transaction", async () => {
    const { params, query } = hookParams(
      "upsert",
      { create: {}, update: {} },
      { transaction: { kind: "batch", id: 1, index: 0, lock: {} } },
    );
    await expect(retryStandaloneQuery(params, deps())).rejects.toMatchObject({ code: "P1017" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("fails safe when the transaction context can't be read: no retry, one warning per process", async () => {
    const d = deps();
    const first = hookParams("findMany", {}, "omit");
    await expect(retryStandaloneQuery(first.params, d)).rejects.toMatchObject({ code: "P1017" });
    expect(first.query).toHaveBeenCalledTimes(1);

    const second = hookParams("count", {}, { transaction: { kind: "mystery" } });
    await expect(retryStandaloneQuery(second.params, d)).rejects.toMatchObject({ code: "P1017" });
    expect(second.query).toHaveBeenCalledTimes(1);

    expect(d.logger.warn).toHaveBeenCalledTimes(1);
    expect(d.logger.warn.mock.calls[0][0]).toContain("__internalParams");
  });
});

/**
 * Canary for Prisma upgrades. Drives a real client (pointed at a closed port,
 * so every query fails fast with no database) and records what
 * {@link classifyTransactionContext} sees from inside a real query hook. If a
 * Prisma upgrade renames or reshapes `__internalParams.transaction`, these
 * fail in CI instead of per-query retry silently turning off (or, worse, on
 * inside transactions) in production.
 */
describe("canary: real Prisma client hook params", () => {
  const seen: TransactionContext[] = [];
  const base = new PrismaClient({
    datasourceUrl: "postgresql://canary:canary@127.0.0.1:1/canary?connect_timeout=1",
  });
  const client = base.$extends({
    query: {
      $allModels: {
        async $allOperations(params) {
          seen.push(classifyTransactionContext(params));
          return params.query(params.args);
        },
      },
    },
  });

  beforeEach(() => {
    seen.length = 0;
  });
  afterAll(async () => {
    await base.$disconnect();
  });

  it("sees a standalone query as standalone", async () => {
    await expect(client.city.count()).rejects.toBeDefined();
    expect(seen).toEqual(["standalone"]);
  });

  it("sees a batch-array transaction query as in a transaction", async () => {
    await expect(client.$transaction([client.city.count(), client.tour.count()])).rejects.toBeDefined();
    expect(seen).toEqual(["transaction", "transaction"]);
  });

  it("sees an interactive transaction query as in a transaction", async () => {
    // Fake only the engine's tx start/commit/rollback so the callback runs
    // without a database; the hook params are built by the real client.
    const engine = (base as unknown as { _engine: { transaction: unknown } })._engine;
    const original = engine.transaction;
    engine.transaction = async (action: string) => (action === "start" ? { id: "canary-itx" } : undefined);
    try {
      await expect(
        client.$transaction(async (tx) => {
          await tx.city.count();
        }),
      ).rejects.toBeDefined();
    } finally {
      engine.transaction = original;
    }
    expect(seen).toEqual(["transaction"]);
  });
});
