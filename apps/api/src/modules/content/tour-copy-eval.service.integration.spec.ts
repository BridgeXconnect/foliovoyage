import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
import { TourCopyEvalService } from "./tour-copy-eval.service";
import { cleanVerdict, FakeJudge, unsupportedVerdict, ZERO_USAGE } from "./tour-copy-judge.fake";
import { getJudgeRubric } from "./tour-copy-judge-rubric";

/**
 * Integration tests for {@link TourCopyEvalService} against a **real
 * Postgres** (BRI-201 / spec 0003, build plan task 3): judge one published
 * row with a fake judge, store the `TourCopyEval` row, and apply the kill
 * switch. No model call is ever made; the judge sits behind its port.
 *
 * Fixtures are scoped by `provider: "tour-copy-eval-test"` and a dedicated
 * City so they never touch the rows other integration specs manage.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient(DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined);

const PROVIDER = "tour-copy-eval-test";
const COUNTRY_SLUG = "tour-copy-eval-land";
const CITY_SLUG = "tour-copy-eval-city";

const DESCRIPTION =
  "Glide along peaceful canals in a traditional longtail boat through the historic floating markets of Bangkok. Your guide points out colorful stalls selling tropical fruit, fragrant spices, and handmade crafts along the water. Afterward, wander through a quiet riverside temple before returning to your hotel in the city center. This small-group tour captures everyday local life away from the busy streets of Bangkok.";

const SUMMARY = "A published paragraph about the floating market tour.";

const SONNET = "claude-sonnet-5";
const HAIKU = "claude-haiku-4-5-20251001";
const OPUS = "claude-opus-5-5";
const RUBRIC_VERSION = getJudgeRubric("tour_copy").version;

function evalService(judge: FakeJudge): TourCopyEvalService {
  return new TourCopyEvalService(prisma as unknown as PrismaService, judge);
}

async function city(): Promise<{ id: string }> {
  return prisma.city.upsert({
    where: { countrySlug_slug: { countrySlug: COUNTRY_SLUG, slug: CITY_SLUG } },
    update: {},
    create: {
      slug: CITY_SLUG,
      countrySlug: COUNTRY_SLUG,
      name: "Eval City",
      country: "Evalland",
      heroImageUrl: "https://example.test/hero.jpg",
      heroImageAlt: "Eval City hero",
    },
    select: { id: true },
  });
}

interface SeedOptions {
  promptVersion?: number;
  model?: string;
  status?: "published" | "failed" | "withdrawn";
  experienceStatus?: string;
  ratingCount?: number;
  deletedAt?: Date | null;
  generatedAt?: Date;
}

/** One tour with its Experience and a `TourCopy` row whose hash matches the tour. */
async function seed(providerTourId: string, options: SeedOptions = {}): Promise<{ tourId: string; copyId: string }> {
  const { id: cityId } = await city();
  const experience = await prisma.experience.create({
    data: {
      title: `Experience ${providerTourId}`,
      description: "An experience.",
      status: options.experienceStatus ?? "published",
      latitude: 13.7,
      longitude: 100.5,
      cityId,
      sourceProvider: PROVIDER,
      sourceProviderTourId: providerTourId,
    },
    select: { id: true },
  });
  const title = `Tour ${providerTourId}`;
  const tour = await prisma.tour.create({
    data: {
      provider: PROVIDER,
      providerTourId,
      title,
      description: DESCRIPTION,
      durationMin: 240,
      inclusions: [] as never,
      exclusions: [] as never,
      ratingAvg: 4.5,
      ratingCount: options.ratingCount ?? 20,
      deletedAt: options.deletedAt ?? null,
      experienceId: experience.id,
      fetchedAt: new Date(),
      sourceHash: `hash-${providerTourId}`,
    },
    select: { id: true },
  });
  const groundingHash = computeGroundingHash({ title, description: DESCRIPTION, durationMin: 240, inclusions: [], exclusions: [] });
  const copy = await prisma.tourCopy.create({
    data: {
      tourId: tour.id,
      status: options.status ?? "published",
      aiSummary: SUMMARY,
      groundingHash,
      model: options.model ?? SONNET,
      promptVersion: options.promptVersion ?? 4,
      generatedAt: options.generatedAt ?? new Date(),
      attempts: 1,
      failureReasons: [],
      runId: "seed_run",
    },
    select: { id: true },
  });
  return { tourId: tour.id, copyId: copy.id };
}

async function seedMany(count: number, prefix: string, options: SeedOptions = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push((await seed(`${prefix}-${i}`, options)).tourId);
  return ids;
}

async function cleanup(): Promise<void> {
  await prisma.tourCopy.deleteMany({ where: { tour: { provider: PROVIDER } } });
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.experience.deleteMany({ where: { sourceProvider: PROVIDER } });
  await prisma.city.deleteMany({ where: { countrySlug: COUNTRY_SLUG } });
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const PAIR = { promptVersion: 4, model: SONNET };

describe("TourCopyEvalService.judgeOne (integration)", () => {
  it("stores one judge row for a served paragraph, tied to the exact copy and rubric version (AC-7, AC-8)", async () => {
    const { tourId, copyId } = await seed("J1");
    const judge = new FakeJudge();

    const outcome = await evalService(judge).judgeOne(tourId, { runId: "eval_1" });

    expect(outcome).toMatchObject({ kind: "judged", claimVerdict: "clean", leadsWithFact: true });
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0]).toMatchObject({ contentType: "tour_copy", runId: "eval_1", tourId, paragraph: SUMMARY });

    const rows = await prisma.tourCopyEval.findMany({ where: { tourCopyId: copyId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      evaluator: "judge",
      evaluatorModel: OPUS,
      rubricVersion: RUBRIC_VERSION,
      claimVerdict: "clean",
      leadsWithFact: true,
      judgedText: SUMMARY,
      promptVersion: 4,
      model: SONNET,
      evalRunId: "eval_1",
    });
  });

  it("does not judge the same copy twice at the same rubric version (AC-7)", async () => {
    const { tourId } = await seed("J2");
    const judge = new FakeJudge();
    const service = evalService(judge);

    await service.judgeOne(tourId, { runId: "eval_1" });
    const second = await service.judgeOne(tourId, { runId: "eval_2" });

    expect(second).toEqual({ kind: "skipped", reason: "already_judged" });
    expect(judge.calls).toHaveLength(1);
  });

  it("judges regenerated copy again, because the verdict is tied to the copy's generatedAt (AC-8)", async () => {
    const { tourId, copyId } = await seed("J3");
    const judge = new FakeJudge();
    const service = evalService(judge);
    await service.judgeOne(tourId, { runId: "eval_1" });

    await prisma.tourCopy.update({ where: { id: copyId }, data: { generatedAt: new Date(Date.now() + 60_000) } });
    const outcome = await service.judgeOne(tourId, { runId: "eval_2" });

    expect(outcome.kind).toBe("judged");
    expect(await prisma.tourCopyEval.count({ where: { tourCopyId: copyId } })).toBe(2);
  });

  it("never judges a row whose tour changed after generation (hash mismatch) (AC-7)", async () => {
    const { tourId } = await seed("J4");
    await prisma.tour.update({ where: { id: tourId }, data: { title: "A brand new title" } });
    const judge = new FakeJudge();

    const outcome = await evalService(judge).judgeOne(tourId, { runId: "eval_1" });

    expect(outcome).toEqual({ kind: "skipped", reason: "not_served" });
    expect(judge.calls).toHaveLength(0);
  });

  it.each([
    ["a failed row", { status: "failed" as const }],
    ["a withdrawn row", { status: "withdrawn" as const }],
    ["a draft Experience", { experienceStatus: "draft" }],
    ["a soft deleted tour", { deletedAt: new Date() }],
    ["a tour that is no longer eligible", { ratingCount: 1 }],
  ])("never judges %s (AC-7)", async (_label, options) => {
    const { tourId } = await seed("J5", options);
    const judge = new FakeJudge();

    const outcome = await evalService(judge).judgeOne(tourId, { runId: "eval_1" });

    expect(outcome).toEqual({ kind: "skipped", reason: "not_served" });
    expect(judge.calls).toHaveLength(0);
  });

  it("never judges a row the judge model itself generated (AC-7)", async () => {
    const { tourId } = await seed("J6", { model: OPUS });
    const judge = new FakeJudge();

    const outcome = await evalService(judge).judgeOne(tourId, { runId: "eval_1" });

    expect(outcome).toEqual({ kind: "skipped", reason: "same_model" });
    expect(judge.calls).toHaveLength(0);
  });

  it("counts a duplicate insert from a concurrent run as a skip, not a failure (AC-8)", async () => {
    const { tourId, copyId } = await seed("J7");
    // A slow judge lets a second run store the same verdict while this one is still waiting.
    const judge = new FakeJudge(async () => {
      const copy = await prisma.tourCopy.findUniqueOrThrow({ where: { id: copyId } });
      await prisma.tourCopyEval.create({
        data: {
          tourCopyId: copyId,
          copyGeneratedAt: copy.generatedAt,
          judgedText: SUMMARY,
          promptVersion: 4,
          model: SONNET,
          groundingHash: copy.groundingHash,
          evaluator: "judge",
          evaluatorModel: OPUS,
          rubricVersion: RUBRIC_VERSION,
          claims: [],
          claimVerdict: "clean",
          leadsWithFact: true,
          evalRunId: "other_run",
        },
      });
      return { kind: "verdict", verdict: cleanVerdict(), usage: ZERO_USAGE };
    });

    const outcome = await evalService(judge).judgeOne(tourId, { runId: "eval_1" });

    expect(outcome).toEqual({ kind: "skipped", reason: "duplicate" });
    expect(await prisma.tourCopyEval.count({ where: { tourCopyId: copyId } })).toBe(1);
  });

  it("stores nothing for a refusal or an invalid result", async () => {
    const { tourId, copyId } = await seed("J8");

    const refusal = await evalService(new FakeJudge(() => ({ kind: "refusal", usage: ZERO_USAGE }))).judgeOne(tourId, {
      runId: "eval_1",
    });
    const invalid = await evalService(new FakeJudge(() => ({ kind: "invalid", usage: ZERO_USAGE }))).judgeOne(tourId, {
      runId: "eval_1",
    });

    expect(refusal.kind).toBe("judge_refusal");
    expect(invalid.kind).toBe("judge_invalid");
    expect(await prisma.tourCopyEval.count({ where: { tourCopyId: copyId } })).toBe(0);
  });
});

describe("TourCopyEvalService.applyKillSwitch (integration)", () => {
  async function judgeAll(service: TourCopyEvalService, tourIds: string[]): Promise<void> {
    for (const id of tourIds) await service.judgeOne(id, { runId: "eval_1" });
  }

  it("makes no withdrawal when 40 judged rows are all clean (AC-9)", async () => {
    const ids = await seedMany(40, "K1");
    const service = evalService(new FakeJudge());
    await judgeAll(service, ids);

    const result = await service.applyKillSwitch(PAIR, { runId: "eval_1", execute: true });

    expect(result).toMatchObject({ decision: "ok", withdrawn: 0, stats: { judged: 40, bad: 0 } });
    expect(await prisma.tourCopy.count({ where: { status: "withdrawn" } })).toBe(0);
  });

  it("withdraws every published row of the pair when 3 of 40 judged rows are bad, and leaves other pairs alone (AC-9)", async () => {
    const ids = await seedMany(40, "K2");
    const unjudged = await seedMany(5, "K2-unjudged"); // same pair, never judged: still withdrawn
    const otherPair = await seedMany(3, "K2-other", { promptVersion: 3, model: HAIKU });
    const badIds = new Set(ids.slice(0, 3));
    const judge = new FakeJudge((request) =>
      badIds.has(request.tourId)
        ? { kind: "verdict", verdict: unsupportedVerdict(), usage: ZERO_USAGE }
        : { kind: "verdict", verdict: cleanVerdict(), usage: ZERO_USAGE },
    );
    const service = evalService(judge);
    await judgeAll(service, ids);

    const result = await service.applyKillSwitch(PAIR, { runId: "eval_9", execute: true });

    expect(result).toMatchObject({ decision: "withdraw", withdrawn: 45, stats: { judged: 40, bad: 3 } });
    expect(result.badPages.map((page) => page.tourId).sort()).toEqual([...badIds].sort());

    const withdrawn = await prisma.tourCopy.findMany({ where: { status: "withdrawn" } });
    expect(withdrawn).toHaveLength(45);
    expect(withdrawn.every((row) => row.withdrawnByRunId === "eval_9" && row.withdrawnAt !== null)).toBe(true);
    expect(withdrawn.every((row) => row.aiSummary === SUMMARY)).toBe(true);
    expect(new Set(withdrawn.map((row) => row.tourId))).toEqual(new Set([...ids, ...unjudged]));
    expect(await prisma.tourCopy.count({ where: { tourId: { in: otherPair }, status: "published" } })).toBe(3);
  });

  it("does not withdraw at exactly 5% bad (2 of 40) (AC-9)", async () => {
    const ids = await seedMany(40, "K3");
    const badIds = new Set(ids.slice(0, 2));
    const service = evalService(
      new FakeJudge((request) =>
        badIds.has(request.tourId)
          ? { kind: "verdict", verdict: unsupportedVerdict(), usage: ZERO_USAGE }
          : { kind: "verdict", verdict: cleanVerdict(), usage: ZERO_USAGE },
      ),
    );
    await judgeAll(service, ids);

    const result = await service.applyKillSwitch(PAIR, { runId: "eval_1", execute: true });

    expect(result).toMatchObject({ decision: "ok", withdrawn: 0, stats: { judged: 40, bad: 2 } });
  });

  it("makes no decision below 30 judged rows, however many are bad (AC-9)", async () => {
    const ids = await seedMany(20, "K4");
    const badIds = new Set(ids.slice(0, 5));
    const service = evalService(
      new FakeJudge((request) =>
        badIds.has(request.tourId)
          ? { kind: "verdict", verdict: unsupportedVerdict(), usage: ZERO_USAGE }
          : { kind: "verdict", verdict: cleanVerdict(), usage: ZERO_USAGE },
      ),
    );
    await judgeAll(service, ids);

    const result = await service.applyKillSwitch(PAIR, { runId: "eval_1", execute: true });

    expect(result).toMatchObject({ decision: "insufficient", withdrawn: 0, stats: { judged: 20, bad: 5 } });
    expect(await prisma.tourCopy.count({ where: { status: "withdrawn" } })).toBe(0);
  });

  it("decides but changes nothing on a dry run, and a rerun after a withdrawal changes nothing (AC-9)", async () => {
    const ids = await seedMany(30, "K5");
    const badIds = new Set(ids.slice(0, 3));
    const service = evalService(
      new FakeJudge((request) =>
        badIds.has(request.tourId)
          ? { kind: "verdict", verdict: unsupportedVerdict(), usage: ZERO_USAGE }
          : { kind: "verdict", verdict: cleanVerdict(), usage: ZERO_USAGE },
      ),
    );
    await judgeAll(service, ids);

    const dry = await service.applyKillSwitch(PAIR, { runId: "eval_1", execute: false });
    expect(dry).toMatchObject({ decision: "withdraw", withdrawn: 0 });
    expect(await prisma.tourCopy.count({ where: { status: "withdrawn" } })).toBe(0);

    await service.applyKillSwitch(PAIR, { runId: "eval_1", execute: true });
    const rerun = await service.applyKillSwitch(PAIR, { runId: "eval_2", execute: true });

    // The rows are no longer published, so nothing is counted and nothing moves.
    expect(rerun).toMatchObject({ decision: "insufficient", withdrawn: 0, stats: { judged: 0 } });
    const rows = await prisma.tourCopy.findMany({ where: { status: "withdrawn" } });
    expect(rows.every((row) => row.withdrawnByRunId === "eval_1")).toBe(true);
  });

  it("counts only verdicts for the row's current copy, so regenerated copy has no verdicts yet (AC-9)", async () => {
    const ids = await seedMany(30, "K6");
    const service = evalService(new FakeJudge(() => ({ kind: "verdict", verdict: unsupportedVerdict(), usage: ZERO_USAGE })));
    await judgeAll(service, ids);

    // Every paragraph is regenerated: the old verdicts judged text that is gone.
    await prisma.tourCopy.updateMany({
      where: { tourId: { in: ids } },
      data: { generatedAt: new Date(Date.now() + 60_000) },
    });

    const result = await service.applyKillSwitch(PAIR, { runId: "eval_2", execute: true });

    expect(result).toMatchObject({ decision: "insufficient", withdrawn: 0, stats: { judged: 0, bad: 0 } });
  });

  it("counts only verdicts at the current rubric version (AC-9)", async () => {
    const ids = await seedMany(30, "K7");
    const service = evalService(new FakeJudge(() => ({ kind: "verdict", verdict: unsupportedVerdict(), usage: ZERO_USAGE })));
    await judgeAll(service, ids);
    await prisma.tourCopyEval.updateMany({ where: { evalRunId: "eval_1" }, data: { rubricVersion: RUBRIC_VERSION + 1 } });

    const result = await service.applyKillSwitch(PAIR, { runId: "eval_2", execute: true });

    expect(result).toMatchObject({ decision: "insufficient", stats: { judged: 0 } });
  });

  it("deletes a row's evals when the TourCopy is deleted (AC-8)", async () => {
    const { tourId, copyId } = await seed("K8");
    await evalService(new FakeJudge()).judgeOne(tourId, { runId: "eval_1" });

    await prisma.tourCopy.delete({ where: { id: copyId } });

    expect(await prisma.tourCopyEval.count({ where: { tourCopyId: copyId } })).toBe(0);
  });
});
