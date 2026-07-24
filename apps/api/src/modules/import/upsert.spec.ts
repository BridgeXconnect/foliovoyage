import { describe, expect, it } from "@jest/globals";

import { planDeletion } from "./upsert";

/**
 * Unit tests for the **pure** guard arithmetic ({@link planDeletion}). The
 * transactional DB behaviour (real double-run idempotency, soft-delete, rollback
 * on abort) is covered separately by `upsert.integration.spec.ts`, which runs
 * against a throwaway Postgres — that is the only honest way to test a
 * transaction, so it is deliberately not faked here.
 */

const DEFAULT_THRESHOLD = 10;

describe("planDeletion — the diff", () => {
  it("marks active-but-absent ids for soft-delete", () => {
    const plan = planDeletion(["a", "b", "c"], ["a", "b"], DEFAULT_THRESHOLD);
    expect(plan.toSoftDelete).toEqual(["c"]);
  });

  it("marks nothing when the run covers the whole active set", () => {
    const plan = planDeletion(["a", "b"], ["a", "b"], DEFAULT_THRESHOLD);
    expect(plan.toSoftDelete).toEqual([]);
    expect(plan.aborted).toBe(false);
  });

  it("ignores incoming ids that are not currently active (new rows)", () => {
    // "c" and "d" are new inserts, not deletions — the diff is one-directional.
    const plan = planDeletion(["a", "b"], ["a", "b", "c", "d"], DEFAULT_THRESHOLD);
    expect(plan.toSoftDelete).toEqual([]);
  });
});

describe("planDeletion — the guard", () => {
  it("does not abort on a first run (empty active catalogue)", () => {
    const plan = planDeletion([], ["a", "b", "c"], DEFAULT_THRESHOLD);
    expect(plan.activeCount).toBe(0);
    expect(plan.deletionPct).toBe(0);
    expect(plan.aborted).toBe(false);
  });

  it("aborts an empty run against a populated catalogue (100% deletion)", () => {
    const plan = planDeletion(["a", "b", "c", "d"], [], DEFAULT_THRESHOLD);
    expect(plan.toSoftDelete).toHaveLength(4);
    expect(plan.deletionPct).toBe(100);
    expect(plan.aborted).toBe(true);
  });

  it("does not abort at exactly the threshold (strictly-greater rule)", () => {
    // 1 of 10 active = 10.0%, equal to the 10% threshold → allowed.
    const active = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const incoming = active.slice(1); // drop exactly one → 10%
    const plan = planDeletion(active, incoming, DEFAULT_THRESHOLD);
    expect(plan.deletionPct).toBeCloseTo(10);
    expect(plan.aborted).toBe(false);
  });

  it("aborts just over the threshold", () => {
    // 2 of 10 active = 20% > 10% → abort.
    const active = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const incoming = active.slice(2);
    const plan = planDeletion(active, incoming, DEFAULT_THRESHOLD);
    expect(plan.deletionPct).toBeCloseTo(20);
    expect(plan.aborted).toBe(true);
  });

  it("honours a custom (higher) threshold — no abort when under it", () => {
    // 20% deletion, but a 50% threshold tolerates it.
    const active = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const incoming = active.slice(2);
    const plan = planDeletion(active, incoming, 50);
    expect(plan.aborted).toBe(false);
  });

  it("with a 0% threshold, any deletion aborts but a no-op run does not", () => {
    const active = ["a", "b"];
    expect(planDeletion(active, ["a"], 0).aborted).toBe(true); // 50% > 0%
    expect(planDeletion(active, ["a", "b"], 0).aborted).toBe(false); // 0% not > 0%
  });
});
