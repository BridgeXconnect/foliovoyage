import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { loadEvalInputs, planEvalSample, seededRandom } from "./tour-copy-eval-sample";
import { computeGroundingHash } from "./tour-copy-grounding-hash";
import { getJudgeRubric } from "./tour-copy-judge-rubric";

/**
 * Integration tests for {@link loadEvalInputs} against a **real Postgres**
 * (BRI-201 / spec 0003, AC-7): only currently served rows come back, each
 * with its city and whether it already has a verdict at the current rubric
 * version. No model call is made.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient(DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined);
const service = prisma as unknown as PrismaService;

const PROVIDER = "tour-copy-sample-test";
const COUNTRY_SLUG = "tour-copy-sample-land";
const SONNET = "claude-sonnet-5";
const HAIKU = "claude-haiku-4-5-20251001";
const RUBRIC_VERSION = getJudgeRubric("tour_copy").version;

const DESCRIPTION =
  "Glide along peaceful canals in a traditional longtail boat through the historic floating markets of Bangkok. Your guide points out colorful stalls selling tropical fruit, fragrant spices, and handmade crafts along the water.";

async function city(slug: string): Promise<{ id: string }> {
  return prisma.city.upsert({
    where: { countrySlug_slug: { countrySlug: COUNTRY_SLUG, slug } },
    update: {},
    create: {
      slug,
      countrySlug: COUNTRY_SLUG,
      name: slug,
      country: "Sampleland",
      heroImageUrl: "https://example.test/hero.jpg",
      heroImageAlt: "hero",
    },
    select: { id: true },
  });
}

interface SeedOptions {
  citySlug?: string;
  model?: string;
  promptVersion?: number;
  status?: "published" | "failed" | "withdrawn";
  experienceStatus?: string;
  deletedAt?: Date | null;
  staleHash?: boolean;
  generatedAt?: Date;
}

async function seed(providerTourId: string, options: SeedOptions = {}): Promise<{ tourId: string; copyId: string; generatedAt: Date }> {
  const { id: cityId } = await city(options.citySlug ?? "sample-a");
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
      ratingCount: 20,
      deletedAt: options.deletedAt ?? null,
      experienceId: experience.id,
      fetchedAt: new Date(),
      sourceHash: `hash-${providerTourId}`,
    },
    select: { id: true },
  });
  const hash = computeGroundingHash({ title, description: DESCRIPTION, durationMin: 240, inclusions: [], exclusions: [] });
  const generatedAt = options.generatedAt ?? new Date();
  const copy = await prisma.tourCopy.create({
    data: {
      tourId: tour.id,
      status: options.status ?? "published",
      aiSummary: "A published paragraph.",
      groundingHash: options.staleHash ? "v1:stale" : hash,
      model: options.model ?? SONNET,
      promptVersion: options.promptVersion ?? 4,
      generatedAt,
      attempts: 1,
      failureReasons: [],
      runId: "seed_run",
    },
    select: { id: true },
  });
  return { tourId: tour.id, copyId: copy.id, generatedAt };
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

/** The real DB may hold other rows, so results are narrowed to this spec's tours. */
async function ownTourIds(): Promise<Set<string>> {
  return new Set((await prisma.tour.findMany({ where: { provider: PROVIDER }, select: { id: true } })).map((tour) => tour.id));
}

describe("loadEvalInputs (integration, spec 0003 AC-7)", () => {
  it("returns only currently served rows, each with its city", async () => {
    const good = await seed("S1");
    await seed("S2", { status: "failed" });
    await seed("S3", { status: "withdrawn" });
    await seed("S4", { staleHash: true });
    await seed("S5", { deletedAt: new Date() });
    await seed("S6", { experienceStatus: "draft" });
    const other = await seed("S7", { citySlug: "sample-b" });

    const { rows } = await loadEvalInputs(service, { model: SONNET }, RUBRIC_VERSION);
    const own = await ownTourIds();
    const mine = rows.filter((row) => own.has(row.tourId));

    expect(mine.map((row) => row.tourId).sort()).toEqual([good.tourId, other.tourId].sort());
    const byTour = new Map(mine.map((row) => [row.tourId, row]));
    expect(byTour.get(good.tourId)).toMatchObject({ cityLabel: "sample-a", judged: false, promptVersion: 4, model: SONNET });
    expect(byTour.get(other.tourId)).toMatchObject({ cityLabel: "sample-b" });
    expect(byTour.get(good.tourId)!.cityId).not.toBe(byTour.get(other.tourId)!.cityId);
    expect(byTour.get(good.tourId)!.promptChars).toBeGreaterThan(getJudgeRubric("tour_copy").systemPrompt.length);
  });

  it("lists a pair that has published rows even when none of them is served now", async () => {
    await seed("P1", { staleHash: true, promptVersion: 9, model: HAIKU });

    const { pairs, rows } = await loadEvalInputs(service, { promptVersion: 9, model: HAIKU }, RUBRIC_VERSION);

    expect(pairs).toEqual([{ promptVersion: 9, model: HAIKU }]);
    expect(rows).toEqual([]);
  });

  it("marks judged only for a verdict at the current rubric version on the exact copy", async () => {
    const judged = await seed("V1");
    const otherRubric = await seed("V2");
    const regenerated = await seed("V3");
    const unjudged = await seed("V4");
    const verdict = (copyId: string, copyGeneratedAt: Date, rubricVersion: number) =>
      prisma.tourCopyEval.create({
        data: {
          tourCopyId: copyId,
          copyGeneratedAt,
          judgedText: "A published paragraph.",
          promptVersion: 4,
          model: SONNET,
          groundingHash: "h",
          evaluator: "judge",
          evaluatorModel: "claude-opus-5-5",
          rubricVersion,
          claims: [],
          claimVerdict: "clean",
          leadsWithFact: true,
          evalRunId: "old_run",
        },
      });
    await verdict(judged.copyId, judged.generatedAt, RUBRIC_VERSION);
    await verdict(otherRubric.copyId, otherRubric.generatedAt, RUBRIC_VERSION + 1);
    await verdict(regenerated.copyId, new Date(regenerated.generatedAt.getTime() - 60_000), RUBRIC_VERSION);

    const { rows } = await loadEvalInputs(service, { model: SONNET }, RUBRIC_VERSION);
    const byTour = new Map(rows.map((row) => [row.tourId, row.judged]));

    expect(byTour.get(judged.tourId)).toBe(true);
    expect(byTour.get(otherRubric.tourId)).toBe(false);
    expect(byTour.get(regenerated.tourId)).toBe(false);
    expect(byTour.get(unjudged.tourId)).toBe(false);
  });

  it("narrows by prompt version and model", async () => {
    const sonnet = await seed("N1");
    const haiku = await seed("N2", { model: HAIKU });
    const v3 = await seed("N3", { promptVersion: 3 });

    const own = await ownTourIds();
    const ids = async (filter: { promptVersion?: number; model?: string }) =>
      (await loadEvalInputs(service, filter, RUBRIC_VERSION)).rows.filter((row) => own.has(row.tourId)).map((row) => row.tourId);

    expect(await ids({ model: HAIKU })).toEqual([haiku.tourId]);
    expect(await ids({ promptVersion: 3 })).toEqual([v3.tourId]);
    expect((await ids({})).sort()).toEqual([sonnet.tourId, haiku.tourId, v3.tourId].sort());
  });

  it("feeds the planner: stage 1 first, then a per city top up, never a judged row", async () => {
    await seed("F1");
    await seed("F2");
    await seed("F3", { citySlug: "sample-b" });
    const { pairs, rows } = await loadEvalInputs(service, { promptVersion: 4, model: SONNET }, RUBRIC_VERSION);
    const own = await ownTourIds();

    const plan = planEvalSample(pairs, rows.filter((row) => own.has(row.tourId)), {
      judgeModel: "claude-opus-5-5",
      cap: 500,
      random: seededRandom(3),
    });

    expect(plan.queue).toHaveLength(3);
    expect(plan.pairs[0].cities.map((c) => c.cityLabel).sort()).toEqual(["sample-a", "sample-b"]);
  });
});
