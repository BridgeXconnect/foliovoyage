import { beforeEach, describe, expect, it } from "@jest/globals";
import type { ImportRun } from "@prisma/client";

import {
  ImportRunService,
  type ImportRunPrisma,
} from "./import-run.service";
import { applyCompletenessGuard } from "./completeness-guard";
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

/** Minimal in-memory stand-in for Prisma's `importRun` + `tour` model surface. */
class InMemoryImportRunStore implements ImportRunPrisma {
  readonly rows = new Map<string, ImportRun>();
  /** Committed `Tour` rows, for `tour.count`'s ledger-reconciliation query. */
  readonly tourRows: Array<{ provider: string; fetchedAt: Date }> = [];
  private seq = 0;

  tour = {
    count: async ({
      where,
    }: {
      where: { provider: string; fetchedAt: Date };
    }): Promise<number> =>
      this.tourRows.filter(
        (t) =>
          t.provider === where.provider &&
          t.fetchedAt.getTime() === where.fetchedAt.getTime(),
      ).length,
  } as unknown as ImportRunPrisma["tour"];

  /** Test helper: record N committed `Tour` rows for a given run's `fetchedAt`. */
  seedTours(provider: string, fetchedAt: Date, count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.tourRows.push({ provider, fetchedAt });
    }
  }

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
        cursor: (data.cursor as string | null | undefined) ?? null,
        cursorAtStart: (data.cursorAtStart as string | null | undefined) ?? null,
        lastPage: null,
        lastCursor: null,
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
    findMany: async ({
      where,
    }: {
      where: { status: ImportRun["status"]; startedAt: { lt: Date } };
    }): Promise<ImportRun[]> =>
      [...this.rows.values()]
        .filter(
          (row) =>
            row.status === where.status && row.startedAt < where.startedAt.lt,
        )
        .map((row) => ({ ...row })),
    findFirst: async ({
      where,
      orderBy,
    }: {
      where: {
        provider?: string;
        status?: ImportRun["status"] | { not: ImportRun["status"] };
        lastCursor?: { not: null };
        cursorAtStart?: null;
        id?: { not: string };
      };
      orderBy?: { startedAt?: "desc" | "asc"; fetched?: "desc" };
    }): Promise<ImportRun | null> => {
      const matches = (row: ImportRun): boolean => {
        if (where.provider !== undefined && row.provider !== where.provider) {
          return false;
        }
        if (where.status !== undefined) {
          if (typeof where.status === "string") {
            if (row.status !== where.status) return false;
          } else if (row.status === where.status.not) {
            return false;
          }
        }
        if (where.lastCursor?.not === null && row.lastCursor === null) {
          return false;
        }
        if (where.cursorAtStart === null && row.cursorAtStart !== null) {
          return false;
        }
        if (where.id && row.id === where.id.not) return false;
        return true;
      };

      let candidates = [...this.rows.values()].filter(matches);
      if (orderBy?.startedAt === "desc") {
        candidates = candidates.sort(
          (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
        );
      } else if (orderBy?.fetched === "desc") {
        candidates = candidates.sort((a, b) => b.fetched - a.fetched);
      } else if (orderBy?.startedAt === "asc") {
        candidates = candidates.sort(
          (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
        );
      }
      return candidates[0] ? { ...candidates[0] } : null;
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
      cursorAtStart: null,
      lastPage: null,
      lastCursor: null,
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

  describe("ledger/reality reconciliation on abnormal exit (BRI-182 follow-up)", () => {
    it("reconciles upserted from real committed Tour rows a killed segment never reported", async () => {
      const runner = fakeSegmentRunner(store, [
        {
          // First segment completes cleanly: its own upsertBatch commits and
          // its `incrementData()` persistence happen together, same as a real
          // segment-worker on the happy path.
          mutate: (rows, id) => {
            const row = rows.get(id)!;
            rows.set(id, { ...row, upserted: 4, fetched: 4, cursor: "c1" });
            store.seedTours(row.provider, row.startedAt, 4);
          },
          result: { exitCode: 0 },
        },
        {
          // Second segment's upsertBatch commits 3 more real Tour rows before
          // an OOM kill — it dies before ever reaching the point where it
          // would persist those as increments on the row itself.
          mutate: (rows, id) => {
            const row = rows.get(id)!;
            store.seedTours(row.provider, row.startedAt, 3);
          },
          result: { exitCode: null },
        },
      ]);
      const service = new ImportRunService(store, runner, CONFIG);

      const run = await service.execute("manual");

      expect(run.status).toBe("failed");
      // fetched has no durable, run-scoped key anywhere in the DB — left
      // exactly as the last successfully completed segment reported it.
      expect(run.fetched).toBe(4);
      // upserted is reconciled against the real Tour count (4 + 3 = 7), not
      // left frozen at the first segment's 4.
      expect(run.upserted).toBe(7);
    });

    it("reconciles upserted to 0 when a segment dies before committing anything", async () => {
      const runner = fakeSegmentRunner(store, [{ result: { exitCode: 1 } }]);
      const service = new ImportRunService(store, runner, CONFIG);

      const run = await service.execute("manual");

      expect(run.status).toBe("failed");
      expect(run.upserted).toBe(0);
    });

    it("scopes the reconciliation query to this run's own provider and fetchedAt (startedAt)", async () => {
      const runner = fakeSegmentRunner(store, [
        {
          mutate: (rows, id) => {
            const row = rows.get(id)!;
            // Tours from a different provider and from a different run's
            // fetchedAt must not leak into this run's reconciled count.
            store.seedTours("other-provider", row.startedAt, 5);
            store.seedTours(row.provider, new Date(row.startedAt.getTime() - 1), 5);
            store.seedTours(row.provider, row.startedAt, 2);
          },
          result: { exitCode: 1 },
        },
      ]);
      const service = new ImportRunService(store, runner, CONFIG);

      const run = await service.execute("manual");

      expect(run.upserted).toBe(2);
    });
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

    describe("ledger/reality reconciliation (BRI-182 follow-up)", () => {
      it("reconciles a reaped run's upserted from real committed Tour rows", async () => {
        const staleStart = new Date(Date.now() - 3 * 60 * 60 * 1000);
        store.seed({
          id: "orphan",
          provider: "viator",
          status: "running",
          startedAt: staleStart,
          upserted: 4, // last successfully-completed segment's own report
        });
        // A later segment's upsertBatch committed 3 more real Tour rows
        // before the whole parent process died mid-orchestration, without
        // ever reporting them back onto the row.
        store.seedTours("viator", staleStart, 7);
        const service = new ImportRunService(
          store,
          fakeSegmentRunner(store, [{ result: { exitCode: 0 } }]),
          { ...CONFIG, stuckRunTimeoutMinutes: 120 },
        );

        const count = await service.reapStuckRuns();

        expect(count).toBe(1);
        const row = store.rows.get("orphan")!;
        expect(row.status).toBe("failed");
        expect(row.upserted).toBe(7);
      });

      it("reconciles each stuck run independently, scoped to its own provider and fetchedAt", async () => {
        const staleA = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const staleB = new Date(Date.now() - 4 * 60 * 60 * 1000);
        store.seed({
          id: "orphan-a",
          provider: "viator",
          status: "running",
          startedAt: staleA,
          upserted: 1,
        });
        store.seed({
          id: "orphan-b",
          provider: "viator",
          status: "running",
          startedAt: staleB,
          upserted: 1,
        });
        store.seedTours("viator", staleA, 5);
        store.seedTours("viator", staleB, 9);

        const service = new ImportRunService(
          store,
          fakeSegmentRunner(store, [{ result: { exitCode: 0 } }]),
          { ...CONFIG, stuckRunTimeoutMinutes: 120 },
        );

        const count = await service.reapStuckRuns();

        expect(count).toBe(2);
        expect(store.rows.get("orphan-a")!.upserted).toBe(5);
        expect(store.rows.get("orphan-b")!.upserted).toBe(9);
      });

      it("reconciles upserted to 0 when a reaped run never committed anything", async () => {
        const staleStart = new Date(Date.now() - 3 * 60 * 60 * 1000);
        store.seed({
          id: "orphan",
          provider: "viator",
          status: "running",
          startedAt: staleStart,
          upserted: 0,
        });
        const service = new ImportRunService(
          store,
          fakeSegmentRunner(store, [{ result: { exitCode: 0 } }]),
          { ...CONFIG, stuckRunTimeoutMinutes: 120 },
        );

        await service.reapStuckRuns();

        expect(store.rows.get("orphan")!.upserted).toBe(0);
      });
    });
  });

  describe("hasRunningRun", () => {
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

  describe("cross-run cursor resume (BRI-181)", () => {
    /**
     * Records the `cursor` already on the row at the moment the *first*
     * segment is spawned — i.e. exactly what `execute()` seeded at
     * `create()` time, before any segment's own progress could overwrite
     * it. Immediately finishes the run so `execute()` returns quickly.
     */
    function captureFirstSegmentRunner(
      store: InMemoryImportRunStore,
    ): SegmentRunner & { seenCursor?: string | null; seenModifiedSince?: string } {
      const runner: SegmentRunner & {
        seenCursor?: string | null;
        seenModifiedSince?: string;
      } = {
        async runSegment(runId: string, modifiedSince?: string) {
          runner.seenCursor = store.rows.get(runId)?.cursor ?? null;
          runner.seenModifiedSince = modifiedSince;
          const row = store.rows.get(runId)!;
          store.rows.set(runId, { ...row, status: "succeeded", finishedAt: new Date() });
          return { exitCode: 0 };
        },
      };
      return runner;
    }

    it("starts a full crawl (no seeded cursor) when no prior run exists", async () => {
      const runner = captureFirstSegmentRunner(store);
      const service = new ImportRunService(store, runner, CONFIG);

      await service.execute("manual");

      expect(runner.seenCursor).toBeNull();
    });

    it("seeds the new run's cursor from a prior succeeded run's lastCursor", async () => {
      store.seed({
        id: "prev",
        status: "succeeded",
        lastCursor: "cursor-succeeded",
        startedAt: new Date(Date.now() - 60_000),
      });
      const runner = captureFirstSegmentRunner(store);
      const service = new ImportRunService(store, runner, CONFIG);

      await service.execute("scheduled");

      expect(runner.seenCursor).toBe("cursor-succeeded");
    });

    it("resumes from a prior FAILED run's lastCursor rather than forcing a full re-crawl", async () => {
      store.seed({
        id: "prev",
        status: "failed",
        lastCursor: "cursor-failed",
        startedAt: new Date(Date.now() - 60_000),
      });
      const runner = captureFirstSegmentRunner(store);
      const service = new ImportRunService(store, runner, CONFIG);

      await service.execute("scheduled");

      expect(runner.seenCursor).toBe("cursor-failed");
    });

    it("resumes from a prior ABORTED run's lastCursor (mass-deletion guard only rolls back the finalize step, not the crawl)", async () => {
      store.seed({
        id: "prev",
        status: "aborted",
        lastCursor: "cursor-aborted",
        startedAt: new Date(Date.now() - 60_000),
      });
      const runner = captureFirstSegmentRunner(store);
      const service = new ImportRunService(store, runner, CONFIG);

      await service.execute("scheduled");

      expect(runner.seenCursor).toBe("cursor-aborted");
    });

    it("picks the most recent of two prior runs with a lastCursor", async () => {
      store.seed({
        id: "older",
        status: "succeeded",
        lastCursor: "cursor-old",
        startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
      store.seed({
        id: "newer",
        status: "succeeded",
        lastCursor: "cursor-new",
        startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      const runner = captureFirstSegmentRunner(store);
      const service = new ImportRunService(store, runner, CONFIG);

      await service.execute("scheduled");

      expect(runner.seenCursor).toBe("cursor-new");
    });

    it("skips a more recent run that made zero progress, falling back to an older run with a real cursor", async () => {
      store.seed({
        id: "older-with-progress",
        status: "succeeded",
        lastCursor: "cursor-old",
        startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
      store.seed({
        id: "newer-crashed-immediately",
        status: "failed",
        lastCursor: null, // crashed before observing a single page
        startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      const runner = captureFirstSegmentRunner(store);
      const service = new ImportRunService(store, runner, CONFIG);

      await service.execute("scheduled");

      expect(runner.seenCursor).toBe("cursor-old");
    });

    it("ignores a currently-running row even if it already has a lastCursor", async () => {
      store.seed({
        id: "in-flight",
        status: "running",
        lastCursor: "cursor-in-flight",
        startedAt: new Date(),
      });
      store.seed({
        id: "settled",
        status: "succeeded",
        lastCursor: "cursor-settled",
        startedAt: new Date(Date.now() - 60_000),
      });
      const runner = captureFirstSegmentRunner(store);
      const service = new ImportRunService(store, runner, CONFIG);

      await service.execute("scheduled");

      expect(runner.seenCursor).toBe("cursor-settled");
    });

    it("an explicit modifiedSince overrides the auto-discovered cursor entirely", async () => {
      store.seed({
        id: "prev",
        status: "succeeded",
        lastCursor: "cursor-stale",
        startedAt: new Date(Date.now() - 60_000),
      });
      const runner = captureFirstSegmentRunner(store);
      const service = new ImportRunService(store, runner, CONFIG);

      await service.execute("manual", { modifiedSince: "2026-08-01T00:00:00Z" });

      expect(runner.seenCursor).toBeNull();
      expect(runner.seenModifiedSince).toBe("2026-08-01T00:00:00Z");
    });
  });

  describe("cursorAtStart -- an immutable snapshot, unlike the mutable cursor field (BRI-184)", () => {
    it("is null for a full crawl (no prior cursor found)", async () => {
      const runner = fakeSegmentRunner(store, [
        {
          mutate: (rows, id) =>
            rows.set(id, { ...rows.get(id)!, status: "succeeded", finishedAt: new Date() }),
          result: { exitCode: 0 },
        },
      ]);
      const service = new ImportRunService(store, runner, CONFIG);

      const run = await service.execute("manual");

      expect(run.cursorAtStart).toBeNull();
    });

    it("captures the resumed cursor for a delta run, and keeps it even after a segment mutates the live cursor field", async () => {
      store.seed({
        id: "prior-run",
        status: "succeeded",
        lastCursor: "cursor-abc",
        startedAt: new Date(Date.now() - 60_000),
      });
      const runner: SegmentRunner = {
        async runSegment(runId: string) {
          const row = store.rows.get(runId)!;
          store.rows.set(runId, {
            ...row,
            cursor: "cursor-xyz",
            status: "succeeded",
            finishedAt: new Date(),
          });
          return { exitCode: 0 };
        },
      };
      const service = new ImportRunService(store, runner, CONFIG);

      const run = await service.execute("manual");

      expect(run.cursor).toBe("cursor-xyz");
      expect(run.cursorAtStart).toBe("cursor-abc");
    });
  });
  describe("BRI-227: a completeness-guard failure does not advance the resume cursor", () => {
    it("the next run resumes from the last good run's cursor, not the failed truncated one's", async () => {
      store.seed({
        id: "good",
        status: "succeeded",
        fetched: 250_000,
        lastCursor: "GOOD-CURSOR",
        startedAt: new Date("2026-10-01T03:00:00Z"),
      });
      // A truncated full run: it saw a cursor on its last page, then ended early.
      store.seed({
        id: "truncated",
        status: "running",
        fetched: 10_500,
        lastPage: 21,
        lastCursor: "TRUNCATED-CURSOR",
        startedAt: new Date("2026-10-09T10:00:00Z"),
      });

      const failed = await applyCompletenessGuard(
        store,
        store.rows.get("truncated")!,
        { minPct: 90 },
        { log: () => undefined, warn: () => undefined, error: () => undefined },
      );

      expect(failed).toBe(true);
      const row = store.rows.get("truncated")!;
      expect(row.status).toBe("failed");
      expect(row.lastCursor).toBeNull();
      expect(row.error).toContain("Completeness guard failed");

      const runner = fakeSegmentRunner(store, [
        {
          mutate: (rows, id) =>
            rows.set(id, { ...rows.get(id)!, status: "succeeded", finishedAt: new Date() }),
          result: { exitCode: 0 },
        },
      ]);
      const next = await new ImportRunService(store, runner, CONFIG).execute("scheduled");
      expect(next.cursorAtStart).toBe("GOOD-CURSOR");
    });
  });
});
