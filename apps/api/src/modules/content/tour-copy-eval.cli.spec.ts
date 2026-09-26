import { describe, expect, it, jest } from "@jest/globals";
import Anthropic from "@anthropic-ai/sdk";

import { main, type EvalCliDeps, type EvalServiceLike, type PairExtras } from "./tour-copy-eval.cli";
import { planEvalSample, seededRandom, type EvalPlan, type ServedRow } from "./tour-copy-eval-sample";
import type { KillSwitchResult, JudgeOneOutcome } from "./tour-copy-eval.service";
import type { PromptModelPair } from "./tour-copy-eval-stats";

const VALID_ENV = {
  AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic",
  AI_GATEWAY_TOKEN: "token",
  TOUR_COPY_EVAL_CONCURRENCY: "1",
} as NodeJS.ProcessEnv;

const SONNET: PromptModelPair = { promptVersion: 4, model: "claude-sonnet-5" };
const JUDGE = "claude-opus-5-5";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
}

function servedRows(count: number, pair: PromptModelPair = SONNET, prefix = "t"): ServedRow[] {
  return Array.from({ length: count }, (_, index) => ({
    tourId: `${prefix}${String(index).padStart(3, "0")}`,
    promptVersion: pair.promptVersion,
    model: pair.model,
    cityId: "c1",
    cityLabel: "bangkok",
    judged: false,
    promptChars: 3100,
  }));
}

function makePlan(rows: ServedRow[], pairs: PromptModelPair[] = [SONNET], cap = 500): EvalPlan {
  return planEvalSample(pairs, rows, { judgeModel: JUDGE, cap, random: seededRandom(1) });
}

const USAGE = { inputTokens: 1000, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 900 };

function killSwitchResult(overrides: Partial<KillSwitchResult> = {}): KillSwitchResult {
  return {
    pair: SONNET,
    stats: { judged: 40, bad: 0, leadsWithFact: 40 },
    decision: "ok",
    withdrawn: 0,
    badPages: [],
    ...overrides,
  };
}

type JudgeOne = (tourId: string, options: { runId: string }) => Promise<JudgeOneOutcome>;

function makeService(overrides: {
  judgeOne?: JudgeOne;
  applyKillSwitch?: EvalServiceLike["applyKillSwitch"];
} = {}) {
  const judgeOne = jest.fn<JudgeOne>(
    overrides.judgeOne ?? (async () => ({ kind: "judged", claimVerdict: "clean", leadsWithFact: true, usage: USAGE })),
  );
  const applyKillSwitch = jest.fn<EvalServiceLike["applyKillSwitch"]>(
    overrides.applyKillSwitch ?? (async (pair) => killSwitchResult({ pair })),
  );
  const service: EvalServiceLike = { rubricVersion: 1, judgeOne, applyKillSwitch };
  return { service, judgeOne, applyKillSwitch };
}

const GOOD_EXTRAS: PairExtras = { humanChecked: 30, openingsTotal: 100, durationOpenings: 10 };

function deps(plan: EvalPlan, service: EvalServiceLike, extras: Partial<EvalCliDeps> = {}): EvalCliDeps {
  return {
    runId: () => "run_eval",
    seed: 7,
    loadPlan: jest.fn(async () => plan),
    service,
    pairExtras: async () => GOOD_EXTRAS,
    disconnect: async () => undefined,
    ...extras,
  };
}

describe("tour-copy-eval:run startup (spec 0003 AC-5, AC-19)", () => {
  it("refuses when the judge and the generator are the same model, naming both, before any plan or call", async () => {
    const { io: cliIo, err } = io();
    const { service, judgeOne } = makeService();
    const cliDeps = deps(makePlan([]), service);

    const code = await main([], { ...VALID_ENV, TOUR_COPY_MODEL: JUDGE, TOUR_COPY_JUDGE_MODEL: JUDGE }, cliIo, cliDeps);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain(`The judge model "${JUDGE}" is the same as the generator model "${JUDGE}"`);
    expect(cliDeps.loadPlan).not.toHaveBeenCalled();
    expect(judgeOne).not.toHaveBeenCalled();
  });

  it("refuses when a gateway variable is missing, before any plan or call", async () => {
    const { io: cliIo, err } = io();
    const { service, judgeOne } = makeService();
    const cliDeps = deps(makePlan([]), service);

    const code = await main([], { ...VALID_ENV, AI_GATEWAY_TOKEN: undefined } as NodeJS.ProcessEnv, cliIo, cliDeps);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("AI_GATEWAY_TOKEN is not set");
    expect(cliDeps.loadPlan).not.toHaveBeenCalled();
    expect(judgeOne).not.toHaveBeenCalled();
  });

  it("refuses an unknown flag with exit 1", async () => {
    const { io: cliIo, err } = io();
    const { service } = makeService();

    expect(await main(["--nope"], VALID_ENV, cliIo, deps(makePlan([]), service))).toBe(1);
    expect(err.join("\n")).toContain('Unknown argument "--nope"');
  });
});

describe("tour-copy-eval:run dry run (AC-7, AC-9)", () => {
  it("makes no judge call, prints counts and a token estimate, and asks the kill switch for a dry decision", async () => {
    const { io: cliIo, out } = io();
    const { service, judgeOne, applyKillSwitch } = makeService({
      applyKillSwitch: async (pair) =>
        killSwitchResult({
          pair,
          decision: "withdraw",
          stats: { judged: 40, bad: 3, leadsWithFact: 40 },
          badPages: [
            {
              tourId: "t001",
              claimVerdict: "unsupported",
              text: "A paragraph.",
              claims: [{ text: "hotel pickup", verdict: "unsupported", evidenceQuote: "" }],
            },
          ],
        }),
    });

    const code = await main([], VALID_ENV, cliIo, deps(makePlan(servedRows(20)), service));

    expect(code).toBe(0);
    expect(judgeOne).not.toHaveBeenCalled();
    expect(applyKillSwitch).toHaveBeenCalledWith(SONNET, { runId: "run_eval", execute: false });
    const text = out.join("\n");
    expect(text).toContain("Dry run: would judge 20 paragraphs.");
    expect(text).toContain("estimated input tokens: ~");
    expect(text).toContain("city bangkok: served 20, judged 0, would judge 20");
    expect(text).toContain("would withdraw pair prompt version 4, model claude-sonnet-5: 3 of 40 judged rows are bad");
    expect(text).toContain("Tour t001 (unsupported)");
    expect(text).toContain("Add --execute");
  });

  it("reports a same_model pair and does not ask the kill switch about it", async () => {
    const { io: cliIo, out } = io();
    const opus: PromptModelPair = { promptVersion: 4, model: JUDGE };
    const { service, applyKillSwitch } = makeService();

    await main([], VALID_ENV, cliIo, deps(makePlan(servedRows(80, opus), [opus]), service));

    expect(out.join("\n")).toContain("same_model, 80 served rows skipped");
    expect(applyKillSwitch).not.toHaveBeenCalled();
  });
});

describe("tour-copy-eval:run --execute", () => {
  it("happy path: judges every planned row, applies the kill switch, exits 0 and prints the summary (AC-11)", async () => {
    const { io: cliIo, out } = io();
    const { service, judgeOne, applyKillSwitch } = makeService();

    const code = await main(["--execute"], VALID_ENV, cliIo, deps(makePlan(servedRows(40)), service));

    expect(code).toBe(0);
    expect(judgeOne).toHaveBeenCalledTimes(40);
    expect(applyKillSwitch).toHaveBeenCalledWith(SONNET, { runId: "run_eval", execute: true });
    const text = out.join("\n");
    expect(text).toContain("Run run_eval summary:");
    expect(text).toContain("judge model: claude-opus-5-5");
    expect(text).toContain("generator model: claude-sonnet-5");
    expect(text).toContain("judged: 40");
    expect(text).toContain("same_model: 0");
    expect(text).toContain("judge_invalid: 0");
    expect(text).toContain("judge_refusal: 0");
    expect(text).toContain("API errors: 0");
    expect(text).toContain("tokens: input 40000, output 4000, cache write 0, cache read 36000");
    expect(text).toContain("pair prompt version 4, model claude-sonnet-5: judged 40, bad 0 (0.0%), leads with fact 100.0%");
    expect(text).not.toContain("WARNING");
  });

  it("counts invalid, refused and skipped outcomes, and keeps going", async () => {
    const { io: cliIo, out } = io();
    const outcomes: JudgeOneOutcome[] = [
      { kind: "judge_invalid", usage: USAGE },
      { kind: "judge_refusal", usage: USAGE },
      { kind: "skipped", reason: "duplicate" },
      { kind: "skipped", reason: "same_model" },
      { kind: "judged", claimVerdict: "clean", leadsWithFact: true, usage: USAGE },
    ];
    let index = 0;
    const { service } = makeService({ judgeOne: async () => outcomes[index++]! });

    const code = await main(["--execute"], VALID_ENV, cliIo, deps(makePlan(servedRows(5)), service));

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("judged: 1");
    expect(text).toContain("judge_invalid: 1");
    expect(text).toContain("judge_refusal: 1");
    expect(text).toContain("duplicate: 1");
    expect(text).toContain("same_model: 1");
  });

  it("prints a flagged page's claims with their quotes, a retry per call, and the retry totals", async () => {
    const { io: cliIo, out } = io();
    const outcomes: JudgeOneOutcome[] = [
      {
        kind: "judged",
        claimVerdict: "unsupported",
        leadsWithFact: true,
        usage: USAGE,
        claims: [
          { text: "not a rushed pace", verdict: "unsupported", evidenceQuote: "" },
          { text: "a supported claim", verdict: "supported", evidenceQuote: "quote" },
        ],
        attempts: [{ outcome: "ok", outputTokens: 200 }],
      },
      {
        kind: "judged",
        claimVerdict: "clean",
        leadsWithFact: true,
        usage: USAGE,
        claims: [{ text: "a supported claim", verdict: "supported", evidenceQuote: "quote" }],
        attempts: [
          { outcome: "max_tokens", outputTokens: 1500 },
          { outcome: "ok", outputTokens: 300 },
        ],
      },
      { kind: "judged", claimVerdict: "clean", leadsWithFact: true, usage: USAGE, claims: [], attempts: [{ outcome: "ok", outputTokens: 100 }] },
    ];
    let index = 0;
    const { service } = makeService({ judgeOne: async () => outcomes[index++]! });

    const code = await main(["--execute"], VALID_ENV, cliIo, deps(makePlan(servedRows(3)), service));

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("tour t000: unsupported\n    unsupported: not a rushed pace\n      evidence: (none, the source does not say it)");
    expect(text).not.toContain("a supported claim");
    expect(text).toContain("tour t001: clean\n    judge retry: attempt 1 ended max_tokens (1500 output tokens), attempt 2 ended ok (300 output tokens)");
    expect(text).not.toContain("tour t002");
    expect(text).toContain("judge calls retried: 1 of 3, max_tokens stops: 1");
  });

  it("names a judge_invalid tour and its attempts", async () => {
    const { io: cliIo, out } = io();
    const { service } = makeService({
      judgeOne: async () => ({
        kind: "judge_invalid",
        usage: USAGE,
        attempts: [
          { outcome: "unparseable", outputTokens: 40 },
          { outcome: "max_tokens", outputTokens: 1500 },
        ],
      }),
    });

    await main(["--execute"], VALID_ENV, cliIo, deps(makePlan(servedRows(1)), service));

    const text = out.join("\n");
    expect(text).toContain("tour t000: judge_invalid");
    expect(text).toContain("judge retry: attempt 1 ended unparseable (40 output tokens), attempt 2 ended max_tokens (1500 output tokens)");
  });

  it("kill switch: a withdrawal prints the bad pages and exits 2 (AC-9)", async () => {
    const { io: cliIo, out } = io();
    const { service } = makeService({
      applyKillSwitch: async (pair) =>
        killSwitchResult({
          pair,
          decision: "withdraw",
          withdrawn: 45,
          stats: { judged: 40, bad: 3, leadsWithFact: 40 },
          badPages: [
            {
              tourId: "t002",
              claimVerdict: "contradicted",
              text: "The tour lasts a day.",
              claims: [{ text: "lasts a day", verdict: "contradicted", evidenceQuote: "Duration: 4 hours" }],
            },
          ],
        }),
    });

    const code = await main(["--execute"], VALID_ENV, cliIo, deps(makePlan(servedRows(40)), service));

    expect(code).toBe(2);
    const text = out.join("\n");
    expect(text).toContain("KILL SWITCH: withdrew 45 published rows");
    expect(text).toContain("Tour t002 (contradicted): The tour lasts a day.");
    expect(text).toContain('contradicted: lasts a day | evidence: "Duration: 4 hours"');
  });

  it("small sample: prints the sample size and makes no decision (AC-9)", async () => {
    const { io: cliIo, out } = io();
    const { service } = makeService({
      applyKillSwitch: async (pair) =>
        killSwitchResult({ pair, decision: "insufficient", stats: { judged: 20, bad: 5, leadsWithFact: 20 } }),
    });

    const code = await main(["--execute"], VALID_ENV, cliIo, deps(makePlan(servedRows(20)), service));

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("only 20 judged rows, below the minimum, no decision");
  });

  it("a same_model pair is never evaluated or withdrawn by the run (AC-7)", async () => {
    const { io: cliIo, out } = io();
    const opus: PromptModelPair = { promptVersion: 4, model: JUDGE };
    const { service, applyKillSwitch, judgeOne } = makeService();

    const code = await main(["--execute"], VALID_ENV, cliIo, deps(makePlan(servedRows(80, opus), [opus]), service));

    expect(code).toBe(0);
    expect(judgeOne).not.toHaveBeenCalled();
    expect(applyKillSwitch).not.toHaveBeenCalled();
    expect(out.join("\n")).toContain("same_model: 80");
  });
});

describe("tour-copy-eval:run failure handling (AC-12)", () => {
  it("stops at once on a 429, prints the status and the cf-aig- headers, skips the kill switch and exits 1", async () => {
    const { io: cliIo, err, out } = io();
    const headers = new Headers({ "cf-aig-limit": "100", "cf-aig-remaining": "0", "content-type": "application/json" });
    const rateLimit = new Anthropic.RateLimitError(429, { type: "rate_limit_error", message: "spend limit" }, "spend limit", headers);
    const { service, judgeOne, applyKillSwitch } = makeService({
      judgeOne: async (tourId) => {
        if (tourId === "t001") throw rateLimit;
        return { kind: "judged", claimVerdict: "clean", leadsWithFact: true, usage: USAGE };
      },
    });

    const code = await main(["--execute"], VALID_ENV, cliIo, deps(makePlan(servedRows(10)), service));

    expect(code).toBe(1);
    // t000 judged, t001 threw, then the run stopped.
    expect(judgeOne).toHaveBeenCalledTimes(2);
    expect(applyKillSwitch).not.toHaveBeenCalled();
    const errText = err.join("\n");
    expect(errText).toContain("429");
    expect(errText).toContain("status: 429");
    expect(errText).toContain("cf-aig-limit: 100");
    expect(errText).toContain("cf-aig-remaining: 0");
    expect(errText).not.toContain("content-type");
    expect(out.join("\n")).toContain("judged: 1");
  });

  it("stops after 5 consecutive API errors, keeps stored verdicts, skips the kill switch and exits 1", async () => {
    const { io: cliIo, err, out } = io();
    const { service, judgeOne, applyKillSwitch } = makeService({
      judgeOne: async () => {
        throw new Error("timeout");
      },
    });

    const code = await main(["--execute"], VALID_ENV, cliIo, deps(makePlan(servedRows(20)), service));

    expect(code).toBe(1);
    expect(judgeOne).toHaveBeenCalledTimes(5);
    expect(applyKillSwitch).not.toHaveBeenCalled();
    expect(err.join("\n")).toContain("Aborted after 5 consecutive API errors");
    expect(out.join("\n")).toContain("API errors: 5");
  });

  it("does not stop when a success sits between the errors", async () => {
    const { io: cliIo } = io();
    let call = 0;
    const { service, judgeOne, applyKillSwitch } = makeService({
      judgeOne: async () => {
        call++;
        if (call % 3 === 0) return { kind: "judged", claimVerdict: "clean", leadsWithFact: true, usage: USAGE };
        throw new Error("flaky");
      },
    });

    const code = await main(["--execute"], VALID_ENV, cliIo, deps(makePlan(servedRows(12)), service));

    expect(code).toBe(0);
    expect(judgeOne).toHaveBeenCalledTimes(12);
    expect(applyKillSwitch).toHaveBeenCalled();
  });

  it("never has more judge calls in flight than TOUR_COPY_EVAL_CONCURRENCY", async () => {
    const { io: cliIo } = io();
    let inFlight = 0;
    let peak = 0;
    const { service } = makeService({
      judgeOne: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return { kind: "judged", claimVerdict: "clean", leadsWithFact: true, usage: USAGE };
      },
    });

    await main(["--execute"], { ...VALID_ENV, TOUR_COPY_EVAL_CONCURRENCY: "3" } as NodeJS.ProcessEnv, cliIo, deps(makePlan(servedRows(20)), service));

    expect(peak).toBe(3);
  });

  it("judges no row twice in one run", async () => {
    const { io: cliIo } = io();
    const { service, judgeOne } = makeService();

    await main(["--execute"], { ...VALID_ENV, TOUR_COPY_EVAL_CONCURRENCY: "4" } as NodeJS.ProcessEnv, cliIo, deps(makePlan(servedRows(60)), service));

    const ids = judgeOne.mock.calls.map(([tourId]) => tourId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("tour-copy-eval:run cap and narrowing (AC-7)", () => {
  it("passes min(--limit, TOUR_COPY_EVAL_MAX_JUDGMENTS) as the cap and the flags as the filter", async () => {
    const { io: cliIo, out } = io();
    const { service } = makeService();
    const cliDeps = deps(makePlan([]), service);

    await main(
      ["--limit", "900", "--prompt-version", "4", "--model", "claude-sonnet-5"],
      { ...VALID_ENV, TOUR_COPY_EVAL_MAX_JUDGMENTS: "200" } as NodeJS.ProcessEnv,
      cliIo,
      cliDeps,
    );

    expect(cliDeps.loadPlan).toHaveBeenCalledWith(
      expect.objectContaining({ cap: 200, filter: { promptVersion: 4, model: "claude-sonnet-5" }, judgeModel: JUDGE, seed: 7, rubricVersion: 1 }),
    );
    expect(out.join("\n")).toContain("--limit 900 exceeds TOUR_COPY_EVAL_MAX_JUDGMENTS=200, clamped");
  });

  it("defaults the cap to 500", async () => {
    const { io: cliIo } = io();
    const { service } = makeService();
    const cliDeps = deps(makePlan([]), service);

    await main([], VALID_ENV, cliIo, cliDeps);

    expect(cliDeps.loadPlan).toHaveBeenCalledWith(expect.objectContaining({ cap: 500 }));
  });
});

describe("tour-copy-eval:run warnings (AC-11)", () => {
  it("warns on a low leads with fact share, a missing spot check and a duration heavy pair, and never withdraws for them", async () => {
    const { io: cliIo, out } = io();
    const { service } = makeService({
      applyKillSwitch: async (pair) => killSwitchResult({ pair, stats: { judged: 40, bad: 0, leadsWithFact: 20 } }),
    });

    const code = await main(
      ["--execute"],
      VALID_ENV,
      cliIo,
      deps(makePlan(servedRows(40)), service, {
        pairExtras: async () => ({ humanChecked: 10, openingsTotal: 100, durationOpenings: 55 }),
      }),
    );

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("only 50.0% of judged pages for prompt version 4, model claude-sonnet-5 open on a fact, below 80%");
    expect(text).toContain("no human spot check exists for prompt version 4, model claude-sonnet-5 (10 of 30 answered)");
    expect(text).toContain("55.0% of published paragraphs for prompt version 4, model claude-sonnet-5 open on the duration, above 40%");
  });

  it("prints no warning when the numbers are healthy", async () => {
    const { io: cliIo, out } = io();
    const { service } = makeService();

    await main(["--execute"], VALID_ENV, cliIo, deps(makePlan(servedRows(40)), service));

    expect(out.join("\n")).not.toContain("WARNING");
  });
});
