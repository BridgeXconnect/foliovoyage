import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../../prisma/prisma.service";
import { CORRECTIVE_SENTENCES } from "./tour-copy-check.constants";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
import type { TourCopyGenerationRequest, TourCopyGenerationResult, TourCopyGenerator } from "./tour-copy-generator";
import { TOUR_COPY_PROMPT_VERSION } from "./tour-copy.constants";
import { TourCopyService } from "./tour-copy.service";

const USAGE = { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

/**
 * A source whose title + description share enough distinct >=4-letter
 * content words with the fixture candidates below to clear the real check's
 * overlap floor (8 words) without tripping its price/cancellation/number
 * bans — verified against the real `checkTourCopy` before being hardcoded
 * here, not hand-counted.
 */
const SOURCE_FIELDS = {
  title: "Bangkok Floating Market Half-Day Tour",
  description:
    "Glide along peaceful canals in a traditional longtail boat through the historic floating markets of Bangkok. Your guide points out colorful stalls selling tropical fruit, fragrant spices, and handmade crafts along the water. Afterward, wander through a quiet riverside temple before returning to your hotel in the city center. This small-group tour captures everyday local life away from the busy streets of Bangkok.",
  durationMin: 240,
  inclusions: [] as unknown[],
  exclusions: [] as unknown[],
};

const CURRENT_HASH = computeGroundingHash(SOURCE_FIELDS);

const TOUR = {
  id: "tour_1",
  ...SOURCE_FIELDS,
  ratingAvg: 4.5,
  ratingCount: 20,
  deletedAt: null,
  experience: { status: "published" },
  tourCopy: null as { status: string; groundingHash: string; promptVersion: number; model: string } | null,
};

/** Passes the real check outright: 2-4 sentences, 30-100 words, >=8 overlap words, no banned language. */
const PASSING_SUMMARY =
  "Glide along peaceful canals in a traditional longtail boat through the historic floating markets of Bangkok. A local guide points out colorful stalls selling tropical fruit and fragrant spices along the water, then leads you through a quiet riverside temple. This small-group tour captures everyday local life away from the busy streets.";

/** Otherwise identical in shape to {@link PASSING_SUMMARY}; fails only `price_language`. */
const PRICE_FAIL_TEXT =
  "Glide along peaceful canals in a traditional longtail boat through the historic floating markets of Bangkok. A local guide points out colorful stalls selling tropical fruit and fragrant spices, and the discounted price makes this small-group tour an affordable way to see local life away from the busy streets.";

/** Shares almost no vocabulary with the source; fails only `low_overlap`. */
const OVERLAP_FAIL_TEXT =
  "Drift quietly across sleepy waterways in a narrow wooden vessel past busy vendor stands. A friendly host highlights bright umbrellas offering exotic snacks and fragrant blossoms near the shoreline, then guides you toward a peaceful sanctuary. This cozy outing reveals ordinary neighborhood living far from noisy avenues.";

function makeService(
  findUnique: jest.Mock<(a: unknown) => Promise<unknown>>,
  upsert: jest.Mock<(a: unknown) => Promise<unknown>>,
  generate: jest.Mock<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>,
): TourCopyService {
  const prisma = {
    tour: { findUnique },
    tourCopy: { upsert },
  } as unknown as PrismaService;
  const generator: TourCopyGenerator = { generate };
  return new TourCopyService(prisma, generator);
}

describe("TourCopyService.generateOne", () => {
  describe("pre-generation skip gates (AC-1)", () => {
    it("skips a not-found tour without calling the generator", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(null);
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>();
      const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

      const outcome = await makeService(findUnique, upsert, generate).generateOne("missing", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "skipped", reason: "not_found" });
      expect(generate).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    });

    it("skips a soft-deleted tour", async () => {
      const findUnique = jest
        .fn<(a: unknown) => Promise<unknown>>()
        .mockResolvedValue({ ...TOUR, deletedAt: new Date() });
      const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

      const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "skipped", reason: "deleted" });
      expect(generate).not.toHaveBeenCalled();
    });

    it("skips a tour on a non-published Experience", async () => {
      const findUnique = jest
        .fn<(a: unknown) => Promise<unknown>>()
        .mockResolvedValue({ ...TOUR, experience: { status: "draft" } });
      const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

      const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "skipped", reason: "experience_not_published" });
      expect(generate).not.toHaveBeenCalled();
    });

    it("skips a tour with no linked Experience", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue({ ...TOUR, experience: null });
      const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

      const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "skipped", reason: "experience_not_published" });
    });

    it("skips an ineligible tour", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue({ ...TOUR, ratingCount: 1 });
      const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

      const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "skipped", reason: "not_eligible" });
      expect(generate).not.toHaveBeenCalled();
    });

    it("skips a thin-source tour with reason source_too_thin, before any model call", async () => {
      const findUnique = jest
        .fn<(a: unknown) => Promise<unknown>>()
        .mockResolvedValue({ ...TOUR, description: "Too short." });
      const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

      const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "skipped", reason: "source_too_thin" });
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe("skip rules for an existing row (AC-7)", () => {
    it("skips a tour whose published row already matches the current hash", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue({
        ...TOUR,
        tourCopy: { status: "published", groundingHash: CURRENT_HASH, promptVersion: TOUR_COPY_PROMPT_VERSION, model: "claude-sonnet-5" },
      });
      const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

      const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "skipped", reason: "already_current" });
      expect(generate).not.toHaveBeenCalled();
    });

    it("regenerates a published row whose hash no longer matches", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue({
        ...TOUR,
        tourCopy: { status: "published", groundingHash: "v1:stale", promptVersion: TOUR_COPY_PROMPT_VERSION, model: "claude-sonnet-5" },
      });
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValue({ kind: "text", text: PASSING_SUMMARY, usage: USAGE });

      const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "generated", status: "published" });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("regenerates a published row whose promptVersion is below --regenerate-older-than-version, even though the hash matches", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue({
        ...TOUR,
        tourCopy: { status: "published", groundingHash: CURRENT_HASH, promptVersion: TOUR_COPY_PROMPT_VERSION, model: "claude-sonnet-5" },
      });
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValue({ kind: "text", text: PASSING_SUMMARY, usage: USAGE });

      const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
        regenerateOlderThanVersion: TOUR_COPY_PROMPT_VERSION + 1,
      });

      expect(outcome).toEqual({ kind: "generated", status: "published" });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("skips a failed row whose hash and promptVersion are both current, without --retry-failed", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue({
        ...TOUR,
        tourCopy: { status: "failed", groundingHash: CURRENT_HASH, promptVersion: TOUR_COPY_PROMPT_VERSION, model: "claude-sonnet-5" },
      });
      const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

      const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "skipped", reason: "failed_current" });
      expect(generate).not.toHaveBeenCalled();
    });

    it("retries a failed row whose promptVersion is stale, even without --retry-failed", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue({
        ...TOUR,
        tourCopy: { status: "failed", groundingHash: CURRENT_HASH, promptVersion: TOUR_COPY_PROMPT_VERSION - 1, model: "claude-sonnet-5" },
      });
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValue({ kind: "text", text: PASSING_SUMMARY, usage: USAGE });

      const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "generated", status: "published" });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("retries a failed row whose hash and promptVersion are current when --retry-failed is passed", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue({
        ...TOUR,
        tourCopy: { status: "failed", groundingHash: CURRENT_HASH, promptVersion: TOUR_COPY_PROMPT_VERSION, model: "claude-sonnet-5" },
      });
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValue({ kind: "text", text: PASSING_SUMMARY, usage: USAGE });

      const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
        retryFailed: true,
      });

      expect(outcome).toEqual({ kind: "generated", status: "published" });
      expect(generate).toHaveBeenCalledTimes(1);
    });
  });

  describe("withdrawn rows (spec 0003 AC-2)", () => {
    function withdrawnRow(overrides: Partial<{ groundingHash: string; promptVersion: number; model: string }> = {}) {
      return {
        ...TOUR,
        tourCopy: {
          status: "withdrawn",
          groundingHash: CURRENT_HASH,
          promptVersion: TOUR_COPY_PROMPT_VERSION,
          model: "claude-sonnet-5",
          ...overrides,
        },
      };
    }

    it("skips a withdrawn row at the current prompt version and model as withdrawn_current", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(withdrawnRow());
      const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

      const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "skipped", reason: "withdrawn_current" });
      expect(generate).not.toHaveBeenCalled();
    });

    it("still skips it when the tour's grounding hash has changed", async () => {
      const findUnique = jest
        .fn<(a: unknown) => Promise<unknown>>()
        .mockResolvedValue(withdrawnRow({ groundingHash: "v1:stale" }));
      const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

      const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
        retryFailed: true,
      });

      expect(outcome).toEqual({ kind: "skipped", reason: "withdrawn_current" });
      expect(generate).not.toHaveBeenCalled();
    });

    it.each([
      ["an older prompt version", { promptVersion: TOUR_COPY_PROMPT_VERSION - 1 }],
      ["a different model", { model: "claude-haiku-4-5-20251001" }],
    ])("regenerates a withdrawn row from %s and clears its withdrawal fields", async (_label, overrides) => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(withdrawnRow(overrides));
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValue({ kind: "text", text: PASSING_SUMMARY, usage: USAGE });

      const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "generated", status: "published" });
      const args = upsert.mock.calls[0]![0] as { update: Record<string, unknown> };
      expect(args.update.withdrawnAt).toBeNull();
      expect(args.update.withdrawnByRunId).toBeNull();
    });
  });

  describe("generation outcomes (AC-6)", () => {
    it("generates and stores a published row for an eligible tour with no existing row, attempts=1 (AC-1, AC-4)", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(TOUR);
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValue({ kind: "text", text: PASSING_SUMMARY, usage: USAGE });

      const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "generated", status: "published" });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run_1", tourId: "tour_1", groundingHash: CURRENT_HASH, attempt: 1 }),
      );
      const upsertArgs = upsert.mock.calls[0][0] as {
        where: { tourId: string };
        create: Record<string, unknown>;
      };
      expect(upsertArgs.where).toEqual({ tourId: "tour_1" });
      expect(upsertArgs.create).toMatchObject({
        tourId: "tour_1",
        status: "published",
        aiSummary: PASSING_SUMMARY,
        groundingHash: CURRENT_HASH,
        model: "claude-sonnet-5",
        promptVersion: TOUR_COPY_PROMPT_VERSION,
        attempts: 1,
        failureReasons: [],
        runId: "run_1",
      });
    });

    it("stores voiceCounts and openingPattern on a published row (spec 0003 AC-4)", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(TOUR);
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValue({ kind: "text", text: PASSING_SUMMARY, usage: USAGE });

      await makeService(findUnique, upsert, generate).generateOne("tour_1", { runId: "run_1", model: "claude-sonnet-5" });

      const args = upsert.mock.calls[0][0] as { create: Record<string, unknown>; update: Record<string, unknown> };
      for (const data of [args.create, args.update]) {
        expect(data).toMatchObject({
          voiceCounts: { emDash: 0, contrastiveReveal: 0, clicheOrIntensifier: 0 },
          openingPattern: "other",
        });
      }
    });

    it("stores no voiceCounts or openingPattern on a failed row (spec 0003 AC-4)", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(TOUR);
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValue({ kind: "refusal", usage: USAGE });

      await makeService(findUnique, upsert, generate).generateOne("tour_1", { runId: "run_1", model: "claude-sonnet-5" });

      const args = upsert.mock.calls[0][0] as { create: Record<string, unknown> };
      expect(args.create.openingPattern).toBeNull();
      expect(args.create.voiceCounts).toBeDefined(); // Prisma.DbNull, written as a database null
    });

    it("retries once when the first attempt fails the check, and stores published with attempts 2 when the retry passes", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(TOUR);
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValueOnce({ kind: "text", text: PRICE_FAIL_TEXT, usage: USAGE })
        .mockResolvedValueOnce({ kind: "text", text: PASSING_SUMMARY, usage: USAGE });

      const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "generated", status: "published" });
      expect(generate).toHaveBeenCalledTimes(2);
      const upsertArgs = upsert.mock.calls[0][0] as { create: Record<string, unknown> };
      expect(upsertArgs.create).toMatchObject({
        status: "published",
        aiSummary: PASSING_SUMMARY,
        attempts: 2,
        // AC-6: failureReasons keeps the first attempt's codes even though this row is published.
        failureReasons: ["price_language"],
      });
    });

    it("stores a failed row with attempts 2 when both the first attempt and the retry fail the check", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(TOUR);
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValueOnce({ kind: "text", text: PRICE_FAIL_TEXT, usage: USAGE })
        .mockResolvedValueOnce({ kind: "text", text: OVERLAP_FAIL_TEXT, usage: USAGE });

      const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "generated", status: "failed" });
      expect(generate).toHaveBeenCalledTimes(2);
      const upsertArgs = upsert.mock.calls[0][0] as { create: Record<string, unknown> };
      expect(upsertArgs.create).toMatchObject({
        status: "failed",
        aiSummary: null,
        attempts: 2,
        // The retry's own check result is what a terminal failed row records.
        failureReasons: ["low_overlap"],
      });
    });

    it("stores a failed row on a first-attempt refusal, without retrying, attempts=1", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(TOUR);
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValue({ kind: "refusal", usage: USAGE });

      const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "generated", status: "failed" });
      expect(generate).toHaveBeenCalledTimes(1);
      const upsertArgs = upsert.mock.calls[0][0] as { create: Record<string, unknown> };
      expect(upsertArgs.create).toMatchObject({
        status: "failed",
        aiSummary: null,
        attempts: 1,
        failureReasons: ["refusal"],
      });
    });

    it("stores a failed row with attempts 2 when the retry is refused after a first-try check failure", async () => {
      const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(TOUR);
      const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
      const generate = jest
        .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
        .mockResolvedValueOnce({ kind: "text", text: PRICE_FAIL_TEXT, usage: USAGE })
        .mockResolvedValueOnce({ kind: "refusal", usage: USAGE });

      const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
        runId: "run_1",
        model: "claude-sonnet-5",
      });

      expect(outcome).toEqual({ kind: "generated", status: "failed" });
      expect(generate).toHaveBeenCalledTimes(2);
      const upsertArgs = upsert.mock.calls[0][0] as { create: Record<string, unknown> };
      expect(upsertArgs.create).toMatchObject({
        status: "failed",
        aiSummary: null,
        attempts: 2,
        // The refusal itself is what's stored, not the first attempt's check reasons.
        failureReasons: ["refusal"],
      });
    });
  });

  it("computes the hash before generating, runs the check before retrying, and sends the failed reason's corrective sentence on the retry (order of operations)", async () => {
    const order: string[] = [];
    const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(TOUR);
    const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockImplementation(async () => {
      order.push("upsert");
    });
    const generate = jest
      .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
      .mockImplementationOnce(async (request) => {
        order.push("generate:1");
        expect(request.groundingHash).toBe(CURRENT_HASH);
        expect(request.attempt).toBe(1);
        return { kind: "text", text: PRICE_FAIL_TEXT, usage: USAGE };
      })
      .mockImplementationOnce(async (request) => {
        order.push("generate:2");
        expect(request.groundingHash).toBe(CURRENT_HASH);
        expect(request.attempt).toBe(2);
        expect(request.userMessage).toBe(CORRECTIVE_SENTENCES.price_language);
        return { kind: "text", text: PASSING_SUMMARY, usage: USAGE };
      });

    const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "generated", status: "published" });
    // Proves the sequence, not just the end state: the retry (generate:2) only
    // happens after the first attempt's check has run and failed, and no row
    // is saved until both attempts (and their checks) have resolved.
    expect(order).toEqual(["generate:1", "generate:2", "upsert"]);
  });
});
