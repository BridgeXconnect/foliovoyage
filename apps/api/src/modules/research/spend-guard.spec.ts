import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import {
  Ledger,
  LedgerCorruptError,
  SpendGuard,
  SpendRefusedError,
  resolveRunCap,
  toMicros,
  type LedgerLine,
} from "./spend-guard";

const NOW = new Date("2026-09-20T12:00:00.000Z");

const line = (over: Partial<LedgerLine> = {}): LedgerLine => ({
  ts: NOW.toISOString(),
  stage: "demand",
  endpoint: "dataforseo_labs/google/keyword_overview/live",
  keywords: 10,
  cost: 0.01,
  cacheKey: "abc",
  ...over,
});

describe("resolveRunCap", () => {
  it("defaults to 1 when unset", () => {
    expect(resolveRunCap(undefined)).toBe(1);
  });

  it("passes a value under the hard maximum through", () => {
    expect(resolveRunCap(2.5)).toBe(2.5);
  });

  it("clamps anything above 5 down to 5", () => {
    expect(resolveRunCap(10)).toBe(5);
    expect(resolveRunCap(5.01)).toBe(5);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %p instead of loosening the cap",
    (bad) => {
      expect(() => resolveRunCap(bad)).toThrow(/positive number/);
    },
  );
});

describe("SpendGuard", () => {
  let dir: string;
  let ledger: Ledger;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "spend-guard-"));
    ledger = new Ledger(path.join(dir, "ledger.jsonl"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const guard = (runCapUsd?: number) =>
    new SpendGuard({ ledger, ...(runCapUsd === undefined ? {} : { runCapUsd }), now: () => NOW });

  it("allows a call that lands exactly on the run cap", () => {
    expect(() => guard(1).check(1)).not.toThrow();
  });

  it("refuses a call that would pass the run cap by one micro dollar", () => {
    let error: unknown;
    try {
      guard(1).check(1.000001);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SpendRefusedError);
    expect((error as SpendRefusedError).reason).toBe("run_cap");
    expect((error as Error).message).toContain("Nothing was spent");
  });

  it("does not let floating point drift hide or invent a breach (0.1 + 0.2 against 0.3)", () => {
    const g = guard(0.3);
    g.record(line({ cost: 0.1 }));
    expect(() => g.check(0.2)).not.toThrow();
    expect(() => g.check(0.200001)).toThrow(SpendRefusedError);
  });

  it("counts the provider reported cost of recorded calls toward the run cap", () => {
    const g = guard(0.05);
    g.record(line({ cost: 0.04 }));
    expect(g.runSpentUsd).toBeCloseTo(0.04, 9);
    expect(() => g.check(0.02)).toThrow(SpendRefusedError);
    expect(() => g.check(0.01)).not.toThrow();
  });

  it("refuses when the month total in the ledger plus the estimate passes 25", () => {
    ledger.append(line({ cost: 24.95 }));
    let error: unknown;
    try {
      guard(1).check(0.1);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SpendRefusedError);
    expect((error as SpendRefusedError).reason).toBe("month_ceiling");
    expect(() => guard(1).check(0.05)).not.toThrow();
  });

  it("only counts ledger lines from the current UTC calendar month", () => {
    ledger.append(line({ cost: 30, ts: "2026-08-31T23:59:59.000Z" }));
    ledger.append(line({ cost: 0.5, ts: "2026-09-01T00:00:00.000Z" }));
    expect(guard(1).monthSpentUsd()).toBeCloseTo(0.5, 9);
    expect(() => guard(1).check(0.5)).not.toThrow();
  });

  it("includes dry run estimates already counted, so a dry run reports what the real run would do", () => {
    const g = guard(0.01);
    g.check(0.006);
    g.plan(0.006);
    expect(g.plannedCallCount).toBe(1);
    expect(g.plannedUsd).toBeCloseTo(0.006, 9);
    expect(() => g.check(0.006)).toThrow(SpendRefusedError);
  });

  describe("total budget", () => {
    const budgeted = (totalBudgetUsd: number | undefined, runCapUsd = 1) =>
      new SpendGuard({
        ledger,
        runCapUsd,
        ...(totalBudgetUsd === undefined ? {} : { totalBudgetUsd }),
        now: () => NOW,
      });

    it("holds across separate runs, which each start their run total at zero", () => {
      const first = budgeted(0.6);
      first.record(line({ cost: 0.55 }));
      // A second process: its run total is zero, but the ledger remembers the first.
      const second = budgeted(0.6);
      expect(second.runSpentUsd).toBe(0);
      let error: unknown;
      try {
        second.check(0.06);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(SpendRefusedError);
      expect((error as SpendRefusedError).reason).toBe("total_budget");
      expect((error as Error).message).toContain("Nothing was spent");
      expect(() => second.check(0.05)).not.toThrow();
    });

    it("counts spend from earlier months, unlike the month ceiling", () => {
      ledger.append(line({ cost: 0.5, ts: "2026-08-01T00:00:00.000Z" }));
      const g = budgeted(0.6);
      expect(g.monthSpentUsd()).toBe(0);
      expect(() => g.check(0.11)).toThrow(SpendRefusedError);
      expect(() => g.check(0.1)).not.toThrow();
    });

    it("includes dry run estimates already counted", () => {
      const g = budgeted(0.1);
      g.check(0.06);
      g.plan(0.06);
      expect(() => g.check(0.05)).toThrow(SpendRefusedError);
    });

    it("reports what is left of the budget from the whole ledger", () => {
      ledger.append(line({ cost: 0.25 }));
      expect(budgeted(0.6).totalBudgetLeftUsd()).toBeCloseTo(0.35, 9);
      expect(budgeted(undefined).totalBudgetLeftUsd()).toBeUndefined();
    });

    it("enforces nothing when no budget is set", () => {
      ledger.append(line({ cost: 10 }));
      expect(() => budgeted(undefined, 5).check(1)).not.toThrow();
    });

    it.each([0, -1, Number.NaN])("rejects %p instead of loosening the budget", (bad) => {
      expect(() => budgeted(bad)).toThrow(/HUB_RESEARCH_BUDGET_USD/);
    });
  });

  it("refuses a negative or non finite estimate", () => {
    expect(() => guard(1).check(-0.01)).toThrow(/non negative/);
    expect(() => guard(1).check(Number.NaN)).toThrow(/non negative/);
  });

  it("stops on a corrupt ledger line rather than trusting the month total", () => {
    fs.writeFileSync(ledger.file, `${JSON.stringify(line())}\nnot json\n`);
    expect(() => guard(1).check(0.01)).toThrow(LedgerCorruptError);
    fs.writeFileSync(ledger.file, `${JSON.stringify({ ts: "x" })}\n`);
    expect(() => guard(1).check(0.01)).toThrow(LedgerCorruptError);
  });

  it("appends one line per record and never rewrites earlier lines", () => {
    const g = guard(1);
    g.record(line({ cacheKey: "one", cost: 0.01 }));
    const first = fs.readFileSync(ledger.file, "utf8");
    g.record(line({ cacheKey: "two", cost: 0.02 }));
    const second = fs.readFileSync(ledger.file, "utf8");
    expect(second.startsWith(first)).toBe(true);
    expect(second.trim().split("\n")).toHaveLength(2);
    expect(ledger.read().map((l) => l.cacheKey)).toEqual(["one", "two"]);
  });
});

describe("toMicros", () => {
  it("rounds to whole micro dollars", () => {
    expect(toMicros(0.012 + 0.00012 * 100)).toBe(24_000);
    expect(toMicros(0.1 + 0.2)).toBe(300_000);
  });
});
