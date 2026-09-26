import { describe, expect, it } from "@jest/globals";

import { GoldenDataMissingError, GOLDEN_REFERENCES_DRAFT_FILE, GOLDEN_STAMP_FILE, computeGoldenStampKey } from "./tour-copy-golden-data";
import { main, stampRefusal, type GoldenCliDeps } from "./tour-copy-golden.cli";
import { makeGoldenData, PASSING_PARAGRAPH } from "./tour-copy-golden.fixtures";
import type { TourCopyGenerationRequest, TourCopyGenerationResult, TourCopyGenerator } from "./tour-copy-generator";
import { cleanVerdict, FakeJudge, unsupportedVerdict, ZERO_USAGE } from "./tour-copy-judge.fake";
import type { JudgeResult } from "./tour-copy-judge";

const ENV = { AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic", AI_GATEWAY_TOKEN: "token" };
const data = makeGoldenData();
const verdict = (v: ReturnType<typeof cleanVerdict>): JudgeResult => ({ kind: "verdict", verdict: v, usage: ZERO_USAGE });

class FakeGenerator implements TourCopyGenerator {
  readonly requests: TourCopyGenerationRequest[] = [];
  constructor(private readonly responder: () => TourCopyGenerationResult = () => ({ kind: "text", text: PASSING_PARAGRAPH, usage: ZERO_USAGE })) {}
  async generate(request: TourCopyGenerationRequest): Promise<TourCopyGenerationResult> {
    this.requests.push(request);
    return this.responder();
  }
}

const perfectJudge = (): FakeJudge => {
  const byParagraph = new Map(data.seeded.map((s) => [s.paragraph, s]));
  return new FakeJudge((request) => {
    const seeded = byParagraph.get(request.paragraph);
    if (!seeded) return verdict(cleanVerdict());
    return verdict(seeded.claimVerdict === "clean" ? cleanVerdict({ leadsWithFact: seeded.leadsWithFact }) : unsupportedVerdict({ leadsWithFact: seeded.leadsWithFact }));
  });
};

function harness(overrides: Partial<GoldenCliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const writes: Array<{ file: string; content: string }> = [];
  const judge = perfectJudge();
  const generator = new FakeGenerator();
  const deps: GoldenCliDeps = {
    runId: () => "run-1",
    now: () => new Date("2026-09-26T10:00:00.000Z"),
    judge,
    generator,
    loadData: () => data,
    writeFile: (file, content) => void writes.push({ file, content }),
    fileExists: () => false,
    ...overrides,
  };
  const run = (argv: string[], env: NodeJS.ProcessEnv = ENV) => main(argv, env, { out: (l) => out.push(l), err: (l) => err.push(l) }, deps);
  return { run, out, err, writes, judge, generator };
}

describe("tour-copy-golden:run arguments", () => {
  it("rejects an unknown argument and a bad --part", async () => {
    const h = harness();
    expect(await h.run(["--nope"])).toBe(1);
    expect(await h.run(["--part", "c"])).toBe(1);
    expect(await h.run(["--part"])).toBe(1);
  });

  it("refuses --freeze-references without --execute", async () => {
    const h = harness();
    expect(await h.run(["--freeze-references"])).toBe(1);
    expect(h.err.join("\n")).toContain("needs --execute");
    expect(h.generator.requests).toHaveLength(0);
  });
});

describe("startup checks (AC-19)", () => {
  it("fails with no gateway variables, before loading the golden data", async () => {
    let loaded = false;
    const h = harness({ loadData: () => ((loaded = true), data) });
    expect(await h.run(["--execute"], {})).toBe(1);
    expect(h.err.join("\n")).toContain("AI_GATEWAY_BASE_URL");
    expect(loaded).toBe(false);
  });

  it("fails on a model that is not allowed", async () => {
    const h = harness();
    expect(await h.run(["--execute"], { ...ENV, TOUR_COPY_JUDGE_MODEL: "gpt-4" })).toBe(1);
    expect(h.judge.calls).toHaveLength(0);
  });
});

describe("dry run", () => {
  it("prints the counts and the planned calls, and makes none", async () => {
    const h = harness();
    expect(await h.run([])).toBe(0);
    const text = h.out.join("\n");
    expect(text).toContain("60 tours, 30 seeded paragraphs (20 defects, 10 clean controls)");
    expect(text).toContain("Part A: 90 judge calls");
    expect(text).toContain("estimated Part A input tokens");
    expect(text).toContain("Part B: 60 generations");
    expect(h.judge.calls).toHaveLength(0);
    expect(h.generator.requests).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
  });

  it("says clearly when the golden files are missing", async () => {
    const h = harness({
      loadData: () => {
        throw new GoldenDataMissingError("/x/tour-copy-golden-tours.json");
      },
    });
    expect(await h.run([])).toBe(1);
    expect(h.err.join("\n")).toContain("tour-copy-golden:snapshot");
  });
});

describe("--execute", () => {
  it("defaults to both parts, passes, and writes the stamp with the effective models", async () => {
    const h = harness();
    expect(await h.run(["--execute"])).toBe(0);
    expect(h.judge.calls).toHaveLength(150);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].file).toBe(GOLDEN_STAMP_FILE);
    const stamp = JSON.parse(h.writes[0].content) as Record<string, unknown>;
    expect(stamp).toMatchObject({
      key: computeGoldenStampKey(data),
      passed: true,
      runId: "run-1",
      date: "2026-09-26T10:00:00.000Z",
      generatorModel: "claude-sonnet-5",
      judgeModel: "claude-opus-5-5",
      rubricVersion: 1,
    });
    expect(stamp.partA).toMatchObject({ caught: 20, defects: 20 });
    expect(stamp.partB).toMatchObject({ judged: 60, bad: 0 });
  });

  it("refuses up front, with no call, when a model differs from the default and the part is both", async () => {
    const h = harness();
    expect(await h.run(["--execute"], { ...ENV, TOUR_COPY_MODEL: "claude-haiku-4-5-20251001" })).toBe(1);
    expect(h.err.join("\n")).toContain("only records a run on the default models");
    expect(h.judge.calls).toHaveLength(0);
    expect(h.generator.requests).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
  });

  it("does not write a stamp for --part a, and --part b runs ungated", async () => {
    const a = harness();
    expect(await a.run(["--execute", "--part", "a"])).toBe(0);
    expect(a.judge.calls).toHaveLength(90);
    expect(a.writes).toHaveLength(0);

    const b = harness({ judge: new FakeJudge(() => verdict(cleanVerdict())) });
    expect(await b.run(["--execute", "--part", "b"])).toBe(0);
    expect(b.writes).toHaveLength(0);
    expect(b.out.join("\n")).toContain("ungated");
  });

  it("allows a diagnostic --part b run on a non default model", async () => {
    const h = harness();
    expect(await h.run(["--execute", "--part", "b"], { ...ENV, TOUR_COPY_MODEL: "claude-haiku-4-5-20251001" })).toBe(0);
    expect(h.generator.requests).toHaveLength(60);
  });

  it("exits 1 with no stamp when Part A fails, and skips Part B", async () => {
    const h = harness({ judge: new FakeJudge(() => verdict(cleanVerdict())) });
    expect(await h.run(["--execute"])).toBe(1);
    expect(h.out.join("\n")).toContain("Part A (the judge): FAIL");
    expect(h.out.join("\n")).toContain("Part B was not run");
    expect(h.generator.requests).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
  });

  it("exits 1 with no stamp when Part B fails", async () => {
    let calls = 0;
    const base = perfectJudge();
    // The first 90 calls are Part A. Every Part B page after that is flagged.
    const judge = new FakeJudge(async (request) => (++calls > 90 ? verdict(unsupportedVerdict()) : base.judge(request)));
    const h = harness({ judge });
    expect(await h.run(["--execute"])).toBe(1);
    expect(h.out.join("\n")).toContain("Part B (the prompt): FAIL");
    expect(h.writes).toHaveLength(0);
  });

  it("stops at an invalid verdict, prints the failed call and counts, no pass rates, no stamp", async () => {
    let n = 0;
    const judge = new FakeJudge(() => (++n === 3 ? { kind: "invalid", reason: "bad", usage: ZERO_USAGE } : verdict(cleanVerdict())));
    const h = harness({ judge });
    expect(await h.run(["--execute"])).toBe(1);
    const errText = h.err.join("\n");
    expect(errText).toContain("Stopped at Part A");
    expect(errText).toContain("invalid verdict");
    expect(errText).toContain("Part A 3");
    expect(h.out.join("\n")).not.toContain("PASS");
    expect(h.out.join("\n")).not.toContain("FAIL");
    expect(h.writes).toHaveLength(0);
  });

  it("stops at an API error and prints it", async () => {
    const judge = new FakeJudge(() => {
      throw new Error("gateway timed out");
    });
    const h = harness({ judge });
    expect(await h.run(["--execute"])).toBe(1);
    expect(h.err.join("\n")).toContain("gateway timed out");
    expect(judge.calls).toHaveLength(1);
  });
});

describe("stampRefusal", () => {
  it("allows the default pair only", () => {
    expect(stampRefusal("claude-sonnet-5", "claude-opus-5-5")).toBeNull();
    expect(stampRefusal("claude-haiku-4-5-20251001", "claude-opus-5-5")).not.toBeNull();
    expect(stampRefusal("claude-sonnet-5", "other")).not.toBeNull();
  });
});

describe("--freeze-references", () => {
  const snapshot = data.tours.map((tour) => {
    const copy: Record<string, unknown> = { ...tour };
    delete copy.referenceParagraph;
    return copy;
  });

  it("writes a draft file with one reference paragraph per tour, and makes no judge call", async () => {
    const h = harness({ loadTours: () => snapshot });
    expect(await h.run(["--execute", "--freeze-references"])).toBe(0);
    expect(h.judge.calls).toHaveLength(0);
    expect(h.generator.requests).toHaveLength(60);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].file).toBe(GOLDEN_REFERENCES_DRAFT_FILE);
    const draft = JSON.parse(h.writes[0].content) as Array<{ id: string; referenceParagraph: string | null }>;
    expect(draft).toHaveLength(60);
    expect(draft.every((entry) => entry.referenceParagraph === PASSING_PARAGRAPH)).toBe(true);
  });

  it("refuses to overwrite an existing draft, before any call", async () => {
    const h = harness({ loadTours: () => snapshot, fileExists: (file) => file === GOLDEN_REFERENCES_DRAFT_FILE });
    expect(await h.run(["--execute", "--freeze-references"])).toBe(1);
    expect(h.err.join("\n")).toContain("will not overwrite");
    expect(h.generator.requests).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
  });

  it("leaves a null draft for a tour the generator could not write, and lists it", async () => {
    let n = 0;
    const generator = new FakeGenerator(() => (n++ === 0 ? { kind: "refusal", usage: ZERO_USAGE } : { kind: "text", text: PASSING_PARAGRAPH, usage: ZERO_USAGE }));
    const h = harness({ loadTours: () => snapshot, generator });
    expect(await h.run(["--execute", "--freeze-references"])).toBe(0);
    const draft = JSON.parse(h.writes[0].content) as Array<{ referenceParagraph: string | null }>;
    expect(draft[0].referenceParagraph).toBeNull();
    expect(h.out.join("\n")).toContain("No draft for: tour-00");
  });

  it("writes nothing when the generator errors part way", async () => {
    let n = 0;
    const generator = new FakeGenerator(() => {
      if (n++ === 4) throw new Error("gateway down");
      return { kind: "text", text: PASSING_PARAGRAPH, usage: ZERO_USAGE };
    });
    const h = harness({ loadTours: () => snapshot, generator });
    expect(await h.run(["--execute", "--freeze-references"])).toBe(1);
    expect(h.writes).toHaveLength(0);
    expect(h.err.join("\n")).toContain("No draft file was written");
  });

  it("fails cleanly when the tours file is missing or the wrong shape", async () => {
    const missing = harness({
      loadTours: () => {
        throw new GoldenDataMissingError("/x/tours.json");
      },
    });
    expect(await missing.run(["--execute", "--freeze-references"])).toBe(1);
    const wrong = harness({ loadTours: () => snapshot.slice(0, 3) });
    expect(await wrong.run(["--execute", "--freeze-references"])).toBe(1);
    expect(wrong.generator.requests).toHaveLength(0);
  });

  it("does not need Part A's seeded file", async () => {
    let loadedData = false;
    const h = harness({ loadTours: () => snapshot, loadData: () => ((loadedData = true), data) });
    await h.run(["--execute", "--freeze-references"]);
    expect(loadedData).toBe(false);
  });
});
