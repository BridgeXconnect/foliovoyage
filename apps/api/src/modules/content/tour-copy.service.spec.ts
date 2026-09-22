import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../../prisma/prisma.service";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
import type { TourCopyGenerationRequest, TourCopyGenerationResult, TourCopyGenerator } from "./tour-copy-generator";
import { TourCopyService } from "./tour-copy.service";

const USAGE = { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

const FULL_TEXT_TOUR = {
  id: "tour_1",
  title: "Bangkok Floating Market Half-Day Tour",
  description: "x".repeat(300),
  durationMin: 240,
  inclusions: [],
  exclusions: [],
  ratingAvg: 4.5,
  ratingCount: 20,
  deletedAt: null,
  experience: { status: "published" },
  tourCopy: null,
};

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
  it("generates and stores a published row for an eligible tour (AC-1, AC-4)", async () => {
    const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(FULL_TEXT_TOUR);
    const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
    const generate = jest
      .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
      .mockResolvedValue({ kind: "text", text: "A fake paragraph.", usage: USAGE });

    const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "generated", status: "published" });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run_1", tourId: "tour_1", attempt: 1 }),
    );
    const upsertArgs = upsert.mock.calls[0][0] as {
      where: { tourId: string };
      create: Record<string, unknown>;
    };
    expect(upsertArgs.where).toEqual({ tourId: "tour_1" });
    expect(upsertArgs.create).toMatchObject({
      tourId: "tour_1",
      status: "published",
      aiSummary: "A fake paragraph.",
      model: "claude-sonnet-5",
      promptVersion: 1,
      attempts: 1,
      failureReasons: [],
      runId: "run_1",
    });
  });

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

  it("skips a soft-deleted tour (AC-1)", async () => {
    const findUnique = jest
      .fn<(a: unknown) => Promise<unknown>>()
      .mockResolvedValue({ ...FULL_TEXT_TOUR, deletedAt: new Date() });
    const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

    const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "deleted" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("skips a tour on a non-published Experience (AC-1)", async () => {
    const findUnique = jest
      .fn<(a: unknown) => Promise<unknown>>()
      .mockResolvedValue({ ...FULL_TEXT_TOUR, experience: { status: "draft" } });
    const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

    const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "experience_not_published" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("skips a tour with no linked Experience (AC-1)", async () => {
    const findUnique = jest
      .fn<(a: unknown) => Promise<unknown>>()
      .mockResolvedValue({ ...FULL_TEXT_TOUR, experience: null });
    const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

    const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "experience_not_published" });
  });

  it("skips an ineligible tour (AC-1)", async () => {
    const findUnique = jest
      .fn<(a: unknown) => Promise<unknown>>()
      .mockResolvedValue({ ...FULL_TEXT_TOUR, ratingCount: 1 });
    const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

    const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "not_eligible" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("skips a thin-source tour with reason source_too_thin, before any model call (AC-1)", async () => {
    const findUnique = jest
      .fn<(a: unknown) => Promise<unknown>>()
      .mockResolvedValue({ ...FULL_TEXT_TOUR, description: "Too short." });
    const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

    const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "source_too_thin" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("skips a tour whose published row already matches the current hash (AC-7)", async () => {
    // Compute the real hash so the fixture actually matches, rather than
    // hardcoding a digest that would need updating if the algorithm changes.
    const currentHash = computeGroundingHash(FULL_TEXT_TOUR);
    const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue({
      ...FULL_TEXT_TOUR,
      tourCopy: { status: "published", groundingHash: currentHash },
    });
    const generate = jest.fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>();

    const outcome = await makeService(findUnique, jest.fn(), generate).generateOne("tour_1", {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "already_current" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("regenerates a published row whose hash no longer matches (AC-7)", async () => {
    const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue({
      ...FULL_TEXT_TOUR,
      tourCopy: { status: "published", groundingHash: "v1:stale" },
    });
    const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
    const generate = jest
      .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
      .mockResolvedValue({ kind: "text", text: "Fresh paragraph.", usage: USAGE });

    const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "generated", status: "published" });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("stores a failed row on refusal, without retrying (task 3's thin thread has no retry yet)", async () => {
    const findUnique = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(FULL_TEXT_TOUR);
    const upsert = jest.fn<(a: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
    const generate = jest
      .fn<(r: TourCopyGenerationRequest) => Promise<TourCopyGenerationResult>>()
      .mockResolvedValue({ kind: "refusal", usage: USAGE });

    const outcome = await makeService(findUnique, upsert, generate).generateOne("tour_1", {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "generated", status: "failed" });
    const upsertArgs = upsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(upsertArgs.create).toMatchObject({
      status: "failed",
      aiSummary: null,
      attempts: 1,
      failureReasons: ["refusal"],
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
