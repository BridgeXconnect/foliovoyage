import { describe, expect, it, jest } from "@jest/globals";

import { seededRandom } from "./tour-copy-eval-sample";
import {
  buildAgreementReport,
  main,
  type HumanAnswer,
  type ReportRow,
  type SpotcheckRow,
  type SpotcheckStore,
} from "./tour-copy-spotcheck.cli";

const source = { title: "Canal tour", description: "A calm boat ride.", durationMin: 120, inclusions: [], exclusions: [] };

function row(id: string): SpotcheckRow {
  return { tourCopyId: `copy-${id}`, tourId: id, copyGeneratedAt: new Date("2026-09-01T00:00:00Z"), paragraph: `Paragraph ${id}.`, source };
}

interface Setup {
  judged?: string[];
  unjudged?: string[];
  answered?: number;
  missing?: string[];
  reportRows?: ReportRow[];
  duplicate?: boolean;
  /** Answers typed by the human, in order. When they run out input ends. */
  answers: string[];
  isTty?: boolean;
}

function setup(options: Setup) {
  const out: string[] = [];
  const err: string[] = [];
  const saved: Array<{ tourId: string; answer: HumanAnswer }> = [];
  const questions: string[] = [];
  const queue = [...options.answers];
  const store: SpotcheckStore = {
    pool: jest.fn(async () => ({
      judged: (options.judged ?? []).map((id) => `copy-${id}`),
      unjudged: (options.unjudged ?? []).map((id) => `copy-${id}`),
      answered: options.answered ?? 0,
    })) as SpotcheckStore["pool"],
    loadRow: async (copyId: string) => {
      const id = copyId.replace("copy-", "");
      return (options.missing ?? []).includes(id) ? null : row(id);
    },
    saveHuman: async (r: SpotcheckRow, _pair, answer: HumanAnswer) => {
      saved.push({ tourId: r.tourId, answer });
      return options.duplicate ? ("duplicate" as const) : ("saved" as const);
    },
    reportRows: async () => options.reportRows ?? [],
  };
  const io = {
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
    isTty: options.isTty ?? true,
    ask: async (question: string) => {
      questions.push(question);
      return queue.length === 0 ? null : queue.shift()!;
    },
  };
  const run = (args: string[]) =>
    main(args, {}, io, { store, random: seededRandom(1), runId: () => "spot-run", disconnect: async () => undefined });
  return { out, err, saved, questions, store, run };
}

const ARGS = ["--prompt-version", "4", "--model", "claude-sonnet-5"];

describe("tour-copy-spotcheck.cli (spec 0003 AC-13)", () => {
  it("exits 1 when input is not a terminal, before touching the database", async () => {
    const { run, err, store } = setup({ answers: [], isTty: false });
    expect(await run(ARGS)).toBe(1);
    expect(err.join("\n")).toContain("interactive terminal");
    expect(store.pool).not.toHaveBeenCalled();
  });

  it("rejects bad arguments with exit 1", async () => {
    const { run, err } = setup({ answers: [] });
    expect(await run(["--prompt-version", "4"])).toBe(1);
    expect(await run([...ARGS, "--count", "0"])).toBe(1);
    expect(err.join("\n")).toContain("Both --prompt-version and --model are required");
    expect(err.join("\n")).toContain("--count needs a positive integer");
  });

  it("stores a good answer as clean with the leads with fact answer", async () => {
    const { run, saved } = setup({ judged: ["a"], answers: ["g", "y"] });
    expect(await run([...ARGS, "--count", "1"])).toBe(0);
    expect(saved).toEqual([{ tourId: "a", answer: { claimVerdict: "clean", note: null, leadsWithFact: true } }]);
  });

  it("stores a bad answer with its verdict and note", async () => {
    const { run, saved } = setup({ judged: ["a"], answers: ["b", "c", "the boat is not wooden", "n"] });
    await run([...ARGS, "--count", "1"]);
    expect(saved).toEqual([
      { tourId: "a", answer: { claimVerdict: "contradicted", note: "the boat is not wooden", leadsWithFact: false } },
    ]);
  });

  it("stores nothing for a skip and does not ask about leading with a fact", async () => {
    const { run, saved, questions } = setup({ judged: ["a"], answers: ["s"] });
    await run([...ARGS, "--count", "1"]);
    expect(saved).toEqual([]);
    expect(questions.some((q) => q.includes("lead with"))).toBe(false);
  });

  it("asks again after an answer it does not know", async () => {
    const { run, saved, out } = setup({ judged: ["a"], answers: ["x", "g", "maybe", "n"] });
    await run([...ARGS, "--count", "1"]);
    expect(out.filter((l) => l.includes("Please answer one of"))).toHaveLength(2);
    expect(saved).toHaveLength(1);
  });

  it("draws judged rows before unjudged ones", async () => {
    const { run, saved } = setup({ judged: ["j1", "j2"], unjudged: ["u1", "u2"], answers: ["g", "y", "g", "y"] });
    await run([...ARGS, "--count", "2"]);
    expect(saved.map((s) => s.tourId).sort()).toEqual(["j1", "j2"]);
  });

  it("fills from unjudged rows only when there are too few judged rows", async () => {
    const { run, saved } = setup({ judged: ["j1"], unjudged: ["u1", "u2"], answers: ["g", "y", "g", "y", "g", "y"] });
    await run([...ARGS, "--count", "3"]);
    expect(saved.map((s) => s.tourId).sort()).toEqual(["j1", "u1", "u2"]);
  });

  it("asks only for the rest when some rows are already answered (resume)", async () => {
    const { run, saved, out } = setup({ judged: ["a", "b", "c"], answered: 2, answers: ["g", "y", "g", "y"] });
    await run([...ARGS, "--count", "3"]);
    expect(out.join("\n")).toContain("2 answered already, target 3, 1 to draw");
    expect(saved).toHaveLength(1);
  });

  it("only prints the report when the target is already met", async () => {
    const { run, saved, questions } = setup({ judged: ["a"], answered: 30, answers: [] });
    expect(await run(ARGS)).toBe(0);
    expect(saved).toEqual([]);
    expect(questions).toEqual([]);
  });

  it("passes over rows that are no longer served without counting them", async () => {
    const { run, saved } = setup({ judged: ["a", "b", "c"], missing: ["a", "b"], answers: ["g", "y"] });
    await run([...ARGS, "--count", "1"]);
    expect(saved.map((s) => s.tourId)).toEqual(["c"]);
  });

  it("stops cleanly when input ends and keeps what was saved", async () => {
    const { run, saved, out } = setup({ judged: ["a", "b"], answers: ["g", "y"] });
    expect(await run([...ARGS, "--count", "2"])).toBe(0);
    expect(saved).toHaveLength(1);
    expect(out.join("\n")).toContain("Stopped early");
  });

  it("does not count a duplicate from another session as this session's answer", async () => {
    const { run, out } = setup({ judged: ["a"], duplicate: true, answers: ["g", "y"] });
    await run([...ARGS, "--count", "1"]);
    expect(out.join("\n")).toContain("Already answered in another session");
    expect(out.join("\n")).toContain("0 good, 0 bad");
  });

  it("prints the report from the store at the end", async () => {
    const { run, out } = setup({
      judged: [],
      answered: 30,
      answers: [],
      reportRows: [{ tourId: "t1", text: "Text.", human: { claimVerdict: "unsupported", note: "invented" }, judge: "clean" }],
    });
    await run(ARGS);
    const text = out.join("\n");
    expect(text).toContain("The judge said clean and you said bad, 1 row");
    expect(text).toContain("Tour t1 (you said unsupported: invented)");
  });
});

describe("buildAgreementReport", () => {
  const r = (tourId: string, human: ReportRow["human"]["claimVerdict"], judge: ReportRow["judge"]): ReportRow => ({
    tourId,
    text: "",
    human: { claimVerdict: human, note: null },
    judge,
  });

  it("counts agreement on clean or bad separately from the exact verdict", () => {
    const report = buildAgreementReport([
      r("1", "clean", "clean"),
      r("2", "unsupported", "contradicted"),
      r("3", "unsupported", "clean"),
      r("4", "clean", null),
    ]);
    expect(report).toMatchObject({ humanChecked: 4, humanBad: 2, both: 3, agreed: 2, exactAgreed: 1 });
    expect(report.missed.map((m) => m.tourId)).toEqual(["3"]);
  });

  it("handles no rows", () => {
    expect(buildAgreementReport([])).toEqual({ humanChecked: 0, humanBad: 0, both: 0, agreed: 0, exactAgreed: 0, missed: [] });
  });
});
