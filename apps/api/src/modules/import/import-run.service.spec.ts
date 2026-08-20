import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ImportRun } from "@prisma/client";

import {
  ImportRunService,
  type ImportRunPrisma,
} from "./import-run.service";
import type { SegmentRunner, SegmentRunResult } from "./segment-runner";

/**
 * Unit tests for {@link ImportRunService} (ST-10 / BRI-107, restructured by
 * BRI-176 into an orchestrator that spawns segment-worker children).
 *
 * The service's whole job is the record lifecycle around a run, so these
 * tests assert exactly that against an in-memory `importRun` store and a
 * fake {@link SegmentRunner} — no DB, no real child process. A fake segment
 * writes to the store directly (mimicking what a real segment-worker child
 * does to its own row) and reports its exit code separately, the same
 * two-channel contract the real spawn uses.
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
        lastPage: null,
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
    findUniqueOrThrow: async ({
      where,
    }: {
      where: { id: string };
    }): Promise<ImportRun> => {
      const row = this.rows.get(where.id);
      if (!row) throw new Error(`no such run ${where.id}`);
      return { ...row };
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
      lastPage: null,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
      ...row,
    } as ImportRun);
  }
}

/**
 * A {@link SegmentRunner} whose behavior per call is scripted by `steps` —
 * each step optionally mutates the store (mimicking a real child's DB
 * writes) before resolving with the given exit result. Records every
 * `runId`/`modifiedSince` it was called with.
 */
function fakeSegmentRunner(
  store: InMemoryImportRunStore,
  steps: Array<{
    mutate?: (rows: Map<string, ImportRun>, runId: string) => void;
    result: SegmentRunResult;
  }>,
): SegmentRunner & { calls: Array<{ runId: string; modifiedSince?: string }> } {
  const calls: Array<{ runId: string; modifiedSince?: string }> = [];
  let i = 0;
  return {
    calls,
    async runSegment(runId: string, modifiedSince?: string): Promise<SegmentRunResult> {
      calls.push({ runId, modifiedSince });
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      step.mutate?.(store.rows, runId);
      return step.result;
    },
  };
}

const CONFIG = {};

describe("ImportRunService", () => {
  let store: InMemoryImportRunStore;

  beforeEach(() => {
    store = new InMemoryImportRunStore();
  });

  it("spawns segments until the row leaves running, returning the finalized row", async () => {
    const runner = fakeSegmentRunner(store, [
      {
        mutate: (rows, id) =>
          rows.set(id, { ...rows.get(id)!, fetched: 3, cursor: "c1" }),
        result: { exitCode: 0 },
      },
      {
        mutate: (rows, id) =>
          rows.set(id, {
            ...rows.get(id)!,
            fetched: 5,
            status: "succeeded",
            finishedAt: new Date(),
          }),
        result: { exitCode: 0 },
      },
    ]);
    const service = new ImportRunService(store, runner, CONFIG);

    const run = await service.execute("manual");

    expect(run.status).toBe("succeeded");
    expect(run.fetched).toBe(5);
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0].runId).toBe(run.id);
    expect(runner.calls[1].runId).toBe(run.id);
    expect(store.rows.size).toBe(1);
  });

  it("returns after one spawn when a single segment finishes the whole run", async () => {
    const runner = fakeSegmentRunner(store, [
      {
        mutate: (rows, id) =>
          rows.set(id, {
            ...rows.get(id)!,
            status: "succeeded",
            fetched: 2,
            finishedAt: new Date(),
          }),
        result: { exitCode: 0 },
      },
    ]);
    const service = new ImportRunService(store, runner, CONFIG);

    const run = await service.execute("manual");

    expect(run.status).toBe("succeeded");
    expect(runner.calls).toHaveLength(1);
  });

  it("records a guard-tripped segment's aborted status as-is (already written by the child)", async () => {
    const runner = fakeSegmentRunner(store, [
      {
        mutate: (rows, id) =>
          rows.set(id, {
            ...rows.get(id)!,
            status: "aborted",
            fetched: 10,
            error: "Mass-deletion guard tripped for provider \"viator\": …",
            finishedAt: new Date(),
          }),
        result: { exitCode: 0 },
      },
    ]);
    const service = new ImportRunService(store, runner, CONFIG);

    const run = await service.execute("scheduled");

    expect(run.status).toBe("aborted");
    expect(run.error).toContain("Mass-deletion guard tripped");
  });

  it("finalizes as failed when a segment exits non-zero, preserving the prior segment's committed progress", async () => {
    const runner = fakeSegmentRunner(store, [
      {
        // First segment completes cleanly and commits real progress.
        mutate: (rows, id) =>
          rows.set(id, { ...rows.get(id)!, fetched: 7, cursor: "c1" }),
        result: { exitCode: 0 },
      },
      {
        // Second segment crashes before it can write anything at all.
        result: { exitCode: 1 },
      },
    ]);
    const service = new ImportRunService(store, runner, CONFIG);

    const run = await service.execute("manual");

    expect(run.status).toBe("failed");
    expect(run.fetched).toBe(7); // untouched from the crashed segment
    expect(run.error).toContain("exited abnormally");
    expect(run.error).toContain("code 1");
    expect(run.finishedAt).not.toBeNull();
  });

  it("finalizes as failed when a segment is killed by a signal (exitCode null)", async () => {
    const runner = fakeSegmentRunner(store, [{ result: { exitCode: null } }]);
    const service = new ImportRunService(store, runner, CONFIG);

    const run = await service.execute("manual");

    expect(run.status).toBe("failed");
    expect(run.error).toContain("code null");
  });

  it("never re-throws — the finalized record is always returned", async () => {
    const runner = fakeSegmentRunner(store, [{ result: { exitCode: 1 } }]);
    const service = new ImportRunService(store, runner, CONFIG);
    await expect(service.execute("manual")).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("forwards modifiedSince to every segment spawn", async () => {
    const runner = fakeSegmentRunner(store, [
      {
        mutate: (rows, id) =>
          rows.set(id, { ...rows.get(id)!, status: "succeeded", finishedAt: new Date() }),
        result: { exitCode: 0 },
      },
    ]);
    const service = new ImportRunService(store, runner, CONFIG);

    await service.execute("manual", { modifiedSince: "2026-08-01T00:00:00Z" });

    expect(runner.calls[0].modifiedSince).toBe("2026-08-01T00:00:00Z");
  });

  describe("reapStuckRuns (BRI-170)", () => {
    it("marks a run stuck 'running' past the timeout as failed", async () => {
      const staleStart = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
      store.seed({ id: "orphan", status: "running", startedAt: staleStart });
      const service = new ImportRunService(
        store,
        fakeSegmentRunner(store, [{ result: { exitCode: 0 } }]),
        { ...CONFIG, stuckRunTimeoutMinutes: 120 },
      );

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
      const service = new ImportRunService(
        store,
        fakeSegmentRunner(store, [{ result: { exitCode: 0 } }]),
        { ...CONFIG, stuckRunTimeoutMinutes: 120 },
      );

      const count = await service.reapStuckRuns();

      expect(count).toBe(0);
      expect(store.rows.get("in-flight")!.status).toBe("running");
    });

    it("leaves already-terminal runs untouched", async () => {
      const staleStart = new Date(Date.now() - 3 * 60 * 60 * 1000);
      store.seed({ id: "done", status: "succeeded", startedAt: staleStart });
      const service = new ImportRunService(
        store,
        fakeSegmentRunner(store, [{ result: { exitCode: 0 } }]),
        { ...CONFIG, stuckRunTimeoutMinutes: 120 },
      );

      const count = await service.reapStuckRuns();

      expect(count).toBe(0);
      expect(store.rows.get("done")!.status).toBe("succeeded");
    });

    it("defaults to a 120-minute timeout when not configured", async () => {
      const staleStart = new Date(Date.now() - 121 * 60 * 1000);
      store.seed({ id: "orphan", status: "running", startedAt: staleStart });
      const service = new ImportRunService(
        store,
        fakeSegmentRunner(store, [{ result: { exitCode: 0 } }]),
        CONFIG,
      );

      const count = await service.reapStuckRuns();

      expect(count).toBe(1);
    });
  });

  describe("hasRunningRun (BRI-173)", () => {
    it("returns false when no run exists", async () => {
      const service = new ImportRunService(
        store,
        fakeSegmentRunner(store, [{ result: { exitCode: 0 } }]),
        CONFIG,
      );
      await expect(service.hasRunningRun()).resolves.toBe(false);
    });

    it("returns true while a run is in progress", async () => {
      store.seed({ id: "in-flight", provider: "viator", status: "running" });
      const service = new ImportRunService(
        store,
        fakeSegmentRunner(store, [{ result: { exitCode: 0 } }]),
        CONFIG,
      );
      await expect(service.hasRunningRun()).resolves.toBe(true);
    });

    it("returns false once the run has finished", async () => {
      store.seed({ id: "done", provider: "viator", status: "succeeded" });
      const service = new ImportRunService(
        store,
        fakeSegmentRunner(store, [{ result: { exitCode: 0 } }]),
        CONFIG,
      );
      await expect(service.hasRunningRun()).resolves.toBe(false);
    });
  });

  describe("self-heartbeat lifecycle (BRI-173)", () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
      jest.useRealTimers();
      (globalThis as { fetch: typeof fetch }).fetch = realFetch;
    });

    it("pings the heartbeat URL while segments are still spawning, and stops once the run settles", async () => {
      jest.useFakeTimers();
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue({ ok: true, status: 200 } as Response);
      (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

      let releaseSegment: (() => void) | undefined;
      const runner: SegmentRunner = {
        runSegment: (runId: string) =>
          new Promise<SegmentRunResult>((resolve) => {
            releaseSegment = () => {
              store.rows.set(runId, {
                ...store.rows.get(runId)!,
                status: "succeeded",
                fetched: 1,
                finishedAt: new Date(),
              });
              resolve({ exitCode: 0 });
            };
          }),
      };

      const service = new ImportRunService(store, runner, {
        ...CONFIG,
        heartbeatUrl: "https://atlas-api.onrender.com",
      });

      const runPromise = service.execute("scheduled-external");

      // The heartbeat's own default interval is 10 minutes; advance well past
      // two ticks while the (single, long) segment is still in flight.
      await jest.advanceTimersByTimeAsync(21 * 60_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://atlas-api.onrender.com/health",
        expect.objectContaining({ signal: expect.anything() }),
      );

      releaseSegment?.();
      await runPromise;

      // Stopped: further elapsed time must not produce more pings.
      await jest.advanceTimersByTimeAsync(30 * 60_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("stops the heartbeat even when a segment exits abnormally", async () => {
      jest.useFakeTimers();
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockResolvedValue({ ok: true, status: 200 } as Response);
      (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

      const runner = fakeSegmentRunner(store, [{ result: { exitCode: 1 } }]);
      const service = new ImportRunService(store, runner, {
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

      const runner = fakeSegmentRunner(store, [
        {
          mutate: (rows, id) =>
            rows.set(id, { ...rows.get(id)!, status: "succeeded", finishedAt: new Date() }),
          result: { exitCode: 0 },
        },
      ]);
      const service = new ImportRunService(store, runner, CONFIG);

      await service.execute("manual");
      await jest.advanceTimersByTimeAsync(30 * 60_000);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
