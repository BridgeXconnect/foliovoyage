import { describe, expect, it, jest } from "@jest/globals";

import type { ViatorCodeBatch } from "./clients/viator.client";
import type { ViatorProduct } from "./clients/viator.types";
import type { ProcessProductsResult } from "./import.pipeline";
import {
  COHORT_FROM,
  COHORT_TO,
  createPrismaRefetchStore,
  main,
  nextBatchIndexFrom,
  parseArgs,
  parseCodesFile,
  type RefetchDeps,
  type RefetchStore,
} from "./refetch-by-code.cli";

const T0 = new Date("2026-10-02T12:00:00.000Z");

interface Row {
  fetchedAt: Date;
  deletedAt: Date | null;
}

const stale = new Date("2026-09-05T00:00:00Z");

/** In-memory Tour table behind a RefetchStore with the real selection semantics. */
function memoryStore(rows: Record<string, Row>, running = false) {
  const q = { rows: 0, distinct: 0 };
  const store: RefetchStore = {
    hasRunningRun: async () => running,
    selectCohort: async (refreshedAfter) =>
      Object.entries(rows)
        .filter(
          ([, r]) =>
            r.deletedAt === null &&
            r.fetchedAt >= COHORT_FROM &&
            r.fetchedAt < (refreshedAfter < COHORT_TO ? refreshedAfter : COHORT_TO),
        )
        .map(([code]) => code)
        .sort(),
    classifyCodes: async (codes, refreshedAfter) => {
      const out = { stale: [] as string[], alreadyRefreshed: [] as string[], notLive: [] as string[] };
      for (const code of codes) {
        const r = rows[code];
        if (!r || r.deletedAt) out.notLive.push(code);
        else if (r.fetchedAt >= refreshedAfter) out.alreadyRefreshed.push(code);
        else out.stale.push(code);
      }
      return out;
    },
    quarantineStats: async () => ({ rows: q.rows, distinctCodes: q.distinct }),
  };
  return { store, rows };
}

function harness(opts: { rows: Record<string, Row>; running?: boolean; returnOnly?: (code: string) => boolean }) {
  const { store, rows } = memoryStore(opts.rows, opts.running);
  const fetchCalls: string[][] = [];
  const batchesSeen: number[] = [];
  const client = {
    fetchProductsByCode: jest.fn(async (codes: readonly string[], o: { batch: number }): Promise<ViatorCodeBatch> => {
      fetchCalls.push([...codes]);
      batchesSeen.push(o.batch);
      const products: ViatorProduct[] = codes
        .filter((c) => (opts.returnOnly ? opts.returnOnly(c) : true))
        .map((productCode) => ({ productCode }));
      return {
        products,
        rejectedCodes: [],
        unresolvedCodes: [],
        archive: { bucket: "b", key: `raw/viator-refetch/2026-10-02/${o.batch}.json` },
      };
    }),
  };
  const processProducts = jest.fn(async (products: readonly ViatorProduct[]): Promise<ProcessProductsResult> => {
    const codes = products.map((p) => p.productCode as string);
    // Mimic upsertBatch: stamp fetchedAt on the rows it writes.
    for (const c of codes) rows[c].fetchedAt = T0;
    return {
      skippedNotCurated: 0,
      skippedInactive: 0,
      skippedManualConfirmation: 0,
      unnormalizableCodes: [],
      quarantinedCodes: [],
      upsertedCodes: codes,
    };
  });
  const readFile = jest.fn<(p: string) => Promise<string>>(async () => "");
  const deps: RefetchDeps = {
    store,
    client,
    pipeline: { processProducts },
    nextBatchIndex: async () => 1,
    readFile,
    now: () => T0,
  };
  return { deps, client, processProducts, fetchCalls, batchesSeen, rows, readFile };
}

async function run(argv: string[], deps: RefetchDeps) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l) }, deps);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const rowsOf = (n: number, prefix = "P"): Record<string, Row> =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`${prefix}${String(i).padStart(4, "0")}`, { fetchedAt: stale, deletedAt: null }]),
  );

describe("refetch-by-code args", () => {
  it("defaults: batch 500, refreshed-after = end of the window", () => {
    const a = parseArgs([], T0);
    expect(a).toMatchObject({ batchSize: 500, limit: null, dryRun: false, codesFile: null });
    expect((a as { refreshedAfter: Date }).refreshedAfter).toEqual(COHORT_TO);
  });

  it.each([["--batch-size", "501"], ["--batch-size", "0"], ["--limit", "x"], ["--refreshed-after", "nope"], ["--bogus", "1"]])(
    "rejects %s %s",
    (flag, value) => {
      expect(parseArgs([flag, value], T0)).toHaveProperty("error");
    },
  );

  it("rejects a --refreshed-after in the future", () => {
    expect(parseArgs(["--refreshed-after", "2026-10-03T00:00:00Z"], T0)).toHaveProperty("error");
  });

  it("parses a codes file: dedupes, ignores blanks and comments, rejects junk", () => {
    expect(parseCodesFile("A1\n\n# c\nB2 # tail\nA1\r\n")).toEqual(["A1", "B2"]);
    expect(parseCodesFile("A1\nbad code!")).toHaveProperty("error");
  });
});

describe("refetch-by-code main", () => {
  it("refuses to start when an ImportRun is running, before any selection or call", async () => {
    const h = harness({ rows: rowsOf(3), running: true });
    const r = await run([], h.deps);
    expect(r.code).toBe(2);
    expect(r.err).toContain("Refusing to start");
    expect(h.client.fetchProductsByCode).not.toHaveBeenCalled();
    expect(h.processProducts).not.toHaveBeenCalled();
  });

  it("batches at the 500 boundary: 1000 codes → 2 calls, 1001 → 3, with increasing archive indexes", async () => {
    const h1 = harness({ rows: rowsOf(1000) });
    await run([], h1.deps);
    expect(h1.fetchCalls.map((c) => c.length)).toEqual([500, 500]);
    expect(h1.batchesSeen).toEqual([1, 2]);

    const h2 = harness({ rows: rowsOf(1001) });
    await run([], h2.deps);
    expect(h2.fetchCalls.map((c) => c.length)).toEqual([500, 500, 1]);
    expect(h2.batchesSeen).toEqual([1, 2, 3]);
  });

  it("--batch-size and --limit shape the batches", async () => {
    const h = harness({ rows: rowsOf(10) });
    const r = await run(["--batch-size", "4", "--limit", "9"], h.deps);
    expect(h.fetchCalls.map((c) => c.length)).toEqual([4, 4, 1]);
    expect(r.out).toContain("--limit 9: 9 of 10 selected");
  });

  it("--dry-run selects and reports but makes no Viator call, archive write or upsert", async () => {
    const h = harness({ rows: rowsOf(5) });
    const r = await run(["--dry-run"], h.deps);
    expect(r.code).toBe(0);
    expect(r.out).toContain("DRY RUN");
    expect(r.out).toContain("5 code(s) in 1 batch(es)");
    expect(h.client.fetchProductsByCode).not.toHaveBeenCalled();
    expect(h.processProducts).not.toHaveBeenCalled();
  });

  it("cohort selection uses the window and ignores soft-deleted rows", async () => {
    const rows = {
      ...rowsOf(2),
      DELETED: { fetchedAt: stale, deletedAt: new Date() },
      TOO_NEW: { fetchedAt: new Date("2026-09-20T00:00:00Z"), deletedAt: null },
      TOO_OLD: { fetchedAt: new Date("2026-08-01T00:00:00Z"), deletedAt: null },
    };
    const h = harness({ rows });
    await run([], h.deps);
    expect(h.fetchCalls.flat().sort()).toEqual(["P0000", "P0001"]);
  });

  it("--codes-file fetches only live, still-stale codes from the file", async () => {
    const rows = {
      ...rowsOf(2),
      DONE: { fetchedAt: T0, deletedAt: null },
      GONE: { fetchedAt: stale, deletedAt: new Date() },
    };
    const h = harness({ rows });
    h.readFile.mockResolvedValue("P0000\nDONE\nGONE\nUNKNOWN\n");
    const r = await run(["--codes-file", "codes.txt"], h.deps);
    expect(h.fetchCalls.flat()).toEqual(["P0000"]);
    expect(r.out).toContain("1 stale, 1 already refreshed (skipped), 2 not live (skipped)");
  });

  it("--refreshed-after: rows fetched at or after it are skipped; before it are fetched", async () => {
    const rows = {
      OLD: { fetchedAt: new Date("2026-10-01T00:00:00Z"), deletedAt: null },
      EDGE: { fetchedAt: new Date("2026-10-02T11:00:00Z"), deletedAt: null },
      NEW: { fetchedAt: new Date("2026-10-02T11:30:00Z"), deletedAt: null },
    };
    const h = harness({ rows });
    h.readFile.mockResolvedValue("OLD\nEDGE\nNEW\n");
    await run(["--codes-file", "c", "--refreshed-after", "2026-10-02T11:00:00Z"], h.deps);
    expect(h.fetchCalls.flat()).toEqual(["OLD"]);
  });

  it("resume: a second run with the same threshold skips everything the first refreshed", async () => {
    const h = harness({ rows: rowsOf(6) });
    h.readFile.mockResolvedValue(Object.keys(h.rows).join("\n"));
    const argv = ["--codes-file", "c", "--refreshed-after", T0.toISOString()];
    await run(argv, h.deps);
    expect(h.fetchCalls.flat()).toHaveLength(6);

    h.client.fetchProductsByCode.mockClear();
    const second = await run(argv, h.deps);
    expect(h.client.fetchProductsByCode).not.toHaveBeenCalled();
    expect(second.out).toContain("0 stale, 6 already refreshed");
  });

  it("counts codes Viator did not return, never deletes them, and leaves them in the cohort", async () => {
    const h = harness({ rows: rowsOf(4), returnOnly: (c) => c !== "P0002" });
    const r = await run([], h.deps);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/not returned:\s+1/);
    expect(r.out).toContain("P0002");
    expect(h.rows.P0002.deletedAt).toBeNull();
    expect(r.out).toMatch(/cohort remaining:\s+1/);
  });

  it("reports unresolved and invalid codes separately", async () => {
    const h = harness({ rows: rowsOf(3) });
    h.client.fetchProductsByCode.mockResolvedValue({
      products: [],
      rejectedCodes: ["P0000"],
      unresolvedCodes: ["P0001", "P0002"],
      archive: null,
    });
    const r = await run([], h.deps);
    expect(r.out).toMatch(/invalid:\s+1/);
    expect(r.out).toMatch(/unresolved:\s+2/);
    expect(r.out).toMatch(/not returned:\s+0/);
  });

  it("does not advance the archive index for a batch that archived nothing", async () => {
    const h = harness({ rows: rowsOf(3) });
    const spy = h.client.fetchProductsByCode;
    spy.mockResolvedValueOnce({ products: [], rejectedCodes: [], unresolvedCodes: ["P0000"], archive: null });
    await run(["--batch-size", "1"], h.deps);
    expect(spy.mock.calls.map((c) => (c[1] as { batch: number }).batch)).toEqual([1, 1, 2]);
  });

  it("stops with exit 1 on a failing batch and keeps earlier work", async () => {
    const h = harness({ rows: rowsOf(3) });
    h.client.fetchProductsByCode.mockRejectedValueOnce(new Error("boom"));
    const r = await run(["--batch-size", "1"], h.deps);
    expect(r.code).toBe(1);
    expect(r.err).toContain("boom");
    expect(h.client.fetchProductsByCode).toHaveBeenCalledTimes(1);
  });
});

describe("refetch-by-code never touches the cursor, runs or deletion", () => {
  it("the Prisma store only reads Tour/QuarantinedTour/ImportRun; no write method exists on the surface it uses", async () => {
    const calls: string[] = [];
    const recorder = (model: string) =>
      new Proxy(
        {},
        {
          get: (_t, method: string) => async () => {
            calls.push(`${model}.${method}`);
            return method === "count" ? 0 : [];
          },
        },
      );
    const prisma = {
      tour: recorder("tour"),
      quarantinedTour: recorder("quarantinedTour"),
      importRun: recorder("importRun"),
    };
    const store = createPrismaRefetchStore(prisma as never);
    await store.hasRunningRun();
    await store.selectCohort(COHORT_TO);
    await store.classifyCodes(["A"], COHORT_TO);
    await store.quarantineStats();

    expect(calls).toEqual(
      expect.arrayContaining(["importRun.findFirst", "tour.findMany", "quarantinedTour.count", "quarantinedTour.findMany"]),
    );
    const writes = calls.filter((c) =>
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|finalizeGuardedSoftDelete)$/.test(c),
    );
    expect(writes).toEqual([]);
    // hasRunningRun is the only ImportRun access; nothing reads or writes lastCursor.
    expect(calls.filter((c) => c.startsWith("importRun."))).toEqual(["importRun.findFirst"]);
  });

  it("main never calls anything beyond the injected seams (no soft-delete or run-row API exists on them)", async () => {
    const h = harness({ rows: rowsOf(2) });
    await run([], h.deps);
    expect(Object.keys(h.deps.pipeline)).toEqual(["processProducts"]);
    expect(Object.keys(h.deps.client)).toEqual(["fetchProductsByCode"]);
    expect(Object.keys(h.deps.store).sort()).toEqual(
      ["classifyCodes", "hasRunningRun", "quarantineStats", "selectCohort"],
    );
  });
});

describe("nextBatchIndexFrom", () => {
  it("continues past existing keys for the same date only", async () => {
    const reader = {
      listPageKeys: async () => [
        "raw/viator-refetch/2026-10-02/3.json",
        "raw/viator-refetch/2026-10-02/10.json",
        "raw/viator-refetch/2026-10-01/40.json",
      ],
    };
    await expect(nextBatchIndexFrom(reader, "2026-10-02")).resolves.toBe(11);
    await expect(nextBatchIndexFrom(reader, "2026-10-05")).resolves.toBe(1);
  });
});
