import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
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
    updateMany: async ({
      where,
      data,
    }: {
      where: { status: ImportRun["status"]; startedAt: { lt: Date } };
      data: Record<string, unknown>;
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const [id, row] of this.rows) {
        if (row.status === where.status && row.startedAt < where.startedAt.lt) {
          this.rows.set(id, { ...row, ...data } as ImportRun);
          count += 1;
        }
      }
      return { count };
    },
    findFirst: async ({
      where,
    }: {
      where: { provider: string; status: ImportRun["status"] };
    }): Promise<ImportRun | null> => {
      for (const row of this.rows.values()) {
        if (row.provider === where.provider && row.status === where.status) {
          return { ...row };
        }
      }
      return null;
    },
  } as unknown as ImportRunPrisma["importRun"];

  /** Test helper: insert a row directly, bypassing `create`'s auto-fields. */
  seed(row: Partial<ImportRun> & { id: string }): void {
    this.rows.set(row.id, {
      provider: "viator",
      trigger: "manual",
      status: "running",
      fetched: 0,
      normalized: 0,
      quarantined: 0,
      upserted: 0,
      softDeleted: 0,
      cursor: null,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
      ...row,
    } as ImportRun);
  }
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

  describe("reapStuckRuns (BRI-170)", () => {
    it("marks a run stuck 'running' past the timeout as failed", async () => {
      const staleStart = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
      store.seed({ id: "orphan", status: "running", startedAt: staleStart });
      const service = new ImportRunService(store, fakePipeline(() => {}), {
        ...CONFIG,
        stuckRunTimeoutMinutes: 120,
      });

      const count = await service.reapStuckRuns();

      expect(count).toBe(1);
      const row = store.rows.get("orphan")!;
      expect(row.status).toBe("failed");
      expect(row.error).toMatch(/running.*120 minutes/);
      expect(row.finishedAt).not.toBeNull();
    });

    it("leaves a recent, legitimately in-flight run untouched", async () => {
      const recentStart = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
      store.seed({ id: "in-flight", status: "running", startedAt: recentStart });
      const service = new ImportRunService(store, fakePipeline(() => {}), {
        ...CONFIG,
        stuckRunTimeoutMinutes: 120,
      });

      const count = await service.reapStuckRuns();

      expect(count).toBe(0);
      expect(store.rows.get("in-flight")!.status).toBe("running");
    });

    it("leaves already-terminal runs untouched", async () => {
      const staleStart = new Date(Date.now() - 3 * 60 * 60 * 1000);
      store.seed({ id: "done", status: "succeeded", startedAt: staleStart });
      const service = new ImportRunService(store, fakePipeline(() => {}), {
        ...CONFIG,
        stuckRunTimeoutMinutes: 120,
      });

      const count = await service.reapStuckRuns();

      expect(count).toBe(0);
      expect(store.rows.get("done")!.status).toBe("succeeded");
    });

    it("defaults to a 120-minute timeout when not configured", async () => {
      const staleStart = new Date(Date.now() - 121 * 60 * 1000);
      store.seed({ id: "orphan", status: "running", startedAt: staleStart });
      const service = new ImportRunService(store, fakePipeline(() => {}), CONFIG);

      const count = await service.reapStuckRuns();

      expect(count).toBe(1);
    });
  });

  describe("hasRunningRun (BRI-173)", () => {
    it("returns false when no run exists", async () => {
      const service = new ImportRunService(store, fakePipeline(() => {}), CONFIG);
      await expect(service.hasRunningRun()).resolves.toBe(false);
    });

    it("returns true while a run is in progress", async () => {
      store.seed({ id: "in-flight", provider: "viator", status: "running" });
      const service = new ImportRunService(store, fakePipeline(() => {}), CONFIG);
      await expect(service.hasRunningRun()).resolves.toBe(true);
    });

    it("returns false once the run has finished", async () => {
      store.seed({ id: "done", provider: "viator", status: "succeeded" });
      const service = new ImportRunService(store, fakePipeline(() => {}), CONFIG);
      await expect(service.hasRunningRun()).resolves.toBe(false);
    });
  });

  describe("self-heartbeat lifecycle (BRI-173)", () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
      jest.useRealTimers();
      (globalThis as { fetch: typeof fetch }).fetch = realFetch;
    });

    it("pings the heartbeat URL while the pipeline is running, and stops once it settles", async () => {
      jest.useFakeTimers();
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue({ ok: true, status: 200 } as Response);
      (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

      let releasePipeline: (() => void) | undefined;
      const pipeline = {
        run: (counts: ImportRunCounts) =>
          new Promise<void>((resolve) => {
            releasePipeline = () => {
              counts.fetched = 1;
              resolve();
            };
          }),
      } as unknown as ImportPipeline;

      const service = new ImportRunService(store, pipeline, {
        ...CONFIG,
        heartbeatUrl: "https://atlas-api.onrender.com",
      });

      const runPromise = service.execute("scheduled-external");

      // The heartbeat's own default interval is 10 minutes; advance well past
      // two ticks while the pipeline is still "in flight".
      await jest.advanceTimersByTimeAsync(21 * 60_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://atlas-api.onrender.com/health",
        expect.objectContaining({ signal: expect.anything() }),
      );

      releasePipeline?.();
      await runPromise;

      // Stopped: further elapsed time must not produce more pings.
      await jest.advanceTimersByTimeAsync(30 * 60_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("stops the heartbeat even when the pipeline throws", async () => {
      jest.useFakeTimers();
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue({ ok: true, status: 200 } as Response);
      (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

      const pipeline = fakePipeline(() => {}, new Error("boom"));
      const service = new ImportRunService(store, pipeline, {
        ...CONFIG,
        heartbeatUrl: "https://atlas-api.onrender.com",
      });

      const run = await service.execute("manual");
      expect(run.status).toBe("failed");

      await jest.advanceTimersByTimeAsync(30 * 60_000);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never pings when no heartbeatUrl is configured", async () => {
      jest.useFakeTimers();
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue({ ok: true, status: 200 } as Response);
      (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

      const service = new ImportRunService(
        store,
        fakePipeline((c) => (c.fetched = 1)),
        CONFIG,
      );

      await service.execute("manual");
      await jest.advanceTimersByTimeAsync(30 * 60_000);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
