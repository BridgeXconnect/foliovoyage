import { describe, expect, it, jest } from "@jest/globals";
import type { ImportRun } from "@prisma/client";

import {
  applyCompletenessGuard,
  evaluateCompleteness,
} from "./completeness-guard";

const CONFIG = { minPct: 90 };

describe("evaluateCompleteness", () => {
  it("fails a full run below the history-derived floor", () => {
    const v = evaluateCompleteness({
      isFullRun: true,
      fetched: 10_500,
      baselineFetched: 250_000,
      config: CONFIG,
    });
    expect(v).toMatchObject({ outcome: "fail", fetched: 10_500, floor: 225_000 });
  });

  it("passes exactly at the floor and above it", () => {
    for (const fetched of [225_000, 250_000]) {
      expect(
        evaluateCompleteness({ isFullRun: true, fetched, baselineFetched: 250_000, config: CONFIG }),
      ).toMatchObject({ outcome: "pass", floor: 225_000 });
    }
  });

  it("exempts a delta run, whatever it fetched", () => {
    expect(
      evaluateCompleteness({ isFullRun: false, fetched: 3, baselineFetched: 250_000, config: CONFIG }).outcome,
    ).toBe("exempt");
  });

  it("skips, with a reason, when there is no baseline and no absolute floor", () => {
    const v = evaluateCompleteness({ isFullRun: true, fetched: 3, baselineFetched: null, config: CONFIG });
    expect(v).toEqual({
      outcome: "skip",
      reason: expect.stringContaining("no reliable floor"),
    });
  });

  it("uses the absolute floor over history when IMPORT_FULL_RUN_MIN_FETCHED is set", () => {
    const v = evaluateCompleteness({
      isFullRun: true,
      fetched: 150_000,
      baselineFetched: 10_000,
      config: { minPct: 90, minFetched: 200_000 },
    });
    expect(v).toMatchObject({ outcome: "fail", floor: 200_000 });
    expect(
      evaluateCompleteness({
        isFullRun: true,
        fetched: 1,
        baselineFetched: null,
        config: { minPct: 90, minFetched: 1 },
      }).outcome,
    ).toBe("pass");
  });
});

function runRow(over: Partial<ImportRun> = {}): ImportRun {
  return {
    id: "run-new",
    provider: "viator",
    trigger: "manual",
    status: "running",
    fetched: 10_500,
    normalized: 600,
    quarantined: 0,
    upserted: 600,
    softDeleted: 0,
    cursor: null,
    cursorAtStart: null,
    lastPage: 21,
    lastCursor: "LAST-GOOD-LOOKING-CURSOR",
    error: null,
    startedAt: new Date("2026-10-09T10:00:00Z"),
    finishedAt: null,
    ...over,
  } as ImportRun;
}

function fakePrisma(baseline: number | null) {
  const findFirst = jest.fn<(args: unknown) => Promise<{ fetched: number } | null>>(
    async () => (baseline === null ? null : { fetched: baseline }),
  );
  const update = jest.fn(async (args: { data: Record<string, unknown> }) => ({ ...args.data }));
  return { prisma: { importRun: { findFirst, update } } as never, findFirst, update };
}

const logger = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

describe("applyCompletenessGuard", () => {
  it("fails the row, clears the resume cursor and reports it", async () => {
    const { prisma, update, findFirst } = fakePrisma(250_000);
    const log = logger();

    const failed = await applyCompletenessGuard(prisma, runRow(), CONFIG, log);

    expect(failed).toBe(true);
    // Baseline looks only at earlier succeeded full runs, largest first.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "succeeded", cursorAtStart: null, id: { not: "run-new" } }),
        orderBy: { fetched: "desc" },
      }),
    );
    const data = update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "failed", cursor: null, lastCursor: null });
    expect(data.error).toEqual(expect.stringContaining("fetched 10500"));
    expect(data.error).toEqual(expect.stringContaining("floor of 225000"));
    expect(data.finishedAt).toBeInstanceOf(Date);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("[guard]"));
  });

  it("passes without touching the row", async () => {
    const { prisma, update } = fakePrisma(10_000);
    const log = logger();
    expect(await applyCompletenessGuard(prisma, runRow(), CONFIG, log)).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining("passed"));
  });

  it("exempts a cursor-resumed run without even querying history", async () => {
    const { prisma, update, findFirst } = fakePrisma(250_000);
    const log = logger();
    const failed = await applyCompletenessGuard(
      prisma,
      runRow({ cursorAtStart: "SOME-CURSOR", fetched: 10 }),
      CONFIG,
      log,
    );
    expect(failed).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining("not applied"));
  });

  it("exempts an explicit modifiedSince run even though it has no start cursor", async () => {
    const { prisma, update } = fakePrisma(250_000);
    const failed = await applyCompletenessGuard(prisma, runRow({ fetched: 10 }), CONFIG, logger(), "2026-10-01T00:00:00Z");
    expect(failed).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("skips with an explicit warning on a database with no earlier full run", async () => {
    const { prisma, update } = fakePrisma(null);
    const log = logger();
    expect(await applyCompletenessGuard(prisma, runRow(), CONFIG, log)).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("SKIPPED"));
  });
});
