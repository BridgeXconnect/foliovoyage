import { beforeEach, describe, expect, it } from "@jest/globals";
import type { ImportRun } from "@prisma/client";

import {
  ImportRunService,
  type ImportRunPrisma,
} from "./import-run.service";
import type { ImportPipeline, ImportRunCounts } from "./import.pipeline";
import { MassDeletionAbortError } from "./upsert";

/**
 * Unit tests for {@link ImportRunService} (ST-10 / BRI-107).
 *
 * The service's whole job is the record lifecycle around a run, so these tests
 * assert exactly that against an in-memory `importRun` store and a stubbed
 * pipeline — no DB. The three acceptance-relevant outcomes: a clean run finishes
 * `succeeded` with counts; a guard trip finishes `aborted` (not `failed`, not
 * left `running`) carrying the partial counts; an unexpected throw finishes
 * `failed`. In every case exactly one record exists and it is finalized.
 */

/** Minimal in-memory stand-in for Prisma's `importRun` model surface. */
class InMemoryImportRunStore implements ImportRunPrisma {
  readonly rows = new Map<string, ImportRun>();
  private seq = 0;

  importRun = {
    create: async ({ data }: { data: Record<string, unknown> }): Promise<ImportRun> => {
      this.seq += 1;
      const row = {
        id: `run-${this.seq}`,
        provider: (data.provider as string) ?? "viator",
        trigger: data.trigger as string,
        status: (data.status as ImportRun["status"]) ?? "running",
        fetched: 0,
        normalized: 0,
        quarantined: 0,
        upserted: 0,
        softDeleted: 0,
        cursor: null,
        error: null,
        startedAt: new Date(),
        finishedAt: null,
      } as ImportRun;
      this.rows.set(row.id, row);
      return { ...row };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<ImportRun> => {
      const existing = this.rows.get(where.id);
      if (!existing) throw new Error(`no such run ${where.id}`);
      const updated = { ...existing, ...data } as ImportRun;
      this.rows.set(where.id, updated);
      return { ...updated };
    },
  } as unknown as ImportRunPrisma["importRun"];
}

/** A pipeline stub that applies `mutate` to the counts, then optionally throws. */
function fakePipeline(
  mutate: (counts: ImportRunCounts) => void,
  throwAfter?: Error,
): ImportPipeline {
  return {
    async run(counts: ImportRunCounts): Promise<void> {
      mutate(counts);
      if (throwAfter) throw throwAfter;
    },
  } as unknown as ImportPipeline;
}

const CONFIG = { deleteGuardThresholdPct: 10 };

describe("ImportRunService", () => {
  let store: InMemoryImportRunStore;

  beforeEach(() => {
    store = new InMemoryImportRunStore();
  });

  it("records a clean run as succeeded with the pipeline's counts", async () => {
    const pipeline = fakePipeline((c) => {
      c.fetched = 5;
      c.normalized = 5;
      c.quarantined = 1;
      c.upserted = 4;
      c.softDeleted = 2;
      c.cursor = null;
    });
    const service = new ImportRunService(store, pipeline, CONFIG);

    const run = await service.execute("manual");

    expect(run.status).toBe("succeeded");
    expect(run.trigger).toBe("manual");
    expect(run.fetched).toBe(5);
    expect(run.normalized).toBe(5);
    expect(run.quarantined).toBe(1);
    expect(run.upserted).toBe(4);
    expect(run.softDeleted).toBe(2);
    expect(run.error).toBeNull();
    expect(run.finishedAt).not.toBeNull();
    // Exactly one record, and it is not left running.
    expect(store.rows.size).toBe(1);
  });

  it("records a guard-tripped run as aborted with the partial counts", async () => {
    const abort = new MassDeletionAbortError("viator", 10, 8, 80, 10);
    const pipeline = fakePipeline((c) => {
      // Pre-upsert stages tallied; upsert committed nothing.
      c.fetched = 10;
      c.normalized = 10;
      c.quarantined = 0;
    }, abort);
    const service = new ImportRunService(store, pipeline, CONFIG);

    const run = await service.execute("scheduled");

    expect(run.status).toBe("aborted");
    expect(run.trigger).toBe("scheduled");
    expect(run.fetched).toBe(10);
    expect(run.normalized).toBe(10);
    expect(run.upserted).toBe(0);
    expect(run.softDeleted).toBe(0);
    expect(run.error).toContain("Mass-deletion guard tripped");
    expect(run.finishedAt).not.toBeNull();
    expect(store.rows.size).toBe(1);
  });

  it("records an unexpected error as failed (not aborted)", async () => {
    const pipeline = fakePipeline((c) => {
      c.fetched = 3;
    }, new Error("Viator returned 500"));
    const service = new ImportRunService(store, pipeline, CONFIG);

    const run = await service.execute("manual");

    expect(run.status).toBe("failed");
    expect(run.fetched).toBe(3);
    expect(run.error).toBe("Viator returned 500");
    expect(run.finishedAt).not.toBeNull();
    expect(store.rows.size).toBe(1);
  });

  it("never re-throws — the finalized record is always returned", async () => {
    const pipeline = fakePipeline(() => {}, new Error("boom"));
    const service = new ImportRunService(store, pipeline, CONFIG);
    await expect(service.execute("manual")).resolves.toMatchObject({
      status: "failed",
    });
  });
});
