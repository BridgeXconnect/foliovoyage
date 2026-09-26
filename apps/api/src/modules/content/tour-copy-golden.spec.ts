import { describe, expect, it } from "@jest/globals";

import { cleanVerdict, FakeJudge, unsupportedVerdict, ZERO_USAGE } from "./tour-copy-judge.fake";
import type { JudgeResult } from "./tour-copy-judge";
import type { TourCopyGenerationRequest, TourCopyGenerationResult, TourCopyGenerator } from "./tour-copy-generator";
import { runGolden, scorePartA, type GoldenRunDeps } from "./tour-copy-golden";
import { makeGoldenData, PASSING_PARAGRAPH } from "./tour-copy-golden.fixtures";

const verdict = (v: ReturnType<typeof cleanVerdict>): JudgeResult => ({ kind: "verdict", verdict: v, usage: ZERO_USAGE });

class FakeGenerator implements TourCopyGenerator {
  readonly requests: TourCopyGenerationRequest[] = [];
  constructor(private readonly responder: (request: TourCopyGenerationRequest) => TourCopyGenerationResult | Promise<TourCopyGenerationResult> = () => ({
    kind: "text",
    text: PASSING_PARAGRAPH,
    usage: ZERO_USAGE,
  })) {}
  async generate(request: TourCopyGenerationRequest): Promise<TourCopyGenerationResult> {
    this.requests.push(request);
    return this.responder(request);
  }
}

const data = makeGoldenData();
const isSeeded = (paragraph: string): boolean => paragraph.startsWith("Seeded paragraph");

/** A judge that answers the seeded paragraphs by their labels and everything else clean. */
const perfectJudge = (): FakeJudge => {
  const byParagraph = new Map(data.seeded.map((s) => [s.paragraph, s]));
  return new FakeJudge((request) => {
    const seeded = byParagraph.get(request.paragraph);
    if (seeded === undefined) return verdict(cleanVerdict());
    return verdict(
      seeded.claimVerdict === "clean"
        ? cleanVerdict({ leadsWithFact: seeded.leadsWithFact })
        : unsupportedVerdict({ leadsWithFact: seeded.leadsWithFact }),
    );
  });
};

const deps = (over: Partial<GoldenRunDeps> = {}): GoldenRunDeps => ({
  judge: perfectJudge(),
  generator: new FakeGenerator(),
  runId: "run-1",
  ...over,
});

describe("scorePartA", () => {
  it("passes at exactly 90% recall and 1 of 70 clean pages flagged", () => {
    expect(scorePartA({ defects: 20, caught: 18, clean: 70, flaggedClean: 1 }).passed).toBe(true);
  });
  it("fails below 90% recall", () => {
    expect(scorePartA({ defects: 20, caught: 17, clean: 70, flaggedClean: 0 }).passed).toBe(false);
  });
  it("fails at 2 of 70 clean pages flagged", () => {
    expect(scorePartA({ defects: 20, caught: 20, clean: 70, flaggedClean: 2 }).passed).toBe(false);
  });
});

describe("runGolden Part A", () => {
  it("makes 90 sequential judge calls (20 defects, 70 clean pages) and passes with a perfect judge", async () => {
    const judge = perfectJudge();
    const outcome = await runGolden("a", data, deps({ judge }));
    expect(judge.calls).toHaveLength(90);
    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") return;
    expect(outcome.partA).toMatchObject({ defects: 20, caught: 20, clean: 70, flaggedClean: 0, passed: true });
    expect(outcome.partA?.leadsWithFactAgreement).toEqual({ agreed: 30, total: 30 });
    expect(outcome.partB).toBeUndefined();
  });

  it("sends the tour's five fields, its id and a grounding hash", async () => {
    const judge = perfectJudge();
    await runGolden("a", data, deps({ judge }));
    const first = judge.calls[0];
    expect(first.contentType).toBe("tour_copy");
    expect(first.runId).toBe("run-1");
    expect(first.groundingHash).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(Object.keys(first.source).sort()).toEqual(["description", "durationMin", "exclusions", "inclusions", "title"]);
  });

  it("fails when the judge misses too many defects, and lists the missed ones", async () => {
    const judge = new FakeJudge((request) => (isSeeded(request.paragraph) ? verdict(cleanVerdict()) : verdict(cleanVerdict())));
    const outcome = await runGolden("a", data, deps({ judge }));
    if (outcome.kind !== "completed") throw new Error("expected completed");
    expect(outcome.partA?.passed).toBe(false);
    expect(outcome.partA?.caught).toBe(0);
    expect(outcome.partA?.missedDefects).toHaveLength(20);
  });

  it("fails when the judge flags 2 of the clean pages", async () => {
    let flagged = 0;
    const base = perfectJudge();
    const judge = new FakeJudge(async (request) => {
      if (!isSeeded(request.paragraph) && flagged < 2) {
        flagged++;
        return verdict(unsupportedVerdict());
      }
      return base.judge(request);
    });
    const outcome = await runGolden("a", data, deps({ judge }));
    if (outcome.kind !== "completed") throw new Error("expected completed");
    expect(outcome.partA).toMatchObject({ flaggedClean: 2, passed: false });
    expect(outcome.partA?.flaggedCleanPages).toHaveLength(2);
  });

  it("stops at the first judge_invalid, with the counts so far and no pass rates", async () => {
    let calls = 0;
    const judge = new FakeJudge(() => {
      calls++;
      return calls === 5
        ? { kind: "invalid", reason: "bad", usage: ZERO_USAGE }
        : verdict(cleanVerdict());
    });
    const outcome = await runGolden("a", data, deps({ judge }));
    expect(outcome.kind).toBe("stopped");
    if (outcome.kind !== "stopped") return;
    expect(outcome.stop.reason).toBe("judge_invalid");
    expect(outcome.stop.call).toContain("Part A");
    expect(outcome.progress.partACalls).toBe(5);
    expect(judge.calls).toHaveLength(5);
  });

  it("stops at a judge_refusal", async () => {
    const judge = new FakeJudge(() => ({ kind: "refusal", usage: ZERO_USAGE }));
    const outcome = await runGolden("a", data, deps({ judge }));
    expect(outcome).toMatchObject({ kind: "stopped", stop: { reason: "judge_refusal" } });
  });

  it("stops at the first API error without trying the next call", async () => {
    const boom = new Error("boom");
    const judge = new FakeJudge(() => {
      throw boom;
    });
    const outcome = await runGolden("a", data, deps({ judge }));
    expect(outcome).toMatchObject({ kind: "stopped", stop: { reason: "api_error", error: boom } });
    expect(judge.calls).toHaveLength(1);
  });
});

describe("runGolden Part B", () => {
  it("generates and judges each of the 60 tours and passes when none is bad", async () => {
    const generator = new FakeGenerator();
    const judge = perfectJudge();
    const outcome = await runGolden("b", data, deps({ generator, judge }));
    if (outcome.kind !== "completed") throw new Error("expected completed");
    expect(generator.requests).toHaveLength(60);
    expect(judge.calls).toHaveLength(60);
    expect(outcome.partA).toBeUndefined();
    expect(outcome.partB).toMatchObject({ tours: 60, published: 60, failed: 0, judged: 60, bad: 0, badRate: 0, passed: true, checkPassRate: 1 });
    expect(outcome.partB?.leadsWithFactShare).toBe(1);
  });

  it("passes at 3 bad of 60 (5%) and fails at 4", async () => {
    const run = async (badCount: number) => {
      let seen = 0;
      const judge = new FakeJudge(() => verdict(seen++ < badCount ? unsupportedVerdict() : cleanVerdict()));
      const outcome = await runGolden("b", data, deps({ judge }));
      if (outcome.kind !== "completed") throw new Error("expected completed");
      return outcome.partB;
    };
    expect((await run(3))?.passed).toBe(true);
    const failing = await run(4);
    expect(failing?.passed).toBe(false);
    expect(failing?.badTourIds).toHaveLength(4);
  });

  it("counts a generator refusal as a failed outcome and carries on", async () => {
    let n = 0;
    const generator = new FakeGenerator(() => (n++ === 0 ? { kind: "refusal", usage: ZERO_USAGE } : { kind: "text", text: PASSING_PARAGRAPH, usage: ZERO_USAGE }));
    const judge = perfectJudge();
    const outcome = await runGolden("b", data, deps({ generator, judge }));
    if (outcome.kind !== "completed") throw new Error("expected completed");
    expect(outcome.partB).toMatchObject({ published: 59, failed: 1, judged: 59 });
    expect(outcome.partB?.reasonCounts).toEqual({ refusal: 1 });
    expect(judge.calls).toHaveLength(59);
  });

  it("does not judge a paragraph that fails the inline check twice, and counts its reasons", async () => {
    const generator = new FakeGenerator(() => ({ kind: "text", text: "Too short.", usage: ZERO_USAGE }));
    const judge = perfectJudge();
    const outcome = await runGolden("b", data, deps({ generator, judge }));
    if (outcome.kind !== "completed") throw new Error("expected completed");
    expect(judge.calls).toHaveLength(0);
    expect(outcome.partB).toMatchObject({ published: 0, failed: 60, judged: 0, passed: false, checkPassRate: 0 });
    expect(Object.keys(outcome.partB?.reasonCounts ?? {}).length).toBeGreaterThan(0);
  });

  it("fails Part B when fewer than 30 pages were judged", async () => {
    let n = 0;
    const generator = new FakeGenerator(() => (n++ % 3 !== 0 ? { kind: "refusal", usage: ZERO_USAGE } : { kind: "text", text: PASSING_PARAGRAPH, usage: ZERO_USAGE }));
    const outcome = await runGolden("b", data, deps({ generator }));
    if (outcome.kind !== "completed") throw new Error("expected completed");
    expect(outcome.partB?.judged).toBeLessThan(30);
    expect(outcome.partB?.passed).toBe(false);
  });

  it("reports how many published openings lead with a duration", async () => {
    const generator = new FakeGenerator(() => ({ kind: "text", text: PASSING_PARAGRAPH, usage: ZERO_USAGE }));
    const outcome = await runGolden("b", data, deps({ generator }));
    if (outcome.kind !== "completed") throw new Error("expected completed");
    expect(outcome.partB?.durationOpeningShare).toBe(0);
  });

  it("stops at a generator API error", async () => {
    const generator = new FakeGenerator(() => {
      throw new Error("gateway down");
    });
    const outcome = await runGolden("b", data, deps({ generator }));
    expect(outcome).toMatchObject({ kind: "stopped", stop: { reason: "api_error" } });
  });

  it("stops at a judge_invalid inside Part B", async () => {
    const judge = new FakeJudge(() => ({ kind: "invalid", reason: "bad", usage: ZERO_USAGE }));
    const outcome = await runGolden("b", data, deps({ judge }));
    expect(outcome).toMatchObject({ kind: "stopped", stop: { reason: "judge_invalid" } });
    if (outcome.kind === "stopped") expect(outcome.progress.partBGenerated).toBe(1);
  });
});

describe("runGolden both", () => {
  it("runs Part B after a passing Part A", async () => {
    const outcome = await runGolden("both", data, deps());
    if (outcome.kind !== "completed") throw new Error("expected completed");
    expect(outcome.partA?.passed).toBe(true);
    expect(outcome.partB?.passed).toBe(true);
    expect(outcome.partBSkipped).toBe(false);
  });

  it("does not start Part B when Part A fails", async () => {
    const generator = new FakeGenerator();
    const judge = new FakeJudge(() => verdict(cleanVerdict()));
    const outcome = await runGolden("both", data, deps({ generator, judge }));
    if (outcome.kind !== "completed") throw new Error("expected completed");
    expect(outcome.partA?.passed).toBe(false);
    expect(outcome.partB).toBeUndefined();
    expect(outcome.partBSkipped).toBe(true);
    expect(generator.requests).toHaveLength(0);
  });

  it("makes its calls one at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    const base = perfectJudge();
    const judge = new FakeJudge(async (request) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return base.judge(request);
    });
    await runGolden("both", data, deps({ judge }));
    expect(peak).toBe(1);
  });
});
