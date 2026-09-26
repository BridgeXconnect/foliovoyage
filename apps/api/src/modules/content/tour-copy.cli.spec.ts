import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, jest } from "@jest/globals";

import { computeGroundingHash } from "./tour-copy-grounding-hash";
import { TOUR_COPY_PROMPT_VERSION } from "./tour-copy.constants";
import type { CandidateTour, CliDeps, CliIo } from "./tour-copy.cli";
import { main as runCli } from "./tour-copy.cli";
import type { GenerateOneOptions, TourCopyOutcome } from "./tour-copy.service";

const VALID_ENV: NodeJS.ProcessEnv = {
  AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/acct123/my-gw/anthropic",
  AI_GATEWAY_TOKEN: "gw-token",
  TOUR_COPY_MODEL: "claude-sonnet-5",
};

/** Every test injects a zero withdrawn count unless it is about the refusal (AC-2). */
function main(argv: readonly string[], env: NodeJS.ProcessEnv, cliIo: CliIo, deps: CliDeps = {}) {
  return runCli(argv, env, cliIo, { withdrawnCount: async () => 0, publishedRows: async () => [], ...deps });
}

const SOURCE_FIELDS = {
  title: "Bangkok Floating Market Half-Day Tour",
  description:
    "Glide along peaceful canals in a traditional longtail boat through the historic floating markets of Bangkok. Your guide points out colorful stalls selling tropical fruit, fragrant spices, and handmade crafts along the water. Afterward, wander through a quiet riverside temple before returning to your hotel in the city center.",
  durationMin: 240,
  inclusions: [] as unknown[],
  exclusions: [] as unknown[],
};

const CURRENT_HASH = computeGroundingHash(SOURCE_FIELDS);

function makeCandidate(id: string, overrides: Partial<CandidateTour> = {}): CandidateTour {
  return {
    id,
    ...SOURCE_FIELDS,
    ratingAvg: 4.5,
    ratingCount: 20,
    deletedAt: null,
    experience: { status: "published" },
    tourCopy: null,
    ...overrides,
  };
}

async function* toAsync<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
}

/** A `generateOne` spy for dry-run tests, which must never actually call it. */
function generateOneSpy() {
  return jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>();
}

describe("tour-copy:run CLI", () => {
  describe("startup check runs before any database access (AC-19)", () => {
    it("exits 1 and never touches candidates when gateway config is missing", async () => {
      const { io: cliIo, out, err } = io();
      const candidates = jest.fn(() => toAsync<CandidateTour>([]));

      const code = await main([], {}, cliIo, { candidates, service: { generateOne: generateOneSpy() } });

      expect(code).toBe(1);
      expect(candidates).not.toHaveBeenCalled();
      expect(out).toEqual([]);
      expect(err.length).toBeGreaterThan(0);
    });

    it("exits 1 and never touches candidates when AI_GATEWAY_BASE_URL fails schema validation", async () => {
      const { io: cliIo, out, err } = io();
      const candidates = jest.fn(() => toAsync<CandidateTour>([]));
      const badEnv = { ...VALID_ENV, AI_GATEWAY_BASE_URL: "https://evil.example.com/anthropic" };

      const code = await main([], badEnv, cliIo, { candidates, service: { generateOne: generateOneSpy() } });

      expect(code).toBe(1);
      expect(candidates).not.toHaveBeenCalled();
      expect(out).toEqual([]);
      expect(err.some((l) => l.includes("Invalid tour-copy configuration"))).toBe(true);
    });
  });

  describe("dry run is the default", () => {
    it("never calls the service and reports what it would do", async () => {
      const { io: cliIo, out } = io();
      const generateOne = generateOneSpy();
      const candidates = () => toAsync([makeCandidate("t1")]);

      const code = await main([], VALID_ENV, cliIo, { candidates, service: { generateOne } });

      expect(code).toBe(0);
      expect(generateOne).not.toHaveBeenCalled();
      const text = out.join("\n");
      expect(text).toContain("dry run");
      expect(text).toContain("would generate 1 tour");
      expect(text).toContain("Add --execute to generate and write rows.");
    });

    it("never prints a dollar figure", async () => {
      const { io: cliIo, out } = io();
      const candidates = () => toAsync([makeCandidate("t1"), makeCandidate("t2")]);

      await main([], VALID_ENV, cliIo, { candidates, service: { generateOne: generateOneSpy() } });

      expect(out.join("\n")).not.toContain("$");
    });

    it("classifies skip reasons and stops after the run limit, printing the last Tour.id reached", async () => {
      const { io: cliIo, out } = io();
      const tours = [
        makeCandidate("t1", { deletedAt: new Date() }), // skip: deleted
        makeCandidate("t2"), // would generate (1)
        makeCandidate("t3"), // would generate (2) -> limit reached here
        makeCandidate("t4"), // never reached
      ];
      const candidates = () => toAsync(tours);

      const code = await main(["--limit", "2"], VALID_ENV, cliIo, {
        candidates,
        service: { generateOne: generateOneSpy() },
      });

      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("would generate 2 tours");
      expect(text).toContain("deleted: 1");
      expect(text).toContain("last Tour.id reached: t3");
      expect(text).not.toContain("t4");
    });
  });

  describe("--limit clamping to TOUR_COPY_MAX_TOURS", () => {
    it("clamps and states so when the requested limit exceeds the cap", async () => {
      const { io: cliIo, out } = io();
      const env = { ...VALID_ENV, TOUR_COPY_MAX_TOURS: "5" };
      const candidates = () => toAsync<CandidateTour>([]);

      const code = await main(["--limit", "100"], env, cliIo, { candidates, service: { generateOne: generateOneSpy() } });

      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("limit: 5");
      expect(text).toContain("clamped");
    });

    it("does not clamp or mention clamping when the requested limit is within the cap", async () => {
      const { io: cliIo, out } = io();
      const env = { ...VALID_ENV, TOUR_COPY_MAX_TOURS: "5" };
      const candidates = () => toAsync<CandidateTour>([]);

      const code = await main(["--limit", "3"], env, cliIo, { candidates, service: { generateOne: generateOneSpy() } });

      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("limit: 3");
      expect(text).not.toContain("clamped");
    });

    it("defaults the limit to TOUR_COPY_MAX_TOURS when --limit is omitted", async () => {
      const { io: cliIo, out } = io();
      const env = { ...VALID_ENV, TOUR_COPY_MAX_TOURS: "7" };
      const candidates = () => toAsync<CandidateTour>([]);

      await main([], env, cliIo, { candidates, service: { generateOne: generateOneSpy() } });

      expect(out.join("\n")).toContain("limit: 7");
    });
  });

  describe("withdrawn pair (AC-2)", () => {
    const pair = { promptVersion: TOUR_COPY_PROMPT_VERSION, model: "claude-sonnet-5" };

    it("refuses a dry run with exit 1, naming the pair and the count, before touching candidates", async () => {
      const { io: cliIo, out, err } = io();
      const candidates = jest.fn(() => toAsync<CandidateTour>([]));
      const withdrawnCount = jest.fn(async () => 3);

      const code = await main([], VALID_ENV, cliIo, {
        candidates,
        service: { generateOne: generateOneSpy() },
        withdrawnCount,
      });

      expect(code).toBe(1);
      expect(withdrawnCount.mock.calls).toEqual([[pair]]);
      expect(candidates).not.toHaveBeenCalled();
      expect(out).toEqual([]);
      const message = err.join("\n");
      expect(message).toContain("3 withdrawn rows");
      expect(message).toContain(`prompt version ${TOUR_COPY_PROMPT_VERSION}`);
      expect(message).toContain("claude-sonnet-5");
    });

    it("refuses --execute the same way and never calls the service", async () => {
      const { io: cliIo, err } = io();
      const generateOne = generateOneSpy();

      const code = await main(["--execute"], VALID_ENV, cliIo, {
        candidates: () => toAsync([makeCandidate("t1")]),
        service: { generateOne },
        withdrawnCount: async () => 1,
      });

      expect(code).toBe(1);
      expect(generateOne).not.toHaveBeenCalled();
      expect(err.join("\n")).toContain("1 withdrawn row ");
    });

    it("disconnects when it refuses", async () => {
      const { io: cliIo } = io();
      const disconnect = jest.fn(async () => undefined);

      await main([], VALID_ENV, cliIo, {
        candidates: () => toAsync<CandidateTour>([]),
        service: { generateOne: generateOneSpy() },
        withdrawnCount: async () => 2,
        disconnect,
      });

      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it("counts a withdrawn row at the current pair as withdrawn_current in the dry run, whatever its hash", async () => {
      const { io: cliIo, out } = io();
      const stale = makeCandidate("t1", {
        tourCopy: { status: "withdrawn", groundingHash: "not-the-current-hash", promptVersion: TOUR_COPY_PROMPT_VERSION, model: "claude-sonnet-5" },
      });

      const code = await main([], VALID_ENV, cliIo, { candidates: () => toAsync([stale]), service: { generateOne: generateOneSpy() } });

      expect(code).toBe(0);
      expect(out.join("\n")).toContain("withdrawn_current: 1");
    });

    it("would regenerate a withdrawn row at another prompt version or model", async () => {
      const { io: cliIo, out } = io();
      const otherVersion = makeCandidate("t1", {
        tourCopy: { status: "withdrawn", groundingHash: CURRENT_HASH, promptVersion: TOUR_COPY_PROMPT_VERSION - 1, model: "claude-sonnet-5" },
      });
      const otherModel = makeCandidate("t2", {
        tourCopy: { status: "withdrawn", groundingHash: CURRENT_HASH, promptVersion: TOUR_COPY_PROMPT_VERSION, model: "claude-haiku-4-5-20251001" },
      });

      const code = await main([], VALID_ENV, cliIo, { candidates: () => toAsync([otherVersion, otherModel]), service: { generateOne: generateOneSpy() } });

      expect(code).toBe(0);
      expect(out.join("\n")).toContain("would generate 2 tours");
      expect(out.join("\n")).not.toContain("withdrawn_current");
    });
  });

  describe("flag independence", () => {
    it("--retry-failed alone does not imply --execute, and does influence dry-run classification", async () => {
      const { io: cliIo, out } = io();
      const failedCurrent = makeCandidate("t1", {
        tourCopy: { status: "failed", groundingHash: CURRENT_HASH, promptVersion: TOUR_COPY_PROMPT_VERSION, model: "claude-sonnet-5" },
      });
      const generateOne = generateOneSpy();

      const withoutFlag = await main([], VALID_ENV, cliIo, {
        candidates: () => toAsync([failedCurrent]),
        service: { generateOne },
      });
      expect(withoutFlag).toBe(0);
      expect(out.join("\n")).toContain("failed_current: 1");
      expect(generateOne).not.toHaveBeenCalled();

      const { io: cliIo2, out: out2 } = io();
      const code = await main(["--retry-failed"], VALID_ENV, cliIo2, {
        candidates: () => toAsync([failedCurrent]),
        service: { generateOne },
      });
      expect(code).toBe(0);
      expect(out2.join("\n")).toContain("dry run");
      expect(out2.join("\n")).toContain("would generate 1 tour");
      expect(generateOne).not.toHaveBeenCalled();
    });

    it("--regenerate-older-than-version alone does not imply --execute, and does influence dry-run classification", async () => {
      const { io: cliIo, out } = io();
      const staleVersion = makeCandidate("t1", {
        tourCopy: { status: "published", groundingHash: CURRENT_HASH, promptVersion: 1, model: "claude-sonnet-5" },
      });
      const generateOne = generateOneSpy();

      const code = await main(["--regenerate-older-than-version", "2"], VALID_ENV, cliIo, {
        candidates: () => toAsync([staleVersion]),
        service: { generateOne },
      });

      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("dry run");
      expect(text).toContain("would generate 1 tour");
      expect(generateOne).not.toHaveBeenCalled();
    });

    it("--limit alone does not imply --execute", async () => {
      const { io: cliIo, out } = io();
      const generateOne = generateOneSpy();

      const code = await main(["--limit", "1"], VALID_ENV, cliIo, {
        candidates: () => toAsync([makeCandidate("t1")]),
        service: { generateOne },
      });

      expect(code).toBe(0);
      expect(out.join("\n")).toContain("dry run");
      expect(generateOne).not.toHaveBeenCalled();
    });

    it("--execute alone does not imply --retry-failed or --regenerate-older-than-version", async () => {
      const { io: cliIo } = io();
      const generateOne = jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>(
        async () => ({ kind: "generated", status: "published" }),
      );

      await main(["--execute"], { ...VALID_ENV, TOUR_COPY_CONCURRENCY: "1" }, cliIo, {
        candidates: () => toAsync([makeCandidate("t1")]),
        service: { generateOne },
      });

      expect(generateOne).toHaveBeenCalledWith("t1", expect.objectContaining({ retryFailed: false }));
      expect(generateOne.mock.calls[0]![1]).not.toHaveProperty("regenerateOlderThanVersion");
    });

    it("--execute forwards --retry-failed and --regenerate-older-than-version to the service", async () => {
      const { io: cliIo } = io();
      const generateOne = jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>(
        async () => ({ kind: "generated", status: "published" }),
      );

      await main(
        ["--execute", "--retry-failed", "--regenerate-older-than-version", "3"],
        { ...VALID_ENV, TOUR_COPY_CONCURRENCY: "1" },
        cliIo,
        { candidates: () => toAsync([makeCandidate("t1")]), service: { generateOne } },
      );

      expect(generateOne).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ retryFailed: true, regenerateOlderThanVersion: 3 }),
      );
    });
  });

  describe("--execute run limit and ordering", () => {
    it("applies the run limit after skip rules and prints the last Tour.id actually reached", async () => {
      const { io: cliIo, out } = io();
      const calls: string[] = [];
      const generateOne = jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>(
        async (tourId) => {
          calls.push(tourId);
          if (tourId === "t1") return { kind: "skipped", reason: "already_current" };
          return { kind: "generated", status: "published" };
        },
      );

      const code = await main(
        ["--execute", "--limit", "2"],
        { ...VALID_ENV, TOUR_COPY_CONCURRENCY: "1" },
        cliIo,
        {
          candidates: () => toAsync(["t1", "t2", "t3", "t4"].map((id) => makeCandidate(id))),
          service: { generateOne },
        },
      );

      expect(code).toBe(0);
      expect(calls).toEqual(["t1", "t2", "t3"]);
      const text = out.join("\n");
      expect(text).toContain("published: 2");
      expect(text).toContain("last Tour.id reached: t3");
    });
  });

  describe("circuit breaker (AC-14)", () => {
    it("aborts after exactly 5 consecutive API errors", async () => {
      const { io: cliIo, out, err } = io();
      let callCount = 0;
      const generateOne = jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>(
        async () => {
          callCount++;
          throw new Error("transient network error");
        },
      );

      const tours = Array.from({ length: 10 }, (_, i) => makeCandidate(`t${i + 1}`));
      const code = await main(
        ["--execute"],
        { ...VALID_ENV, TOUR_COPY_CONCURRENCY: "1" },
        cliIo,
        { candidates: () => toAsync(tours), service: { generateOne } },
      );

      expect(code).toBe(1);
      expect(callCount).toBe(5);
      expect(err.some((l) => l.includes("5 consecutive API errors"))).toBe(true);
      expect(out.join("\n")).toContain("API errors: 5");
    });

    it("does not abort after only 4 consecutive API errors", async () => {
      const { io: cliIo } = io();
      let callCount = 0;
      const generateOne = jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>(
        async () => {
          callCount++;
          if (callCount <= 4) throw new Error("transient");
          return { kind: "generated", status: "published" };
        },
      );

      const tours = Array.from({ length: 5 }, (_, i) => makeCandidate(`t${i + 1}`));
      const code = await main(
        ["--execute"],
        { ...VALID_ENV, TOUR_COPY_CONCURRENCY: "1" },
        cliIo,
        { candidates: () => toAsync(tours), service: { generateOne } },
      );

      expect(code).toBe(0);
      expect(callCount).toBe(5);
    });

    it("does not count a check failure (resolved outcome) toward the consecutive error count", async () => {
      const { io: cliIo, out } = io();
      let callCount = 0;
      const generateOne = jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>(
        async () => {
          callCount++;
          // 3 errors, then a resolved check-failure, then 3 more errors: never 5 consecutive.
          if (callCount <= 3) throw new Error("transient");
          if (callCount === 4) return { kind: "generated", status: "failed" };
          if (callCount <= 7) throw new Error("transient");
          return { kind: "generated", status: "published" };
        },
      );

      const tours = Array.from({ length: 8 }, (_, i) => makeCandidate(`t${i + 1}`));
      const code = await main(
        ["--execute"],
        { ...VALID_ENV, TOUR_COPY_CONCURRENCY: "1" },
        cliIo,
        { candidates: () => toAsync(tours), service: { generateOne } },
      );

      expect(code).toBe(0);
      expect(callCount).toBe(8);
      expect(out.join("\n")).toContain("API errors: 6");
      expect(out.join("\n")).toContain("failed: 1");
      expect(out.join("\n")).toContain("published: 1");
    });

    it("aborts immediately on a 429 without counting toward the 5-error breaker, printing cf-aig- headers", async () => {
      const { io: cliIo, out, err } = io();
      const headers = new Headers({
        "cf-aig-limit": "100",
        "cf-aig-remaining": "0",
        "content-type": "application/json",
      });
      const rateLimitError = new Anthropic.RateLimitError(
        429,
        { type: "rate_limit_error", message: "spend limit exceeded" },
        "spend limit exceeded",
        headers,
      );
      const generateOne = jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>(
        async (tourId) => {
          if (tourId === "t1") throw rateLimitError;
          return { kind: "generated", status: "published" };
        },
      );

      const tours = Array.from({ length: 3 }, (_, i) => makeCandidate(`t${i + 1}`));
      const code = await main(
        ["--execute"],
        { ...VALID_ENV, TOUR_COPY_CONCURRENCY: "1" },
        cliIo,
        { candidates: () => toAsync(tours), service: { generateOne } },
      );

      expect(code).toBe(1);
      expect(generateOne).toHaveBeenCalledTimes(1);
      const errText = err.join("\n");
      expect(errText).toContain("429");
      expect(errText).toContain("cf-aig-limit: 100");
      expect(errText).toContain("cf-aig-remaining: 0");
      expect(errText).not.toContain("content-type");
      expect(out.join("\n")).toContain("published: 0");
    });
  });

  describe("concurrency", () => {
    it("reads the worker count from TOUR_COPY_CONCURRENCY rather than hardcoding it", async () => {
      async function runWithConcurrency(concurrency: string): Promise<number> {
        let active = 0;
        let maxActive = 0;
        const generateOne = jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>(
          async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 15));
            active--;
            return { kind: "generated", status: "published" };
          },
        );
        const tours = Array.from({ length: 9 }, (_, i) => makeCandidate(`t${i + 1}`));
        const { io: cliIo } = io();
        await main(["--execute"], { ...VALID_ENV, TOUR_COPY_CONCURRENCY: concurrency }, cliIo, {
          candidates: () => toAsync(tours),
          service: { generateOne },
        });
        return maxActive;
      }

      expect(await runWithConcurrency("1")).toBe(1);
      expect(await runWithConcurrency("3")).toBe(3);
    });
  });

  describe("per-run summary", () => {
    it("reports counts by outcome, including skip-reason breakdown, for a real run", async () => {
      const { io: cliIo, out } = io();
      const generateOne = jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>(
        async (tourId) => {
          if (tourId === "t1") return { kind: "generated", status: "published" };
          if (tourId === "t2") return { kind: "generated", status: "failed" };
          return { kind: "skipped", reason: "not_eligible" };
        },
      );

      const tours = ["t1", "t2", "t3", "t4"].map((id) => makeCandidate(id));
      const code = await main(
        ["--execute"],
        { ...VALID_ENV, TOUR_COPY_CONCURRENCY: "1" },
        cliIo,
        { candidates: () => toAsync(tours), service: { generateOne } },
      );

      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("published: 1");
      expect(text).toContain("failed: 1");
      expect(text).toContain("skipped: 2");
      expect(text).toContain("not_eligible: 2");
    });

    it("prints voice counter totals and opening shares of the run's published rows, with no warning at or below 40% duration (spec 0003 AC-4)", async () => {
      const { io: cliIo, out } = io();
      const generateOne = jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>(
        async () => ({ kind: "generated", status: "published" }),
      );
      const publishedRows = jest.fn(async () => [
        { voiceCounts: { emDash: 1, contrastiveReveal: 0, clicheOrIntensifier: 2 }, openingPattern: "duration" },
        { voiceCounts: { emDash: 0, contrastiveReveal: 1, clicheOrIntensifier: 0 }, openingPattern: "other" },
        { voiceCounts: { emDash: 2, contrastiveReveal: 0, clicheOrIntensifier: 0 }, openingPattern: "other" },
        { voiceCounts: { emDash: 0, contrastiveReveal: 0, clicheOrIntensifier: 1 }, openingPattern: "other" },
        { voiceCounts: { emDash: 0, contrastiveReveal: 0, clicheOrIntensifier: 0 }, openingPattern: "other" },
      ]);

      await main(["--execute"], { ...VALID_ENV, TOUR_COPY_CONCURRENCY: "1" }, cliIo, {
        runId: () => "run_x",
        candidates: () => toAsync([makeCandidate("t1")]),
        service: { generateOne },
        publishedRows,
      });

      const text = out.join("\n");
      expect(publishedRows.mock.calls).toEqual([["run_x"]]);
      expect(text).toContain("voice counters: emDash 3, contrastiveReveal 1, clicheOrIntensifier 3");
      expect(text).toContain("opening patterns: duration 1 (20%), other 4 (80%)");
      expect(text).not.toContain("WARNING");
    });

    it("prints a warning line when more than 40% of the run's published rows open on the duration (spec 0003 AC-4)", async () => {
      const { io: cliIo, out } = io();
      const generateOne = jest.fn<(tourId: string, options: GenerateOneOptions) => Promise<TourCopyOutcome>>(
        async () => ({ kind: "generated", status: "published" }),
      );
      const row = (openingPattern: string) => ({
        voiceCounts: { emDash: 0, contrastiveReveal: 0, clicheOrIntensifier: 0 },
        openingPattern,
      });

      await main(["--execute"], { ...VALID_ENV, TOUR_COPY_CONCURRENCY: "1" }, cliIo, {
        candidates: () => toAsync([makeCandidate("t1")]),
        service: { generateOne },
        publishedRows: async () => [row("duration"), row("duration"), row("other")],
      });

      expect(out.join("\n")).toMatch(/WARNING: 67% of this run's published paragraphs open on the duration/);
    });

    it("prints no counter lines when the run published nothing", async () => {
      const { io: cliIo, out } = io();
      const publishedRows = jest.fn(async () => []);
      await main(["--execute"], { ...VALID_ENV, TOUR_COPY_CONCURRENCY: "1" }, cliIo, {
        candidates: () => toAsync([makeCandidate("t1")]),
        service: { generateOne: async () => ({ kind: "generated", status: "failed" }) },
        publishedRows,
      });
      expect(publishedRows).not.toHaveBeenCalled();
      expect(out.join("\n")).not.toContain("voice counters");
    });
  });

  describe("argument parsing", () => {
    it("rejects an unknown flag with exit code 2", async () => {
      const { io: cliIo, err } = io();
      const code = await main(["--bogus"], VALID_ENV, cliIo, {
        candidates: () => toAsync<CandidateTour>([]),
        service: { generateOne: generateOneSpy() },
      });
      expect(code).toBe(2);
      expect(err.some((l) => l.includes("Unknown argument"))).toBe(true);
    });

    it("rejects a non-positive --limit with exit code 2", async () => {
      const { io: cliIo, err } = io();
      const code = await main(["--limit", "0"], VALID_ENV, cliIo, {
        candidates: () => toAsync<CandidateTour>([]),
        service: { generateOne: generateOneSpy() },
      });
      expect(code).toBe(2);
      expect(err.some((l) => l.includes("--limit"))).toBe(true);
    });
  });
});
